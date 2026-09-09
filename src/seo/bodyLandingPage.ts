/**
 * PAGES D'ATTERRISSAGE PAR CORPS — le seul levier d'audience qui restait.
 *
 * L'application est une URL unique : `?body=jupiter` est un paramètre, pas une route. Un
 * moteur de recherche ne peut donc classer qu'UN sujet pour tout le site, alors que le
 * catalogue en contient une cinquantaine. Ce module transforme chaque corps en une vraie page
 * indexable — titre, description, canonique, contenu textuel propre — qui ouvre la scène
 * directement sur ce corps.
 *
 * Trois contraintes ont dicté la forme, et il vaut mieux les connaître avant de la changer :
 *
 *   1. **Ce sont des FICHIERS statiques, pas des routes.** `dist/jupiter/index.html` est servi
 *      par Firebase avant la réécriture SPA `** → /index.html`. Aucun changement d'hébergement
 *      n'est nécessaire, et une page de corps ne peut pas porter `?body=` dans son URL.
 *   2. **Pas de script en ligne.** La CSP du projet est `script-src 'self'` sans
 *      `unsafe-inline` : impossible d'injecter le corps courant par un `<script>` généré. C'est
 *      le CHEMIN qui porte l'information, lu par `core/permalink.ts::bodyFromPathname`.
 *   3. **Du contenu réel, pas une coquille.** Cinquante pages quasi identiques seraient du
 *      contenu pauvre et dupliqué. Chacune porte donc la description du catalogue et les
 *      données mesurées de ce corps — la même matière que la fiche de l'application.
 *
 * Module PUR : il transforme du HTML et des données en HTML. L'écriture des fichiers vit dans
 * le plugin Vite (`vite.config.ts`), pour que tout ce qui décide quelque chose soit testable
 * sans build.
 */
import { flattenBodies } from '@/config/catalog';
import type { CelestialBodyConfig, CelestialConfig } from '@/types';

export interface BodyFact {
  label: string;
  value: string;
}

export interface BodyPage {
  /** Segment d'URL, en minuscules — `/jupiter`. */
  slug: string;
  displayName: string;
  title: string;
  description: string;
  heading: string;
  summary: string;
  facts: BodyFact[];
  canonical: string;
}

/** Échappement HTML — tout ce qui vient du catalogue traverse ceci. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const NBSP = '\u202f';

/** Séparateur de milliers fin, en dur : la page est statique et servie en anglais. */
function formatNumber(value: number, decimals = 0): string {
  const fixed = value.toFixed(decimals);
  const [whole, fraction] = fixed.split('.');
  const grouped = (whole ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

const SUPERSCRIPTS = '⁰¹²³⁴⁵⁶⁷⁸⁹';

/** Masse en notation scientifique, exposant en vrais chiffres suscrits : `1.90 × 10²⁷ kg`. */
function formatMass(kilograms: number): string {
  const exponent = Math.floor(Math.log10(Math.abs(kilograms)));
  const mantissa = kilograms / 10 ** exponent;
  const digits = [...String(exponent)]
    .map((d) => SUPERSCRIPTS[Number(d)] ?? d)
    .join('');
  return `${mantissa.toFixed(2)} × 10${digits} kg`;
}

/**
 * Faits mesurés de ce corps. Un champ ABSENT est simplement omis — et un champ déclaré
 * inconnu (`realData.unknown`) l'est aussi : une page statique qui aligne des tirets n'apprend
 * rien, alors que la fiche de l'application, elle, affiche la raison publiée.
 */
export function bodyFacts(
  config: CelestialBodyConfig,
  parentDisplayName?: string
): BodyFact[] {
  const data = config.realData;
  const facts: BodyFact[] = [];
  if (!data) return facts;
  const unknown = data.unknown ?? {};
  const push = (
    key: keyof typeof unknown,
    label: string,
    value: number | undefined,
    render: (v: number) => string
  ): void => {
    if (value === undefined || unknown[key] !== undefined) return;
    facts.push({ label, value: render(value) });
  };

  push('radiusKm', 'Radius', data.radiusKm, (v) => `${formatNumber(v)} km`);
  push('massKg', 'Mass', data.massKg, formatMass);
  push(
    'gravity',
    'Surface gravity',
    data.gravity,
    (v) => `${v.toFixed(2)} m/s²`
  );
  push(
    'meanTempC',
    'Mean temperature',
    data.meanTempC,
    (v) => `${formatNumber(v)} °C`
  );
  if (parentDisplayName)
    facts.push({ label: 'Orbits', value: parentDisplayName });
  push(
    'distanceAU',
    'Distance from the Sun',
    data.distanceAU,
    (v) => `${v.toFixed(3)} AU`
  );
  push(
    'orbitPeriodDays',
    'Orbital period',
    data.orbitPeriodDays,
    (v) => `${formatNumber(v, v < 10 ? 2 : 0)} days`
  );
  push('axialTilt', 'Axial tilt', data.axialTilt, (v) => `${v.toFixed(1)}°`);
  push('moonCount', 'Known moons', data.moonCount, (v) => formatNumber(v));
  return facts;
}

/**
 * Coupe une description à la longueur utile d'une meta.
 *
 * Une PHRASE complète d'abord, un mot ensuite : couper au milieu d'une proposition
 * (« … Its Great… ») se lit mal dans un résultat de recherche, et c'est là que ce texte est
 * vu. On ne recule jusqu'à une fin de phrase que si elle garde l'essentiel du budget.
 */
export function trimForMeta(text: string, max = 155): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '));
  if (lastSentence >= max * 0.5) return cut.slice(0, lastSentence + 1);
  // Seuil RELATIF au budget, pas absolu : écrit `> 40`, la règle du mot devenait inerte dès
  // qu'on demandait une coupe courte (le test l'a montré sur un budget de 20).
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace >= max * 0.5 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Une page par corps SÉLECTIONNABLE — exactement l'ensemble que l'application sait ouvrir
 * (`flattenBodies` moins la skybox). Une page menant vers un corps qu'on ne peut pas
 * sélectionner serait une promesse non tenue.
 */
export function bodyLandingPages(
  config: CelestialConfig,
  origin: string
): BodyPage[] {
  const flat = flattenBodies(config);
  const parentOf = new Map<string, string>();
  for (const [name, cfg] of Object.entries(config.bodies))
    for (const satellite of Object.keys(cfg.satellites ?? {}))
      parentOf.set(satellite, name);

  const displayOf = (name: string): string => {
    const cfg = flat.get(name);
    return cfg?.displayName?.en ?? name.charAt(0).toUpperCase() + name.slice(1);
  };

  const pages: BodyPage[] = [];
  for (const [name, cfg] of flat.entries()) {
    if (cfg.kind === 'skybox') continue;
    const slug = name.toLowerCase();
    const displayName = displayOf(name);
    const parent = parentOf.get(name);
    const description = cfg.realData?.description?.en ?? '';
    pages.push({
      slug,
      displayName,
      title: `${displayName} in 3D — live position, size and orbit | Solar System 3D`,
      // La phrase d'appel est ajoutée APRÈS la troncature : sinon c'est elle qui se fait
      // couper en plein milieu dans les résultats de recherche, ce qui est exactement
      // l'endroit où elle doit être lisible.
      description: description
        ? `${trimForMeta(description, 92)} See ${displayName} in 3D, at its real position right now.`
        : `${displayName} in an interactive 3D solar system, at its real position right now, from NASA/JPL ephemeris data.`,
      heading: `${displayName} in 3D — live position and orbit`,
      summary: description,
      facts: bodyFacts(cfg, parent ? displayOf(parent) : undefined),
      // Barre finale VOULUE. La page est `dist/<slug>/index.html` : Firebase sert un index de
      // répertoire et redirige `/jupiter` (301) vers `/jupiter/`. Un canonique sans barre
      // désignerait donc une URL qui redirige — le canonique doit nommer l'adresse finale.
      // Vérifié localement : `vite preview` sert la page sur `/jupiter/` et retombe sur le
      // shell SPA sur `/jupiter`, même distinction.
      canonical: `${origin}/${slug}/`,
    });
  }
  return pages.sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Remplace une portion délimitée, en ÉCHOUANT si le repère n'existe pas.
 *
 * Le mode d'échec à éviter est connu de ce dépôt : un `replace` dont le motif ne correspond
 * plus devient un no-op SILENCIEUX. Ici cela produirait cinquante pages portant toutes le
 * titre de l'accueil — du contenu dupliqué, exactement ce que ces pages existent pour éviter,
 * et rien pour le signaler. Une mise à jour de Vite ou du HTML doit casser le build, pas le
 * référencement.
 */
function replaceBetween(
  html: string,
  start: string,
  end: string,
  replacement: string
): string {
  const from = html.indexOf(start);
  if (from < 0) throw new Error(`repère introuvable dans le HTML : ${start}`);
  const to = html.indexOf(end, from + start.length);
  if (to < 0) throw new Error(`fin introuvable dans le HTML : ${end}`);
  return html.slice(0, from) + start + replacement + html.slice(to);
}

/** Remplace la valeur d'un attribut `content="…"` (ou `href`) du bloc qui suit `anchor`. */
function replaceAttrAfter(
  html: string,
  anchor: string,
  attribute: string,
  value: string
): string {
  const anchorAt = html.indexOf(anchor);
  if (anchorAt < 0) throw new Error(`repère introuvable : ${anchor}`);
  const attrAt = html.indexOf(`${attribute}="`, anchorAt);
  if (attrAt < 0)
    throw new Error(`attribut ${attribute} introuvable après ${anchor}`);
  const valueAt = attrAt + attribute.length + 2;
  const valueEnd = html.indexOf('"', valueAt);
  if (valueEnd < 0) throw new Error(`valeur non terminée pour ${attribute}`);
  return html.slice(0, valueAt) + escapeHtml(value) + html.slice(valueEnd);
}

/** Le contenu textuel indexable de la page, réutilisé par `<noscript>` et le bloc lecteur. */
function contentBlock(page: BodyPage): string {
  const facts = page.facts
    .map(
      (fact) =>
        `<dt>${escapeHtml(fact.label)}</dt><dd>${escapeHtml(fact.value)}</dd>`
    )
    .join('');
  const summary = page.summary ? `<p>${escapeHtml(page.summary)}</p>` : '';
  return (
    summary +
    `<p>${escapeHtml(page.displayName)} is shown at its real position, computed from NASA/JPL ephemeris data. ` +
    `The view opens on ${escapeHtml(page.displayName)}; you can travel in time, switch between the educational ` +
    `overview and the true-scale voyage, and compare it with every other body of the solar system.</p>` +
    (facts ? `<dl>${facts}</dl>` : '')
  );
}

/**
 * Une page de corps à partir du `index.html` CONSTRUIT : mêmes scripts, mêmes styles, mêmes
 * chemins absolus (`/assets/…`), seules les balises de tête et le contenu textuel changent.
 * La page EST donc l'application, ouverte sur ce corps — pas une page intermédiaire qui
 * demanderait un clic de plus.
 */
export function renderBodyPage(
  baseHtml: string,
  page: BodyPage,
  origin = new URL(page.canonical).origin
): string {
  let html = baseHtml;
  html = replaceBetween(html, '<title>', '</title>', escapeHtml(page.title));
  html = replaceAttrAfter(
    html,
    'name="description"',
    'content',
    page.description
  );
  html = replaceAttrAfter(html, 'rel="canonical"', 'href', page.canonical);
  html = replaceAttrAfter(html, 'property="og:title"', 'content', page.title);
  html = replaceAttrAfter(
    html,
    'property="og:description"',
    'content',
    page.description
  );
  html = replaceAttrAfter(html, 'property="og:url"', 'content', page.canonical);
  html = replaceAttrAfter(html, 'name="twitter:title"', 'content', page.title);
  html = replaceAttrAfter(
    html,
    'name="twitter:description"',
    'content',
    page.description
  );

  // Données structurées PROPRES à la page. Sans cela, cinquante et une pages annonceraient la
  // même entité `WebApplication`, mots-clés compris — de la donnée structurée dupliquée, ce que
  // ces pages existent précisément pour éviter. Ici chaque page se décrit elle-même et se
  // rattache à l'application, ce qui est à la fois vrai et distinct.
  html = replaceBetween(
    html,
    '<script type="application/ld+json">',
    '</script>',
    JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: page.title,
      description: page.description,
      url: page.canonical,
      inLanguage: 'en',
      isPartOf: {
        '@type': 'WebApplication',
        name: 'Solar System 3D',
        url: `${origin}/`,
        applicationCategory: 'EducationalApplication',
      },
      about: { '@type': 'Thing', name: page.displayName },
    })
  );

  const block = contentBlock(page);
  html = replaceBetween(
    html,
    '<h1 class="sr-only">',
    '</h1>',
    escapeHtml(page.heading)
  );
  html = replaceBetween(html, '<noscript>', '</noscript>', block);
  // Le même contenu, visible des moteurs qui exécutent le script : sans lui, une page rendue
  // par un crawler moderne ne verrait que le canevas WebGL et aucun mot à indexer.
  html = html.replace(
    '</noscript>',
    `</noscript><section class="sr-only" aria-hidden="true">${block}</section>`
  );
  return html;
}

/** Sitemap complet : accueil, confidentialité, puis un `url` par corps. */
export function renderSitemap(
  pages: BodyPage[],
  origin: string,
  lastmod: string
): string {
  const entry = (loc: string, priority: string, freq: string): string =>
    `  <url>\n    <loc>${escapeHtml(loc)}</loc>\n    <lastmod>${lastmod}</lastmod>\n` +
    `    <changefreq>${freq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
  const urls = [
    entry(`${origin}/`, '1.0', 'monthly'),
    entry(`${origin}/privacy.html`, '0.3', 'yearly'),
    ...pages.map((page) => entry(page.canonical, '0.7', 'monthly')),
  ];
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.join('\n') +
    '\n</urlset>\n'
  );
}
