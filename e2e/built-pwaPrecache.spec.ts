import { expect, test } from '@playwright/test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { NAVIGATE_FALLBACK_DENYLIST } from '../src/seo/pwaRouting';

/**
 * GAL-PERF-PWA-001 : la garde exhaustive sur les VRAIS artefacts du build, sans navigateur.
 *
 * Le service worker précachait 3 420 pages de formations (`/places/<corps>/<nom>/`, 28 Mo bruts) et
 * les activités, parce que `pwaRouting.ts` ne nommait que des familles de un ou deux niveaux et que son
 * test ne connaissait que les pages qu'on lui avait listées. Ici, la vérité est `dist/` :
 *   - tous les `*.html` écrits, parcourus récursivement ;
 *   - le manifeste de précache lu dans `dist/sw.js`, tel que Workbox l'a produit ;
 *   - la liste de refus du repli SPA lue dans le même `dist/sw.js`, tel que le navigateur l'exécute.
 * Une famille de pages nouvelle, à n'importe quelle profondeur, fait donc échouer ceci au lieu de
 * passer inaperçue. Tourne dans `test:pages` (le job `verify` construit déjà).
 */
const DIST = join(import.meta.dirname, '..', 'dist');
const LANGS = ['', 'fr/', 'es/', 'pt-br/'] as const;

function htmlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...htmlFiles(full));
    else if (name.endsWith('.html'))
      out.push(relative(DIST, full).split(sep).join('/'));
  }
  return out;
}

const sw = existsSync(join(DIST, 'sw.js'))
  ? readFileSync(join(DIST, 'sw.js'), 'utf8')
  : '';
const precached = [...sw.matchAll(/\{url:"([^"]+)",revision:/g)].map(
  (m) => m[1]!
);
// Les motifs du repli SPA tels que le service worker les exécute (littéraux de regex dans `sw.js`).
const builtDenylist: RegExp[] = (() => {
  const start = sw.indexOf('denylist:[');
  if (start < 0) return [];
  let i = start + 'denylist:['.length;
  const items: RegExp[] = [];
  while (sw[i] !== ']') {
    if (sw[i] === ',') i++;
    // Un littéral `/…/` : on lit jusqu'au `/` non échappé et hors classe de caractères `[...]`.
    let j = i + 1;
    let inClass = false;
    while (inClass || sw[j] !== '/') {
      if (sw[j] === '\\') j++;
      else if (sw[j] === '[') inClass = true;
      else if (sw[j] === ']') inClass = false;
      j++;
    }
    items.push(new RegExp(sw.slice(i + 1, j)));
    i = j + 1;
  }
  return items;
})();
const pages = existsSync(DIST) ? htmlFiles(DIST) : [];
const routeOf = (file: string): string =>
  `/${file.replace(/index\.html$/, '')}`;
const generated = pages.filter((f) => f.includes('/'));
const denied = (path: string): boolean =>
  builtDenylist.some((rule) => rule.test(path));

test('le build est là, avec un manifeste et une liste de refus lisibles', () => {
  expect(
    existsSync(join(DIST, 'sw.js')),
    'dist/sw.js (lancer pnpm build)'
  ).toBe(true);
  expect(precached.length).toBeGreaterThan(20);
  expect(builtDenylist.length).toBeGreaterThan(10);
  // La liste lue dans le build est celle du module source : aucune des deux ne dérive.
  expect(builtDenylist.map((r) => r.source)).toEqual(
    NAVIGATE_FALLBACK_DENYLIST.map((r) => r.source)
  );
});

test('le parcours du build voit toutes les familles, dans les quatre langues', () => {
  // Borne : un parcours vide rendrait tout le reste vert sans rien vérifier.
  expect(generated.length).toBeGreaterThan(1000);
  for (const lang of LANGS)
    for (const family of [
      'places/',
      'activities/',
      'missions/',
      'eclipse/',
      'flybys/',
    ])
      expect(
        generated.some((f) => f.startsWith(`${lang}${family}`)),
        `aucune page ${lang}${family}`
      ).toBe(true);
  // Les formations ont bien trois niveaux sous le segment : `places/<corps>/<nom>/index.html`.
  expect(
    generated.some((f) => /^places\/[^/]+\/[^/]+\/index\.html$/.test(f))
  ).toBe(true);
});

test('aucune page générée n’est précachée : seuls index.html et privacy.html le sont', () => {
  const html = precached.filter((u) => u.endsWith('.html')).sort();
  expect(html).toEqual(['index.html', 'privacy.html']);
  const leaked = precached.filter((u) => generated.includes(u));
  expect(leaked, `${leaked.length} pages précachées`).toEqual([]);
});

test('toute page générée est refusée au repli SPA, avec et sans slash final', () => {
  // Les pages de corps, d'éclipse et de mission portent des permaliens interactifs : seules les adresses
  // SANS paramètres sont attendues ici. Les paramètres sont l'objet du test suivant.
  const open = generated.filter(
    (f) => !denied(routeOf(f)) || !denied(routeOf(f).replace(/\/$/, ''))
  );
  expect(open, `${open.length} routes recevraient l'app shell`).toEqual([]);
});

test('les pages de formations et d’activités tolèrent paramètres, slash final et index.html', () => {
  const documentOnly = generated.filter((f) =>
    /^(?:(?:fr|es|pt-br)\/)?(?:places|activities)\/[^/]+(?:\/[^/]+)?\/index\.html$/.test(
      f
    )
  );
  expect(documentOnly.length).toBeGreaterThan(3000);
  const open: string[] = [];
  for (const file of documentOnly) {
    const route = routeOf(file);
    for (const variant of [
      route,
      route.replace(/\/$/, ''),
      `${route}index.html`,
      `${route}?utm_source=x`,
      `${route.replace(/\/$/, '')}?foo=1&bar=2`,
    ])
      if (!denied(variant)) open.push(variant);
  }
  expect(
    open.slice(0, 5),
    `${open.length} variantes recevraient l'app shell`
  ).toEqual([]);
});

test('les permaliens interactifs d’un corps avec paramètres retombent toujours sur l’app shell', () => {
  // Workbox teste `pathname + search` : sans cette règle, `/mars/?mode=explo` partirait au réseau et
  // ne s'ouvrirait plus hors ligne. Cette PR n'y touche pas.
  for (const path of [
    '/mars/?mode=explo&date=2026-11-20T18%3A00%3A00Z',
    '/vesta/?place=albana',
    '/eclipse/2026-08-12/?mode=educ',
  ])
    expect(denied(path), path).toBe(false);
});

test('le morceau différé du panneau des événements est précaché (ouverture hors ligne)', () => {
  // GAL-PERF-001B-01 : sorti du démarrage, le panneau doit rester disponible hors ligne ; Workbox
  // précache tout `assets/*.js`, et ce test le prouve sur le manifeste réel plutôt que de le supposer.
  const chunks = readdirSync(join(DIST, 'assets')).filter((f) =>
    /^astronomicalEvents-.*\.js$/.test(f)
  );
  expect(chunks, 'un seul morceau du panneau dans le build').toHaveLength(1);
  expect(precached).toContain(`assets/${chunks[0]}`);
});
