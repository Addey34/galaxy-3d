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
import { flattenBodies, ringTexturePath } from '@/config/catalog';
import type {
  CelestialBodyConfig,
  CelestialConfig,
  TextureQuality,
} from '@/types';
import { distanceDecimals } from '@/core/units';
import { CARD_HEIGHT, CARD_WIDTH } from './socialCard';

export interface BodyFact {
  label: string;
  value: string;
}

/**
 * De quoi PEINDRE la vignette de partage de ce corps — la matière première que le plugin de
 * build passe à `socialCard.ts`. Décidée ici, dans le module pur, pour la même raison que tout
 * le reste : ce qui décide quelque chose doit être testable sans build.
 */
export interface BodyVisual {
  /**
   * Carte équirectangulaire de la surface, chemin depuis la racine du dépôt, ou `null` pour un
   * corps sans texture locale.
   */
  surface: string | null;
  /** Teinte de repli, en composantes 0-255 — utilisée quand `surface` est `null`. */
  fallback: [number, number, number];
  /** Le corps ÉMET sa lumière (étoile) : pas de terminateur, un assombrissement centre-bord. */
  emissive: boolean;
  /**
   * Anneau à peindre, ou `null`. Les rayons viennent du CATALOGUE (`config.ring`) : la vignette
   * décrit la même représentation que la scène 3D, elle n'en invente pas une seconde.
   */
  ring: BodyRingVisual | null;
}

export interface BodyRingVisual {
  /** Profil radial de l'anneau, chemin depuis la racine du dépôt. */
  texture: string;
  /** Rayon interne, en rayons du corps. */
  innerRadius: number;
  /** Rayon externe, en rayons du corps. */
  outerRadius: number;
}

/**
 * Repli quand le catalogue ne déclare aucune couleur : un gris moyen neutre. Surtout pas du
 * noir — sur un fond spatial la sphère disparaîtrait, et une vignette vide se partage mal.
 */
const NEUTRAL_FALLBACK: [number, number, number] = [154, 154, 154];

/** Du plus petit au plus grand — sert à choisir « la plus petite disponible » sans deviner. */
const RESOLUTION_ORDER: readonly TextureQuality[] = ['1k', '2k', '4k', '8k'];

/**
 * Résolution de texture à charger pour une vignette.
 *
 * Le disque fait 440 px : au centre, un pixel écran couvre environ 0,4° de longitude, ce qu'une
 * carte 2k (0,18°/texel) sature déjà largement. Charger la 8k d'une planète ne changerait rien
 * à l'image et coûterait cinquante décodages inutiles au build. On prend donc la 2k quand elle
 * existe, la 1k sinon (cinq lunes n'ont que celle-là), et à défaut la plus petite disponible —
 * jamais la première du tableau, dont l'ordre est une convention d'affichage, pas un contrat.
 */
export function pickSurfaceResolution(
  available: readonly TextureQuality[] | undefined
): TextureQuality | null {
  if (!available || available.length === 0) return null;
  if (available.includes('2k')) return '2k';
  if (available.includes('1k')) return '1k';
  return (
    [...available].sort(
      (a, b) => RESOLUTION_ORDER.indexOf(a) - RESOLUTION_ORDER.indexOf(b)
    )[0] ?? null
  );
}

/** `0x9b6a45` → `[155, 106, 69]`. */
function rgbFromHex(hex: number): [number, number, number] {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

/** Ce qu'il faut pour dessiner ce corps : sa carte de surface, sa couleur, son éclairage. */
export function bodyVisual(
  config: CelestialBodyConfig,
  bodyName: string
): BodyVisual {
  const resolution = pickSurfaceResolution(config.textureResolutions?.surface);
  const base = config.textures?.surface;
  return {
    surface:
      base && resolution
        ? `public/assets/textures/${base}_${resolution}.jpg`
        : null,
    fallback:
      config.fallbackColor === undefined
        ? NEUTRAL_FALLBACK
        : rgbFromHex(config.fallbackColor),
    emissive: config.kind === 'star',
    ring: bodyRingVisual(config, bodyName),
  };
}

/**
 * L'anneau du corps, s'il en a un.
 *
 * Le chemin de la texture passe par `ringTexturePath`, comme la scène 3D — le nommage a une
 * source unique et personne ne l'écrit à la main. La résolution suit la même règle que la
 * surface : le profil radial d'un anneau est une image large et courte, la 2k y suffit
 * largement pour 540 px de large.
 */
function bodyRingVisual(
  config: CelestialBodyConfig,
  bodyName: string
): BodyRingVisual | null {
  const ring = config.ring;
  if (!ring) return null;
  const resolution = pickSurfaceResolution(ring.textureResolutions);
  if (!resolution) return null;
  const base = ring.textures ?? ringTexturePath(bodyName);
  return {
    texture: `public/assets/textures/${base}_${resolution}.jpg`,
    innerRadius: ring.innerRadius,
    outerRadius: ring.outerRadius,
  };
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
  /**
   * Vignette de partage PROPRE à ce corps. Les cinquante et une pages partageaient jusqu'ici
   * une vieille capture générique de la vue d'ensemble : un lien vers Titan montrait le Soleil.
   * Pour un site qui vit du partage, c'est l'image qui décide du clic.
   *
   * Hors de `/assets/` volontairement : Firebase y applique un cache immuable d'un an, et ces
   * fichiers-ci portent un nom STABLE (`/social/titan.jpg`) que chaque régénération réécrit.
   * Un an de cache sur une URL qui change de contenu, c'est une vignette périmée qu'on ne peut
   * plus corriger.
   */
  image: string;
  imageAlt: string;
  /** De quoi peindre cette vignette au build — voir `socialCard.ts`. */
  visual: BodyVisual;
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

  // Décimales selon l'ordre de grandeur — même règle que la fiche de l'application. Sans elle
  // Bennu, 242 mètres de rayon, annonçait « 0 km » sur sa page ET sur sa vignette de partage.
  // La correction avait été faite dans `ui/bodyInfo.ts` seulement : ce chemin-ci a son propre
  // formateur, et le défaut y a survécu jusqu'à ce qu'on regarde l'image déployée.
  push(
    'radiusKm',
    'Radius',
    data.radiusKm,
    (v) => `${formatNumber(v, distanceDecimals(v))} km`
  );
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
      // Titre COURT, sans nom de site. Mesuré sur les 51 pages générées : le format précédent
      // (« … — live position, size and orbit | Solar System 3D ») faisait 58 à 65 caractères et
      // 43 d'entre eux se faisaient tronquer dans les résultats de recherche. Le nom du corps
      // était déjà en tête, donc la coupe mangeait le nom du site plutôt que le sujet — mais
      // une ellipse en fin de titre reste du bruit. Google ajoute lui-même le nom du site quand
      // il le juge utile ; le budget est mieux dépensé sur ce qui distingue la page.
      title: `${displayName} in 3D — live position and orbit`,
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
      image: `${origin}/social/${slug}.jpg`,
      // Décrit ce que l'image MONTRE, pas ce que la page raconte : c'est un texte alternatif,
      // lu à voix haute par un lecteur d'écran sur une carte de partage.
      imageAlt: `${displayName} rendered as a 3D sphere — Solar System 3D`,
      visual: bodyVisual(cfg, name),
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
  // L'ancre porte son guillemet fermant : sans lui `property="og:image` correspondrait aussi à
  // `og:image:width`, et selon l'ordre des balises la vignette finirait écrite dans la largeur.
  html = replaceAttrAfter(html, 'property="og:image"', 'content', page.image);
  html = replaceAttrAfter(
    html,
    'property="og:image:alt"',
    'content',
    page.imageAlt
  );
  // Réécrites depuis les constantes de `socialCard.ts` plutôt que laissées telles quelles : ces
  // deux nombres sont ce sur quoi un réseau social réserve sa place avant d'avoir téléchargé
  // l'image. Les laisser en dur, c'est accepter qu'un jour on change le format de la carte et
  // que cinquante et une pages annoncent des dimensions fausses sans que rien ne le dise.
  html = replaceAttrAfter(
    html,
    'property="og:image:width"',
    'content',
    String(CARD_WIDTH)
  );
  html = replaceAttrAfter(
    html,
    'property="og:image:height"',
    'content',
    String(CARD_HEIGHT)
  );
  html = replaceAttrAfter(html, 'name="twitter:image"', 'content', page.image);
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
  // Le même contenu, cette fois hors de `<noscript>` : une page rendue par un crawler moderne
  // (qui exécute donc le script) ne verrait sinon qu'un canevas WebGL et aucun mot à indexer.
  //
  // PAS de `aria-hidden` ici, et c'est délibéré. Masqué à l'œil ET aux lecteurs d'écran, ce
  // bloc n'aurait servi qu'aux robots — c'est la forme même du cloaking, et le risque de
  // sanction dépasse de loin le gain. Sans lui, il devient ce qu'il aurait toujours dû être :
  // l'alternative textuelle d'un canevas WebGL, c'est-à-dire la seule description de la scène
  // qu'un utilisateur de lecteur d'écran arrivant sur `/jupiter/` puisse entendre. Utile à
  // quelqu'un, donc légitime pour un moteur.
  html = html.replace(
    '</noscript>',
    `</noscript><section class="sr-only">${block}</section>`
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
