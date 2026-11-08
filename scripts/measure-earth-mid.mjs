/* global console, process, document, localStorage, URL */
/**
 * LA ZONE INTERMÉDIAIRE DE LA TERRE (2026-11-08) : de l'arrivée jusqu'au sol, par petits crans, puis
 * un aller-retour. Aucune tuile n'est demandée au-dessus de ~1,8 rayon : c'est la texture de BASE
 * (paliers 8k, 4k, 2k, 1k selon la distance, `core/textureLod`) et le fond lointain
 * (`core/farBase`) qui sont peints, et c'est là que `measure-earth-zoom.mjs` ne regardait pas.
 *
 * À chaque cran : la netteté de l'image PEINTE tout de suite, puis une fois la scène posée (rapport
 * « tout de suite / posée » : une texture grossière montrée alors qu'une plus fine est due le fait
 * chuter), l'altitude, et les fichiers de TEXTURE demandés pendant le cran. Un même fichier demandé
 * plusieurs fois sur la durée = libéré puis retéléchargé (le retour en arrière que voit l'œil).
 *
 * Mobile : `--device "Pixel 7"` (Chromium) ou `--device "iPhone 15"` (WebKit), appareils de
 * Playwright, émulation et non téléphone réel.
 *
 *   node scripts/measure-earth-mid.mjs --origin http://localhost:4391
 *   node scripts/measure-earth-mid.mjs --origin <url> --device "Pixel 7" --json reports/perf/x.json
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { chromium, devices, webkit } from 'playwright';
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
const DEVICE = flag('--device', null);
const STEPS = Number(flag('--steps', '24'));
const WHEEL = Number(flag('--wheel', '-500'));
const JSON_OUT = flag('--json', null);
const DATE = '2024-07-01T12:00:00Z';

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

const descriptor = DEVICE ? devices[DEVICE] : null;
if (DEVICE && !descriptor) throw new Error(`Appareil inconnu : ${DEVICE}`);
const engine = descriptor?.defaultBrowserType === 'webkit' ? webkit : chromium;
const browser = await engine.launch(
  engine === chromium
    ? {
        args: [
          '--disable-features=CalculateNativeWinOcclusion',
          '--disable-renderer-backgrounding',
          '--use-angle=d3d11',
          '--enable-gpu',
          '--ignore-gpu-blocklist',
        ],
      }
    : {}
);
const context = await browser.newContext(
  descriptor ?? { viewport: { width: 1280, height: 800 } }
);
await context.addInitScript(() => {
  localStorage.setItem('ssv-guided-tour-v1', '1');
  localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  localStorage.setItem('ssv-locale', 'en');
});
const page = await context.newPage();

/** Fichiers de texture demandés, dans l'ordre, avec l'instant et le cran courant. */
const textureRequests = [];
let currentStep = -1;
page.on('request', (request) => {
  const url = new URL(request.url());
  if (!/\/textures\//.test(url.pathname) || !/\.jpe?g$/.test(url.pathname))
    return;
  textureRequests.push({
    step: currentStep,
    file: url.pathname.split('/').slice(-2).join('/'),
  });
});

await page.goto(`${ORIGIN}/?debug-surface&mode=explo&body=earth&date=${DATE}`, {
  timeout: 180_000,
});
await page.locator('#loader').waitFor({ state: 'hidden', timeout: 180_000 });
await page.waitForFunction(
  () => document.querySelector('#surface-probe') !== null,
  null,
  { timeout: 60_000 }
);
const calm = (timeout) =>
  page
    .waitForFunction(
      () => {
        const c = document.querySelector('canvas');
        return (
          c?.dataset['sceneMoving'] !== '1' &&
          c?.dataset['texturesLoading'] === '0' &&
          (c?.dataset['surfaceBusy'] ?? '0') === '0'
        );
      },
      null,
      { timeout, polling: 150 }
    )
    .then(
      () => true,
      () => false
    );
await calm(60_000);
await page.waitForTimeout(1500);

const box = await page.locator('canvas').first().boundingBox();
const clip = {
  x: box.x + box.width * 0.25,
  y: box.y + box.height * 0.25,
  width: box.width * 0.5,
  height: box.height * 0.5,
};
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
const altitude = () =>
  page.evaluate(() => {
    const t = (document.getElementById('surface-probe')?.innerText ?? '')
      .split(/\s+/)
      .join(' ');
    const km = /altitude ([-0-9.]+) km/.exec(t)?.[1];
    return km === undefined ? null : Number(km);
  });

const rows = [];
async function stepOnce(index, wheel, label) {
  currentStep = index;
  const before = textureRequests.length;
  await page.mouse.wheel(0, wheel);
  // « Tout de suite » : le temps d'un vol court, puis la capture, sans attendre le réseau.
  await page.waitForTimeout(350);
  const immediate = await sharpness(await page.screenshot({ clip }));
  const altNow = await altitude();
  const settled = await calm(8000);
  await page.waitForTimeout(400);
  const posed = await sharpness(await page.screenshot({ clip }));
  rows.push({
    step: index,
    label,
    altKm: altNow,
    immediate: Math.round(immediate),
    posed: Math.round(posed),
    ratio: posed > 0 ? Number((immediate / posed).toFixed(2)) : null,
    settled,
    textures: textureRequests.slice(before).map((r) => r.file),
  });
}

let index = 0;
for (let i = 0; i < STEPS; i += 1) await stepOnce(index++, WHEEL, 'descente');
for (let i = 0; i < STEPS / 2; i += 1)
  await stepOnce(index++, -WHEEL, 'remontée');
for (let i = 0; i < STEPS / 2; i += 1)
  await stepOnce(index++, WHEEL, 'redescente');
await browser.close();

console.log(
  'cran  phase        alt km      tout de suite / posée   textures demandées'
);
for (const r of rows)
  console.log(
    `${String(r.step).padStart(3)}  ${r.label.padEnd(11)} ${String(r.altKm).padStart(10)}  ${String(r.immediate).padStart(7)} / ${String(r.posed).padStart(7)}  x${String(r.ratio).padEnd(5)}${r.settled ? '' : ' NON POSÉE'}  ${r.textures.join(', ')}`
  );
const counts = {};
for (const r of textureRequests) counts[r.file] = (counts[r.file] ?? 0) + 1;
const repeated = Object.entries(counts).filter(([, n]) => n > 1);
console.log(
  "\nfichiers de texture demandés plus d'une fois :",
  repeated.length ? JSON.stringify(Object.fromEntries(repeated)) : 'aucun'
);
const low = rows.filter((r) => r.ratio !== null && r.ratio < 0.7);
console.log(
  `crans où l'image montrée tout de suite est < 70 % de la posée : ${low.length} sur ${rows.length}`
);
if (JSON_OUT) {
  const path = resolve(JSON_OUT);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      { origin: ORIGIN, device: DEVICE, rows, repeated },
      null,
      2
    ) + '\n',
    'utf8'
  );
}
process.exit(0);
