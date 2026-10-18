/* global console, process, document, window, URL, fetch */
/**
 * LE GUETTEUR DE LA PRODUCTION (lot 56) : ce que sert `galaxy.adrianguichard.dev`, lu et non
 * supposé. Il complète le guetteur des SOURCES (`check-source-health.mjs`), qui regarde ce dont le
 * dépôt dépend, et celui de la CI (`check-ci-health.mjs`), qui regarde ce que le dépôt construit :
 * personne ne regardait ce que les visiteurs RECOIVENT.
 *
 * QUATRE familles de contrôles, chacune jugée sur ce qui la distingue d'une panne et jamais sur un
 * code HTTP, puisque Firebase réécrit tout chemin inconnu vers la coquille en HTTP 200 :
 *
 *   1. LE TÉMOIN : un chemin qui n'a jamais existé doit rendre la coquille (`canonical` vers la
 *      racine). C'est elle que toute page générée doit NE PAS être.
 *   2. LES PAGES : la première et la dernière adresse de chaque famille du `sitemap.xml` SERVI
 *      (langue + premier segment) doivent rendre du HTML qui n'est pas la coquille, et dont le
 *      `canonical` nomme leur propre chemin. La liste se DÉRIVE du sitemap : une famille nouvelle
 *      est couverte sans que personne y pense, et un déploiement partiel se voit à la dernière.
 *   3. LES EN-TÊTES : ceux que `firebase.json` déclare pour `**`, et la règle de cache d'un actif
 *      au nom stable, comparés VALEUR pour valeur à ce que le service rend.
 *   4. LE DÉMARRAGE, dans un vrai navigateur : une adresse localisée de grand lieu
 *      (`/fr/moon/?place=Mare%20Imbrium`) s'ouvre sur son corps, tournée vers la formation, garde
 *      sa langue et perd `place` ; et aucune erreur de console ni d'exécution au démarrage.
 *
 * Codes de sortie : 0 sain ; 1 un contrôle a échoué ; 2 un contrôle n'a pas pu être MESURÉ
 * (réseau, navigateur), ce qui n'est pas « tout va bien ».
 *
 * Usage :
 *   node scripts/check-production.mjs                 (production)
 *   node scripts/check-production.mjs --origin http://127.0.0.1:4173 --no-browser
 *   node scripts/check-production.mjs --markdown      (corps d'issue)
 *   node scripts/check-production.mjs --place "Mare Inexistentium"   (falsifie le démarrage)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');

/** Le grand lieu que le guetteur ouvre par son adresse localisée (lot 55, `?place=`). */
export const PLACE_NAME = 'Mare Imbrium';
const placeAddress = (name) => `/fr/moon/?place=${encodeURIComponent(name)}`;

/** Le `canonical` d'un document HTML, ou `null`. */
export function canonicalOf(html) {
  const match = /<link\s+rel="canonical"\s+href="([^"]+)"/i.exec(html);
  return match ? match[1] : null;
}

/** Le chemin d'une URL absolue, sans l'hôte. */
function pathOf(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * Les familles du sitemap : langue éventuelle + premier segment, une page à un seul segment
 * formant la famille `page`. Rend, par famille, sa première et sa dernière adresse (chemins).
 */
export function sitemapSamples(xml) {
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) =>
    pathOf(m[1])
  );
  const families = new Map();
  for (const path of locs) {
    if (path === '/') continue; // la racine EST la coquille
    const parts = path.split('/').filter(Boolean);
    const locale = /^(fr|es|pt-br|pt-BR|en)$/.test(parts[0] ?? '')
      ? parts.shift()
      : '';
    const family = `${locale ? `${locale}/` : ''}${parts.length > 1 ? parts[0] : 'page'}`;
    const list = families.get(family) ?? [];
    list.push(path);
    families.set(family, list);
  }
  const out = [];
  for (const [family, list] of families) {
    out.push({ family, path: list[0] });
    if (list.length > 1) out.push({ family, path: list[list.length - 1] });
  }
  return { count: locs.length, samples: out };
}

/** Juge une page générée contre la coquille du témoin. */
export function judgePage(path, response, shell) {
  const type = response.contentType ?? '';
  if (response.status !== 200)
    return { ok: false, detail: `HTTP ${response.status}` };
  if (!type.includes('text/html'))
    return { ok: false, detail: `content-type ${type}` };
  if (response.body === shell.body)
    return { ok: false, detail: 'rend la coquille (identique au témoin)' };
  const canonical = canonicalOf(response.body);
  // Une page HTML statique sans `canonical` (privacy.html) n'est jugée que sur sa différence
  // avec la coquille ; une page générée doit nommer SON chemin.
  if (canonical !== null && pathOf(canonical) !== path)
    return { ok: false, detail: `canonical ${canonical}` };
  return {
    ok: true,
    detail: canonical
      ? `canonical ${pathOf(canonical)}`
      : 'HTML distinct de la coquille',
  };
}

/** Juge le témoin : la coquille, `canonical` vers la racine. */
export function judgeShell(response) {
  const type = response.contentType ?? '';
  const canonical = canonicalOf(response.body ?? '');
  if (response.status !== 200 || !type.includes('text/html'))
    return { ok: false, detail: `HTTP ${response.status}, ${type}` };
  if (canonical === null || pathOf(canonical) !== '/')
    return { ok: false, detail: `canonical ${canonical}` };
  return { ok: true, detail: `coquille, ${response.body.length} o` };
}

/**
 * Les en-têtes attendus, LUS dans `firebase.json` : ceux de la règle `**` sur toute réponse, et
 * ceux d'une règle de chemin exacte sur ce chemin.
 */
export function expectedHeaders(firebase, path) {
  const hosting = Array.isArray(firebase.hosting)
    ? firebase.hosting[0]
    : firebase.hosting;
  const out = {};
  for (const rule of hosting.headers ?? [])
    if (rule.source === '**' || rule.source === path)
      for (const { key, value } of rule.headers) out[key.toLowerCase()] = value;
  return out;
}

/** Compare des en-têtes servis à ceux attendus, valeur pour valeur. */
export function judgeHeaders(expected, served) {
  const wrong = [];
  for (const [key, value] of Object.entries(expected)) {
    const got = served[key];
    if (got === undefined) wrong.push(`${key} absent`);
    else if (got.trim() !== String(value).trim()) wrong.push(`${key} diffère`);
  }
  return wrong.length === 0
    ? { ok: true, detail: `${Object.keys(expected).length} en-têtes conformes` }
    : { ok: false, detail: wrong.join(', ') };
}

/**
 * Toute erreur de console ou d'exécution compte, sans liste d'exceptions : en production le
 * démarrage n'en émet aucune (mesuré le 2026-10-18). Hors de son origine, la balise Cloudflare
 * échoue en CORS, et c'est ce contrôle qui le dit : il mord.
 */
export function judgeConsole(errors) {
  return errors.length === 0
    ? { ok: true, detail: 'aucune erreur de console ni d’exécution' }
    : { ok: false, detail: errors.slice(0, 5).join(' | ') };
}

async function get(origin, path) {
  const response = await fetch(`${origin}${path}`, { redirect: 'follow' });
  const headers = {};
  response.headers.forEach((value, key) => (headers[key] = value));
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    headers,
    body: await response.text(),
  };
}

async function browserChecks(origin, placeName) {
  const address = placeAddress(placeName);
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    await context.addInitScript(() => {
      window.localStorage.setItem('ssv-guided-tour-v1', '1');
      window.localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    });
    const page = await context.newPage();
    const errors = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console : ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`exécution : ${e.message}`));
    await page.goto(`${origin}${address}`, { timeout: 120_000 });
    await page
      .locator('#loader')
      .waitFor({ state: 'hidden', timeout: 180_000 });
    const canvas = page.locator('canvas').first();
    let focus = null;
    try {
      await page.waitForFunction(
        (name) =>
          (
            document.querySelector('canvas')?.dataset.searchFocus ?? ''
          ).startsWith(`${name}|`),
        placeName,
        { timeout: 90_000 }
      );
      focus = await canvas.getAttribute('data-search-focus');
    } catch {
      focus = await canvas.getAttribute('data-search-focus');
    }
    await page.waitForTimeout(5000);
    const url = page.url();
    const lang = await page.evaluate(() => document.documentElement.lang);
    const placeOk =
      (focus ?? '').startsWith(`${placeName}|`) &&
      new URL(url).pathname === '/fr/moon/' &&
      !new URL(url).searchParams.has('place') &&
      lang.startsWith('fr');
    return [
      {
        group: 'démarrage',
        name: address,
        ok: placeOk,
        detail: `visée ${focus ?? 'aucune'}, adresse ${new URL(url).pathname}${new URL(url).search}, langue ${lang}`,
      },
      { group: 'démarrage', name: 'console', ...judgeConsole(errors) },
    ];
  } finally {
    await browser.close();
  }
}

export async function run({ origin, browser = true, placeName = PLACE_NAME }) {
  const results = [];
  const unmeasured = [];
  const firebase = JSON.parse(
    readFileSync(resolve(ROOT, 'firebase.json'), 'utf8')
  );

  let shell;
  try {
    shell = await get(origin, `/__galaxy-never-existed-${Date.now()}/`);
    results.push({
      group: 'témoin',
      name: 'chemin jamais existé',
      ...judgeShell(shell),
    });
  } catch (error) {
    unmeasured.push(`témoin : ${error.message}`);
    return { results, unmeasured };
  }

  try {
    const sitemap = await get(origin, '/sitemap.xml');
    const { count, samples } = sitemapSamples(sitemap.body);
    if (count === 0)
      results.push({
        group: 'pages',
        name: 'sitemap.xml',
        ok: false,
        detail: 'aucune adresse',
      });
    for (const { family, path } of samples) {
      try {
        results.push({
          group: 'pages',
          name: `${family} ${path}`,
          ...judgePage(path, await get(origin, path), shell),
        });
      } catch (error) {
        unmeasured.push(`${path} : ${error.message}`);
      }
    }
  } catch (error) {
    unmeasured.push(`sitemap : ${error.message}`);
  }

  // Les en-têtes de `**` sur la racine, puis la règle d'un actif au nom stable.
  for (const path of ['/', '/assets/ephemerides/manifest.json']) {
    try {
      const response = await get(origin, path);
      results.push({
        group: 'en-têtes',
        name: path,
        ...judgeHeaders(expectedHeaders(firebase, path), response.headers),
      });
    } catch (error) {
      unmeasured.push(`${path} : ${error.message}`);
    }
  }

  if (browser)
    try {
      results.push(...(await browserChecks(origin, placeName)));
    } catch (error) {
      unmeasured.push(`navigateur : ${error.message}`);
    }
  return { results, unmeasured };
}

function report({ results, unmeasured }, origin, markdown) {
  const failed = results.filter((r) => !r.ok);
  const lines = [];
  if (markdown) {
    lines.push(
      `## Production ${failed.length || unmeasured.length ? 'NON SAINE' : 'saine'} (${origin})`,
      ''
    );
    lines.push('| | Contrôle | Détail |', '|---|---|---|');
    for (const r of results)
      lines.push(
        `| ${r.ok ? 'ok' : '**ÉCHEC**'} | ${r.group} : \`${r.name}\` | ${r.detail.replaceAll('|', '/')} |`
      );
    for (const u of unmeasured)
      lines.push(`| **non mesuré** | ${u.replaceAll('|', '/')} | |`);
  } else {
    for (const r of results)
      lines.push(
        `${r.ok ? '  ok   ' : 'ÉCHEC  '} ${r.group} : ${r.name} — ${r.detail}`
      );
    for (const u of unmeasured) lines.push(`NON MESURÉ ${u}`);
    lines.push(
      `${results.length - failed.length}/${results.length} contrôles sains, ${unmeasured.length} non mesurés (${origin})`
    );
  }
  console.log(lines.join('\n'));
  return failed.length ? 1 : unmeasured.length ? 2 : 0;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--origin');
  const origin = (
    at >= 0 ? args[at + 1] : 'https://galaxy.adrianguichard.dev'
  ).replace(/\/$/, '');
  // `--place` sert à FALSIFIER le contrôle du démarrage : une formation que le corps n'a pas.
  const placeAt = args.indexOf('--place');
  const outcome = await run({
    origin,
    browser: !args.includes('--no-browser'),
    placeName: placeAt >= 0 ? args[placeAt + 1] : PLACE_NAME,
  });
  process.exit(report(outcome, origin, args.includes('--markdown')));
}
