/* global console, process, window, document, localStorage, URL, setInterval, clearInterval, performance */
/**
 * CE QUE FAIT LE CHARGEMENT DES TUILES PENDANT UNE DESCENTE SUR LA TERRE (2026-11-08).
 *
 * Une descente à la molette, plus ou moins vive (`--settle` ms entre deux crans), puis une pause.
 * Relevé, dans un vrai navigateur :
 *   - les requêtes vers les hôtes de tuiles (tout hôte autre que l'origine) : terminées par code
 *     HTTP, annulées (`ERR_ABORTED`, la vue a bougé) et ÉCHOUÉES (le reste : un trou durable
 *     avant le correctif des rejeux) ;
 *   - le journal des libérations de carreaux (`window.__tileLog`, `?debug-surface`) par raison ;
 *   - la part du temps où le moteur avait encore du travail (`canvas.dataset.surfaceBusy` > 0) et
 *     le nombre de carreaux posés lu dans la sonde `#surface-probe`, par tranche d'altitude ;
 *   - le temps de stabilisation après le dernier cran.
 *
 * Conditions : VRAI GPU (`--use-angle=d3d11`, `--software` pour s'en passer), fenêtre 1280 × 800,
 * visites coupées, date fixe (la scène change d'un jour à l'autre), un seul tirage par exécution :
 * lancer `--repeat 3` pour voir la dispersion, un échantillon ne dit rien. Ce n'est PAS un chiffre
 * de téléphone. `--throttle-kbps` freine le réseau (CDP) pour reproduire une liaison lente.
 *
 * Usage :
 *   node scripts/measure-earth-zoom.mjs --origin http://127.0.0.1:4275
 *   node scripts/measure-earth-zoom.mjs --origin <url> --settle 300 --steps 20 --repeat 3 --json x.json
 *   node scripts/measure-earth-zoom.mjs --origin <url> --throttle-kbps 1500
 *
 * Sert un build local (`pnpm build && pnpm exec vite preview --port 4275 --strictPort`) : lire le
 * `<title>` avant de mesurer, un autre projet peut occuper le port.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const ORIGIN = flag('--origin', 'https://galaxy.adrianguichard.dev').replace(
  /\/$/,
  ''
);
const STEPS = Number(flag('--steps', '20'));
const SETTLE = Number(flag('--settle', '400'));
const WHEEL = Number(flag('--wheel', '-1500'));
const REPEAT = Number(flag('--repeat', '1'));
const THROTTLE = Number(flag('--throttle-kbps', '0'));
const SOFTWARE = args.includes('--software');
const GESTURE = args.includes('--gesture');
/** Lieu terrestre visé avant la descente (`--place Rome`), sans quoi la caméra regarde la mer. */
const PLACE = flag('--place', null);
const JSON_OUT = flag('--json', null);
const DATE = '2024-07-01T12:00:00Z';

const ORIGIN_HOST = new URL(ORIGIN).host;

/** Netteté d'une capture : variance du laplacien d'une version réduite en niveaux de gris. */
async function sharpness(png) {
  const { data, info } = await sharp(png)
    .resize(320, 200, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      const l =
        4 * data[i] - data[i - 1] - data[i + 1] - data[i - w] - data[i + w];
      sum += l;
      sum2 += l * l;
      n += 1;
    }
  }
  return sum2 / n - (sum / n) ** 2;
}

function pct(sorted, p) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

async function oneRun(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  await context.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  if (THROTTLE > 0) {
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 40,
      downloadThroughput: (THROTTLE * 1024) / 8,
      uploadThroughput: (THROTTLE * 1024) / 8,
    });
  }

  /** Requêtes vers les hôtes de tuiles (tout sauf l'origine). */
  const net = {
    ok: 0,
    aborted: 0,
    failed: 0,
    status: {},
    hosts: {},
    failures: {},
  };
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.host === ORIGIN_HOST || url.protocol === 'data:') return;
    net.hosts[url.host] = (net.hosts[url.host] ?? 0) + 1;
    const code = String(response.status());
    net.status[code] = (net.status[code] ?? 0) + 1;
    if (response.status() < 400) net.ok += 1;
  });
  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
    if (url.host === ORIGIN_HOST || url.protocol === 'data:') return;
    // La balise d'analyse échoue hors production : ce n'est pas une tuile.
    if (url.host === 'cloudflareinsights.com') return;
    const text = request.failure()?.errorText ?? '?';
    if (text.includes('ABORTED')) net.aborted += 1;
    else {
      net.failed += 1;
      (net.failedUrls ??= []).push(request.url().slice(0, 140));
      net.failures[text] = (net.failures[text] ?? 0) + 1;
    }
  });

  await page.goto(
    `${ORIGIN}/?debug-surface&mode=explo&body=earth&date=${DATE}`,
    { timeout: 180_000 }
  );
  await page.locator('#loader').waitFor({ state: 'hidden', timeout: 180_000 });
  await page.waitForFunction(
    () => document.querySelector('#surface-probe') !== null,
    null,
    { timeout: 60_000 }
  );
  // Laisser le vol d'arrivée finir et les textures d'entrée se poser.
  await page.waitForFunction(
    () =>
      document.querySelector('canvas')?.dataset['sceneMoving'] !== '1' &&
      document.querySelector('canvas')?.dataset['texturesLoading'] === '0',
    null,
    { timeout: 120_000 }
  );
  await page.waitForTimeout(2000);
  net.ok = 0;
  net.aborted = 0;
  net.failed = 0;
  net.status = {};
  net.hosts = {};
  net.failures = {};
  await page.evaluate(() => {
    window.__tileLog = [];
  });

  // L'échantillonneur, DANS la page : 10 relevés par seconde, sans aller-retour réseau.
  await page.evaluate(() => {
    window.__zoomSamples = [];
    window.__zoomSampler = setInterval(() => {
      const canvas = document.querySelector('canvas');
      const text = (document.getElementById('surface-probe')?.innerText ?? '')
        .split(/\s+/)
        .join(' ');
      const alt = /altitude ([-0-9.]+) km/.exec(text)?.[1];
      const posed = /carreaux\s+(\d+) au niveau servi, (\d+) pos/.exec(text);
      window.__zoomSamples.push({
        t: Math.round(performance.now()),
        busy: Number(canvas?.dataset['surfaceBusy'] ?? '0'),
        loading: Number(canvas?.dataset['texturesLoading'] ?? '0'),
        altKm: alt === undefined ? null : Number(alt),
        painted: posed ? Number(posed[1]) : null,
        attached: posed ? Number(posed[2]) : null,
      });
    }, 100);
  });

  if (PLACE) {
    // Un lieu terrestre, choisi par la recherche comme le fait un visiteur : au-dessus de la mer la
    // netteté ne varie pas et rien ne se mesure. La sélection se perd parfois : on la rejoue.
    let flying = false;
    for (let pick = 1; pick <= 3 && !flying; pick += 1) {
      await page.locator('#body-search-trigger').click();
      await page.locator('#palette-input').fill(PLACE);
      await page
        .locator('#palette-hit-0')
        .filter({ hasText: PLACE })
        .waitFor({ timeout: 15_000 });
      await page.locator('#palette-hit-0').click();
      await page.bringToFront();
      flying = await page
        .waitForFunction(
          () => {
            const t = (
              document.getElementById('surface-probe')?.innerText ?? ''
            )
              .split(/\s+/)
              .join(' ');
            const km = /altitude ([-0-9.]+) km/.exec(t)?.[1];
            return km !== undefined && Number(km) < 200_000;
          },
          null,
          { timeout: 12_000 }
        )
        .then(
          () => true,
          () => false
        );
    }
    await page.waitForTimeout(6000);
  }
  const box = await page.locator('canvas').first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const startedAt = await page.evaluate(() => Math.round(performance.now()));
  for (let i = 0; i < STEPS; i += 1) {
    await page.mouse.wheel(0, WHEEL);
    await page.waitForTimeout(SETTLE);
  }
  const lastWheelAt = await page.evaluate(() => Math.round(performance.now()));
  // Stabilisation : jusqu'à 30 s pour que plus rien ne soit dû.
  const settled = await page
    .waitForFunction(
      () => {
        const s = window.__zoomSamples;
        const recent = s.slice(-15);
        return (
          recent.length === 15 &&
          recent.every((x) => x.busy === 0 && x.loading === 0)
        );
      },
      null,
      { timeout: 30_000, polling: 200 }
    )
    .then(
      () => true,
      () => false
    );
  const settledAt = await page.evaluate(() => Math.round(performance.now()));
  await page.waitForTimeout(1500);

  // GESTES (`--gesture`) : glissements latéraux puis va-et-vient de molette, une fois la scène
  // posée. La netteté de l'image PEINTE est relevée toutes les 250 ms (variance du laplacien) :
  // un retour de la texture lointaine la fait chuter, ce qu'aucun compteur ne montre.
  let gesture = null;
  if (GESTURE) {
    const clip = {
      x: box.x + box.width * 0.25,
      y: box.y + box.height * 0.25,
      width: box.width * 0.5,
      height: box.height * 0.5,
    };
    const shots = [];
    let phase = 'repos';
    let measuring = true;
    const sharpTimer = (async () => {
      while (measuring) {
        const png = await page.screenshot({ clip });
        const alt = await page.evaluate(
          () => window.__zoomSamples.at(-1)?.altKm ?? null
        );
        shots.push({ phase, altKm: alt, sharp: await sharpness(png) });
        await page.waitForTimeout(150);
      }
    })();
    await page.waitForTimeout(1500);
    const rest = shots.map((x) => x.sharp);
    phase = 'glissements';
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    for (let i = 0; i < 6; i += 1) {
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      const dir = i % 2 === 0 ? 1 : -1;
      await page.mouse.move(cx + dir * 260, cy + dir * 40, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(300);
    }
    phase = 'va-et-vient';
    for (let i = 0; i < 6; i += 1) {
      await page.mouse.wheel(0, i % 2 === 0 ? 700 : -700);
      await page.waitForTimeout(500);
    }
    phase = 'après';
    await page.waitForTimeout(4000);
    measuring = false;
    await sharpTimer;
    const reference = pct(
      [...rest].sort((a, b) => a - b),
      0.5
    );
    const byPhase = {};
    for (const shot of shots) {
      const row = (byPhase[shot.phase] ??= { n: 0, below60: 0, min: Infinity });
      row.n += 1;
      if (shot.sharp < 0.6 * reference) row.below60 += 1;
      row.min = Math.min(row.min, shot.sharp);
    }
    gesture = {
      referenceSharpness: Math.round(reference),
      byPhase: Object.fromEntries(
        Object.entries(byPhase).map(([k, v]) => [
          k,
          {
            captures: v.n,
            below60pctOfReference: v.below60,
            minRelative: Number((v.min / reference).toFixed(2)),
          },
        ])
      ),
    };
  }

  const data = await page.evaluate(() => {
    clearInterval(window.__zoomSampler);
    return { samples: window.__zoomSamples, log: window.__tileLog ?? [] };
  });
  await context.close();

  const during = data.samples.filter(
    (s) => s.t >= startedAt && s.t <= lastWheelAt
  );
  const busyShare = during.length
    ? during.filter((s) => s.busy > 0).length / during.length
    : null;
  // Trous : au sol (sous 200 km) sans AUCUN carreau posé, donc le fond lointain seul.
  const near = data.samples.filter((s) => s.altKm !== null && s.altKm < 200);
  const bare = near.filter((s) => (s.attached ?? 0) === 0);
  const reasons = {};
  for (const e of data.log) reasons[e.reason] = (reasons[e.reason] ?? 0) + 1;
  const alts = data.samples.map((s) => s.altKm).filter((a) => a !== null);
  return {
    settled,
    settleMsAfterLastWheel: settledAt - lastWheelAt,
    descentMs: lastWheelAt - startedAt,
    finalAltKm: alts.at(-1) ?? null,
    network: net,
    gesture,
    tileLog: reasons,
    busyShareDuringDescent: busyShare,
    nearSamples: near.length,
    nearBareShare: near.length ? bare.length / near.length : null,
    attachedP50: pct(
      near.map((s) => s.attached ?? 0).sort((a, b) => a - b),
      0.5
    ),
  };
}

const browser = await chromium.launch({
  args: [
    '--disable-features=CalculateNativeWinOcclusion',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    ...(SOFTWARE
      ? []
      : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']),
  ],
});
const runs = [];
for (let r = 1; r <= REPEAT; r += 1) {
  const result = await oneRun(browser);
  runs.push(result);
  console.log(`--- tirage ${r}/${REPEAT}`);
  console.log(JSON.stringify(result, null, 2));
}
await browser.close();
if (JSON_OUT) {
  const path = resolve(JSON_OUT);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      {
        origin: ORIGIN,
        date: DATE,
        steps: STEPS,
        settleMs: SETTLE,
        throttleKbps: THROTTLE,
        runs,
      },
      null,
      2
    ) + '\n',
    'utf8'
  );
  console.log(`écrit : ${path}`);
}
process.exit(0);
