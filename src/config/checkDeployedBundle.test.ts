/**
 * `scripts/check-deployed-bundle.mjs` contre un serveur HTTP LOCAL, jamais la production.
 *
 * Pourquoi ce fichier existe : au run 43885534027 l'etape « Verify production serves this build »
 * a affiche ses quatre « OK » puis n'a plus rien dit pendant six minutes, jusqu'a l'annulation du
 * job (15 min) : le script avait fini, le processus ne sortait pas. Le corps de la vignette
 * n'etait ni lu ni annule et aucune requete n'avait de delai. Chaque scenario ci-dessous lance le
 * VRAI script dans un processus a part, avec une limite de temps, et verifie le code de sortie ET
 * qu'il se termine de lui-meme (jamais tue par la limite).
 *
 * Falsifie a la main le 2026-11-16 (voir la PR) : sans l'annulation du corps, le scenario « corps
 * inacheve » depasse sa borne ; sans le delai, les scenarios « serveur muet » et « lecture
 * bloquee » sont tues par la limite ; avec l'ancien motif `\\d`, le scenario « cache long sans
 * immutable » passe a tort.
 */
import { spawn } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_ATTEMPTS,
  DEFAULT_DELAY_MS,
  DEFAULT_FETCH_TIMEOUT_MS,
  readLimits,
  worstCaseMs,
} from '../../scripts/deployed-bundle-limits.mjs';

const SCRIPT = resolve(__dirname, '../../scripts/check-deployed-bundle.mjs');
const ENTRY = 'SolarSystemApp-abc123.js';
const OLD_ENTRY = 'SolarSystemApp-old999.js';
const REVALIDATE = 'public, max-age=0, must-revalidate';
/** Borne dure d'un scenario : au-dela, le processus est TUE et le test echoue. */
const HARD_LIMIT_MS = 20_000;

let workDir = '';

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'gx-deploycheck-'));
  mkdirSync(join(workDir, 'dist', 'assets'), { recursive: true });
  writeFileSync(join(workDir, 'dist', 'assets', ENTRY), '//');
});
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

interface Route {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Buffer;
  /** Les en-tetes partent, une partie du corps aussi, puis plus rien. */
  stallBody?: boolean;
  /** Aucune reponse, jamais. */
  mute?: boolean;
}
type Handler = (method: string, path: string, call: number) => Route;

interface Fake {
  origin: string;
  hits: () => number;
  close: () => Promise<void>;
}

async function serve(handler: Handler): Promise<Fake> {
  const counts = new Map<string, number>();
  const sockets = new Set<Socket>();
  let total = 0;
  const server = http.createServer((req, res) => {
    total++;
    const key = `${req.method} ${req.url}`;
    const call = (counts.get(key) ?? 0) + 1;
    counts.set(key, call);
    const route = handler(req.method ?? 'GET', req.url ?? '/', call);
    if (route.mute) return;
    const body = route.body ?? '';
    const length = route.stallBody ? 2_000_000 : Buffer.byteLength(body);
    res.writeHead(route.status ?? 200, {
      'content-length': String(length),
      ...(route.headers ?? {}),
    });
    if (req.method === 'HEAD') return void res.end();
    if (route.stallBody) {
      res.write(Buffer.alloc(100_000, 1));
      return;
    }
    res.end(body);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    hits: () => total,
    close: () =>
      new Promise<void>((ok) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => ok());
      }),
  };
}

const indexOf = (entry: string): Route => ({
  headers: { 'content-type': 'text/html' },
  body: `<script type="module" src="/assets/${entry}"></script>`,
});

/** Un site sain : index a jour, vignette et assets stables revalides. */
const healthy: Handler = (method, path) => {
  if (path === '/') return indexOf(ENTRY);
  if (path === '/social/earth.jpg')
    return {
      headers: { 'cache-control': REVALIDATE },
      body: Buffer.alloc(20_000),
    };
  return {
    headers: { 'cache-control': REVALIDATE },
    body: method === 'HEAD' ? '' : 'x',
  };
};

interface Outcome {
  code: number | null;
  signal: NodeJS.Signals | null;
  killed: boolean;
  ms: number;
  stdout: string;
  stderr: string;
}

function run(env: Record<string, string | undefined>): Promise<Outcome> {
  return new Promise((done) => {
    const started = Date.now();
    const childEnv: Record<string, string | undefined> = { ...process.env };
    for (const name of [
      'SITE_ORIGIN',
      'ATTEMPTS',
      'DELAY_MS',
      'FETCH_TIMEOUT_MS',
    ])
      delete childEnv[name];
    const child = spawn(process.execPath, [SCRIPT], {
      cwd: workDir,
      env: { ...childEnv, ...env },
    });
    let stdout = '';
    let stderr = '';
    let killed = false;
    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, HARD_LIMIT_MS);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      done({ code, signal, killed, ms: Date.now() - started, stdout, stderr });
    });
  });
}

/** Le script a fini DE LUI-MEME : ni tue par la limite, ni coupe par un signal. */
const endedNaturally = (outcome: Outcome): void => {
  expect(outcome.killed, 'tue par la limite de temps').toBe(false);
  expect(outcome.signal).toBeNull();
};

async function scenario(
  handler: Handler,
  env: Record<string, string>
): Promise<{ outcome: Outcome; fake: Fake }> {
  const fake = await serve(handler);
  try {
    const outcome = await run({ SITE_ORIGIN: fake.origin, ...env });
    return { outcome, fake };
  } finally {
    await fake.close();
  }
}

describe('check-deployed-bundle : serveur local', () => {
  it('reponses normales : code 0, quatre controles, fin naturelle et rapide', async () => {
    const { outcome } = await scenario(healthy, { ATTEMPTS: '1' });
    endedNaturally(outcome);
    expect(outcome.code).toBe(0);
    expect(outcome.stdout).toContain(`sert bien ${ENTRY}`);
    expect(outcome.stdout).toContain('vignettes servies');
    expect(outcome.stdout.match(/se revalide/g)).toHaveLength(2);
    expect(outcome.ms).toBeLessThan(4_000);
  }, 30_000);

  it('corps volumineux : fin naturelle et rapide', async () => {
    const big: Handler = (method, path, call) =>
      path === '/social/earth.jpg'
        ? {
            headers: { 'cache-control': REVALIDATE },
            body: Buffer.alloc(3_000_000, 1),
          }
        : healthy(method, path, call);
    const { outcome } = await scenario(big, { ATTEMPTS: '1' });
    endedNaturally(outcome);
    expect(outcome.code).toBe(0);
    expect(outcome.ms).toBeLessThan(4_000);
  }, 30_000);

  it('corps INACHEVE apres les en-tetes : le corps est annule, le processus sort vite', async () => {
    // Le delai est laisse a 20 s : seule l'ANNULATION du corps peut expliquer une sortie rapide.
    const unfinished: Handler = (method, path, call) =>
      path === '/social/earth.jpg'
        ? { headers: { 'cache-control': REVALIDATE }, stallBody: true }
        : healthy(method, path, call);
    const { outcome } = await scenario(unfinished, {
      ATTEMPTS: '1',
      FETCH_TIMEOUT_MS: '20000',
    });
    endedNaturally(outcome);
    expect(outcome.code).toBe(0);
    expect(outcome.stdout).toContain('vignettes servies');
    // L'ancienne version attendait le ramasse-miettes : 6 a 8 s mesures en local.
    expect(outcome.ms).toBeLessThan(3_500);
  }, 30_000);

  it('serveur MUET sur la vignette : expiration diagnostiquee, code 1, fin naturelle', async () => {
    const mute: Handler = (method, path, call) =>
      path === '/social/earth.jpg'
        ? { mute: true }
        : healthy(method, path, call);
    const { outcome } = await scenario(mute, {
      ATTEMPTS: '1',
      FETCH_TIMEOUT_MS: '400',
    });
    endedNaturally(outcome);
    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toMatch(/vignette : expiration apres 0\.4 s/);
    expect(outcome.stderr).toContain('/social/earth.jpg');
    expect(outcome.ms).toBeLessThan(4_000);
  }, 30_000);

  it('lecture BLOQUEE apres les en-tetes de l’index : le delai couvre le corps', async () => {
    const stalled: Handler = (method, path, call) =>
      path === '/'
        ? { headers: { 'content-type': 'text/html' }, stallBody: true }
        : healthy(method, path, call);
    const { outcome } = await scenario(stalled, {
      ATTEMPTS: '1',
      FETCH_TIMEOUT_MS: '400',
    });
    endedNaturally(outcome);
    expect(outcome.code).toBe(1);
    expect(outcome.stdout).toMatch(
      /tentative 1\/1 : index : expiration apres 0\.4 s/
    );
    expect(outcome.stderr).toContain('LA PRODUCTION NE SERT PAS CE BUILD');
    expect(outcome.ms).toBeLessThan(4_000);
  }, 30_000);

  it('serveur MUET sur l’index : chaque tentative expire, les tentatives sont toutes jouees', async () => {
    const mute: Handler = () => ({ mute: true });
    const { outcome } = await scenario(mute, {
      ATTEMPTS: '3',
      DELAY_MS: '20',
      FETCH_TIMEOUT_MS: '300',
    });
    endedNaturally(outcome);
    expect(outcome.code).toBe(1);
    expect(outcome.stdout.match(/expiration apres 0\.3 s/g)).toHaveLength(3);
    expect(outcome.ms).toBeLessThan(6_000);
  }, 30_000);

  it('reponse HTTP en erreur sur l’index : diagnostic, code 1, fin naturelle', async () => {
    const broken: Handler = () => ({ status: 503, body: 'indisponible' });
    const { outcome } = await scenario(broken, {
      ATTEMPTS: '2',
      DELAY_MS: '20',
    });
    endedNaturally(outcome);
    expect(outcome.code).toBe(1);
    expect(outcome.stdout).toMatch(/tentative 1\/2 : .* répond 503/);
    expect(outcome.stderr).toContain('LA PRODUCTION NE SERT PAS CE BUILD');
  }, 30_000);

  it('vignette absente (404) : code 1, message de vignette absente', async () => {
    const noCard: Handler = (method, path, call) =>
      path === '/social/earth.jpg'
        ? { status: 404, body: 'x'.repeat(5_000) }
        : healthy(method, path, call);
    const { outcome } = await scenario(noCard, { ATTEMPTS: '1' });
    endedNaturally(outcome);
    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toContain('vignette absente');
  }, 30_000);

  it('ancien bundle puis propagation du nouveau : reessaie puis reussit', async () => {
    const propagating: Handler = (method, path, call) =>
      path === '/'
        ? indexOf(call < 3 ? OLD_ENTRY : ENTRY)
        : healthy(method, path, call);
    const { outcome } = await scenario(propagating, {
      ATTEMPTS: '5',
      DELAY_MS: '50',
    });
    endedNaturally(outcome);
    expect(outcome.code).toBe(0);
    expect(outcome.stdout).toContain(`en ligne ${OLD_ENTRY}`);
    expect(outcome.stdout).toContain('tentative 2/5');
    expect(outcome.stdout).toContain(`sert bien ${ENTRY}`);
    expect(outcome.stdout).not.toContain('tentative 3/5');
  }, 30_000);

  it('bundle incorrect persistant : toutes les tentatives, code 1', async () => {
    const stale: Handler = (method, path, call) =>
      path === '/' ? indexOf(OLD_ENTRY) : healthy(method, path, call);
    const { outcome, fake } = await scenario(stale, {
      ATTEMPTS: '3',
      DELAY_MS: '20',
    });
    endedNaturally(outcome);
    expect(outcome.code).toBe(1);
    expect(outcome.stdout.match(/tentative \d\/3/g)).toHaveLength(2);
    expect(outcome.stderr).toContain('LA PRODUCTION NE SERT PAS CE BUILD');
    expect(outcome.stderr).toContain(OLD_ENTRY);
    // Trois lectures de l'index, et rien d'autre : pas de controle de cache sur un mauvais build.
    expect(fake.hits()).toBe(3);
  }, 30_000);

  it('vignette en cache immuable : code 1', async () => {
    const immutable: Handler = (method, path, call) =>
      path === '/social/earth.jpg'
        ? {
            headers: { 'cache-control': 'public, max-age=31536000, immutable' },
            body: 'x',
          }
        : healthy(method, path, call);
    const { outcome } = await scenario(immutable, { ATTEMPTS: '1' });
    endedNaturally(outcome);
    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toContain('CACHE DES VIGNETTES');
  }, 30_000);

  it('vignette en cache excessivement long SANS immutable : code 1', async () => {
    const long: Handler = (method, path, call) =>
      path === '/social/earth.jpg'
        ? {
            headers: { 'cache-control': 'public, max-age=31536000' },
            body: 'x',
          }
        : healthy(method, path, call);
    const { outcome } = await scenario(long, { ATTEMPTS: '1' });
    endedNaturally(outcome);
    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toContain('CACHE DES VIGNETTES');
  }, 30_000);

  it('asset a nom stable en cache long SANS immutable : code 1 (motif `\\d`, pas `\\\\d`)', async () => {
    const long: Handler = (method, path, call) =>
      path === '/assets/ephemerides/manifest.json'
        ? { headers: { 'cache-control': 'public, max-age=31536000' } }
        : healthy(method, path, call);
    const { outcome } = await scenario(long, { ATTEMPTS: '1' });
    endedNaturally(outcome);
    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toContain('CACHE DES ASSETS STABLES');
    expect(outcome.stderr).toContain('max-age=31536000');
  }, 30_000);

  it('asset a nom stable immuable : code 1 ; un max-age court passe', async () => {
    const immutable: Handler = (method, path, call) =>
      path === '/assets/textures/earth/earth_surface_1k.jpg'
        ? { headers: { 'cache-control': 'public, immutable' } }
        : healthy(method, path, call);
    const bad = await scenario(immutable, { ATTEMPTS: '1' });
    expect(bad.outcome.code).toBe(1);
    expect(bad.outcome.stderr).toContain('CACHE DES ASSETS STABLES');

    const short: Handler = (method, path, call) =>
      path === '/assets/textures/earth/earth_surface_1k.jpg'
        ? { headers: { 'cache-control': 'public, max-age=3600' } }
        : healthy(method, path, call);
    const good = await scenario(short, { ATTEMPTS: '1' });
    expect(good.outcome.code).toBe(0);
  }, 30_000);

  it('erreur reseau (port ferme) : diagnostic « erreur reseau », code 1', async () => {
    const closed = await serve(healthy);
    const origin = closed.origin;
    await closed.close();
    const outcome = await run({
      SITE_ORIGIN: origin,
      ATTEMPTS: '2',
      DELAY_MS: '20',
    });
    endedNaturally(outcome);
    expect(outcome.code).toBe(1);
    expect(outcome.stdout).toMatch(/tentative 1\/2 : index : erreur reseau \(/);
  }, 30_000);

  it('reglage invalide : code 2, aucune requete envoyee', async () => {
    const invalid: Record<string, string>[] = [
      { FETCH_TIMEOUT_MS: 'abc' },
      { FETCH_TIMEOUT_MS: '' },
      { FETCH_TIMEOUT_MS: '10' },
      { ATTEMPTS: '0' },
      { DELAY_MS: '-5' },
      { ATTEMPTS: '2.5' },
    ];
    for (const env of invalid) {
      const { outcome, fake } = await scenario(healthy, env);
      endedNaturally(outcome);
      expect(outcome.code, JSON.stringify(env)).toBe(2);
      expect(outcome.stderr).toContain('Reglage invalide');
      expect(fake.hits(), JSON.stringify(env)).toBe(0);
    }
  }, 60_000);

  it('ne force jamais la sortie : aucun `process.exit(` dans le code (libuv sous Windows)', () => {
    const code = readFileSync(SCRIPT, 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n');
    expect(code).not.toMatch(/process\.exit\s*\(/);
  });
});

describe('limites du vérificateur', () => {
  it('lit les valeurs par defaut, et refuse ce qui n’est pas un entier dans les bornes', () => {
    expect(readLimits({})).toEqual({
      attempts: DEFAULT_ATTEMPTS,
      delayMs: DEFAULT_DELAY_MS,
      timeoutMs: DEFAULT_FETCH_TIMEOUT_MS,
    });
    expect(DEFAULT_ATTEMPTS).toBe(6);
    expect(DEFAULT_FETCH_TIMEOUT_MS).toBe(15_000);
    expect(readLimits({ FETCH_TIMEOUT_MS: '300' }).timeoutMs).toBe(300);
    for (const bad of ['abc', '', ' ', '1e3', '-1', '12.5', '49', '120001'])
      expect(() => readLimits({ FETCH_TIMEOUT_MS: bad }), bad).toThrow(
        RangeError
      );
    expect(() => readLimits({ ATTEMPTS: '21' })).toThrow(RangeError);
    expect(() => readLimits({ DELAY_MS: '60001' })).toThrow(RangeError);
  });

  it('l’enveloppe de l’étape CI dépasse le pire cumul des tentatives, pauses et requêtes', () => {
    const ci = readFileSync(
      resolve(__dirname, '../../.github/workflows/ci.yml'),
      'utf8'
    );
    const at = ci.indexOf('- name: Verify production serves this build');
    expect(at, 'étape absente de ci.yml').toBeGreaterThan(0);
    const next = ci.indexOf('\n  secret-scan:', at);
    const step = ci.slice(at, next > 0 ? next : undefined);
    const minutes = /timeout-minutes:\s*(\d+)/.exec(step);
    expect(minutes, 'l’étape n’a pas de timeout-minutes').toBeTruthy();
    const envelope = Number(minutes![1]) * 60_000;
    const worst = worstCaseMs({
      attempts: DEFAULT_ATTEMPTS,
      delayMs: DEFAULT_DELAY_MS,
      timeoutMs: DEFAULT_FETCH_TIMEOUT_MS,
    });
    // 6 x 15 s + 5 x 10 s + 3 x 15 s = 185 s ; l'enveloppe doit laisser de la marge au demarrage de Node.
    expect(worst).toBe(185_000);
    expect(envelope).toBeGreaterThan(worst + 30_000);
    // Et elle reste bien en dessous du garde-fou du job (15 min) : une coupure DIT quelle etape.
    expect(envelope).toBeLessThan(15 * 60_000);
  });
});
