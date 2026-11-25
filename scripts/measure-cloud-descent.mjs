/* global console, process, document, localStorage, Event, URL */
/**
 * DESCENTE SUR UNE RÉGION RÉELLEMENT NUAGEUSE (GAL-EARTH-CLOUD-IMMERSION-001, 2026-11-24).
 *
 * Le lot précédent n'avait cadré que Paris, sans nuage : aucune conclusion sur la coque des nuages.
 * Ce script vise une région dont la couverture a été MESURÉE sur l'image source GIBS (NOAA-21,
 * 2026-11-20 : Brasília, cumulus de convection ; îles Kerguelen, Océan Austral à 92 %), descend à la
 * molette et enregistre, à chaque cran : altitude de la caméra (sonde `?debug-surface`), une
 * capture PNG, l'état de la couche nuages et son badge de traçabilité.
 *
 * Conditions : VRAI GPU (`--use-angle=d3d11`, `--software` pour s'en passer), 1280 × 800, visites
 * coupées, date fixée. `--clouds on|off` : couche « nuages réels » cochée ou non (même descente).
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
const context = await browser.newContext(
  DEVICE ? { ...devices[DEVICE] } : { viewport: { width: vw, height: vh } }
);
await context.addInitScript(() => {
  localStorage.setItem('ssv-guided-tour-v1', '1');
  localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  localStorage.setItem('ssv-locale', 'en');
});
const page = await context.newPage();
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
  `${ORIGIN}/?debug-surface${QUERY}&mode=${MODE}&body=earth&date=${DATE}`,
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
for (let i = 0; i <= STEPS; i += 1) {
  if (i > 0) {
    await page.mouse.wheel(0, WHEEL);
    await page.waitForTimeout(SETTLE);
    await page
      .waitForFunction(
        () =>
          document.querySelector('canvas')?.dataset['sceneMoving'] !== '1' &&
          document.querySelector('canvas')?.dataset['texturesLoading'] ===
            '0' &&
          (document.querySelector('canvas')?.dataset['surfaceBusy'] ?? '0') ===
            '0',
        null,
        { timeout: 30_000 }
      )
      .catch(() => {});
  }
  const alt = await altitude();
  const name = `f${String(i).padStart(2, '0')}_${alt === null ? 'na' : alt.toFixed(1)}km.png`;
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
  frames.push({
    i,
    altKm: alt,
    file: name,
    fps,
    shell,
    net: JSON.parse(JSON.stringify(net)),
  });
  console.log(name);
  if (alt !== null && alt < 2) break;
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
