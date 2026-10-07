/**
 * PAGES DOCUMENTAIRES — `/methodology` et `/sources`, en anglais et en français.
 *
 * Contrairement aux pages de corps, ce ne sont PAS des copies d'`index.html` : on y vient pour
 * lire, pas pour lancer la scène WebGL. Elles suivent donc le modèle de `public/privacy.html`
 * (document autonome, même habillage, `privacy.css`) plutôt que celui des pages d'atterrissage.
 *
 * Quatre choix, chacun contraint :
 *
 *   1. **Une URL par langue** (`/methodology/`, `/fr/methodology/`), reliées par `hreflang`.
 *      La page de confidentialité met les deux langues dans un seul document et masque l'une
 *      par script : un moteur n'indexe alors correctement qu'une langue. Ici chaque version est
 *      un document complet, et le changement de langue est un simple lien.
 *   2. **Aucun script.** La CSP interdit le script en ligne, et une page de lecture n'en a pas
 *      besoin. Les données structurées `ld+json` ne sont pas exécutées.
 *   3. **Aucun chiffre écrit à la main.** Tout ce qui est mesuré ou déclaré ailleurs (rapport de
 *      validation, manifest des éphémérides, catalogue, crédits) est lu à la source par le
 *      module de chaque page. Le texte, lui, explique ; il n'affirme aucun nombre.
 *   4. **Module PUR.** Les lectures de fichiers vivent dans le plugin Vite (`vite.config.ts`).
 */
import { escapeHtml } from './bodyLandingPage';
import {
  HTML_LANG,
  LOCALES,
  LOCALE_ENDONYM,
  LOCALE_PATH,
  type Locale,
} from '@/i18n/locales';

/**
 * Les pages documentaires parlent les MÊMES langues que l'application (lot 20).
 *
 * `DocLocale` était `'en' | 'fr'` et `Bilingual` portait deux champs : deux types parallèles à
 * ceux de l'application, qui auraient dérivé au premier ajout de langue. Ils sont désormais
 * dérivés de `i18n/locales`, propriétaire unique de la liste des langues et de leurs conventions.
 */
export type DocLocale = Locale;
export type DocSlug = 'methodology' | 'sources';

export const DOC_LOCALES: readonly DocLocale[] = LOCALES;
export const DOC_SLUGS: readonly DocSlug[] = ['methodology', 'sources'];

/**
 * Les pages des missions (2026-10-04) sont aussi des documents : l'index `/missions/` et une page
 * par mission, `/missions/voyager/`. Elles ne sont pas dans `DOC_SLUGS`, qui nomme les deux
 * documents liés depuis l'aide de l'application (`credits.{slug}.href`), mais elles entrent dans
 * la navigation de tous les documents.
 */
export const MISSIONS_SLUG = 'missions';
const NAV_SLUGS: readonly string[] = [...DOC_SLUGS, MISSIONS_SLUG];

/**
 * Texte dans les quatre langues livrées, sans repli : une page documentaire n'a pas le droit
 * d'afficher une phrase anglaise sous un titre espagnol. Le compilateur nomme chaque manque.
 */
export interface DocText {
  en: string;
  fr: string;
  es: string;
  'pt-BR': string;
}

/**
 * `/methodology/`, `/fr/methodology/`, `/pt-br/methodology/` — l'anglais est à la racine.
 *
 * Le segment vient de `LOCALE_PATH`, qui écrit le brésilien en minuscules : une URL en `pt-BR`
 * serait servie mais s'écrirait de deux façons dans les liens et le sitemap.
 */
export function docPath(slug: string, locale: DocLocale): string {
  const segment = LOCALE_PATH[locale];
  return segment === '' ? `/${slug}/` : `/${segment}/${slug}/`;
}

export interface DocPage {
  /** `methodology`, `sources`, `missions` ou `missions/voyager` : le chemin sans la langue. */
  slug: string;
  locale: DocLocale;
  /** URL absolue finale, barre comprise (même règle que les pages de corps). */
  canonical: string;
  title: string;
  description: string;
  /** Corps HTML du `<main>`, déjà échappé par le module de la page. */
  body: string;
  /** Date ISO des données publiées, affichée en tête (`Dernière mise à jour`). */
  updated: string;
}

const NAV: Record<string, DocText> = {
  methodology: {
    en: 'Methodology',
    fr: 'Méthodologie',
    es: 'Metodología',
    'pt-BR': 'Metodologia',
  },
  sources: {
    en: 'Sources & credits',
    fr: 'Sources et crédits',
    es: 'Fuentes y créditos',
    'pt-BR': 'Fontes e créditos',
  },
  missions: {
    en: 'Missions',
    fr: 'Missions',
    es: 'Misiones',
    'pt-BR': 'Missões',
  },
};

const CHROME = {
  back: {
    en: '← Back to the app',
    fr: '← Retour à l’app',
    es: '← Volver a la aplicación',
    'pt-BR': '← Voltar ao aplicativo',
  },
  updated: {
    en: 'Data as of',
    fr: 'Données au',
    es: 'Datos al',
    'pt-BR': 'Dados de',
  },
  privacy: {
    en: 'Privacy',
    fr: 'Confidentialité',
    es: 'Privacidad',
    'pt-BR': 'Privacidade',
  },
  footer: {
    en: 'Generated at build time from the repository’s own data files.',
    fr: 'Générée au build à partir des fichiers de données du dépôt.',
    es: 'Generada en la compilación a partir de los archivos de datos del repositorio.',
    'pt-BR':
      'Gerada na compilação a partir dos arquivos de dados do repositório.',
  },
  /** Nom du sélecteur de langue, pour un lecteur d'écran : les liens, eux, sont des endonymes. */
  languages: {
    en: 'Language',
    fr: 'Langue',
    es: 'Idioma',
    'pt-BR': 'Idioma',
  },
};

/**
 * `og:locale` EXIGE une région (`xx_YY`), alors que `<html lang>` n'en revendique pas pour
 * l'espagnol (cf. `i18n/locales`). L'Espagne est donc écrite ici, faute d'un choix régional, et
 * seulement ici : c'est une métadonnée de partage, pas une déclaration sur le contenu.
 */
const OG_LOCALE: Record<DocLocale, string> = {
  en: 'en_GB',
  fr: 'fr_FR',
  es: 'es_ES',
  'pt-BR': 'pt_BR',
};

/** Image de partage du site, telle que la déclare l'`index.html` construit. */
export interface SocialImage {
  url: string;
  width: string;
  height: string;
  alt: string;
}

/**
 * Lit l'image de partage dans l'`index.html` construit, sans la recopier. Échoue si une balise
 * manque : une page partagée sans image s'afficherait comme un lien nu, sans que rien ne le dise.
 */
export function socialImageFromHtml(html: string): SocialImage {
  const read = (property: string): string => {
    const tag = new RegExp(`<meta[^>]*property="${property}"[^>]*>`).exec(
      html
    )?.[0];
    const value = tag ? /content="([^"]*)"/.exec(tag)?.[1] : undefined;
    if (!value) throw new Error(`index.html : balise ${property} introuvable`);
    return value;
  };
  return {
    url: read('og:image'),
    width: read('og:image:width'),
    height: read('og:image:height'),
    alt: read('og:image:alt'),
  };
}

/** Document HTML complet d'une page documentaire. */
export function renderDocPage(
  page: DocPage,
  origin: string,
  image: SocialImage
): string {
  const { locale, slug } = page;
  const url = (s: string, l: DocLocale): string => `${origin}${docPath(s, l)}`;
  // Une page de mission est DANS la rubrique « Missions » sans être sa page : la rubrique est
  // marquée courante à l'œil, mais `aria-current="page"` reste réservé à la page elle-même.
  const nav = NAV_SLUGS.map((s) =>
    s === slug
      ? `<a class="doc-nav-link is-current" aria-current="page" href="${docPath(s, locale)}">${escapeHtml(NAV[s]![locale])}</a>`
      : slug.startsWith(`${s}/`)
        ? `<a class="doc-nav-link is-current" href="${docPath(s, locale)}">${escapeHtml(NAV[s]![locale])}</a>`
        : `<a class="doc-nav-link" href="${docPath(s, locale)}">${escapeHtml(NAV[s]![locale])}</a>`
  ).join('');
  const structured = {
    '@context': 'https://schema.org',
    '@type': slug === 'methodology' ? 'TechArticle' : 'WebPage',
    name: page.title,
    headline: page.title,
    description: page.description,
    url: page.canonical,
    inLanguage: locale,
    dateModified: page.updated,
    isPartOf: {
      '@type': 'WebApplication',
      name: 'Galaxy',
      url: `${origin}/`,
      applicationCategory: 'EducationalApplication',
    },
  };
  // `<` échappé dans le JSON : une chaîne contenant `</script>` fermerait sinon le bloc.
  const json = JSON.stringify(structured).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="${HTML_LANG[locale]}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(page.title)}</title>
    <meta name="description" content="${escapeHtml(page.description)}" />
    <meta name="robots" content="index, follow" />
    <meta name="theme-color" content="#000000" />
    <link rel="canonical" href="${escapeHtml(page.canonical)}" />
${DOC_LOCALES.map(
  (l) =>
    `<link rel="alternate" hreflang="${l}" href="${escapeHtml(url(slug, l))}" />`
).join('\n    ')}
    <link rel="alternate" hreflang="x-default" href="${escapeHtml(url(slug, 'en'))}" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${escapeHtml(page.title)}" />
    <meta property="og:description" content="${escapeHtml(page.description)}" />
    <meta property="og:url" content="${escapeHtml(page.canonical)}" />
    <meta property="og:site_name" content="Galaxy" />
    <meta property="og:locale" content="${OG_LOCALE[locale]}" />
    <meta property="og:image" content="${escapeHtml(image.url)}" />
    <meta property="og:image:width" content="${escapeHtml(image.width)}" />
    <meta property="og:image:height" content="${escapeHtml(image.height)}" />
    <meta property="og:image:alt" content="${escapeHtml(image.alt)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(page.title)}" />
    <meta name="twitter:description" content="${escapeHtml(page.description)}" />
    <meta name="twitter:image" content="${escapeHtml(image.url)}" />
    <link rel="icon" href="/favicon.ico" type="image/x-icon" />
    <link rel="icon" href="/icon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/privacy.css" />
    <link rel="stylesheet" href="/docs.css" />
    <script type="application/ld+json">${json}</script>
  </head>
  <body class="doc">
    <header class="page-header">
      <a class="brand" href="/">
        <img src="/icon.svg" alt="" width="32" height="32" />
        <span class="app-name">Galaxy</span>
      </a>
      <nav class="doc-nav" aria-label="Documentation">${nav}</nav>
      <div class="topbar-actions">
        <nav class="doc-langs" aria-label="${escapeHtml(CHROME.languages[locale])}">${DOC_LOCALES.filter(
          (l) => l !== locale
        )
          .map(
            (l) =>
              `<a class="doc-lang" href="${docPath(slug, l)}" hreflang="${l}" lang="${HTML_LANG[l]}">${escapeHtml(LOCALE_ENDONYM[l])}</a>`
          )
          .join('')}</nav>
        <a class="back" href="/">${escapeHtml(CHROME.back[locale])}</a>
      </div>
    </header>
    <main>
      <h1>${escapeHtml(page.title)}</h1>
      <p class="updated">${CHROME.updated[locale]} ${escapeHtml(page.updated)}</p>
${page.body}
    </main>
    <footer>
      <p>${escapeHtml(CHROME.footer[locale])} · <a href="/privacy.html">${CHROME.privacy[locale]}</a></p>
    </footer>
  </body>
</html>
`;
}

/** Une section titrée, dans la surface en verre de `privacy.css`. */
export function docSection(id: string, heading: string, inner: string): string {
  return `      <h2 id="${escapeHtml(id)}">${escapeHtml(heading)}</h2>\n      <section>${inner}</section>`;
}

/** Tableau HTML ; les cellules sont du HTML déjà échappé. */
export function docTable(
  caption: string,
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  numericFrom = Number.POSITIVE_INFINITY
): string {
  const head = headers
    .map(
      (h, i) =>
        `<th scope="col"${i >= numericFrom ? ' class="num"' : ''}>${escapeHtml(h)}</th>`
    )
    .join('');
  const body = rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell, i) =>
            i === 0
              ? `<th scope="row">${cell}</th>`
              : `<td${i >= numericFrom ? ' class="num"' : ''}>${cell}</td>`
          )
          .join('')}</tr>`
    )
    .join('');
  // Zone défilante atteignable au clavier (règle axe « scrollable-region-focusable ») : sans
  // tabindex, un tableau plus large que l'écran ne peut pas défiler sans souris.
  return `<div class="table-scroll" tabindex="0" role="region" aria-label="${escapeHtml(caption)}"><table><caption>${escapeHtml(caption)}</caption><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

const SUPERSCRIPTS = '⁰¹²³⁴⁵⁶⁷⁸⁹⁻';

/**
 * Nombre lisible dans la langue de la page : séparateur de milliers fin, virgule décimale en
 * français, puissance de dix au-delà de dix millions (`1.7 × 10⁸`).
 */
/**
 * Un nombre tel qu'il est PUBLIÉ par sa source (un albédo de 0.1203), sans arrondi, avec le
 * séparateur décimal de la langue. Réservé aux valeurs sous mille, qui n'ont pas de groupes.
 */
export function formatExact(value: number, locale: DocLocale): string {
  if (!Number.isFinite(value) || Math.abs(value) >= 1000)
    throw new Error(`formatExact : ${value} hors domaine`);
  return String(value).replace('.', NUMBER_MARKS[locale].decimal);
}

/**
 * La ponctuation des nombres, par langue, decidee UNE fois.
 *
 * L'anglais groupe par virgule et decime par point ; le francais fait l'inverse avec une
 * espace fine insecable. L'espagnol et le portugais du Bresil decimant tous deux par la
 * virgule, ecrire « 1,234.5 » pour eux aurait affiche mille fois la valeur pour un lecteur
 * hispanophone. Le groupement suit l'usage : espace pour l'espagnol (recommandation de la
 * RAE), point au Bresil.
 */
const NUMBER_MARKS: Record<DocLocale, { decimal: string; group: string }> = {
  en: { decimal: '.', group: ',' },
  fr: { decimal: ',', group: ' ' },
  es: { decimal: ',', group: ' ' },
  'pt-BR': { decimal: ',', group: '.' },
};

export function formatQuantity(
  value: number | null,
  locale: DocLocale
): string {
  if (value === null || !Number.isFinite(value)) return 'n/a';
  const { decimal, group } = NUMBER_MARKS[locale];
  const abs = Math.abs(value);
  if (abs >= 1e7) {
    const exponent = Math.floor(Math.log10(abs));
    const mantissa = (value / 10 ** exponent).toFixed(1).replace('.', decimal);
    const digits = [...String(exponent)]
      .map((d) => (d === '-' ? SUPERSCRIPTS[10] : SUPERSCRIPTS[Number(d)]))
      .join('');
    return `${mantissa} × 10${digits}`;
  }
  let text: string;
  if (abs >= 100) text = Math.round(value).toString();
  else if (abs >= 10) text = value.toFixed(1);
  else if (abs >= 0.01 || abs === 0) text = value.toFixed(2);
  else text = value.toPrecision(2);
  const [whole, fraction] = text.split('.');
  const grouped = (whole ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return fraction === undefined ? grouped : `${grouped}${decimal}${fraction}`;
}
