/* global console, process, document, localStorage, Event, URL, window */
/**
 * DESCENTE SUR UNE RÉGION RÉELLEMENT NUAGEUSE (GAL-EARTH-CLOUD-IMMERSION-001, 2026-11-24).
 *
 * Le lot précédent n'avait cadré que Paris, sans nuage : aucune conclusion sur la coque des nuages.
 * Ce script vise une région dont la couverture a été MESURÉE sur l'image source GIBS (NOAA-21,
 * 2026-11-20 : Brasília, cumulus de convection ; îles Kerguelen, Océan Austral à 92 %), descend à la
 * molette et enregistre, à chaque cran : altitude de la caméra (sonde `?debug-surface`), une
 * capture PNG, l'état de la couche nuages et son badge de traçabilité.
 *
 * Conditions : VRAI GPU (`--use-angle=d3d11`, `--software` pour s'en passer, `--cpu 4` pour freiner), 1280 × 800, visites
 * coupées, date fixée. `--clouds on|off` : couche « nuages réels » cochée ou non (même descente).
 *
 * GAL-EARTH-ATMOSPHERE-003 : `--perf` (durées d'image médiane et p95 et mémoire du pilote par cran, sonde
 * `?debug-perf`), `--min-alt 0.3` (descendre jusque-là, km ; 2 par défaut), `--look-up 0,30,60,85` (au plus bas,
 * visée relevée de ces degrés au-dessus du cadrage d'horizon, une capture chacune), `--ascend 12` (remontée, même
 * nombre de crans de molette en sens inverse, captures `u..`).
 *
 * Usage :
 *   node scripts/measure-cloud-descent.mjs --origin http://localhost:4275 --place Brasília \
 *     --mode explo --clouds on --out reports/cloud-descent/brasilia-explo-on --steps 24
 */
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { chromium, devices } from 'playwright';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const ORIGIN = flag('--origin', 'https://galaxy.adrianguichard.dev').replace(
  /\/$/,
  ''
);
const PLACE = flag('--place', 'Brasília');
const MODE = flag('--mode', 'explo');
const CLOUDS = flag('--clouds', 'on');
const STEPS = Number(flag('--steps', '24'));
const WHEEL = Number(flag('--wheel', '-1200'));
const SETTLE = Number(flag('--settle', '2500'));
const BASE = flag('--base', null);
const QUERY = flag('--query', '');
const VIEWPORT = flag('--viewport', '1280x800');
const DEVICE = flag('--device', null);
const DATE = flag('--date', '2026-11-20T16:30:00Z');
const OUT = resolve(flag('--out', 'reports/cloud-descent/run'));
const SOFTWARE = args.includes('--software');
// `--cpu 4` : processeur freiné (CDP), pour reproduire un coureur lent (incident #588, GAL-EARTH-ATMOSPHERE-002).
const CPU = Number(flag('--cpu', '1'));
// `--slow-net` : réseau retardé (300 ms, 1,5 Mb/s), pour voir ce qui manque pendant l'arrivée des tuiles.
const SLOW_NET = args.includes('--slow-net');
// `--reduced-motion` : le visiteur a demandé le mouvement réduit (`prefers-reduced-motion: reduce`).
const REDUCED_MOTION = args.includes('--reduced-motion');
const PERF = args.includes('--perf');
const MIN_ALT = Number(flag('--min-alt', '2'));
const LOOK_UP = (flag('--look-up', '') || '')
  .split(',')
  .filter(Boolean)
  .map(Number);
const ASCEND = Number(flag('--ascend', '0'));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: [
    '--disable-features=CalculateNativeWinOcclusion',
    '--disable-renderer-backgrounding',
    ...(SOFTWARE
      ? []
      : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']),
  ],
});
const [vw, vh] = VIEWPORT.split('x').map(Number);
// `--device "Pixel 7"` : écran, rapport de pixels et toucher émulés ; sinon une fenêtre de bureau.
const context = await browser.newContext({
  ...(DEVICE ? devices[DEVICE] : { viewport: { width: vw, height: vh } }),
  ...(REDUCED_MOTION ? { reducedMotion: 'reduce' } : {}),
});
await context.addInitScript(() => {
  localStorage.setItem('ssv-guided-tour-v1', '1');
  localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  localStorage.setItem('ssv-locale', 'en');
});
const page = await context.newPage();
if (CPU > 1 || SLOW_NET) {
  const cdp = await context.newCDPSession(page);
  if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  if (SLOW_NET)
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 300,
      downloadThroughput: (1.5 * 1024 * 1024) / 8,
      uploadThroughput: (0.75 * 1024 * 1024) / 8,
    });
}
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 200)));
const gibs = { ok: 0, failed: 0, urls: [] };
const net = {};
const originHost = new URL(ORIGIN).host;
page.on('response', (r) => {
  const u = new URL(r.url());
  if (u.host !== originHost && u.protocol !== 'data:') {
    const h = (net[u.host] ??= { n: 0, bytes: 0, failed: 0 });
    h.n += 1;
    h.bytes += Number(r.headers()['content-length'] ?? 0);
    if (r.status() >= 400) h.failed += 1;
  }
  if (r.url().includes('gibs.earthdata.nasa.gov/wms')) {
    gibs.ok += 1;
    gibs.urls.push(
      r
        .url()
        .replace(/^.*wms\.cgi\?/, '')
        .slice(0, 220)
    );
  }
});

await page.goto(
  `${ORIGIN}/?debug-surface${PERF ? '&debug-perf' : ''}${QUERY}&mode=${MODE}&body=earth&date=${DATE}`,
  {
    timeout: 180_000,
  }
);
await page.locator('#loader').waitFor({ state: 'hidden', timeout: 180_000 });
await page.waitForFunction(
  () =>
    document.querySelector('canvas')?.dataset['sceneMoving'] !== '1' &&
    document.querySelector('canvas')?.dataset['texturesLoading'] === '0',
  null,
  { timeout: 120_000 }
);

// Couche nuages réels : cochée ou non, avant tout.
await page.locator('#weather-trigger').click();
const box = page.locator('#weather-layers input[data-layer="clouds"]');
await box.waitFor({ timeout: 20_000 });
if ((await box.isChecked()) !== (CLOUDS === 'on')) {
  if (CLOUDS === 'on') await box.check();
  else await box.uncheck();
}
await page.waitForTimeout(6000);
const badge = (await page.locator('#weather-layers').innerText())
  .split(/\s+/)
  .join(' ')
  .slice(0, 600);
await page.locator('#weather-trigger').click();

// Fond du sol (`--base daily` = « Terre du jour », VIIRS) : le sélecteur est dans le panneau de réglages.
if (BASE) {
  await page.evaluate((value) => {
    const select = document.getElementById('surface-earth-base');
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, BASE);
  await page.waitForTimeout(1500);
}

// Viser le lieu comme le fait un visiteur.
await page.locator('#body-search-trigger').click();
await page.locator('#palette-input').fill(PLACE);
await page.locator('#palette-hit-0').waitFor({ timeout: 15_000 });
await page.locator('#palette-hit-0').click();
await page.waitForFunction(
  () => {
    const t = (document.getElementById('surface-probe')?.innerText ?? '')
      .split(/\s+/)
      .join(' ');
    const km = /altitude ([-0-9.]+) km/.exec(t)?.[1];
    return km !== undefined && Number(km) < 200_000;
  },
  null,
  { timeout: 30_000 }
);
await page.waitForTimeout(8000);

const altitude = () =>
  page.evaluate(() => {
    const t = (document.getElementById('surface-probe')?.innerText ?? '')
      .split(/\s+/)
      .join(' ');
    const km = /altitude ([-0-9.]+) km/.exec(t)?.[1];
    return km === undefined ? null : Number(km);
  });

const cbox = await page.locator('canvas').first().boundingBox();
await page.mouse.move(cbox.x + cbox.width / 2, cbox.y + cbox.height / 2);
const frames = [];
const settle = () =>
  page
    .waitForFunction(
      () =>
        document.querySelector('canvas')?.dataset['sceneMoving'] !== '1' &&
        document.querySelector('canvas')?.dataset['texturesLoading'] === '0' &&
        (document.querySelector('canvas')?.dataset['surfaceBusy'] ?? '0') ===
          '0',
      null,
      { timeout: 30_000 }
    )
    .catch(() => {});
const perfSample = async () => {
  if (!PERF) return null;
  await page.evaluate(() => window.perfProbe?.reset());
  await page.waitForTimeout(2000);
  return page.evaluate(() => {
    const s = window.perfProbe?.snapshot();
    return s
      ? {
          p50Ms: s.frames.p50Ms,
          p95Ms: s.frames.p95Ms,
          frames: s.frames.count,
          textureMiB: Math.round((s.textures.bytes / 1048576) * 10) / 10,
          textures: s.textures.count,
          geometryMiB: Math.round((s.geometries.bytes / 1048576) * 10) / 10,
          driverMiB: s.driver
            ? Math.round((s.driver.total / 1048576) * 10) / 10
            : null,
          triangles: s.triangles,
          drawCalls: s.drawCalls ?? null,
        }
      : null;
  });
};
const capture = async (tag) => {
  const alt = await altitude();
  const name = `${tag}_${alt === null ? 'na' : alt.toFixed(2)}km.png`;
  await page.screenshot({ path: resolve(OUT, name) });
  const fps = await page.evaluate(() => {
    const t = (document.getElementById('surface-probe')?.innerText ?? '')
      .split(/\s+/)
      .join(' ');
    return Number(/fps ([0-9.]+)/.exec(t)?.[1] ?? NaN);
  });
  const shell = await page.evaluate(
    () => document.querySelector('canvas')?.dataset['cloudShell'] ?? null
  );
  // GAL-PLANETARY-RELIEF-001 : la hauteur au-dessus du SOL MESURÉ (relief posé), et le relief servi.
  const ground = await page.evaluate(() => {
    const t = (document.getElementById('surface-probe')?.innerText ?? '')
      .split(/\s+/)
      .join(' ');
    const m = /→ ([-0-9.]+) km au-dessus du sol/.exec(t);
    const badge = document.getElementById('surface-imagery');
    return {
      clearanceKm: m ? Number(m[1]) : null,
      reliefLevel: badge?.dataset['relief'] ?? null,
      reliefM: badge?.dataset['reliefM'] ?? null,
      relief: badge?.querySelector('.si-relief')?.textContent ?? null,
    };
  });
  const perf = await perfSample();
  frames.push({
    tag,
    altKm: alt,
    file: name,
    fps,
    shell,
    ground,
    perf,
    gibs: gibs.ok,
    net: JSON.parse(JSON.stringify(net)),
  });
  console.log(
    name,
    shell ?? '',
    perf ? `p50 ${perf.p50Ms} p95 ${perf.p95Ms}` : ''
  );
  return alt;
};
for (let i = 0; i <= STEPS; i += 1) {
  if (i > 0) {
    await page.mouse.wheel(0, WHEEL);
    await page.waitForTimeout(SETTLE);
    await settle();
  }
  const alt = await capture(`f${String(i).padStart(2, '0')}`);
  if (alt !== null && alt < MIN_ALT) break;
}
// Au plus bas : la visée relevée vers le ciel (sonde `?debug-surface`, `window.__lookUpDeg`).
for (const deg of LOOK_UP) {
  await page.evaluate((d) => {
    window.__lookUpDeg = d;
  }, deg);
  await page.waitForTimeout(SETTLE);
  await settle();
  await capture(`sky${String(deg).padStart(2, '0')}`);
}
await page.evaluate(() => {
  window.__lookUpDeg = 0;
});
for (let i = 1; i <= ASCEND; i += 1) {
  await page.mouse.wheel(0, -WHEEL);
  await page.waitForTimeout(SETTLE);
  await settle();
  await capture(`u${String(i).padStart(2, '0')}`);
}
writeFileSync(
  resolve(OUT, 'run.json'),
  JSON.stringify(
    {
      net,
      ORIGIN,
      PLACE,
      MODE,
      CLOUDS,
      BASE,
      DATE,
      badge,
      frames,
      gibs,
      consoleErrors,
    },
    null,
    2
  )
);
await browser.close();
