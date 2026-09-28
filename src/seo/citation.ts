/**
 * COMMENT CITER GALAXY — un seul propriétaire de la référence, lu et jamais recopié (lot 18).
 *
 * Module PUR, sans E/S : il reçoit le TEXTE de `CITATION.cff` et rend de quoi l'afficher. Ce
 * fichier ne contient donc aucun DOI, aucune version, aucune date.
 *
 * POURQUOI cette forme. Un identifiant pérenne recopié dans quatre endroits finit par différer
 * dans l'un d'eux, et une citation fausse est pire qu'une citation absente : elle est reprise par
 * tous ceux qui citent le projet et ne se corrige plus. `CITATION.cff` est la source unique — c'est
 * déjà le fichier que GitHub et les gestionnaires de références lisent —, le build en extrait ce
 * qu'il faut (comme il extrait déjà `repository-code`), et les pages `/methodology` et `/sources`
 * l'affichent sans le retaper. Le README, lui, est du Markdown que rien ne construit : il porte
 * donc la valeur en clair, et un test la confronte à `CITATION.cff`.
 *
 * Le DOI de CONCEPT est préféré au DOI de version. Zenodo en frappe deux à chaque release : un qui
 * désigne cette version-là, et un qui désigne l'œuvre et pointe toujours vers la plus récente.
 * Citer le second, c'est donner une référence qui ne pourrit pas à la release suivante.
 */

import { escapeHtml } from './bodyLandingPage';
import { docSection, type DocText, type DocLocale } from './documentPage';

/** Ce que `CITATION.cff` déclare, réduit à ce qu'une citation affiche. */
export interface CitationMetadata {
  readonly title: string;
  /** Auteurs, dans l'ordre déclaré, au format « Nom, P. ». */
  readonly authors: readonly string[];
  readonly version: string;
  /** Date de publication, en ISO. */
  readonly released: string;
  /** DOI de concept, sans préfixe : `10.5281/zenodo.1234567`. */
  readonly doi: string;
  readonly repository: string;
  readonly url: string;
}

const field = (cff: string, name: string): string | null => {
  const match = new RegExp(`^${name}:\\s*(.+?)\\s*$`, 'm').exec(cff);
  if (!match) return null;
  // YAML : une valeur scalaire peut être nue, entre apostrophes ou entre guillemets.
  return match[1]!.replace(/^['"]|['"]$/g, '');
};

/**
 * Lit `CITATION.cff` et REFUSE ce qui manque, au lieu de rendre une citation incomplète.
 *
 * Le refus est délibérément bruyant : ce module est appelé pendant le build, et une page qui
 * afficherait « comment citer » sans DOI serait exactement le genre de texte publié faux que ce
 * dépôt corrige depuis le lot 3.
 */
export function parseCitation(cff: string): CitationMetadata {
  const title = field(cff, 'title');
  const version = field(cff, 'version');
  const released = field(cff, 'date-released');
  const doi = field(cff, 'doi');
  const repository = field(cff, 'repository-code');
  const url = field(cff, 'url');

  const missing = Object.entries({
    title,
    version,
    'date-released': released,
    doi,
    'repository-code': repository,
    url,
  })
    .filter(([, value]) => value === null || value === '')
    .map(([name]) => name);
  if (missing.length > 0)
    throw new Error(
      `CITATION.cff : champ(s) manquant(s) pour la citation : ${missing.join(', ')}`
    );
  if (!/^10\.\d{4,9}\/\S+$/.test(doi!))
    throw new Error(
      `CITATION.cff : « ${doi} » n'est pas un DOI (attendu 10.NNNN/suffixe)`
    );
  if (!/^\d{4}-\d{2}-\d{2}$/.test(released!))
    throw new Error(
      `CITATION.cff : date-released « ${released} » n'est pas ISO`
    );

  // Les auteurs sont une liste YAML de `given-names` / `family-names` ; on les lit dans l'ordre
  // déclaré, qui est celui de la citation.
  const authors: string[] = [];
  const authorBlock = /^authors:\s*$([\s\S]*?)^\S/m.exec(`${cff}\n\u0000`);
  const block = authorBlock?.[1] ?? '';
  const given = [...block.matchAll(/^\s*-?\s*given-names:\s*(.+)$/gm)].map(
    (m) => m[1]!.trim()
  );
  const family = [...block.matchAll(/^\s*-?\s*family-names:\s*(.+)$/gm)].map(
    (m) => m[1]!.trim()
  );
  for (let i = 0; i < Math.max(given.length, family.length); i++) {
    const last = family[i];
    const first = given[i];
    if (last && first) authors.push(`${last}, ${first.charAt(0)}.`);
    else if (last) authors.push(last);
    else if (first) authors.push(first);
  }
  if (authors.length === 0)
    throw new Error('CITATION.cff : aucun auteur lisible');

  return {
    title: title!,
    authors,
    version: version!,
    released: released!,
    doi: doi!,
    repository: repository!,
    url: url!,
  };
}

/**
 * La référence en UNE ligne, telle qu'on la copie dans une bibliographie.
 *
 * Format volontairement sobre et sans style bibliographique imposé : auteurs, année, titre,
 * version, éditeur de l'archive, DOI. C'est ce que produisent les convertisseurs de `CITATION.cff`,
 * et c'est ce qu'un lecteur adapte à son propre style sans avoir à chercher une information.
 */
export function citationLine(meta: CitationMetadata): string {
  const year = meta.released.slice(0, 4);
  return `${meta.authors.join(', ')} (${year}). ${meta.title} (version ${meta.version}) [Software]. Zenodo. https://doi.org/${meta.doi}`;
}

/** Le lien résolvable d'un DOI. C'est la seule forme qu'on publie : un DOI nu ne se clique pas. */
export function doiUrl(meta: CitationMetadata): string {
  return `https://doi.org/${meta.doi}`;
}

/**
 * Le bloc « Comment citer », rendu UNE fois pour les deux pages qui l'affichent.
 *
 * Il vit ici et non dans chaque page, pour la raison habituelle de ce dépôt : deux copies d'un même
 * texte divergent, et celle qu'on oublie est celle que le lecteur a sous les yeux.
 */
/** Le titre de la section, dans les quatre langues livrees. */
const HOW_TO_CITE: DocText = {
  en: 'How to cite',
  fr: 'Comment citer',
  es: 'Como citar',
  'pt-BR': 'Como citar',
};

export function citationSection(
  meta: CitationMetadata,
  locale: DocLocale
): string {
  const line = escapeHtml(citationLine(meta));
  const url = doiUrl(meta);
  const intro: DocText = {
    en: `Galaxy is archived on Zenodo and carries a permanent identifier. The DOI below is the <strong>concept DOI</strong>: it always resolves to the most recent version, so a reference written today does not rot at the next release. Version ${escapeHtml(meta.version)} was published on ${escapeHtml(meta.released)}.`,
    fr: `Galaxy est archivé sur Zenodo et porte un identifiant pérenne. Le DOI ci-dessous est le <strong>DOI de concept</strong> : il désigne toujours la version la plus récente, de sorte qu’une référence écrite aujourd’hui ne pourrira pas à la prochaine publication. La version ${escapeHtml(meta.version)} a été publiée le ${escapeHtml(meta.released)}.`,
    es: `Galaxy está archivado en Zenodo y lleva un identificador permanente. El DOI de abajo es el <strong>DOI de concepto</strong>: siempre resuelve hacia la versión más reciente, así que una referencia escrita hoy no se echa a perder en la próxima publicación. La versión ${escapeHtml(meta.version)} se publicó el ${escapeHtml(meta.released)}.`,
    'pt-BR': `A Galaxy está arquivada no Zenodo e carrega um identificador permanente. O DOI abaixo é o <strong>DOI de conceito</strong>: ele sempre resolve para a versão mais recente, então uma referência escrita hoje não se estraga na próxima publicação. A versão ${escapeHtml(meta.version)} foi publicada em ${escapeHtml(meta.released)}.`,
  };
  const machine: DocText = {
    en: `The repository also carries a <a href="${escapeHtml(meta.repository)}/blob/main/CITATION.cff"><code>CITATION.cff</code></a> file, which GitHub and most reference managers read directly. It is the single place this DOI is written: this page reads it rather than repeating it.`,
    fr: `Le dépôt porte aussi un fichier <a href="${escapeHtml(meta.repository)}/blob/main/CITATION.cff"><code>CITATION.cff</code></a>, que GitHub et la plupart des gestionnaires de références lisent directement. C’est le seul endroit où ce DOI est écrit : cette page le lit au lieu de le répéter.`,
    es: `El repositorio lleva además un archivo <a href="${escapeHtml(meta.repository)}/blob/main/CITATION.cff"><code>CITATION.cff</code></a>, que GitHub y la mayoría de los gestores de referencias leen directamente. Es el único lugar donde este DOI está escrito: esta página lo lee en lugar de repetirlo.`,
    'pt-BR': `O repositório carrega também um arquivo <a href="${escapeHtml(meta.repository)}/blob/main/CITATION.cff"><code>CITATION.cff</code></a>, que o GitHub e a maioria dos gerenciadores de referências leem diretamente. É o único lugar onde este DOI está escrito: esta página o lê em vez de repeti-lo.`,
  };
  return docSection(
    'citation',
    // Quatre langues depuis le lot 20 : un ternaire aurait rendu le titre anglais a un lecteur
    // hispanophone, sous un corps de texte espagnol.
    HOW_TO_CITE[locale],
    `<p>${intro[locale]}</p>` +
      `<p><a href="${escapeHtml(url)}"><code>${escapeHtml(meta.doi)}</code></a></p>` +
      `<blockquote><p>${line}</p></blockquote>` +
      `<p>${machine[locale]}</p>`
  );
}
