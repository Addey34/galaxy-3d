/**
 * PAGES DES MISSIONS (2026-10-04) : l'index `/missions/` et une page par mission que le registre
 * de contexte du Planetary Data System déclare, dans les quatre langues.
 *
 * Le lot 40 a donné à chaque FICHE la liste des missions qui prennent son corps pour cible, et
 * le lot 42 à chaque sonde les investigations où elle figure. Le graphe existait donc, mais dans
 * un seul sens, et seulement dans l'application : aucune adresse ne répondait à « qu'est-ce que
 * Cassini-Huygens, et qu'a-t-elle visé ». Ces pages en sont l'autre sens.
 *
 * CE SONT DES DOCUMENTS, pas des copies de l'application (`documentPage.ts`, comme
 * `/methodology`) : on y vient pour lire, et une mission n'a pas de position que la scène
 * pourrait ouvrir. Elles ne coûtent donc aucun octet au démarrage et aucune règle de permalien.
 * La scène est à un lien : chaque cible du catalogue renvoie à la page de son corps, chaque sonde
 * suivie à la sienne, et ces pages-là SONT l'application.
 *
 * CE QUE LA PAGE AFFIRME, et rien de plus, parce que c'est tout ce que la source déclare :
 *   - les dates sont celles de l'ARCHIVE, et son « début » est celui du PROJET, pas un lancement
 *     (Voyager y commence en 1972, cinq ans avant le décollage ; mesuré au lot 40). Une fin non
 *     déclarée ne veut pas dire « en cours » : Venus Express n'en déclare pas et s'est terminée
 *     en 2014 ;
 *   - une cible déclarée n'est pas un relevé d'observation ;
 *   - la description est CITÉE, en anglais, telle que l'archive la publie : la traduire serait
 *     écrire à sa place. Le texte de la page autour d'elle est, lui, dans la langue de la page.
 *
 * Module PUR : le catalogue (`missionCatalogue.json`, écrit par `pnpm missions:generate`) et les
 * archives des sondes sont lus par le greffon de build et passés en argument.
 */
import type { CelestialBodyConfig, CelestialConfig } from '@/types';
import { flattenBodies } from '@/config/catalog';
import { INTL_LOCALE, type Locale } from '@/i18n/locales';
import { bodyPagePath, escapeHtml, trimForMeta } from './bodyLandingPage';
import {
  docPath,
  docSection,
  docTable,
  MISSIONS_SLUG,
  type DocPage,
  type DocText,
} from './documentPage';
import { longDay } from './instrumentLandingPage';

/** Une cible telle que l'archive la déclare ; `body` est le corps du catalogue qu'elle désigne. */
export interface MissionTarget {
  lid: string;
  name: string | null;
  type: string | null;
  body: string | null;
}

export interface CatalogueMission {
  /** Segment terminal de l'identifiant PDS, `_` réécrit `-` : `cassini-huygens`. */
  slug: string;
  name: string;
  lid: string;
  /** `null` quand l'archive écrit sa sentinelle `1000-01-01` (DART, la seule au 2026-10-04). */
  start: string | null;
  end: string | null;
  description: string;
  targets: MissionTarget[];
}

export interface MissionCatalogue {
  /** Date de lecture des missions (noms, dates, cibles) : celle que la fiche affiche déjà. */
  retrieved: string;
  /** Date de lecture des descriptions, une seconde réponse (cf. le générateur). */
  descriptionsRetrieved: string;
  missions: CatalogueMission[];
}

export interface MissionPageInputs {
  catalogue: MissionCatalogue;
  /** Le catalogue des corps, pour leurs noms affichés. */
  config: CelestialConfig;
  /** Les objets d'instrument navigables (`config/navigable.ts`), pour le nom des sondes. */
  navigable: ReadonlyMap<string, CelestialBodyConfig>;
  /** Pour chaque mission (identifiant PDS), les sondes de Galaxy qui y figurent. */
  spacecraftByMission: ReadonlyMap<string, readonly string[]>;
  origin: string;
}

/** Le registre interrogé, tel que l'index des missions le publie déjà. */
export const PDS_REGISTRY = {
  publisher: 'NASA Planetary Data System',
  title: 'PDS Registry, investigation context products',
  url: 'https://pds.nasa.gov/',
  citingGuidance: 'https://pds.nasa.gov/datastandards/citing/',
} as const;

/**
 * Les types de cible que l'archive publie, traduits. Liste FERMÉE : un type nouveau fait échouer
 * le build plutôt que de s'afficher en anglais sous un titre espagnol.
 */
const TARGET_TYPE: Record<string, DocText> = {
  Planet: { en: 'planet', fr: 'planète', es: 'planeta', 'pt-BR': 'planeta' },
  Satellite: {
    en: 'satellite',
    fr: 'satellite',
    es: 'satélite',
    'pt-BR': 'satélite',
  },
  'Dwarf Planet': {
    en: 'dwarf planet',
    fr: 'planète naine',
    es: 'planeta enano',
    'pt-BR': 'planeta anão',
  },
  Asteroid: {
    en: 'asteroid',
    fr: 'astéroïde',
    es: 'asteroide',
    'pt-BR': 'asteroide',
  },
  Comet: { en: 'comet', fr: 'comète', es: 'cometa', 'pt-BR': 'cometa' },
  'Trans-Neptunian Object': {
    en: 'trans-Neptunian object',
    fr: 'objet transneptunien',
    es: 'objeto transneptuniano',
    'pt-BR': 'objeto transnetuniano',
  },
  Star: { en: 'star', fr: 'étoile', es: 'estrella', 'pt-BR': 'estrela' },
  Ring: { en: 'ring', fr: 'anneau', es: 'anillo', 'pt-BR': 'anel' },
  Dust: { en: 'dust', fr: 'poussière', es: 'polvo', 'pt-BR': 'poeira' },
  'Plasma Stream': {
    en: 'plasma stream',
    fr: 'flux de plasma',
    es: 'flujo de plasma',
    'pt-BR': 'fluxo de plasma',
  },
  'Magnetic Field': {
    en: 'magnetic field',
    fr: 'champ magnétique',
    es: 'campo magnético',
    'pt-BR': 'campo magnético',
  },
  'Planetary System': {
    en: 'planetary system',
    fr: 'système planétaire',
    es: 'sistema planetario',
    'pt-BR': 'sistema planetário',
  },
  Astrophysical: {
    en: 'astrophysical phenomenon',
    fr: 'phénomène astrophysique',
    es: 'fenómeno astrofísico',
    'pt-BR': 'fenômeno astrofísico',
  },
};

/**
 * Les cibles d'ÉTALONNAGE ne se listent pas : « PLAQUE », « DARK SKY » ou « CAL LAMPS » sont ce
 * qu'un instrument regarde pour se régler, pas un lieu qu'une mission a visé. Le type est celui
 * que l'archive PUBLIE, donc l'exclusion se lit dans la donnée et ne se devine pas ; la page en
 * donne le nombre, pour que rien ne disparaisse sans le dire.
 */
export const CALIBRATION_TYPES: ReadonlySet<string> = new Set([
  'Calibrator',
  'Calibration Field',
]);

const TEXT = {
  indexTitle: {
    en: 'Missions in the planetary archives',
    fr: 'Les missions des archives planétaires',
    es: 'Las misiones de los archivos planetarios',
    'pt-BR': 'As missões dos arquivos planetários',
  },
  indexDescription: {
    en: '{count} space missions as the NASA Planetary Data System registry declares them: dates, targets, and the bodies and spacecraft you can open in Galaxy.',
    fr: '{count} missions spatiales telles que le registre du Planetary Data System de la NASA les déclare : dates, cibles, et les corps et sondes à ouvrir dans Galaxy.',
    es: '{count} misiones espaciales tal como las declara el registro del Planetary Data System de la NASA: fechas, objetivos, y los cuerpos y sondas que puede abrir en Galaxy.',
    'pt-BR':
      '{count} missões espaciais tal como o registro do Planetary Data System da NASA as declara: datas, alvos, e os corpos e sondas que você pode abrir na Galaxy.',
  },
  indexIntro: {
    en: 'This list is read from the registry of the NASA Planetary Data System, which also federates the archives of {agencies}: {count} missions, read on {date}. Each page gives what the archive declares about one mission, and links every target that Galaxy shows to its page.',
    fr: 'Cette liste est lue dans le registre du Planetary Data System de la NASA, qui fédère aussi les archives de ces agences : {agencies} ; {count} missions, lues le {date}. Chaque page donne ce que l’archive déclare d’une mission, et relie chaque cible que Galaxy montre à sa page.',
    es: 'Esta lista se lee en el registro del Planetary Data System de la NASA, que federa también los archivos de estas agencias: {agencies}; {count} misiones, leídas el {date}. Cada página da lo que el archivo declara de una misión, y enlaza cada objetivo que Galaxy muestra con su página.',
    'pt-BR':
      'Esta lista é lida no registro do Planetary Data System da NASA, que federa também os arquivos destas agências: {agencies}; {count} missões, lidas em {date}. Cada página dá o que o arquivo declara sobre uma missão, e liga cada alvo que a Galaxy mostra à sua página.',
  },
  datesCaveat: {
    en: 'The start the archive declares is the start of the project, not the launch, and an end it does not declare does not mean the mission is still running.',
    fr: 'Le début que l’archive déclare est celui du projet, pas le lancement, et une fin qu’elle ne déclare pas ne veut pas dire que la mission est toujours en cours.',
    es: 'El inicio que declara el archivo es el del proyecto, no el lanzamiento, y un final que no declara no significa que la misión siga en curso.',
    'pt-BR':
      'O início que o arquivo declara é o do projeto, não o lançamento, e um fim que ele não declara não quer dizer que a missão continue em curso.',
  },
  tableCaption: {
    en: 'Missions, by declared start',
    fr: 'Missions, par début déclaré',
    es: 'Misiones, por inicio declarado',
    'pt-BR': 'Missões, por início declarado',
  },
  colMission: { en: 'Mission', fr: 'Mission', es: 'Misión', 'pt-BR': 'Missão' },
  colStart: {
    en: 'Project start',
    fr: 'Début du projet',
    es: 'Inicio del proyecto',
    'pt-BR': 'Início do projeto',
  },
  colEnd: {
    en: 'Declared end',
    fr: 'Fin déclarée',
    es: 'Final declarado',
    'pt-BR': 'Fim declarado',
  },
  colInGalaxy: {
    en: 'Targets in Galaxy',
    fr: 'Cibles dans Galaxy',
    es: 'Objetivos en Galaxy',
    'pt-BR': 'Alvos na Galaxy',
  },
  noStart: {
    en: 'not declared',
    fr: 'non déclaré',
    es: 'no declarado',
    'pt-BR': 'não declarado',
  },
  noEnd: {
    en: 'not declared',
    fr: 'non déclarée',
    es: 'no declarado',
    'pt-BR': 'não declarado',
  },
  missionTitle: {
    en: '{name}: mission and targets',
    fr: '{name} : mission et cibles',
    es: '{name}: misión y objetivos',
    'pt-BR': '{name}: missão e alvos',
  },
  missionDescription: {
    en: '{name}: dates, targets and description as the NASA Planetary Data System archive declares them, with the bodies you can open in Galaxy.',
    fr: '{name} : dates, cibles et description telles que l’archive du Planetary Data System de la NASA les déclare, avec les corps à ouvrir dans Galaxy.',
    es: '{name}: fechas, objetivos y descripción tal como los declara el archivo del Planetary Data System de la NASA, con los cuerpos que puede abrir en Galaxy.',
    'pt-BR':
      '{name}: datas, alvos e descrição tal como o arquivo do Planetary Data System da NASA os declara, com os corpos que você pode abrir na Galaxy.',
  },
  sectionDates: {
    en: 'Dates declared by the archive',
    fr: 'Dates déclarées par l’archive',
    es: 'Fechas declaradas por el archivo',
    'pt-BR': 'Datas declaradas pelo arquivo',
  },
  sectionInGalaxy: {
    en: 'In Galaxy',
    fr: 'Dans Galaxy',
    es: 'En Galaxy',
    'pt-BR': 'Na Galaxy',
  },
  bodiesLead: {
    en: 'Targets you can open in 3D:',
    fr: 'Cibles à ouvrir en 3D :',
    es: 'Objetivos que puede abrir en 3D:',
    'pt-BR': 'Alvos que você pode abrir em 3D:',
  },
  spacecraftLead: {
    en: 'Spacecraft of this mission that Galaxy follows:',
    fr: 'Sondes de cette mission que Galaxy suit :',
    es: 'Sondas de esta misión que Galaxy sigue:',
    'pt-BR': 'Sondas desta missão que a Galaxy acompanha:',
  },
  noneInGalaxy: {
    en: 'None of the targets this mission declares is in Galaxy’s catalogue.',
    fr: 'Aucune des cibles que cette mission déclare n’est dans le catalogue de Galaxy.',
    es: 'Ninguno de los objetivos que declara esta misión está en el catálogo de Galaxy.',
    'pt-BR':
      'Nenhum dos alvos que esta missão declara está no catálogo da Galaxy.',
  },
  sectionDescription: {
    en: 'Description published by the archive',
    fr: 'Description publiée par l’archive',
    es: 'Descripción publicada por el archivo',
    'pt-BR': 'Descrição publicada pelo arquivo',
  },
  descriptionNote: {
    en: 'Quoted in English, as the archive publishes it, read on {date}.',
    fr: 'Citée en anglais, telle que l’archive la publie, lue le {date}.',
    es: 'Citada en inglés, tal como la publica el archivo, leída el {date}.',
    'pt-BR': 'Citada em inglês, tal como o arquivo a publica, lida em {date}.',
  },
  descriptionTruncated: {
    en: 'The rest of the published text is a table, which reads only at the source.',
    fr: 'La suite du texte publié est un tableau, lisible seulement à la source.',
    es: 'El resto del texto publicado es una tabla, legible solo en la fuente.',
    'pt-BR':
      'O resto do texto publicado é uma tabela, legível apenas na fonte.',
  },
  sectionOtherTargets: {
    en: 'Other targets declared',
    fr: 'Autres cibles déclarées',
    es: 'Otros objetivos declarados',
    'pt-BR': 'Outros alvos declarados',
  },
  calibrationNote: {
    en: '{count} calibration targets declared by the archive are not listed: they are what an instrument looks at to adjust itself, not a place the mission aimed at.',
    fr: '{count} cibles d’étalonnage déclarées par l’archive ne sont pas listées : c’est ce qu’un instrument regarde pour se régler, pas un lieu que la mission a visé.',
    es: 'No se enumeran {count} objetivos de calibración declarados por el archivo: son lo que un instrumento mira para ajustarse, no un lugar al que apuntó la misión.',
    'pt-BR':
      '{count} alvos de calibração declarados pelo arquivo não são listados: são o que um instrumento observa para se ajustar, não um lugar que a missão visou.',
  },
  targetsCaveat: {
    en: 'A declared target is what the archive files the mission’s data under, not a record of observation.',
    fr: 'Une cible déclarée est ce sous quoi l’archive range les données de la mission, pas un relevé d’observation.',
    es: 'Un objetivo declarado es aquello bajo lo que el archivo clasifica los datos de la misión, no un registro de observación.',
    'pt-BR':
      'Um alvo declarado é aquilo sob o qual o arquivo arquiva os dados da missão, não um registro de observação.',
  },
  sectionSource: {
    en: 'Source',
    fr: 'Source',
    es: 'Fuente',
    'pt-BR': 'Fonte',
  },
  sourceText: {
    en: 'Identifier in the archive, which is its citation:',
    fr: 'Identifiant dans l’archive, qui en est la citation :',
    es: 'Identificador en el archivo, que es su cita:',
    'pt-BR': 'Identificador no arquivo, que é a sua citação:',
  },
  sourceRead: {
    en: 'Dates and targets read on {date}; how to cite the archive:',
    fr: 'Dates et cibles lues le {date} ; comment citer l’archive :',
    es: 'Fechas y objetivos leídos el {date}; cómo citar el archivo:',
    'pt-BR': 'Datas e alvos lidos em {date}; como citar o arquivo:',
  },
  allMissions: {
    en: 'All missions',
    fr: 'Toutes les missions',
    es: 'Todas las misiones',
    'pt-BR': 'Todas as missões',
  },
} as const satisfies Record<string, DocText>;

const fill = (
  text: string,
  values: Readonly<Record<string, string | number>>
): string =>
  text.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match
  );

/**
 * Le texte d'une description tel qu'il se cite.
 *
 * Deux descriptions sur 112 (BepiColombo, ExoMars 2016) sont des documents PDS3 aplatis : elles
 * s'ouvrent sur un titre souligné (« ExoMars 2016 Mission Overview ===== »), que la page remplace
 * par le sien, et celle d'ExoMars finit sur un SECOND titre suivi d'un tableau des phases dont les
 * colonnes ne survivent pas à l'aplatissement. La citation s'arrête alors à la dernière phrase
 * complète avant ce titre, et le DIT (`truncated`). Rien n'est réécrit à l'intérieur du texte.
 */
export function missionDescription(raw: string): {
  text: string;
  truncated: boolean;
} {
  const text = raw.replace(/^[^.=]{1,80}?\s+={4,}\s+/, '').trim();
  const next = text.search(/={4,}/);
  if (next < 0) return { text, truncated: false };
  const before = text.slice(0, next);
  const end = before.lastIndexOf('. ');
  if (end < 0)
    throw new Error(
      `description illisible : un titre souligné sans phrase complète avant lui (« ${text.slice(0, 80)} »)`
    );
  return { text: before.slice(0, end + 1), truncated: true };
}

/** Le chemin d'une page de mission sans la langue : `missions/voyager`. */
export const missionSlug = (mission: Pick<CatalogueMission, 'slug'>): string =>
  `${MISSIONS_SLUG}/${mission.slug}`;

/** Corps du catalogue et objets navigables, sous une seule clé : leur identifiant. */
function namedObjects(
  inputs: Pick<MissionPageInputs, 'config' | 'navigable'>
): Map<string, CelestialBodyConfig> {
  return new Map([...flattenBodies(inputs.config), ...inputs.navigable]);
}

/** Le nom affiché d'un corps ou d'un objet navigable, dans la langue de la page. */
function displayName(
  named: ReadonlyMap<string, CelestialBodyConfig>,
  id: string,
  locale: Locale
): string {
  const cfg = named.get(id);
  if (!cfg) throw new Error(`objet inconnu du catalogue : ${id}`);
  return cfg.displayName?.[locale] ?? cfg.displayName?.en ?? id;
}

/** Les corps du catalogue qu'une mission vise, sans doublon, dans l'ordre de l'archive. */
export function missionBodies(mission: CatalogueMission): string[] {
  return [
    ...new Set(
      mission.targets.flatMap((t) => (t.body === null ? [] : [t.body]))
    ),
  ];
}

const pageLink = (id: string, label: string, locale: Locale): string =>
  `<a href="/${bodyPagePath(id, locale)}/">${escapeHtml(label)}</a>`;

/**
 * Les missions, triées par début déclaré puis par nom : l'ordre de l'index et des fiches. Un
 * début non déclaré va à la FIN : en tête, il passait pour la plus ancienne mission.
 */
export function byStart(
  a: Pick<CatalogueMission, 'start' | 'name'>,
  b: Pick<CatalogueMission, 'start' | 'name'>
): number {
  if (a.start !== b.start) {
    if (a.start === null) return 1;
    if (b.start === null) return -1;
    return a.start.localeCompare(b.start);
  }
  return a.name.localeCompare(b.name);
}

function missionPage(
  mission: CatalogueMission,
  inputs: MissionPageInputs,
  locale: Locale
): DocPage {
  const { catalogue, origin } = inputs;
  const named = namedObjects(inputs);
  const slug = missionSlug(mission);
  const list = (items: readonly string[]): string =>
    `<ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>`;

  const dates =
    `<dl><dt>${escapeHtml(TEXT.colStart[locale])}</dt><dd>${escapeHtml(
      mission.start === null
        ? TEXT.noStart[locale]
        : longDay(mission.start, locale)
    )}</dd>` +
    `<dt>${escapeHtml(TEXT.colEnd[locale])}</dt><dd>${escapeHtml(
      mission.end === null ? TEXT.noEnd[locale] : longDay(mission.end, locale)
    )}</dd></dl><p>${escapeHtml(TEXT.datesCaveat[locale])}</p>`;

  const bodies = missionBodies(mission);
  const spacecraft = inputs.spacecraftByMission.get(mission.lid) ?? [];
  const inGalaxy =
    bodies.length === 0 && spacecraft.length === 0
      ? `<p>${escapeHtml(TEXT.noneInGalaxy[locale])}</p>`
      : (bodies.length
          ? `<p>${escapeHtml(TEXT.bodiesLead[locale])}</p>${list(
              bodies.map((b) =>
                pageLink(b, displayName(named, b, locale), locale)
              )
            )}`
          : `<p>${escapeHtml(TEXT.noneInGalaxy[locale])}</p>`) +
        (spacecraft.length
          ? `<p>${escapeHtml(TEXT.spacecraftLead[locale])}</p>${list(
              spacecraft.map((s) =>
                pageLink(s, displayName(named, s, locale), locale)
              )
            )}`
          : '');

  const { text, truncated } = missionDescription(mission.description);
  const description =
    `<blockquote lang="en" cite="${escapeHtml(PDS_REGISTRY.url)}"><p>${escapeHtml(text)}</p></blockquote>` +
    `<p>${escapeHtml(
      fill(TEXT.descriptionNote[locale], {
        date: longDay(catalogue.descriptionsRetrieved, locale),
      })
    )}${truncated ? ` ${escapeHtml(TEXT.descriptionTruncated[locale])}` : ''}</p>`;

  const others = mission.targets.filter(
    (t) => t.body === null && !CALIBRATION_TYPES.has(String(t.type))
  );
  const calibrations = mission.targets.filter((t) =>
    CALIBRATION_TYPES.has(String(t.type))
  ).length;
  const otherItems = others.map((t) => {
    const type = TARGET_TYPE[String(t.type)];
    if (!type)
      throw new Error(
        `type de cible sans traduction : « ${t.type} » (${t.lid}). L'ajouter à TARGET_TYPE.`
      );
    return `${escapeHtml(t.name ?? t.lid)} (${escapeHtml(type[locale])})`;
  });
  const otherTargets =
    others.length || calibrations
      ? docSection(
          'other-targets',
          TEXT.sectionOtherTargets[locale],
          (others.length ? list(otherItems) : '') +
            (calibrations
              ? `<p>${escapeHtml(fill(TEXT.calibrationNote[locale], { count: calibrations }))}</p>`
              : '')
        )
      : '';

  const source =
    `<p>${escapeHtml(TEXT.sourceText[locale])} <code>${escapeHtml(mission.lid)}</code></p>` +
    `<p>${escapeHtml(PDS_REGISTRY.publisher)}, ${escapeHtml(PDS_REGISTRY.title)}. ` +
    `${escapeHtml(fill(TEXT.sourceRead[locale], { date: longDay(catalogue.retrieved, locale) }))} ` +
    `<a href="${escapeHtml(PDS_REGISTRY.citingGuidance)}" rel="noopener noreferrer">${escapeHtml(PDS_REGISTRY.citingGuidance)}</a></p>` +
    `<p><a href="${docPath(MISSIONS_SLUG, locale)}">${escapeHtml(TEXT.allMissions[locale])}</a></p>`;

  return {
    slug,
    locale,
    canonical: `${origin}${docPath(slug, locale)}`,
    title: fill(TEXT.missionTitle[locale], { name: mission.name }),
    description: trimForMeta(
      fill(TEXT.missionDescription[locale], { name: mission.name }),
      160
    ),
    updated: [catalogue.retrieved, catalogue.descriptionsRetrieved]
      .sort()
      .at(-1)!,
    body: [
      docSection('dates', TEXT.sectionDates[locale], dates),
      docSection(
        'in-galaxy',
        TEXT.sectionInGalaxy[locale],
        inGalaxy + `<p>${escapeHtml(TEXT.targetsCaveat[locale])}</p>`
      ),
      docSection('description', TEXT.sectionDescription[locale], description),
      otherTargets,
      docSection('source', TEXT.sectionSource[locale], source),
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

function indexPage(inputs: MissionPageInputs, locale: Locale): DocPage {
  const { catalogue, origin } = inputs;
  const named = namedObjects(inputs);
  const count = new Intl.NumberFormat(INTL_LOCALE[locale]).format(
    catalogue.missions.length
  );
  // Les agences se DÉRIVENT des identifiants livrés (`urn:esa:psa:…` → ESA), comme le fait le
  // générateur pour l'index : une liste écrite à la main en oubliait deux au lot 40.
  const agencies = new Intl.ListFormat(INTL_LOCALE[locale], {
    type: 'conjunction',
  }).format(
    [...new Set(catalogue.missions.map((m) => m.lid.split(':')[1]!))]
      .filter((agency) => agency !== 'nasa')
      .sort()
      .map((agency) => agency.toUpperCase())
  );
  const rows = [...catalogue.missions].sort(byStart).map((mission) => [
    `<a href="${docPath(missionSlug(mission), locale)}">${escapeHtml(mission.name)}</a>`,
    escapeHtml(mission.start ?? TEXT.noStart[locale]),
    escapeHtml(mission.end ?? TEXT.noEnd[locale]),
    missionBodies(mission)
      .map((b) => pageLink(b, displayName(named, b, locale), locale))
      .join(', '),
  ]);
  return {
    slug: MISSIONS_SLUG,
    locale,
    canonical: `${origin}${docPath(MISSIONS_SLUG, locale)}`,
    title: TEXT.indexTitle[locale],
    description: fill(TEXT.indexDescription[locale], { count }),
    updated: [catalogue.retrieved, catalogue.descriptionsRetrieved]
      .sort()
      .at(-1)!,
    body:
      `      <p>${escapeHtml(
        fill(TEXT.indexIntro[locale], {
          count,
          agencies,
          date: longDay(catalogue.retrieved, locale),
        })
      )}</p>\n      <p>${escapeHtml(TEXT.datesCaveat[locale])}</p>\n      ` +
      docTable(
        TEXT.tableCaption[locale],
        [
          TEXT.colMission[locale],
          TEXT.colStart[locale],
          TEXT.colEnd[locale],
          TEXT.colInGalaxy[locale],
        ],
        rows
      ),
  };
}

/** L'index puis une page par mission, dans une langue. */
export function missionPages(
  inputs: MissionPageInputs,
  locale: Locale
): DocPage[] {
  return [
    indexPage(inputs, locale),
    ...inputs.catalogue.missions.map((m) => missionPage(m, inputs, locale)),
  ];
}

/**
 * Pour chaque corps du catalogue, les missions qui le visent, dans l'ordre de leur début : ce que
 * la page d'un corps relie. Dérivé du MÊME catalogue que les pages, donc un lien ne peut pas
 * mener à une page qui n'existe pas.
 */
export function missionsByBody(
  catalogue: MissionCatalogue
): Map<string, { name: string; slug: string }[]> {
  const out = new Map<string, { name: string; slug: string }[]>();
  for (const mission of [...catalogue.missions].sort(byStart))
    for (const body of missionBodies(mission)) {
      if (!out.has(body)) out.set(body, []);
      out.get(body)!.push({ name: mission.name, slug: missionSlug(mission) });
    }
  return out;
}

/** Identifiant PDS → chemin de page, pour lier les investigations d'une sonde. */
export function missionSlugsByLid(
  catalogue: MissionCatalogue
): Map<string, string> {
  return new Map(catalogue.missions.map((m) => [m.lid, missionSlug(m)]));
}
