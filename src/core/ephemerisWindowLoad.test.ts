import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { bodyDynamics } from '@/config/gravity';
import { flattenBodies } from '@/config/catalog';
import { HorizonsEphemerisService } from './HorizonsEphemerisService';
import type { SceneWindowRequest } from './HorizonsEphemerisService';
import {
  EPHEMERIDES_DIR,
  horizonsManifest,
  horizonsServiceFromDisk,
} from './horizonsTestFixture';
import { noticeText } from '@/ui/ephemerisNotice';

/**
 * LE SERVICE NE CHARGE PLUS DES FICHIERS, IL CHARGE DES FENÊTRES (lot 17, phase 17C).
 *
 * Ce fichier exerce le chemin de PRODUCTION — `HorizonsEphemerisService.load`, son `fetch`,
 * son en-tête `Range`, son interprétation de la réponse — contre les BINAIRES RÉELLEMENT
 * LIVRÉS. Les octets servis sont ceux du dépôt, découpés par le serveur simulé exactement
 * comme un hôte le ferait : un test qui fabriquerait ses propres échantillons ne dirait rien
 * du seul risque qui compte, celui de lire un autre instant que le fichier entier.
 *
 * Le fait qui fonde le lot, et que ce fichier mesure : positionner un corps coûte 96 octets,
 * pas un fichier de 880 Ko.
 */

const MANIFEST_URL = 'https://example.test/assets/ephemerides/manifest.json';
const SCENE_DATE = new Date('2026-09-23T00:00:00Z');

/** Ce qu'une requête a demandé et reçu : c'est là-dessus que portent la moitié des gardes. */
interface Served {
  body: string;
  range: string | null;
  bytes: number;
  status: number;
}

interface ServerOptions {
  /** Corps dont la requête échoue : statut HTTP, ou 0 pour un rejet de transport. */
  fail?: Readonly<Record<string, number>>;
  /** L'hôte IGNORE la plage et rend 200 avec tout le fichier (décision D7, mesuré). */
  ignoreRanges?: boolean;
  /**
   * L'hôte rend un `Content-Range` dont le total n'est pas celui du fichier : c'est le cas du
   * flux COMPRESSÉ (piège 1 du plan, 417 899 au lieu de 440 496 sur Mercure).
   */
  lieAboutTotal?: boolean;
}

const fileCache = new Map<string, Buffer>();

function fileOf(name: string): Buffer {
  const entry = horizonsManifest.bodies[name];
  let file = fileCache.get(name);
  if (!file) {
    file = readFileSync(EPHEMERIDES_DIR + entry.file);
    fileCache.set(name, file);
  }
  return file;
}

function bodyOfUrl(url: string): string {
  const file = url.split('/').pop() ?? '';
  const found = Object.entries(horizonsManifest.bodies).find(
    ([, entry]) => entry.file === file
  );
  if (!found) throw new Error(`fichier inconnu du manifeste : ${file}`);
  return found[0];
}

/** Un hôte qui sert les VRAIS octets, et honore `Range` comme Firebase le fait (mesuré). */
function serveRealEphemerides(
  log: Served[],
  options: ServerOptions = {}
): typeof fetch {
  const server = async (
    input: unknown,
    init?: RequestInit
  ): Promise<unknown> => {
    const url = String(input);
    if (url.endsWith('manifest.json'))
      return { ok: true, json: async () => horizonsManifest };

    const body = bodyOfUrl(url);
    const status = options.fail?.[body];
    if (status === 0) throw new TypeError('Failed to fetch');
    if (status !== undefined) {
      log.push({ body, range: null, bytes: 0, status });
      return { ok: false, status };
    }

    const file = fileOf(body);
    const header = (init?.headers as Record<string, string> | undefined)?.[
      'Range'
    ];
    if (!header || options.ignoreRanges) {
      log.push({
        body,
        range: header ?? null,
        bytes: file.byteLength,
        status: 200,
      });
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        arrayBuffer: async () => slice(file, 0, file.byteLength - 1),
      };
    }

    const match = /^bytes=(\d+)-(\d+)$/.exec(header);
    if (!match) throw new Error(`plage illisible : ${header}`);
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), file.byteLength - 1);
    const total = options.lieAboutTotal ? file.byteLength - 1 : file.byteLength;
    log.push({ body, range: header, bytes: end - start + 1, status: 206 });
    return {
      ok: true,
      status: 206,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'content-range'
            ? `bytes ${start}-${end}/${total}`
            : null,
      },
      arrayBuffer: async () => slice(file, start, end),
    };
  };
  return server as unknown as typeof fetch;
}

function slice(file: Buffer, start: number, end: number): ArrayBuffer {
  const view = file.subarray(start, end + 1);
  return view.buffer.slice(
    view.byteOffset,
    view.byteOffset + view.byteLength
  ) as ArrayBuffer;
}

function stubBrowser(fetchImpl: typeof fetch): void {
  vi.stubGlobal('window', {
    location: { href: 'https://example.test/', origin: 'https://example.test' },
  });
  vi.stubGlobal('fetch', fetchImpl);
}

const PERIODS: Record<string, number> = {};
for (const [name, cfg] of flattenBodies(CELESTIAL_CONFIG)) {
  const period = cfg.realData?.orbitPeriodDays;
  if (period !== undefined && period > 0) PERIODS[name] = period;
}

/** La demande que fait `SolarSystemApp` : la date affichée, et les lignes d'orbite tracées. */
const sceneRequest = (
  date: Date,
  lines = true,
  leadDays = 0
): SceneWindowRequest => ({
  date,
  leadDays,
  ...(lines ? { orbitPeriodDays: PERIODS } : {}),
});

async function loadWindowed(
  log: Served[],
  options: ServerOptions = {},
  request: SceneWindowRequest = sceneRequest(SCENE_DATE)
): Promise<HorizonsEphemerisService> {
  stubBrowser(serveRealEphemerides(log, options));
  return HorizonsEphemerisService.load(
    MANIFEST_URL,
    bodyDynamics(CELESTIAL_CONFIG),
    { scene: request, retryDelaysMs: [] }
  );
}

/** Les corps qui mettent à l'épreuve chaque chemin du lecteur, pas un échantillon au hasard. */
const WITNESSES = [
  'mercury', // planète : sa ligne d'orbite tient dans la couverture
  'uranus', // la plus large fenêtre de ligne mesurée (41,8 % de son fichier)
  'enceladus', // facteur d'échelle du temps de propagation publié au manifeste (17B)
  'mimas', // le pire cas de ce facteur : 202,4 m sans publication
  'pluto', // ballant du barycentre : exige Charon sur le MÊME intervalle d'index
  'nix', // même famille, relatif au centre de Pluton
  'bennu', // petit corps, pas de 4 jours
  'voyager1', // sonde : couverture bornée, aucun repli
] as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('le service charge des fenêtres (lot 17C)', () => {
  it('place chaque corps EXACTEMENT comme le ferait le fichier entier', async () => {
    const log: Served[] = [];
    const windowed = await loadWindowed(log);
    const whole = horizonsServiceFromDisk();

    // Bit pour bit, pas « à peu près » : une fenêtre qui décalerait l'index d'un cran rendrait
    // une position plausible et fausse, et c'est le seul défaut que ce lot peut produire.
    for (const name of WITNESSES) {
      for (const offsetDays of [-2, 0, 0.37, 3]) {
        const date = new Date(SCENE_DATE.getTime() + offsetDays * 86_400_000);
        const fromWindow = windowed.getHeliocentricAU(name, date);
        const fromFile = whole.getHeliocentricAU(name, date);
        expect(fromWindow, `${name} ${offsetDays}`).not.toBeNull();
        expect(fromWindow!.x, `${name} x`).toBe(fromFile!.x);
        expect(fromWindow!.y, `${name} y`).toBe(fromFile!.y);
        expect(fromWindow!.z, `${name} z`).toBe(fromFile!.z);
      }
    }
  });

  it('ne demande qu’une plage par corps, et moins de 2 % des octets livrés', async () => {
    const log: Served[] = [];
    const service = await loadWindowed(log);

    const shipped = Object.values(horizonsManifest.bodies).reduce(
      (sum, entry) => sum + entry.sampleCount * 48,
      0
    );
    const served = log.reduce((sum, call) => sum + call.bytes, 0);

    expect(log.every((call) => call.status === 206)).toBe(true);
    expect(log.every((call) => /^bytes=\d+-\d+$/.test(call.range ?? ''))).toBe(
      true
    );
    expect(shipped).toBe(38_445_024);
    // MESURÉ ici, et ce n'est pas le 1,47 % du plan : celui-ci comptait les lignes d'orbite
    // des seules PLANÈTES, alors que `SolarSystemApp._recomputeOrbits` calcule la ligne de
    // TOUS les corps, visible ou non. Halley en demande 333 Ko à elle seule (76 ans de
    // révolution, pas de 4 jours), Uranus 368 Ko. Le gain reste d'un facteur 39.
    expect(served).toBeLessThan(shipped * 0.03);
    expect(served).toBeGreaterThan(900_000);
    expect(service.report.missing).toEqual([]);
    expect(service.report.declared).toBe(64);
  });

  it('ne demande AUCUN octet d’un corps que la date ne concerne pas', async () => {
    const log: Served[] = [];
    // 1969 : onze corps sur 64 sont hors de leur couverture (sondes non lancées, surtout).
    const service = await loadWindowed(
      log,
      {},
      sceneRequest(new Date('1969-07-20T20:17:00Z'))
    );
    const asked = new Set(log.map((call) => call.body));

    expect(asked.has('voyager1')).toBe(false);
    expect(asked.has('jwst')).toBe(false);
    expect(asked.has('earth')).toBe(true);
    expect(log.length).toBeLessThan(
      Object.keys(horizonsManifest.bodies).length
    );
    // Un corps sans octets n'est pas un corps MANQUANT : il ne répondrait pas davantage avec
    // son fichier entier, et le bandeau doit donc rester muet.
    expect(service.report.missing).toEqual([]);
    expect(
      service.getHeliocentricAU('voyager1', new Date('1969-07-20'))
    ).toBeNull();
  });

  it('donne au compagnon du ballant AU MOINS la fenêtre de TOUTE sa famille', async () => {
    const log: Served[] = [];
    await loadWindowed(log);
    const rangeOf = (body: string): [number, number] => {
      const call = log.find((entry) => entry.body === body);
      const match = /^bytes=(\d+)-(\d+)$/.exec(call?.range ?? '');
      return [Number(match![1]), Number(match![2])];
    };
    const [charonStart, charonEnd] = rangeOf('charon');

    // Comparer Charon à Pluton seul ne prouverait RIEN : leurs deux fenêtres sont les mêmes,
    // la période de Pluton (248 ans) sortant de la couverture. Ce sont les petites lunes qui
    // demandent large, leur ligne d'orbite tenant, elle, dans le fichier — et Charon doit
    // porter la RÉUNION, sinon `_withoutReflex` les soustrait sur l'intersection et leur
    // ligne repart en silence de leurs éléments képlériens (piège 7 du plan).
    let widestStart = Infinity;
    let widestEnd = -Infinity;
    for (const moon of ['pluto', 'styx', 'nix', 'kerberos', 'hydra']) {
      const [start, end] = rangeOf(moon);
      widestStart = Math.min(widestStart, start);
      widestEnd = Math.max(widestEnd, end);
    }
    expect(charonStart).toBeLessThanOrEqual(widestStart);
    expect(charonEnd).toBeGreaterThanOrEqual(widestEnd);
    // Et la réunion élargit VRAIMENT : sinon la garde ci-dessus serait tautologique.
    expect(charonEnd - charonStart).toBeGreaterThan(
      rangeOf('pluto')[1] - rangeOf('pluto')[0]
    );
  });

  it('garde le fichier entier quand l’hôte ignore la plage, et cesse d’en demander', async () => {
    const log: Served[] = [];
    const service = await loadWindowed(log, { ignoreRanges: true });
    const whole = horizonsServiceFromDisk();

    expect(service.report.missing).toEqual([]);
    expect(service.getHeliocentricAU('mercury', SCENE_DATE)!.x).toBe(
      whole.getHeliocentricAU('mercury', SCENE_DATE)!.x
    );
    // Décision D7 : l'application marche sur un hôte sans plages, au prix d'aujourd'hui.
    // Une date déjà tenue ne redemande rien, puisque les fichiers sont entiers.
    expect(service.hasCoverageFor(sceneRequest(new Date('2080-01-01')))).toBe(
      true
    );
    expect(
      service.getHeliocentricAU('mercury', new Date('2080-01-01'))
    ).not.toBeNull();
    // Et un corps que la date ne concernait pas n'a toujours RIEN coûté : la couverture se
    // lit au manifeste, même quand l'hôte refuse les plages.
    expect(log.some((call) => call.body === 'cassini')).toBe(false);

    // Le service a RETENU le refus : il ne redemande plus une plage à cet hôte, même pour
    // une date neuve. Sans cela il en redemanderait une par corps et par saut, pour se faire
    // rendre le fichier entier à chaque fois.
    const before = log.length;
    await service.ensureCoverage(sceneRequest(new Date('2017-06-01')));
    expect(log.length).toBeGreaterThan(before);
    expect(log.slice(before).every((call) => call.range === null)).toBe(true);
  });

  it('refuse une plage prise dans un flux compressé, puis reprend le fichier entier', async () => {
    const log: Served[] = [];
    stubBrowser(serveRealEphemerides(log, { lieAboutTotal: true }));
    const service = await HorizonsEphemerisService.load(
      MANIFEST_URL,
      bodyDynamics(CELESTIAL_CONFIG),
      { scene: sceneRequest(SCENE_DATE), retryDelaysMs: [0] }
    );
    const whole = horizonsServiceFromDisk();

    // Le premier passage rejette tout (le total annoncé n'est pas celui du fichier), le
    // second demande les fichiers entiers : aucun corps n'est perdu.
    expect(service.report.missing).toEqual([]);
    expect(log.some((call) => call.range === null)).toBe(true);
    expect(service.getHeliocentricAU('mercury', SCENE_DATE)!.x).toBe(
      whole.getHeliocentricAU('mercury', SCENE_DATE)!.x
    );
  });
});

describe('une fenêtre qui manque, et ce qu’on en dit (lot 17C)', () => {
  it('sait qu’une date n’est pas couverte, puis la sert après ensureCoverage', async () => {
    const log: Served[] = [];
    const service = await loadWindowed(log);
    const whole = horizonsServiceFromDisk();
    const far = new Date('2080-03-01T00:00:00Z');
    const request = sceneRequest(far, false);

    expect(service.hasCoverageFor(request)).toBe(false);
    expect(service.getHeliocentricAU('mercury', far)).toBeNull();

    await service.ensureCoverage(request);

    expect(service.hasCoverageFor(request)).toBe(true);
    for (const name of WITNESSES) {
      const fromWindow = service.getHeliocentricAU(name, far);
      const fromFile = whole.getHeliocentricAU(name, far);
      if (fromFile === null) continue; // hors couverture du fichier : rien à comparer
      expect(fromWindow, name).not.toBeNull();
      expect(fromWindow!.x, name).toBe(fromFile.x);
      expect(fromWindow!.z, name).toBe(fromFile.z);
    }
  });

  it('ne redemande rien quand la fenêtre tenue contient déjà la demande', async () => {
    const log: Served[] = [];
    const service = await loadWindowed(log);
    const before = log.length;

    await service.ensureCoverage(sceneRequest(SCENE_DATE, false));
    expect(log.length).toBe(before);

    // Un pas d'horloge d'une heure reste dans la marge : toujours aucune requête.
    await service.ensureCoverage(
      sceneRequest(new Date(SCENE_DATE.getTime() + 3_600_000), false)
    );
    expect(log.length).toBe(before);
  });

  it('nomme la fenêtre qui a échoué EN COURS DE SESSION, et le bandeau la compte', async () => {
    const log: Served[] = [];
    const service = await loadWindowed(log);
    expect(service.report.missing).toEqual([]);

    // Le lien tombe pour un seul corps, à un saut de date : le démarrage, lui, était complet.
    stubBrowser(serveRealEphemerides(log, { fail: { mercury: 0 } }));
    const far = new Date('2080-03-01T00:00:00Z');
    const report = await service.ensureCoverage(sceneRequest(far, false));

    expect(report.missing.map((failure) => failure.body)).toEqual(['mercury']);
    expect(report.loaded).not.toContain('mercury');
    expect(report.retryable).toBe(true);
    expect(noticeText(report)[0]).toContain('63');
    // Et la scène peut avancer : on a demandé, on a dit, on ne fige pas l'horloge pour
    // toujours (cf. `hasCoverageFor`).
    expect(service.hasCoverageFor(sceneRequest(far, false))).toBe(true);
  });

  it('charge le fichier ENTIER d’un corps dont le facteur n’est pas publié', async () => {
    const log: Served[] = [];
    // Manifeste d'avant la phase 17B : le facteur d'échelle du temps de propagation se
    // calculait alors sur le fichier entier, donc une fenêtre donnerait un AUTRE facteur,
    // donc une autre position (jusqu'à 202,4 m sur Mimas, mesuré).
    const legacy = {
      ...horizonsManifest,
      bodies: Object.fromEntries(
        Object.entries(horizonsManifest.bodies).map(([name, entry]) => {
          const { meanMotionScale: _dropped, ...rest } =
            entry as unknown as Record<string, unknown>;
          return [name, rest];
        })
      ),
    };
    const real = serveRealEphemerides(log);
    stubBrowser((async (input: unknown, init?: RequestInit) => {
      if (String(input).endsWith('manifest.json'))
        return { ok: true, json: async () => legacy };
      return (
        real as unknown as (i: unknown, x?: RequestInit) => Promise<unknown>
      )(input, init);
    }) as unknown as typeof fetch);

    const service = await HorizonsEphemerisService.load(
      MANIFEST_URL,
      bodyDynamics(CELESTIAL_CONFIG),
      { scene: sceneRequest(SCENE_DATE), retryDelaysMs: [] }
    );

    const mimas = log.find((call) => call.body === 'mimas');
    expect(mimas?.range).toBeNull();
    expect(mimas?.bytes).toBe(horizonsManifest.bodies.mimas.sampleCount * 48);
    // Les autres, eux, restent fenêtrés : la règle vise les sept corps qui déclarent ce
    // facteur, pas tout le catalogue.
    expect(log.find((call) => call.body === 'mercury')?.range).not.toBeNull();
    expect(service.getHeliocentricAU('mimas', SCENE_DATE)).not.toBeNull();
  });
});
