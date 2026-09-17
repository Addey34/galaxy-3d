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

export type DocLocale = 'en' | 'fr';
export type DocSlug = 'methodology' | 'sources';

export const DOC_LOCALES: readonly DocLocale[] = ['en', 'fr'];
export const DOC_SLUGS: readonly DocSlug[] = ['methodology', 'sources'];

/** Texte en deux langues — même forme que `LocalizedText` du catalogue, sans repli. */
export interface Bilingual {
  en: string;
  fr: string;
}

/** `/methodology/` ou `/fr/methodology/` — l'anglais est la langue par défaut du site. */
export function docPath(slug: DocSlug, locale: DocLocale): string {
  return locale === 'en' ? `/${slug}/` : `/${locale}/${slug}/`;
}

export interface DocPage {
  slug: DocSlug;
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

const NAV: Record<DocSlug, Bilingual> = {
  methodology: { en: 'Methodology', fr: 'Méthodologie' },
  sources: { en: 'Sources & credits', fr: 'Sources et crédits' },
};

const CHROME = {
  back: { en: '← Back to the app', fr: '← Retour à l’app' },
  otherLanguage: { en: 'Français', fr: 'English' },
  updated: { en: 'Data as of', fr: 'Données au' },
  privacy: { en: 'Privacy', fr: 'Confidentialité' },
  footer: {
    en: 'Generated at build time from the repository’s own data files.',
    fr: 'Générée au build à partir des fichiers de données du dépôt.',
  },
};

/** Document HTML complet d'une page documentaire. */
export function renderDocPage(page: DocPage, origin: string): string {
  const { locale, slug } = page;
  const other: DocLocale = locale === 'en' ? 'fr' : 'en';
  const url = (s: DocSlug, l: DocLocale): string => `${origin}${docPath(s, l)}`;
  const nav = DOC_SLUGS.map((s) =>
    s === slug
      ? `<a class="doc-nav-link is-current" aria-current="page" href="${docPath(s, locale)}">${escapeHtml(NAV[s][locale])}</a>`
      : `<a class="doc-nav-link" href="${docPath(s, locale)}">${escapeHtml(NAV[s][locale])}</a>`
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
<html lang="${locale}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(page.title)}</title>
    <meta name="description" content="${escapeHtml(page.description)}" />
    <meta name="robots" content="index, follow" />
    <meta name="theme-color" content="#000000" />
    <link rel="canonical" href="${escapeHtml(page.canonical)}" />
    <link rel="alternate" hreflang="en" href="${escapeHtml(url(slug, 'en'))}" />
    <link rel="alternate" hreflang="fr" href="${escapeHtml(url(slug, 'fr'))}" />
    <link rel="alternate" hreflang="x-default" href="${escapeHtml(url(slug, 'en'))}" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${escapeHtml(page.title)}" />
    <meta property="og:description" content="${escapeHtml(page.description)}" />
    <meta property="og:url" content="${escapeHtml(page.canonical)}" />
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
        <a class="doc-lang" href="${docPath(slug, other)}" hreflang="${other}" lang="${other}">${CHROME.otherLanguage[locale]}</a>
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
  return `<div class="table-scroll"><table><caption>${escapeHtml(caption)}</caption><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

const SUPERSCRIPTS = '⁰¹²³⁴⁵⁶⁷⁸⁹⁻';

/**
 * Nombre lisible dans la langue de la page : séparateur de milliers fin, virgule décimale en
 * français, puissance de dix au-delà de dix millions (`1.7 × 10⁸`).
 */
export function formatQuantity(
  value: number | null,
  locale: DocLocale
): string {
  if (value === null || !Number.isFinite(value)) return 'n/a';
  const decimal = locale === 'fr' ? ',' : '.';
  const group = locale === 'fr' ? ' ' : ',';
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
