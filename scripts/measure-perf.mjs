/* global console, process, window */
/* Les rappels passés à `addInitScript` tournent DANS la page, pas dans Node : d'où ces globaux. */
/* global localStorage, PerformanceObserver, WebGL2RenderingContext, performance */
/**
 * CE QUE COÛTE UNE SCÈNE HORS OCTETS (lot 54) : images par seconde, blocages du fil principal,
 * mémoire GPU estimée, appels de dessin. Mesuré dans un vrai navigateur, scène par scène, par la
 * sonde `?debug-perf` (`src/ui/perfProbe.ts`, qui dit comment elle estime la mémoire).
 *
 * Conditions, écrites ici pour qu'un nombre ne survive pas à sa méthode :
 *
 *   - le VRAI GPU de la machine (`--use-angle=d3d11`) : sans ce drapeau, Chromium piloté rend en
 *     logiciel (SwiftShader), et les images par seconde ne décrivent plus que le processeur. La
 *     carte est nommée dans le relevé : une RTX 5070 Ti ne dit rien d'un téléphone, et le relevé
 *     ne prétend pas le contraire ;
 *   - `--cpu <n>` freine le processeur par le protocole DevTools, comme `e2e/perf-fps.spec.ts` ;
 *     le GPU, lui, ne se freine pas ;
 *   - deux phases par scène : l'APPROCHE (du chargement à la fin du trajet, où tombent les
 *     téléversements de textures) et le RÉGIME (dix secondes immobiles ensuite). Les confondre
 *     ferait passer un coût de chargement pour un coût d'image ;
 *   - fenêtre 1280 × 800, langue anglaise, visites guidées coupées ;
 *   - scènes DATÉES (le 2024-07-01 à 12 h UTC) : la caméra aborde un corps côté Soleil, et une
 *     scène à la date du jour ne serait pas la même d'un jour à l'autre (piège du 2026-10-01).
 *
 * Usage :
 *   node scripts/measure-perf.mjs --origin http://127.0.0.1:4173
 *   node scripts/measure-perf.mjs --origin http://127.0.0.1:4173 --cpu 4 --json reports/perf/x.json
 *   node scripts/measure-perf.mjs --only earth-surface
 *   node scripts/measure-perf.mjs --only earth-surface --profile approach   (ou steady, ou boot)
 *   node scripts/measure-perf.mjs --only earth-explo --links   (attentes d'édition de liens, par programme)
 *
 * `--profile` enregistre un profil CPU (domaine Profiler du protocole DevTools) pendant la phase
 * nommée et imprime les fonctions au plus fort temps PROPRE : ce qui coûte, pas qui appelle.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const ORIGIN = flag('--origin', 'https://galaxy.adrianguichard.dev').replace(
  /\/$/,
  ''
);
const CPU = Number(flag('--cpu', '1'));
const ONLY = flag('--only', null);
const JSON_OUT = flag('--json', null);
const PROFILE = flag('--profile', null);
const LINKS = args.includes('--links');
/** Paramètres ajoutés à chaque adresse, pour un A/B sur le même build (`--extra debug-decode-img`). */
const EXTRA = flag('--extra', null);

/** Temps propre par fonction (fichier et ligne), en ms, depuis un profil du protocole. */
function topSelf(profile, count = 15) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  for (let i = 0; i < profile.samples.length; i += 1) {
    const node = byId.get(profile.samples[i]);
    const f = node.callFrame;
    const key = `${f.functionName || '(anonyme)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
  }
  return [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, count);
}
const DATE = '2024-07-01T12:00:00Z';

/** Les scènes : une adresse, puis un nombre de crans de molette vers la cible. */
const SCENES = [
  { id: 'overview', query: `?debug-perf&date=${DATE}`, steps: 0 },
  {
    id: 'jupiter-educ',
    query: `?debug-perf&body=jupiter&date=${DATE}`,
    steps: 0,
  },
  {
    id: 'saturn-explo',
    query: `?debug-perf&mode=explo&body=saturn&date=${DATE}`,
    steps: 0,
  },
  {
    id: 'earth-explo',
    query: `?debug-perf&mode=explo&body=earth&date=${DATE}`,
    steps: 0,
  },
  {
    id: 'earth-surface',
    query: `?debug-perf&mode=explo&body=earth&date=${DATE}`,
    steps: 12,
  },
  {
    id: 'moon-surface',
    query: `?debug-perf&mode=explo&body=moon&date=${DATE}`,
    steps: 12,
  },
  {
    id: 'mars-surface',
    query: `?debug-perf&mode=explo&body=mars&date=${DATE}`,
    steps: 12,
  },
].filter((s) => !ONLY || s.id === ONLY);

// `--software` : le rendu LOGICIEL (SwiftShader) de la CI, sans GPU. Payé le 2026-10-17 : le
// décodage hors du fil, gagnant sur la RTX, a rendu la suite e2e de la CI non saine.
const SOFTWARE = args.includes('--software');
const browser = await chromium.launch(
  SOFTWARE
    ? {}
    : { args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] }
);
const results = [];
for (const scene of SCENES) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  await context.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
    // Les blocages se comptent DEPUIS LA NAVIGATION, avant toute ligne de l'application : la
    // sonde ne se charge qu'après l'initialisation, et ce qui tombait avant elle n'était pas
    // compté, ce qui a fait passer le décodage hors du fil pour une perte (2026-10-17).
    const tasks = [];
    window.__longTasks = tasks;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) tasks.push(entry.duration);
    }).observe({ type: 'longtask' });
    // L'attente d'une édition de liens de shaders, programme par programme : la trace du
    // démarrage montrait des images de 400 ms dans `GetProgramiv` (2026-10-17).
    const links = [];
    window.__shaderLinks = links;
    for (const method of [
      'getProgramParameter',
      'getProgramInfoLog',
      'getShaderInfoLog',
      'getShaderParameter',
      'getUniformLocation',
      'getActiveUniform',
      'getAttribLocation',
    ]) {
      const original = WebGL2RenderingContext.prototype[method];
      WebGL2RenderingContext.prototype[method] = function (target, ...rest) {
        const start = performance.now();
        const value = original.call(this, target, ...rest);
        const ms = performance.now() - start;
        if (ms > 20) {
          // Les #define des shaders attachés : ce qui distingue deux variantes d'un même matériau.
          const defines = (this.getAttachedShaders(target) ?? [])
            .map((shader) =>
              (this.getShaderSource(shader) ?? '')
                .split('\n')
                .filter((line) => line.startsWith('#define'))
                .join(' ')
            )
            .join(' | ');
          links.push({ program: target, ms, at: start, method, defines });
        }
        return value;
      };
    }
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  if (PROFILE) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  }
  const started = Date.now();
  if (PROFILE === 'boot') await cdp.send('Profiler.start');
  await page.goto(`${ORIGIN}/${scene.query}${EXTRA ? `&${EXTRA}` : ''}`, {
    timeout: 180_000,
  });
  await page
    .locator('#loader')
    .waitFor({ state: 'visible', timeout: 60_000 })
    .catch(() => {});
  await page.locator('#loader').waitFor({ state: 'hidden', timeout: 180_000 });
  await page.waitForFunction(() => 'perfProbe' in window, null, {
    timeout: 60_000,
  });
  await page.waitForTimeout(8000);
  if (PROFILE === 'boot') {
    const { profile } = await cdp.send('Profiler.stop');
    for (const [k, ms] of topSelf(profile, 20))
      console.log(`  ${ms.toFixed(0).padStart(7)} ms  ${k}`);
  }
  if (PROFILE === 'approach') await cdp.send('Profiler.start');
  const box = await page.locator('canvas').first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < scene.steps; i += 1) {
    await page.mouse.wheel(0, -1500);
    await page.waitForTimeout(2500);
  }
  await page.waitForTimeout(8000);
  const approach = await page.evaluate(() => window.perfProbe.snapshot());
  if (LINKS) {
    const links = await page.evaluate(() => window.perfProbe.shaderLinks());
    for (const l of links)
      console.log(
        `  lien ${l.ms.toFixed(0).padStart(5)} ms à ${l.at.toFixed(0)} ms  ${l.method}  ${l.name}`
      );
    const heavy = await page.evaluate(() =>
      window.__shaderLinks
        .filter((l) => l.ms > 100)
        .map((l) => ({
          ms: l.ms,
          at: l.at,
          defines: l.defines,
          method: l.method,
        }))
    );
    for (const l of heavy)
      console.log(
        `  ${l.ms.toFixed(0)} ms à ${l.at.toFixed(0)} ms ${l.method} : ${l.defines.includes('FLIP_SIDED') ? 'face arrière' : 'face avant'}${l.defines.includes('VIEW_SAMPLES') ? ', perspective aérienne' : ''}`
      );
  }
  if (PROFILE === 'approach') {
    const { profile } = await cdp.send('Profiler.stop');
    for (const [k, ms] of topSelf(profile))
      console.log(`  ${ms.toFixed(0).padStart(7)} ms  ${k}`);
  }
  await page.evaluate(() => window.perfProbe.reset());
  if (PROFILE === 'steady') await cdp.send('Profiler.start');
  await page.waitForTimeout(10_000);
  if (PROFILE === 'steady') {
    const { profile } = await cdp.send('Profiler.stop');
    for (const [k, ms] of topSelf(profile))
      console.log(`  ${ms.toFixed(0).padStart(7)} ms  ${k}`);
  }
  const steady = await page.evaluate(() => window.perfProbe.snapshot());
  results.push({
    scene: scene.id,
    seconds: Math.round((Date.now() - started) / 1000),
    approach,
    steady,
  });
  const mib = (b) => (b / 1048576).toFixed(0);
  console.log(
    `${scene.id.padEnd(14)} régime p50 ${steady.frames.p50Ms.toFixed(1)} ms, p95 ${steady.frames.p95Ms.toFixed(1)} ms` +
      ` | approche : ${approach.longTasks.count} blocages, ${Math.round(approach.longTasks.totalMs)} ms, max ${Math.round(approach.longTasks.maxMs)} ms` +
      ` | textures ${steady.textures.count} (${mib(steady.textures.bytes)} Mio), géométries ${mib(steady.geometries.bytes)} Mio, ${steady.drawCalls} appels`
  );
  // Le registre du PILOTE (lot 56) : tout ce qui a été demandé à WebGL, cubemaps et cibles de
  // rendu comprises, et non les seules textures des matériaux.
  const d = steady.driver;
  if (d) {
    console.log(
      `${''.padEnd(14)} pilote ${mib(d.total)} Mio : textures ${d.textures.live} (${mib(d.textures.bytes)} Mio, dont matériaux ${mib(d.materialBytes)}, cubemaps ${mib(d.textures.cubeBytes)}), rendu ${mib(d.renderbuffers.bytes)} Mio, tampons ${mib(d.buffers.bytes)} Mio`
    );
    for (const line of d.largest.slice(0, 6))
      console.log(`${''.padEnd(16)}${line}`);
    console.log(
      `${''.padEnd(16)}matériaux : ${d.materialUploaded} téléversées, ${d.notUploaded} jamais, ${d.mismatches.length} écarts d'estimation`
    );
    for (const line of d.mismatches.slice(0, 6))
      console.log(`${''.padEnd(18)}${line}`);
  }
  await context.close();
}
await browser.close();
console.log(
  `GPU : ${results[0]?.steady.renderer ?? '?'} ; frein CPU × ${CPU} ; origine ${ORIGIN}`
);
if (JSON_OUT) {
  const out = resolve(JSON_OUT);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    `${JSON.stringify({ origin: ORIGIN, cpu: CPU, results }, null, 2)}\n`
  );
}
