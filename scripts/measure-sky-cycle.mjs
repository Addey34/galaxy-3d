/* global console, process, document, localStorage, window */
/**
 * LE CYCLE LUMINEUX VU DU SOL (GAL-EARTH-LIGHTING-001, 2026-11-28).
 *
 * Pour un lieu et une liste d'instants (choisis pour une hauteur du Soleil, calculée à part), charge la scène à
 * cet instant, met le temps en pause, vise le lieu par la recherche, descend à la molette en capturant aux
 * altitudes de passage (orbite, ~2 000 km, ~100 km, ~10 km), puis, au plus bas, capture plusieurs caps autour de
 * la verticale (`window.__headingDeg`, sonde `?debug-surface`) près de l'horizon et une visée vers le zénith
 * (`window.__lookUpDeg`). Chaque capture enregistre l'altitude, le gain d'adaptation de l'air lu dans la sonde
 * et la couleur moyenne de la moitié haute du centre de l'image (le ciel), et, avec `--perf`, les durées
 * d'image médiane et p95 et les textures (`?debug-perf`).
 *
 * Usage :
 *   node scripts/measure-sky-cycle.mjs --origin http://localhost:4391 --place Kerguelen \
 *     --times "+45=2026-11-20T04:15:00Z,0=2026-11-20T14:48:00Z,-6=2026-11-20T15:35:00Z" \
 *     --out reports/sky-cycle/ker-after [--query "&sky-adapt=0"] [--clouds on] [--perf] [--software]
 *     [--device "Pixel 7"] [--reduced-motion] [--headings 0,90,180,270] [--zenith 80] [--steps 18 --wheel -700]
 */
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import sharp from 'sharp';
import { chromium, devices } from 'playwright';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const ORIGIN = flag('--origin', 'http://localhost:4391').replace(/\/$/, '');
const PLACE = flag('--place', 'Kerguelen');
const TIMES = flag('--times', '')
  .split(',')
  .filter(Boolean)
  .map((pair) => {
    const [label, iso] = pair.split('=');
    return { label, iso };
  });
const QUERY = flag('--query', '');
const OUT = resolve(flag('--out', 'reports/sky-cycle/run'));
const CLOUDS = flag('--clouds', 'off');
const STEPS = Number(flag('--steps', '18'));
const WHEEL = Number(flag('--wheel', '-700'));
const HEADINGS = flag('--headings', '0,90,180,270').split(',').map(Number);
const ZENITH = Number(flag('--zenith', '80'));
const DEVICE = flag('--device', null);
const PERF = args.includes('--perf');
const SOFTWARE = args.includes('--software');
const REDUCED_MOTION = args.includes('--reduced-motion');
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

const probeNumber = (text, re) => {
  const m = re.exec(text.split(/\s+/).join(' '));
  return m ? Number(m[1]) : null;
};

const results = [];
for (const { label, iso } of TIMES) {
  const context = await browser.newContext({
    ...(DEVICE ? devices[DEVICE] : { viewport: { width: 1280, height: 800 } }),
    ...(REDUCED_MOTION ? { reducedMotion: 'reduce' } : {}),
  });
  await context.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.goto(
    `${ORIGIN}/?debug-surface${PERF ? '&debug-perf' : ''}${QUERY}&mode=explo&body=earth&date=${iso}`,
    { timeout: 180_000 }
  );
  await page.locator('#loader').waitFor({ state: 'hidden', timeout: 180_000 });
  await page.waitForTimeout(4000);
  // Le temps arrêté : le Soleil reste à la hauteur choisie pendant toute la mesure.
  await page.locator('#play-pause-btn').click();
  if (CLOUDS === 'on') {
    await page.locator('#weather-trigger').click();
    const box = page.locator('#weather-layers input[data-layer="clouds"]');
    await box.waitFor({ timeout: 20_000 });
    if (!(await box.isChecked())) await box.check();
    // Une case restée décochée ferait passer une mesure SANS nuages pour une mesure avec (vu le 2026-11-28).
    if (!(await box.isChecked()))
      throw new Error('la couche des nuages réels ne s’est pas cochée');
    await page.waitForTimeout(3000);
    await page.locator('#weather-trigger').click();
  }
  await page.locator('#body-search-trigger').click();
  await page.locator('#palette-input').fill(PLACE);
  await page.locator('#palette-hit-0').waitFor({ timeout: 15_000 });
  await page.locator('#palette-hit-0').click();
  await page.waitForTimeout(9000);
  await page.keyboard.press('Escape');

  const probe = () =>
    page.evaluate(
      () => document.getElementById('surface-probe')?.innerText ?? ''
    );
  const settle = () =>
    page
      .waitForFunction(
        () =>
          document.querySelector('canvas')?.dataset['sceneMoving'] !== '1' &&
          (document.querySelector('canvas')?.dataset['surfaceBusy'] ?? '0') ===
            '0',
        null,
        { timeout: 20_000 }
      )
      .catch(() => {});
  const frames = [];
  const capture = async (tag) => {
    await settle();
    // Les carreaux lointains de l'horizon arrivent après les proches : 1,2 s laissait des plaques grossières
    // posées au-dessus de l'horizon (vu le 2026-11-28, absentes avec 5 s).
    await page.waitForTimeout(5000);
    const file = `${label}_${tag}.png`;
    const shot = await page.screenshot({ path: resolve(OUT, file) });
    const meta = await sharp(shot).metadata();
    // Le ciel : la moitié haute du centre de l'image, à l'écart de la sonde (gauche) et de la fiche (droite).
    const left = Math.round(meta.width * 0.3);
    const width = Math.round(meta.width * 0.42);
    const stats = await sharp(shot)
      .extract({ left, top: 0, width, height: Math.round(meta.height / 2) })
      .stats();
    const text = await probe();
    let perf = null;
    if (PERF) {
      await page.evaluate(() => window.perfProbe?.reset());
      await page.waitForTimeout(2000);
      perf = await page.evaluate(() => {
        const s = window.perfProbe?.snapshot();
        return s
          ? {
              p50Ms: s.frames.p50Ms,
              p95Ms: s.frames.p95Ms,
              textureMiB: Math.round((s.textures.bytes / 1048576) * 10) / 10,
            }
          : null;
      });
    }
    const frame = {
      tag,
      file,
      altKm: probeNumber(text, /altitude ([-0-9.]+) km/),
      airGain: probeNumber(text, /air \(adapt\.\) ×([0-9.]+)/),
      skyRgb: stats.channels
        .slice(0, 3)
        .map((c) => Math.round(c.mean * 10) / 10),
      perf,
    };
    frames.push(frame);
    console.log(
      label,
      tag,
      frame.altKm,
      '×' + frame.airGain,
      frame.skyRgb.join(',')
    );
  };

  const box = await page.locator('canvas').first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await capture('orbit');
  const marks = [2000, 100, 10];
  for (let i = 0; i < STEPS; i += 1) {
    await page.mouse.wheel(0, WHEEL);
    await page.waitForTimeout(1600);
    const alt = probeNumber(await probe(), /altitude ([-0-9.]+) km/);
    while (marks.length && alt !== null && alt < marks[0])
      await capture(`alt${marks.shift()}`);
  }
  for (const heading of HEADINGS) {
    await page.evaluate(
      ([h, up]) => {
        window.__headingDeg = h;
        window.__lookUpDeg = up;
      },
      [heading, 8]
    );
    await capture(`h${String(heading).padStart(3, '0')}`);
  }
  await page.evaluate((up) => {
    window.__headingDeg = 0;
    window.__lookUpDeg = up;
  }, ZENITH);
  await capture('zenith');
  results.push({ label, iso, frames, errors });
  await context.close();
}
writeFileSync(
  resolve(OUT, 'run.json'),
  JSON.stringify(
    { ORIGIN, PLACE, QUERY, CLOUDS, DEVICE, SOFTWARE, results },
    null,
    2
  )
);
await browser.close();
