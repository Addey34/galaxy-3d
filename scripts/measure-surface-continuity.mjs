/* global console, process, window, document, localStorage, URL  */
/**
 * LA CONTINUITÉ DU SOL PENDANT UN PARCOURS (GAL-SURFACE-MULTILOD-001, 2026-11-26).
 *
 * Un parcours reproductible sur un corps et un lieu : approche (le lieu choisi par la recherche), descente
 * à la molette, glissements latéraux près du sol, remontée. Relevé PAR PHASE, depuis la couverture que le
 * moteur publie sous `?debug-surface` (`window.__surfaceCoverage`, une entrée par passe) :
 *   - la part moyenne des carreaux voulus qui ne sont couverts par AUCUN carreau posé (la texture globale
 *     se voit là : un trou dans la couverture fine) ;
 *   - la durée pendant laquelle il y a eu au moins un tel trou, et le pic ;
 *   - les requêtes de tuiles (terminées, annulées, échouées) et le pic de carreaux en vol.
 *
 * Conditions : fenêtre 1280 × 800, visites coupées, date fixe, réseau réel (ou freiné : `--throttle-kbps`).
 * Un tirage ne dit rien : `--repeat 3`. `--query a=b` ajoute un paramètre d'adresse (comparaison A/B sur le
 * MÊME build). Sert un build local ou le serveur de développement : lire le `<title>` avant.
 *
 * Usage :
 *   node scripts/measure-surface-continuity.mjs --origin http://localhost:5273 --body earth --place Rome
 *   node scripts/measure-surface-continuity.mjs --origin <url> --body moon --place "Mare Tranquillitatis" --repeat 3 --json out.json
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
const ORIGIN = flag('--origin', 'http://localhost:5273').replace(/\/$/, '');
const BODY = flag('--body', 'earth');
const PLACE = flag('--place', null);
const QUERY = flag('--query', '');
const REPEAT = Number(flag('--repeat', '1'));
const THROTTLE = Number(flag('--throttle-kbps', '0'));
const STEPS = Number(flag('--steps', '14'));
const JSON_OUT = flag('--json', null);
const DATE = flag('--date', '2026-11-20T12:00:00Z');
const SOFTWARE = args.includes('--software');
const ORIGIN_HOST = new URL(ORIGIN).host;

/** Netteté d'une image : variance du laplacien sur la luminance (plus haut = plus de détail). */
async function sharpness(png) {
  const { data, info } = await sharp(png)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let y = 1; y < info.height - 1; y += 1)
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      const l =
        4 * data[i] - data[i - 1] - data[i + 1] - data[i - w] - data[i + w];
      sum += l;
      sum2 += l * l;
      n += 1;
    }
  return sum2 / n - (sum / n) ** 2;
}

function summarise(entries, net) {
  if (entries.length === 0) return { passes: 0 };
  // Pondéré par le TEMPS (chaque passe vaut jusqu'à la suivante) : les passes ne sont pas régulières.
  let shareTime = 0;
  let deficitTime = 0;
  let span = 0;
  let holeMs = 0;
  let peak = 0;
  let peakInFlight = 0;
  let peakResident = 0;
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    const dt = i + 1 < entries.length ? entries[i + 1].t - e.t : 0;
    const wantedN = Math.max(e.wanted, 1);
    shareTime += (e.uncovered / wantedN) * dt;
    deficitTime += ((e.deficit ?? 0) / wantedN) * dt;
    span += dt;
    peak = Math.max(peak, e.uncovered);
    peakInFlight = Math.max(peakInFlight, e.inFlight);
    peakResident = Math.max(peakResident, e.resident ?? 0);
    if (e.uncovered > 0) holeMs += dt;
  }
  return {
    passes: entries.length,
    uncoveredShareMean: Number((shareTime / Math.max(span, 1)).toFixed(4)),
    deficitLevelsMean: Number((deficitTime / Math.max(span, 1)).toFixed(3)),
    holeMs,
    peakUncovered: peak,
    peakInFlight,
    peakResident,
    requests: { ...net },
  };
}

async function oneRun(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    serviceWorkers: 'block',
  });
  await context.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
  const page = await context.newPage();
  if (THROTTLE > 0) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 60,
      downloadThroughput: (THROTTLE * 1024) / 8,
      uploadThroughput: (THROTTLE * 1024) / 8,
    });
  }
  const net = { ok: 0, aborted: 0, failed: 0 };
  page.on('response', (r) => {
    const url = new URL(r.url());
    if (url.host === ORIGIN_HOST || url.protocol === 'data:') return;
    if (r.status() < 400) net.ok += 1;
    else net.failed += 1;
  });
  page.on('requestfailed', (r) => {
    const url = new URL(r.url());
    if (url.host === ORIGIN_HOST || url.host === 'cloudflareinsights.com')
      return;
    if ((r.failure()?.errorText ?? '').includes('ABORTED')) net.aborted += 1;
    else net.failed += 1;
  });
  const extra = QUERY ? `&${QUERY}` : '';
  await page.goto(
    `${ORIGIN}/?debug-surface&mode=explo&body=${BODY}&date=${DATE}${extra}`,
    { timeout: 180_000 }
  );
  await page.locator('#loader').waitFor({ state: 'hidden', timeout: 180_000 });
  const calm = () =>
    page.waitForFunction(
      () => document.querySelector('canvas')?.dataset['sceneMoving'] === '0',
      null,
      { timeout: 120_000 }
    );
  await calm();
  if (PLACE) {
    await page.locator('#body-search-trigger').click();
    await page.locator('#palette-input').fill(PLACE);
    const hit = page.locator('.palette-hit').filter({ hasText: PLACE }).first();
    await hit.waitFor({ timeout: 90_000 });
    await hit.click();
    await page.waitForTimeout(1500);
    await calm();
  }
  await page.waitForTimeout(3000);
  const box = await page.locator('canvas').first().boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);

  const phases = {};
  // La netteté de la région centrale (hors fiche et bandeaux), toutes les 500 ms pendant la phase.
  const clip = {
    x: box.x + box.width * 0.15,
    y: box.y + box.height * 0.35,
    width: box.width * 0.45,
    height: box.height * 0.5,
  };
  const phase = async (name, run) => {
    for (const k of Object.keys(net)) net[k] = 0;
    const from = await page.evaluate(
      () => window.__surfaceCoverage?.length ?? 0
    );
    const t0 = Date.now();
    const samples = [];
    let sampling = true;
    const sampler = (async () => {
      while (sampling) {
        samples.push(await sharpness(await page.screenshot({ clip })));
        await page.waitForTimeout(500);
      }
    })();
    await run();
    // La phase finit quand le sol est posé (plus rien en vol, sans trou), au plus 25 s.
    await page
      .waitForFunction(
        () => {
          const log = window.__surfaceCoverage ?? [];
          const last = log.slice(-10);
          return (
            last.length === 10 &&
            last.every((e) => e.inFlight === 0 && e.uncovered === 0)
          );
        },
        null,
        { timeout: 25_000, polling: 250 }
      )
      .catch(() => undefined);
    sampling = false;
    await sampler;
    const entries = await page.evaluate(
      (f) => (window.__surfaceCoverage ?? []).slice(f),
      from
    );
    phases[name] = {
      ...summarise(entries, net),
      sharpnessMean: Math.round(
        samples.reduce((a, b) => a + b, 0) / Math.max(samples.length, 1)
      ),
      wallMs: Date.now() - t0,
    };
  };

  await phase('descente', async () => {
    for (let i = 0; i < STEPS; i += 1) {
      await page.mouse.wheel(0, -1500);
      await page.waitForTimeout(350);
    }
  });
  await phase('deplacement-proche', async () => {
    for (let i = 0; i < 6; i += 1) {
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + (i % 2 ? -220 : 220), cy + 40, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(400);
    }
  });
  await phase('remontee', async () => {
    for (let i = 0; i < STEPS; i += 1) {
      await page.mouse.wheel(0, 1500);
      await page.waitForTimeout(250);
    }
  });
  await context.close();
  return phases;
}

const browser = await chromium.launch({
  args: SOFTWARE ? [] : ['--use-angle=d3d11', '--enable-gpu'],
});
const runs = [];
for (let r = 0; r < REPEAT; r += 1) {
  const phases = await oneRun(browser);
  runs.push(phases);
  for (const [name, p] of Object.entries(phases))
    console.log(
      `${BODY}${QUERY ? ` [${QUERY}]` : ''} #${r + 1} ${name.padEnd(19)} trou ${(p.uncoveredShareMean * 100).toFixed(2).padStart(6)} %  déficit ${p.deficitLevelsMean?.toFixed(3)} niv.  durée trou ${String(p.holeMs).padStart(6)} ms  netteté ${String(p.sharpnessMean).padStart(5)}  pic ${String(p.peakUncovered).padStart(3)}  requêtes ${p.requests?.ok}/${p.requests?.aborted}a/${p.requests?.failed}e  en vol ${p.peakInFlight}  posés ${p.peakResident}  ${p.wallMs} ms`
    );
}
await browser.close();
if (JSON_OUT) {
  mkdirSync(dirname(resolve(JSON_OUT)), { recursive: true });
  writeFileSync(
    resolve(JSON_OUT),
    JSON.stringify(
      { body: BODY, place: PLACE, query: QUERY, date: DATE, runs },
      null,
      2
    )
  );
}
