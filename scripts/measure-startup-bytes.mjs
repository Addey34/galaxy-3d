/* global console, process */
/* Les rappels passés à `addInitScript` tournent DANS la page, pas dans Node : d'où ces globaux. */
/* global navigator, localStorage */
/**
 * CE QUE LE DÉMARRAGE COÛTE, PAR FAMILLE, MESURÉ DANS UN VRAI NAVIGATEUR.
 *
 * Lot 17, phase 17F. Ce script est LA MÉTHODE écrite à côté des nombres : un budget dont on ne
 * sait plus comment il a été mesuré ne se remesure pas, donc il vieillit sans que personne le
 * voie. `src/core/startupBudget.ts` porte les plafonds et la règle ; celui-ci porte la mesure.
 *
 * Conditions, reprises du plan (`docs/private/EPHEMERIDES_LOT17.md` §§ 2 et 8) :
 *
 *   - contre la PRODUCTION par défaut (`--origin`), donc avec la compression et les en-têtes de
 *     l'hôte réel : c'est ce que le visiteur paie, pas ce que `dist/` pèse ;
 *   - **service worker bloqué**, de deux façons redondantes (sa requête est coupée ET
 *     `navigator.serviceWorker.register` est neutralisé avant tout script de la page). Sans ça la
 *     mesure décrit une visite de RETOUR : le trafic servi par le service worker n'apparaît pas
 *     dans le domaine Network du CDP de la page (piège 3 du plan), donc la moitié des octets
 *     manquerait sans qu'aucune ligne ne soit vide ;
 *   - contexte NEUF à chaque passage : ni cache HTTP, ni magasin d'éphémérides du lot 17E ;
 *   - `#loader` attendu **VISIBLE puis masqué** (piège 2 du plan) : Playwright compte un élément
 *     ABSENT comme masqué, donc attendre `hidden` seul rend la main avant que l'application
 *     existe — 0,4 s et 13 requêtes au lieu de 15,3 s et 159 ;
 *   - fenêtre 1280 x 800, comme le relevé du § 2 ;
 *   - les octets sont ceux du CDP (`Network.loadingFinished.encodedDataLength`), en-têtes
 *     comprises : la grandeur du fil, jamais une taille de fichier.
 *
 * Les familles ne sont JAMAIS sommées en un total unique qui déciderait de quoi que ce soit. Un
 * budget global créerait une pression permanente à dégrader les textures pour financer autre
 * chose, en contradiction frontale avec la règle de parité du lot 16. Le total imprimé est un
 * repère de lecture, rien d'autre ne s'y adosse.
 *
 * Usage :
 *   node scripts/measure-startup-bytes.mjs
 *   node scripts/measure-startup-bytes.mjs --origin http://127.0.0.1:4173 --runs 2
 *   node scripts/measure-startup-bytes.mjs --json reports/startup-bytes.json
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// La table des familles n'est PAS recopiée ici : elle vit dans `src/core/startupBudget.ts`,
// que lisent aussi la garde de build et la garde e2e. Chargée comme
// `scripts/compute-mean-motion-scale.mjs` charge la formule du facteur d'échelle.
const { createServer } = await import('vite');
const loader = await createServer({
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  resolve: { alias: { '@': join(ROOT, 'src') } },
});
const { classifyStartupUrl } = await loader.ssrLoadModule(
  '/src/core/startupBudget.ts'
);

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const ORIGIN = flag('--origin', 'https://galaxy.adrianguichard.dev').replace(
  /\/$/,
  ''
);
const PATH = flag('--path', '/');
const RUNS = Number(flag('--runs', '1'));
const JSON_OUT = flag('--json', null);
/** Large : la mesure décrit un lien lent autant qu'un lien rapide, et ne doit pas le trancher. */
const LOADER_TIMEOUT_MS = Number(flag('--loader-timeout', '600000'));
/** Millisecondes d'observation APRÈS le chargeur masqué. 0 = les conditions du plan, strictement. */
const SETTLE_MS = Number(flag('--settle', '0'));

/** Une visite, contexte neuf, service worker hors jeu. */
async function measureOnce(browser, index) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    serviceWorkers: 'block',
  });
  // Ceinture ET bretelles. `serviceWorkers: 'block'` empêche Playwright de laisser un worker
  // servir des réponses ; les deux lignes qui suivent empêchent la page d'en enregistrer un,
  // pour que la mesure ne dépende pas d'une seule option du harnais.
  await context.route('**/sw.js', (route) => route.abort());
  await context.addInitScript(() => {
    try {
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        get: () => undefined,
      });
    } catch {
      /* Un navigateur qui refuse la redéfinition garde `serviceWorkers: block`. */
    }
    // La visite guidée et le toast d'Explo ne changent aucun octet, mais un panneau ouvert
    // fausserait une relecture à l'écran faite avec le même harnais.
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });

  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');

  /** requestId -> url, pour rattacher les octets à leur famille. */
  const urls = new Map();
  /** famille -> { bytes, requests } */
  const families = new Map();
  const perUrl = new Map();
  /** famille -> requêtes PARTIES pendant la fenêtre, arrivées ou non. */
  const requested = new Map();
  let served = 0;
  let servedByWorker = 0;

  cdp.on('Network.requestWillBeSent', ({ requestId, request }) => {
    urls.set(requestId, request.url);
    // COMPTÉ À PART, et la raison a coûté une lecture fausse : les octets ne sont comptés qu'à
    // `loadingFinished`, donc une requête PARTIE pendant le démarrage mais arrivée après que le
    // chargeur se masque disparaît du relevé. C'est exactement ce qui est arrivé aux trois images
    // WMS de NASA GIBS : présentes dans un démarrage de 13,7 s, absentes dans un de 10,1 s, pour
    // un comportement identique. Le visiteur les paie dans les deux cas.
    const family = classifyStartupUrl(request.url);
    requested.set(family, (requested.get(family) ?? 0) + 1);
  });
  cdp.on('Network.responseReceived', ({ response }) => {
    if (response.fromServiceWorker) servedByWorker++;
  });
  cdp.on('Network.loadingFinished', ({ requestId, encodedDataLength }) => {
    const url = urls.get(requestId);
    if (url === undefined) return;
    const family = classifyStartupUrl(url);
    const entry = families.get(family) ?? { bytes: 0, requests: 0 };
    entry.bytes += encodedDataLength;
    entry.requests += 1;
    families.set(family, entry);
    perUrl.set(url, (perUrl.get(url) ?? 0) + encodedDataLength);
    served += encodedDataLength;
  });

  const started = Date.now();
  await page.goto(`${ORIGIN}${PATH}`, { waitUntil: 'commit' });
  // Piège 2 : VISIBLE d'abord. Sans cette ligne, `hidden` est satisfait par l'absence.
  await page
    .locator('#loader')
    .waitFor({ state: 'visible', timeout: LOADER_TIMEOUT_MS });
  await page
    .locator('#loader')
    .waitFor({ state: 'hidden', timeout: LOADER_TIMEOUT_MS });
  const loaderHiddenMs = Date.now() - started;
  const atLoader = { served, families: new Map(families) };
  // Fenêtre d'observation PROLONGÉE, facultative et distincte : les conditions du plan s'arrêtent
  // au chargeur masqué, mais un octet demandé juste après est payé par le visiteur tout de même.
  // C'est ainsi que les trois images WMS de NASA GIBS apparaissent ou non selon la vitesse de la
  // machine, et le relevé doit le dire au lieu d'en dépendre.
  if (SETTLE_MS > 0) await page.waitForTimeout(SETTLE_MS);

  // TÉMOIN. `'serviceWorker' in navigator` répond vrai même pour une propriété neutralisée : ce
  // qui compte est qu'AUCUNE réponse n'ait été servie par un worker, et le CDP le dit.
  const serviceWorkerSeen = servedByWorker > 0;

  await context.close();
  return {
    index,
    loaderHiddenMs,
    settleMs: SETTLE_MS,
    servedAtLoader: atLoader.served,
    familiesAtLoader: Object.fromEntries(atLoader.families),
    served,
    serviceWorkerSeen,
    families: Object.fromEntries(families),
    requested: Object.fromEntries(requested),
    perUrl: [...perUrl.entries()].sort((a, b) => b[1] - a[1]),
  };
}

const browser = await chromium.launch();
const runs = [];
try {
  for (let i = 1; i <= RUNS; i++) {
    const run = await measureOnce(browser, i);
    runs.push(run);
    if (run.serviceWorkerSeen)
      console.error(
        `visite ${i} : des réponses ont été servies par un SERVICE WORKER — la mesure décrit ` +
          `une visite de RETOUR, pas une première visite. Relancer sur un profil neuf.`
      );
  }
} finally {
  await browser.close();
  await loader.close();
}

const ORDER = [
  'ephemerides',
  'textures',
  'models',
  'javascript',
  'small-bodies',
  'css',
  'html',
  'other',
];

console.log(`\nOrigine : ${ORIGIN}${PATH}`);
console.log(
  `Conditions : service worker bloqué, contexte neuf, 1280x800, #loader visible puis masqué.\n`
);
for (const run of runs) {
  console.log(
    `— visite ${run.index} : ${run.servedAtLoader.toLocaleString('fr-FR')} octets servis ` +
      `jusqu'au chargeur masqué, à ${(run.loaderHiddenMs / 1000).toFixed(1)} s` +
      (run.settleMs > 0
        ? `, puis ${(run.served - run.servedAtLoader).toLocaleString('fr-FR')} de plus ` +
          `dans les ${run.settleMs / 1000} s suivantes`
        : '')
  );
  for (const family of ORDER) {
    const entry = run.families[family];
    if (!entry) continue;
    const share = ((entry.bytes / run.served) * 100).toFixed(1);
    console.log(
      `    ${family.padEnd(14)} ${String(entry.bytes).padStart(10)} o  ` +
        `${String(entry.requests).padStart(4)} req  ${share.padStart(5)} %`
    );
  }
  const pending = ORDER.filter(
    (family) =>
      (run.requested[family] ?? 0) > (run.families[family]?.requests ?? 0)
  );
  if (pending.length > 0) {
    console.log(
      `    parties mais pas encore arrivées quand le chargeur s'est masqué ` +
        `(le visiteur les paie quand même) :`
    );
    for (const family of pending)
      console.log(
        `    ${family.padEnd(14)} ${run.requested[family]} demandées, ` +
          `${run.families[family]?.requests ?? 0} comptées`
      );
  }
  const unknown = run.families.other;
  if (unknown) {
    console.log(`    détail de « other » (une famille ne doit rien cacher) :`);
    for (const [url, bytes] of run.perUrl) {
      if (classifyStartupUrl(url) !== 'other') continue;
      console.log(`      ${String(bytes).padStart(9)} o  ${url}`);
    }
  }
}

if (JSON_OUT) {
  mkdirSync(dirname(JSON_OUT), { recursive: true });
  writeFileSync(
    JSON_OUT,
    JSON.stringify({ origin: ORIGIN, path: PATH, runs }, null, 2)
  );
  console.log(`\nRelevé écrit dans ${JSON_OUT}`);
}
