/**
 * `/research/` : la porte « recherche » (lot 63, pas 3).
 *
 * Une page d'entrée, pas une page de données : elle ne porte AUCUN nombre. Elle dit où un lecteur
 * qui veut vérifier, citer ou reproduire trouve ce qu'il cherche, et chaque lien est une page
 * générée par ce même build (`docPath`) ; un test les confronte aux familles de documents. Le
 * lien « ouvrir une vue à une date » est construit par `formatPermalinkDate`, la fonction qui
 * écrit les adresses partagées de l'application, et non recopié.
 *
 * Module PUR : données en entrée, pages en sortie.
 */
import { formatPermalinkDate } from '@/core/permalink';
import type { Locale } from '@/i18n/locales';
import { bodyPagePath, escapeHtml } from './bodyLandingPage';
import {
  ACTIVITIES_SLUG,
  CONTACTS_SLUG,
  FLYBYS_SLUG,
  MISSIONS_SLUG,
  ORBIT_INSERTIONS_SLUG,
  PLACES_SLUG,
  RESEARCH_SLUG,
  docPath,
  docSection,
  type DocPage,
  type DocText,
} from './documentPage';

export interface ResearchPageInputs {
  origin: string;
  /** URL du dépôt (lue dans `CITATION.cff`), sans barre finale. */
  repository: string;
  /** Date ISO des données publiées, la même que `/sources`. */
  updated: string;
}

/** La date de l'exemple : un instant fixe, écrit une fois, dont l'adresse est DÉRIVÉE. */
const EXAMPLE_DATE = new Date(Date.UTC(2016, 5, 21, 12, 0, 0));

/** Une famille d'événements datés : son chemin et sa phrase « Nom : ce qu'elle contient ». */
interface Family {
  slug: string;
  name: DocText;
  what: DocText;
}

const FAMILIES: readonly Family[] = [
  {
    slug: MISSIONS_SLUG,
    name: {
      en: 'Missions',
      fr: 'Missions',
      es: 'Misiones',
      'pt-BR': 'Missões',
    },
    what: {
      en: 'what the Planetary Data System context registry declares about each mission and the bodies it studied.',
      fr: 'ce que le registre de contexte du Planetary Data System déclare de chaque mission et des corps étudiés.',
      es: 'lo que el registro de contexto del Planetary Data System declara de cada misión y de los cuerpos estudiados.',
      'pt-BR':
        'o que o registro de contexto do Planetary Data System declara sobre cada missão e os corpos estudados.',
    },
  },
  {
    slug: FLYBYS_SLUG,
    name: {
      en: 'Flybys',
      fr: 'Survols',
      es: 'Sobrevuelos',
      'pt-BR': 'Sobrevoos',
    },
    what: {
      en: 'the closest approach of a probe to a body, read on its trajectory.',
      fr: 'le point le plus proche d’une sonde et d’un corps, lu sur sa trajectoire.',
      es: 'el punto más cercano de una sonda a un cuerpo, leído en su trayectoria.',
      'pt-BR':
        'o ponto mais próximo de uma sonda a um corpo, lido em sua trajetória.',
    },
  },
  {
    slug: ORBIT_INSERTIONS_SLUG,
    name: {
      en: 'Orbit insertions',
      fr: 'Mises en orbite',
      es: 'Inserciones en órbita',
      'pt-BR': 'Inserções em órbita',
    },
    what: {
      en: 'the first instant a probe becomes bound to a body.',
      fr: 'le premier instant où une sonde devient liée à un corps.',
      es: 'el primer instante en que una sonda queda ligada a un cuerpo.',
      'pt-BR': 'o primeiro instante em que uma sonda fica ligada a um corpo.',
    },
  },
  {
    slug: CONTACTS_SLUG,
    name: {
      en: 'Contacts',
      fr: 'Contacts',
      es: 'Contactos',
      'pt-BR': 'Contatos',
    },
    what: {
      en: 'a probe at rest on a small body, or crossing the 1 bar level of a giant planet.',
      fr: 'une sonde au repos sur un petit corps, ou franchissant le niveau de 1 bar d’une planète géante.',
      es: 'una sonda en reposo sobre un cuerpo pequeño, o cruzando el nivel de 1 bar de un planeta gigante.',
      'pt-BR':
        'uma sonda em repouso sobre um corpo pequeno, ou cruzando o nível de 1 bar de um planeta gigante.',
    },
  },
  {
    slug: PLACES_SLUG,
    name: {
      en: 'Great places',
      fr: 'Grands lieux',
      es: 'Grandes lugares',
      'pt-BR': 'Grandes lugares',
    },
    what: {
      en: 'named surface features, with the orbiter instruments whose footprints cover them.',
      fr: 'des formations nommées de la surface, avec les instruments d’orbiteur dont l’empreinte les couvre.',
      es: 'formaciones con nombre de la superficie, con los instrumentos de orbitador cuya huella las cubre.',
      'pt-BR':
        'formações nomeadas da superfície, com os instrumentos de orbitador cuja pegada as cobre.',
    },
  },
  {
    slug: ACTIVITIES_SLUG,
    name: {
      en: 'Activities',
      fr: 'Activités',
      es: 'Actividades',
      'pt-BR': 'Atividades',
    },
    what: {
      en: 'printable classroom sheets whose every number is computed by the same code as the scene.',
      fr: 'des fiches de classe imprimables dont chaque nombre est calculé par le même code que la scène.',
      es: 'fichas de clase imprimibles cuyos números se calculan con el mismo código que la escena.',
      'pt-BR':
        'fichas de sala de aula imprimíveis cujos números são calculados pelo mesmo código da cena.',
    },
  },
];

const TEXT = {
  title: {
    en: 'For research',
    fr: 'Pour la recherche',
    es: 'Para la investigación',
    'pt-BR': 'Para a pesquisa',
  },
  description: {
    en: 'Where to verify, cite and reproduce what Galaxy shows: measured position errors, the source and read date of every fact, dated mission events, and shareable views.',
    fr: 'Où vérifier, citer et reproduire ce que montre Galaxy : erreurs de position mesurées, source et date de lecture de chaque fait, événements de mission datés, vues partageables.',
    es: 'Dónde verificar, citar y reproducir lo que muestra Galaxy: errores de posición medidos, fuente y fecha de lectura de cada dato, eventos de misión fechados y vistas compartibles.',
    'pt-BR':
      'Onde verificar, citar e reproduzir o que a Galaxy mostra: erros de posição medidos, fonte e data de leitura de cada dado, eventos de missão datados e vistas compartilháveis.',
  },
  intro: {
    en: 'Galaxy draws real positions and says where each one comes from. This page gathers, in one place, what a reader needs to check that, cite it, or open the same view again.',
    fr: 'Galaxy dessine de vraies positions et dit d’où vient chacune. Cette page réunit en un lieu ce dont un lecteur a besoin pour le vérifier, le citer ou rouvrir la même vue.',
    es: 'Galaxy dibuja posiciones reales y dice de dónde viene cada una. Esta página reúne en un solo lugar lo que un lector necesita para comprobarlo, citarlo o volver a abrir la misma vista.',
    'pt-BR':
      'A Galaxy desenha posições reais e diz de onde vem cada uma. Esta página reúne em um só lugar o que um leitor precisa para conferir, citar ou reabrir a mesma vista.',
  },
  verifyHeading: {
    en: 'Verify',
    fr: 'Vérifier',
    es: 'Verificar',
    'pt-BR': 'Verificar',
  },
  methodologyName: {
    en: 'Methodology',
    fr: 'Méthodologie',
    es: 'Metodología',
    'pt-BR': 'Metodologia',
  },
  methodology: {
    en: 'how each position is computed, and the gap MEASURED between the position drawn and the one JPL Horizons serves, body by body.',
    fr: 'comment chaque position est calculée, et l’écart MESURÉ entre la position dessinée et celle que sert JPL Horizons, corps par corps.',
    es: 'cómo se calcula cada posición y la diferencia MEDIDA entre la posición dibujada y la que sirve JPL Horizons, cuerpo por cuerpo.',
    'pt-BR':
      'como cada posição é calculada e a diferença MEDIDA entre a posição desenhada e a que o JPL Horizons serve, corpo por corpo.',
  },
  sourcesName: {
    en: 'Sources and credits',
    fr: 'Sources et crédits',
    es: 'Fuentes y créditos',
    'pt-BR': 'Fontes e créditos',
  },
  sources: {
    en: 'the source and the read date of every displayed fact, the licence of every texture, and the third-party software.',
    fr: 'la source et la date de lecture de chaque fait affiché, la licence de chaque texture et les logiciels tiers.',
    es: 'la fuente y la fecha de lectura de cada dato mostrado, la licencia de cada textura y el software de terceros.',
    'pt-BR':
      'a fonte e a data de leitura de cada dado exibido, a licença de cada textura e os softwares de terceiros.',
  },
  citeHeading: {
    en: 'Cite',
    fr: 'Citer',
    es: 'Citar',
    'pt-BR': 'Citar',
  },
  cite: {
    en: 'The permanent identifier and a ready-made reference are in the citation section of the methodology page.',
    fr: 'L’identifiant permanent et une référence toute prête sont dans la section de citation de la page de méthodologie.',
    es: 'El identificador permanente y una referencia lista para usar están en la sección de citación de la página de metodología.',
    'pt-BR':
      'O identificador permanente e uma referência pronta estão na seção de citação da página de metodologia.',
  },
  eventsHeading: {
    en: 'Dated events',
    fr: 'Événements datés',
    es: 'Eventos fechados',
    'pt-BR': 'Eventos datados',
  },
  eventsIntro: {
    en: 'Each family below is generated at build time from published data, and every page names its source.',
    fr: 'Chaque famille ci-dessous est générée au build à partir de données publiées, et chaque page nomme sa source.',
    es: 'Cada familia siguiente se genera en la compilación a partir de datos publicados, y cada página nombra su fuente.',
    'pt-BR':
      'Cada família abaixo é gerada na compilação a partir de dados publicados, e cada página nomeia sua fonte.',
  },
  reproduceHeading: {
    en: 'Reproduce a view',
    fr: 'Reproduire une vue',
    es: 'Reproducir una vista',
    'pt-BR': 'Reproduzir uma vista',
  },
  reproduce: {
    en: 'A view is an address. The body is in the path, and the query holds the date (UTC), the mode (educ or explo, the second keeping true scale) and, when shared from the Share button, the exact camera angles. For example, the Earth at that instant:',
    fr: 'Une vue est une adresse. Le corps est dans le chemin, et la requête porte la date (UTC), le mode (educ ou explo, ce dernier gardant l’échelle vraie) et, quand elle vient du bouton Partager, les angles exacts de la caméra. Par exemple, la Terre à cet instant :',
    es: 'Una vista es una dirección. El cuerpo va en la ruta, y la consulta lleva la fecha (UTC), el modo (educ o explo, este último con escala real) y, cuando viene del botón Compartir, los ángulos exactos de la cámara. Por ejemplo, la Tierra en ese instante:',
    'pt-BR':
      'Uma vista é um endereço. O corpo está no caminho, e a consulta traz a data (UTC), o modo (educ ou explo, este mantendo a escala real) e, quando vem do botão Compartilhar, os ângulos exatos da câmera. Por exemplo, a Terra nesse instante:',
  },
  codeHeading: {
    en: 'Read the code',
    fr: 'Lire le code',
    es: 'Leer el código',
    'pt-BR': 'Ler o código',
  },
  code: {
    en: 'The repository is public, and the technical contracts (how a position is chosen, how a dated product is classified) are written in its architecture document:',
    fr: 'Le dépôt est public, et les contrats techniques (comment une position est choisie, comment un produit daté est classé) sont écrits dans son document d’architecture :',
    es: 'El repositorio es público, y los contratos técnicos (cómo se elige una posición, cómo se clasifica un producto fechado) están escritos en su documento de arquitectura:',
    'pt-BR':
      'O repositório é público, e os contratos técnicos (como uma posição é escolhida, como um produto datado é classificado) estão escritos em seu documento de arquitetura:',
  },
} satisfies Record<string, DocText>;

/** L'adresse de la page de la Terre à `EXAMPLE_DATE`, dans une langue. */
export function researchExampleHref(locale: Locale): string {
  return `/${bodyPagePath('earth', locale)}/?date=${formatPermalinkDate(EXAMPLE_DATE)}`;
}

/** Les pages générées vers lesquelles celle-ci renvoie, pour le test de liens. */
export const RESEARCH_LINKED_SLUGS: readonly string[] = [
  'methodology',
  'sources',
  ...FAMILIES.map((f) => f.slug),
];

export function researchPage(
  inputs: ResearchPageInputs,
  locale: Locale
): DocPage {
  const link = (slug: string, label: string, fragment = ''): string =>
    `<a href="${docPath(slug, locale)}${fragment}">${escapeHtml(label)}</a>`;
  const example = researchExampleHref(locale);
  const architecture = `${inputs.repository}/blob/main/docs/ARCHITECTURE.md`;
  const families = FAMILIES.map(
    (f) =>
      `<li>${link(f.slug, f.name[locale])}: ${escapeHtml(f.what[locale])}</li>`
  ).join('');
  return {
    slug: RESEARCH_SLUG,
    locale,
    canonical: `${inputs.origin}${docPath(RESEARCH_SLUG, locale)}`,
    title: TEXT.title[locale],
    description: TEXT.description[locale],
    updated: inputs.updated,
    body: [
      `      <p>${escapeHtml(TEXT.intro[locale])}</p>`,
      docSection(
        'verify',
        TEXT.verifyHeading[locale],
        `<ul><li>${link('methodology', TEXT.methodologyName[locale])}: ${escapeHtml(TEXT.methodology[locale])}</li><li>${link('sources', TEXT.sourcesName[locale])}: ${escapeHtml(TEXT.sources[locale])}</li></ul>`
      ),
      docSection(
        'cite',
        TEXT.citeHeading[locale],
        `<p>${escapeHtml(TEXT.cite[locale])} ${link('methodology', TEXT.methodologyName[locale], '#citation')}.</p>`
      ),
      docSection(
        'events',
        TEXT.eventsHeading[locale],
        `<p>${escapeHtml(TEXT.eventsIntro[locale])}</p><ul>${families}</ul>`
      ),
      docSection(
        'reproduce',
        TEXT.reproduceHeading[locale],
        `<p>${escapeHtml(TEXT.reproduce[locale])}</p><p><a href="${escapeHtml(example)}"><code>${escapeHtml(inputs.origin + example)}</code></a></p>`
      ),
      docSection(
        'code',
        TEXT.codeHeading[locale],
        `<p>${escapeHtml(TEXT.code[locale])}</p><p><a href="${escapeHtml(architecture)}"><code>docs/ARCHITECTURE.md</code></a></p>`
      ),
    ].join('\n'),
  };
}
