/**
 * PAGES DES GRANDS LIEUX NOMMÉS (lot 55) : l'index `/places/` et une page par grande formation
 * nommée par l'UAI, `/places/moon/tycho/`, dans les quatre langues.
 *
 * QU'EST-CE QU'UN GRAND LIEU : une règle RELATIVE à la taille du corps, `GREAT_PLACE_RATIO`. Un
 * seuil absolu en kilomètres aurait servi les grands corps et laissé les petits à zéro, contre la
 * règle de parité ; un diamètre d'au moins 0,2 rayon donne une page à 40 corps sur 44, de Deimos à
 * Mars (mesuré le 2026-10-17, `docs/private/LIEUX_LOT55.md`). Un corps dont l'UAI ne publie aucun
 * diamètre assez grand n'a pas de page, et l'index le DIT avec ses comptes : aucune taille n'est
 * inventée.
 *
 * CE QUE LA PAGE AFFIRME, et rien de plus :
 *   - le nom, le type, le diamètre, le centre, la date d'adoption et la raison du nom sont ceux du
 *     Gazetteer of Planetary Nomenclature ; la raison du nom et la définition du type sont CITÉES
 *     en anglais, mot pour mot, comme les descriptions du PDS sur les pages des missions ;
 *   - pour les quatre corps de l'Orbital Data Explorer, les instruments dont une empreinte TOUCHE
 *     la formation (ligne 40.3), pas « ceux qui l'ont étudiée » ;
 *   - ailleurs, les missions qui ont visé le CORPS, dites comme telles : aucune n'est réputée avoir
 *     vu cette formation.
 *
 * Le lien « Voir dans Galaxy » ouvre la page du corps avec `?place=`, que l'application lit à
 * l'ouverture pour tourner la caméra vers la formation (`ui/lookAtFormation.ts`).
 *
 * Module PUR : le greffon de build lit le gazetteer, les termes, les observations et le catalogue
 * des missions, et les passe en argument.
 */
import type { CelestialBodyConfig, CelestialConfig } from '@/types';
import { flattenBodies } from '@/config/catalog';
import type { NamedFeature } from '@/core/gazetteer';
import { INTL_LOCALE, type Locale } from '@/i18n/locales';
import { bodyPagePath, escapeHtml, trimForMeta } from './bodyLandingPage';
import {
  docPath,
  docSection,
  docTable,
  MISSIONS_SLUG,
  PLACES_SLUG,
  type DocPage,
  type DocText,
} from './documentPage';
import { longDay } from './instrumentLandingPage';

/** Un grand lieu : diamètre publié d'au moins cette fraction du rayon de son corps. */
export const GREAT_PLACE_RATIO = 0.2;

export interface DescriptorTerm {
  label: string;
  code: string;
  definition: string;
}

export interface DescriptorTerms {
  source: string;
  retrieved: string;
  terms: readonly DescriptorTerm[];
}

/** Une observation par instrument, telle que la donne une fiche de `place-observations`. */
export interface PlaceObservationRow {
  mission: string;
  instrument: string;
  count: number;
  first: string;
  last: string;
  label: string;
}

export interface PlacePageInputs {
  config: CelestialConfig;
  /** Les formations nommées par l'UAI, par corps du catalogue. */
  gazetteer: ReadonlyMap<string, readonly NamedFeature[]>;
  gazetteerProvider: {
    publisher: string;
    title: string;
    url: string;
    accessed: string;
  };
  terms: DescriptorTerms;
  /** Les observations d'une formation, ou `null` pour un corps hors de l'Orbital Data Explorer. */
  observations: (body: string, iauId: number) => PlaceObservationRow[] | null;
  observationProvider: { url: string; frozenAt: string };
  /** Les missions qui visent chaque corps (`missionPages.ts`, même catalogue que leurs pages). */
  missionsByBody: ReadonlyMap<
    string,
    readonly { name: string; slug: string }[]
  >;
  origin: string;
}

const TEXT = {
  placeTitle: {
    en: '{name} ({body})',
    fr: '{name} ({body})',
    es: '{name} ({body})',
    'pt-BR': '{name} ({body})',
  },
  placeDescription: {
    en: '{name} ({body}), a formation named by the IAU: its type, size, centre and the origin of its name, from the IAU gazetteer, and what observed it.',
    fr: '{name} ({body}), une formation nommée par l’UAI : son type, sa taille, son centre et l’origine de son nom selon le gazetteer de l’UAI, et ce qui l’a observée.',
    es: '{name} ({body}), una formación con nombre de la UAI: su tipo, tamaño, centro y el origen de su nombre según el gazetteer de la UAI, y qué la observó.',
    'pt-BR':
      '{name} ({body}), uma formação nomeada pela UAI: seu tipo, tamanho, centro e a origem do seu nome segundo o gazetteer da UAI, e o que a observou.',
  },
  sectionWhat: {
    en: 'What it is',
    fr: 'Ce que c’est',
    es: 'Qué es',
    'pt-BR': 'O que é',
  },
  type: { en: 'Type', fr: 'Type', es: 'Tipo', 'pt-BR': 'Tipo' },
  typeDefinition: {
    en: 'IAU definition',
    fr: 'Définition de l’UAI',
    es: 'Definición de la UAI',
    'pt-BR': 'Definição da UAI',
  },
  diameter: {
    en: 'Diameter',
    fr: 'Diamètre',
    es: 'Diámetro',
    'pt-BR': 'Diâmetro',
  },
  diameterShare: {
    en: '{km} km, {share} % of the radius of its body',
    fr: '{km} km, {share} % du rayon de son corps',
    es: '{km} km, el {share} % del radio de su cuerpo',
    'pt-BR': '{km} km, {share} % do raio do seu corpo',
  },
  centre: { en: 'Centre', fr: 'Centre', es: 'Centro', 'pt-BR': 'Centro' },
  centreValue: {
    en: '{lat}° {ns}, {lon}° east (planetocentric latitude, east longitude from 0 to 360°, the IAU convention)',
    fr: '{lat}° {ns}, {lon}° est (latitude planétocentrique, longitude est de 0 à 360°, convention de l’UAI)',
    es: '{lat}° {ns}, {lon}° este (latitud planetocéntrica, longitud este de 0 a 360°, convención de la UAI)',
    'pt-BR':
      '{lat}° {ns}, {lon}° leste (latitude planetocêntrica, longitude leste de 0 a 360°, convenção da UAI)',
  },
  north: { en: 'N', fr: 'N', es: 'N', 'pt-BR': 'N' },
  south: { en: 'S', fr: 'S', es: 'S', 'pt-BR': 'S' },
  adopted: {
    en: 'Name adopted',
    fr: 'Nom adopté',
    es: 'Nombre adoptado',
    'pt-BR': 'Nome adotado',
  },
  origin: {
    en: 'Origin of the name',
    fr: 'Origine du nom',
    es: 'Origen del nombre',
    'pt-BR': 'Origem do nome',
  },
  noOrigin: {
    en: 'The gazetteer gives no origin for this name.',
    fr: 'Le gazetteer ne donne pas d’origine pour ce nom.',
    es: 'El gazetteer no da origen para este nombre.',
    'pt-BR': 'O gazetteer não dá origem para este nome.',
  },
  quotedNote: {
    en: 'Quoted in English, as the IAU publishes it.',
    fr: 'Cité en anglais, tel que l’UAI le publie.',
    es: 'Citado en inglés, tal como lo publica la UAI.',
    'pt-BR': 'Citado em inglês, tal como a UAI o publica.',
  },
  sectionOpen: {
    en: 'In Galaxy',
    fr: 'Dans Galaxy',
    es: 'En Galaxy',
    'pt-BR': 'No Galaxy',
  },
  open: {
    en: 'See it in Galaxy',
    fr: 'Le voir dans Galaxy',
    es: 'Verlo en Galaxy',
    'pt-BR': 'Vê-lo no Galaxy',
  },
  openText: {
    en: 'Opens its body in the application, the camera turned towards {name}.',
    fr: 'Ouvre son corps dans l’application, la caméra tournée vers {name}.',
    es: 'Abre su cuerpo en la aplicación, con la cámara orientada hacia {name}.',
    'pt-BR':
      'Abre o seu corpo no aplicativo, com a câmera voltada para {name}.',
  },
  sectionObserved: {
    en: 'Observed by',
    fr: 'Observé par',
    es: 'Observado por',
    'pt-BR': 'Observado por',
  },
  observedLead: {
    en: 'Instruments whose footprint touches this formation, counted by the PDS Orbital Data Explorer (data frozen on {date}). A footprint that touches it is not a study of it.',
    fr: 'Instruments dont une empreinte touche cette formation, comptés par l’Orbital Data Explorer du PDS (données figées le {date}). Une empreinte qui la touche n’est pas une étude d’elle.',
    es: 'Instrumentos cuya huella toca esta formación, contados por el Orbital Data Explorer del PDS (datos fijados el {date}). Una huella que la toca no es un estudio de ella.',
    'pt-BR':
      'Instrumentos cuja pegada toca esta formação, contados pelo Orbital Data Explorer do PDS (dados fixados em {date}). Uma pegada que a toca não é um estudo dela.',
  },
  observedNone: {
    en: 'No footprint counted by the PDS Orbital Data Explorer touches this formation.',
    fr: 'Aucune empreinte comptée par l’Orbital Data Explorer du PDS ne touche cette formation.',
    es: 'Ninguna huella contada por el Orbital Data Explorer del PDS toca esta formación.',
    'pt-BR':
      'Nenhuma pegada contada pelo Orbital Data Explorer do PDS toca esta formação.',
  },
  colInstrument: {
    en: 'Mission and instrument',
    fr: 'Mission et instrument',
    es: 'Misión e instrumento',
    'pt-BR': 'Missão e instrumento',
  },
  colCount: {
    en: 'Products',
    fr: 'Produits',
    es: 'Productos',
    'pt-BR': 'Produtos',
  },
  colFirst: {
    en: 'First',
    fr: 'Premier',
    es: 'Primero',
    'pt-BR': 'Primeiro',
  },
  colLast: { en: 'Last', fr: 'Dernier', es: 'Último', 'pt-BR': 'Último' },
  undated: {
    en: 'no date published',
    fr: 'date non publiée',
    es: 'fecha no publicada',
    'pt-BR': 'data não publicada',
  },
  sectionMissions: {
    en: 'Missions to its body',
    fr: 'Missions vers son corps',
    es: 'Misiones a su cuerpo',
    'pt-BR': 'Missões para o seu corpo',
  },
  missionsLead: {
    en: 'No observation record of this formation is crossed here. These are the missions the Planetary Data System declares for its body; none is claimed to have observed {name}.',
    fr: 'Aucun relevé d’observation de cette formation n’est croisé ici. Voici les missions que le Planetary Data System déclare pour son corps ; aucune n’est réputée avoir observé {name}.',
    es: 'Aquí no se cruza ningún registro de observación de esta formación. Estas son las misiones que el Planetary Data System declara para su cuerpo; de ninguna se afirma que haya observado {name}.',
    'pt-BR':
      'Nenhum registro de observação desta formação é cruzado aqui. Estas são as missões que o Planetary Data System declara para o seu corpo; de nenhuma se afirma que tenha observado {name}.',
  },
  missionsNone: {
    en: 'The Planetary Data System declares no mission for its body.',
    fr: 'Le Planetary Data System ne déclare aucune mission pour son corps.',
    es: 'El Planetary Data System no declara ninguna misión para su cuerpo.',
    'pt-BR':
      'O Planetary Data System não declara nenhuma missão para o seu corpo.',
  },
  sectionSource: {
    en: 'Sources',
    fr: 'Sources',
    es: 'Fuentes',
    'pt-BR': 'Fontes',
  },
  sourceGazetteer: {
    en: '{publisher}, {title}, read on {date}. Feature page:',
    fr: '{publisher}, {title}, lu le {date}. Fiche de la formation :',
    es: '{publisher}, {title}, leído el {date}. Ficha de la formación:',
    'pt-BR': '{publisher}, {title}, lido em {date}. Ficha da formação:',
  },
  sourceTerms: {
    en: 'Type definitions: IAU Descriptor Terms, read on {date}.',
    fr: 'Définitions des types : Descriptor Terms de l’UAI, lus le {date}.',
    es: 'Definiciones de los tipos: Descriptor Terms de la UAI, leídos el {date}.',
    'pt-BR': 'Definições dos tipos: Descriptor Terms da UAI, lidos em {date}.',
  },
  allPlaces: {
    en: 'All the great named places',
    fr: 'Tous les grands lieux nommés',
    es: 'Todos los grandes lugares con nombre',
    'pt-BR': 'Todos os grandes lugares nomeados',
  },
  allMissions: {
    en: 'All the missions',
    fr: 'Toutes les missions',
    es: 'Todas las misiones',
    'pt-BR': 'Todas as missões',
  },
  indexTitle: {
    en: 'Great named places of the Solar System',
    fr: 'Les grands lieux nommés du système solaire',
    es: 'Los grandes lugares con nombre del sistema solar',
    'pt-BR': 'Os grandes lugares nomeados do sistema solar',
  },
  indexDescription: {
    en: '{count} formations named by the IAU, each at least a fifth of its body’s radius across: what they are, the origin of their names, and what observed them.',
    fr: '{count} formations nommées par l’UAI, chacune large d’au moins un cinquième du rayon de son corps : ce qu’elles sont, l’origine de leur nom et ce qui les a observées.',
    es: '{count} formaciones con nombre de la UAI, cada una de al menos un quinto del radio de su cuerpo: qué son, el origen de su nombre y qué las observó.',
    'pt-BR':
      '{count} formações nomeadas pela UAI, cada uma com pelo menos um quinto do raio do seu corpo: o que são, a origem do seu nome e o que as observou.',
  },
  indexIntro: {
    en: 'A great place is a formation whose published diameter is at least {share} % of its body’s radius: a rule relative to the body, so that a small moon has its great places as well as Mars. {count} formations on {bodies} bodies meet it, in the IAU gazetteer read on {date}.',
    fr: 'Un grand lieu est une formation dont le diamètre publié atteint au moins {share} % du rayon de son corps : une règle relative au corps, pour qu’une petite lune ait ses grands lieux autant que Mars. {count} formations sur {bodies} corps la remplissent, dans le gazetteer de l’UAI lu le {date}.',
    es: 'Un gran lugar es una formación cuyo diámetro publicado alcanza al menos el {share} % del radio de su cuerpo: una regla relativa al cuerpo, para que una luna pequeña tenga sus grandes lugares tanto como Marte. {count} formaciones en {bodies} cuerpos la cumplen, en el gazetteer de la UAI leído el {date}.',
    'pt-BR':
      'Um grande lugar é uma formação cujo diâmetro publicado atinge pelo menos {share} % do raio do seu corpo: uma regra relativa ao corpo, para que uma pequena lua tenha seus grandes lugares tanto quanto Marte. {count} formações em {bodies} corpos a cumprem, no gazetteer da UAI lido em {date}.',
  },
  indexWithout: {
    en: 'Named bodies with no great place: {list}. The IAU publishes no diameter large enough for any of their formations, and none is invented here.',
    fr: 'Corps nommés sans grand lieu : {list}. L’UAI ne publie pour aucune de leurs formations un diamètre assez grand, et aucun n’est inventé ici.',
    es: 'Cuerpos con nombres sin gran lugar: {list}. La UAI no publica para ninguna de sus formaciones un diámetro suficientemente grande, y aquí no se inventa ninguno.',
    'pt-BR':
      'Corpos nomeados sem grande lugar: {list}. A UAI não publica para nenhuma de suas formações um diâmetro grande o suficiente, e nenhum é inventado aqui.',
  },
  withoutItem: {
    en: '{body} ({count} {formations}, {sized} with a published diameter)',
    fr: '{body} ({count} {formations}, {sized} avec un diamètre publié)',
    es: '{body} ({count} {formations}, {sized} con un diámetro publicado)',
    'pt-BR': '{body} ({count} {formations}, {sized} com um diâmetro publicado)',
  },
  formationOne: {
    en: 'formation',
    fr: 'formation',
    es: 'formación',
    'pt-BR': 'formação',
  },
  formationOther: {
    en: 'formations',
    fr: 'formations',
    es: 'formaciones',
    'pt-BR': 'formações',
  },
  tableCaption: {
    en: 'Great named places, by body',
    fr: 'Grands lieux nommés, par corps',
    es: 'Grandes lugares con nombre, por cuerpo',
    'pt-BR': 'Grandes lugares nomeados, por corpo',
  },
  colPlace: {
    en: 'Formation',
    fr: 'Formation',
    es: 'Formación',
    'pt-BR': 'Formação',
  },
  colBody: { en: 'Body', fr: 'Corps', es: 'Cuerpo', 'pt-BR': 'Corpo' },
} as const satisfies Record<string, DocText>;

const fill = (
  text: string,
  values: Readonly<Record<string, string | number>>
): string =>
  text.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match
  );

/**
 * Les sources publient des entités HTML dans leurs textes : le gazetteer (« &quot;Sea of
 * Showers.&quot; ») comme l'ODE (« Chang&apos;e »). Décodées ICI, avant tout échappement, sans
 * quoi la page les afficherait telles quelles (`&amp;quot;`, vu au rendu le 2026-10-17).
 */
export function decodeEntities(text: string): string {
  return text
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Le rayon publié d'un corps du catalogue, en km, ou `null`. */
function radiusKm(cfg: CelestialBodyConfig): number | null {
  const r = cfg.realData?.radiusKm;
  return typeof r === 'number' && r > 0 ? r : null;
}

/** Les grands lieux d'un corps : diamètre publié d'au moins `GREAT_PLACE_RATIO` rayon, du plus grand au plus petit. */
export function greatPlaces(
  features: readonly NamedFeature[],
  radius: number
): NamedFeature[] {
  return features
    .filter(
      (f) => f.diameterKm > 0 && f.diameterKm >= GREAT_PLACE_RATIO * radius
    )
    .sort(
      (a, b) => b.diameterKm - a.diameterKm || a.name.localeCompare(b.name)
    );
}

/** Un nom de formation en segment d'adresse : sans accents, minuscules, tirets. */
export function placeNameSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Le chemin d'une page de lieu sans la langue : `places/moon/tycho`. */
export const placeSlug = (body: string, name: string): string =>
  `${PLACES_SLUG}/${body}/${placeNameSlug(name)}`;

interface GreatPlace {
  body: string;
  bodyConfig: CelestialBodyConfig;
  radius: number;
  feature: NamedFeature;
}

/** Tous les grands lieux, dans l'ordre du catalogue puis du plus grand au plus petit. */
export function allGreatPlaces(inputs: PlacePageInputs): GreatPlace[] {
  const out: GreatPlace[] = [];
  for (const [body, cfg] of flattenBodies(inputs.config)) {
    const features = inputs.gazetteer.get(body);
    const radius = radiusKm(cfg);
    if (!features || radius === null) continue;
    for (const feature of greatPlaces(features, radius))
      out.push({
        body,
        bodyConfig: cfg,
        radius,
        feature: {
          ...feature,
          name: decodeEntities(feature.name),
          origin: decodeEntities(feature.origin),
        },
      });
  }
  return out;
}

const bodyName = (
  id: string,
  cfg: CelestialBodyConfig,
  locale: Locale
): string => cfg.displayName?.[locale] ?? cfg.displayName?.en ?? id;

const bodyLink = (id: string, cfg: CelestialBodyConfig, locale: Locale) =>
  `<a href="/${bodyPagePath(id, locale)}/">${escapeHtml(bodyName(id, cfg, locale))}</a>`;

/** Une date d'adoption telle que le gazetteer la publie : l'année seule, ou le jour. */
function adoptionDate(approved: string, locale: Locale): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(approved)
    ? longDay(approved, locale)
    : approved;
}

function placePage(
  place: GreatPlace,
  inputs: PlacePageInputs,
  locale: Locale
): DocPage {
  const { feature, body, bodyConfig, radius } = place;
  const number = (value: number, digits: number) =>
    new Intl.NumberFormat(INTL_LOCALE[locale], {
      maximumFractionDigits: digits,
    }).format(value);
  const term = inputs.terms.terms.find((t) => t.label === feature.type);
  if (!term)
    throw new Error(
      `type sans définition de l’UAI : « ${feature.type} » (${feature.name}) ; relancer pnpm places:terms`
    );
  const name = bodyName(body, bodyConfig, locale);
  const slug = placeSlug(body, feature.name);
  const values = { name: feature.name, body: name };

  const quote = (text: string) =>
    `<blockquote lang="en"><p>${escapeHtml(text)}</p></blockquote>`;
  const what =
    `<dl>` +
    `<dt>${escapeHtml(TEXT.type[locale])}</dt><dd lang="la">${escapeHtml(term.label)}</dd>` +
    `<dt>${escapeHtml(TEXT.typeDefinition[locale])}</dt><dd>${quote(term.definition)}</dd>` +
    `<dt>${escapeHtml(TEXT.diameter[locale])}</dt><dd>${escapeHtml(
      fill(TEXT.diameterShare[locale], {
        km: number(feature.diameterKm, 1),
        share: number((100 * feature.diameterKm) / radius, 0),
        body: name,
      })
    )}</dd>` +
    `<dt>${escapeHtml(TEXT.centre[locale])}</dt><dd>${escapeHtml(
      fill(TEXT.centreValue[locale], {
        lat: number(Math.abs(feature.lat), 2),
        ns: feature.lat < 0 ? TEXT.south[locale] : TEXT.north[locale],
        lon: number(feature.lon, 2),
      })
    )}</dd>` +
    (feature.approved
      ? `<dt>${escapeHtml(TEXT.adopted[locale])}</dt><dd>${escapeHtml(adoptionDate(feature.approved, locale))}</dd>`
      : '') +
    `<dt>${escapeHtml(TEXT.origin[locale])}</dt><dd>${
      feature.origin
        ? quote(feature.origin)
        : `<p>${escapeHtml(TEXT.noOrigin[locale])}</p>`
    }</dd>` +
    `</dl><p>${escapeHtml(TEXT.quotedNote[locale])}</p>`;

  const open = `<p><a href="/${bodyPagePath(body, locale)}/?place=${encodeURIComponent(feature.name)}">${escapeHtml(
    TEXT.open[locale]
  )}</a></p><p>${escapeHtml(fill(TEXT.openText[locale], values))}</p>`;

  const observations = inputs.observations(body, feature.iauId);
  const provider = inputs.observationProvider;
  const providerValues = { date: longDay(provider.frozenAt, locale) };
  let evidence: string;
  if (observations !== null) {
    // Des produits de l'ODE ne publient AUCUNE date (6 016 lignes au 2026-10-17) : dit tel quel,
    // et rangé après les observations datées.
    const day = (iso: string) =>
      iso ? longDay(iso, locale) : TEXT.undated[locale];
    const rows = [...observations]
      .sort(
        (a, b) =>
          (a.first || '9999').localeCompare(b.first || '9999') ||
          b.count - a.count
      )
      .map((o) => [
        `${escapeHtml(o.mission)} · ${escapeHtml(o.instrument)}`,
        escapeHtml(number(o.count, 0)),
        `<a href="${escapeHtml(o.label)}" rel="noopener noreferrer">${escapeHtml(day(o.first))}</a>`,
        escapeHtml(day(o.last)),
      ]);
    evidence = docSection(
      'observed',
      TEXT.sectionObserved[locale],
      rows.length
        ? `<p>${escapeHtml(fill(TEXT.observedLead[locale], providerValues))}</p>` +
            docTable(
              TEXT.sectionObserved[locale],
              [
                TEXT.colInstrument[locale],
                TEXT.colCount[locale],
                TEXT.colFirst[locale],
                TEXT.colLast[locale],
              ],
              rows
            )
        : `<p>${escapeHtml(fill(TEXT.observedNone[locale], providerValues))}</p>`
    );
  } else {
    const missions = inputs.missionsByBody.get(body) ?? [];
    evidence = docSection(
      'missions',
      fill(TEXT.sectionMissions[locale], values),
      missions.length
        ? `<p>${escapeHtml(fill(TEXT.missionsLead[locale], values))}</p><ul>${missions
            .map(
              (m) =>
                `<li><a href="${docPath(m.slug, locale)}">${escapeHtml(m.name)}</a></li>`
            )
            .join('')}</ul>`
        : `<p>${escapeHtml(fill(TEXT.missionsNone[locale], values))}</p>`
    );
  }

  const g = inputs.gazetteerProvider;
  const featureUrl = `https://planetarynames.wr.usgs.gov/Feature/${feature.iauId}`;
  const sources =
    `<p>${escapeHtml(
      fill(TEXT.sourceGazetteer[locale], {
        publisher: g.publisher,
        title: g.title,
        date: longDay(g.accessed, locale),
      })
    )} <a href="${featureUrl}" rel="noopener noreferrer">${featureUrl}</a></p>` +
    `<p>${escapeHtml(
      fill(TEXT.sourceTerms[locale], {
        date: longDay(inputs.terms.retrieved, locale),
      })
    )} <a href="${escapeHtml(inputs.terms.source)}" rel="noopener noreferrer">${escapeHtml(inputs.terms.source)}</a></p>` +
    `<p>${bodyLink(body, bodyConfig, locale)} · <a href="${docPath(PLACES_SLUG, locale)}">${escapeHtml(
      TEXT.allPlaces[locale]
    )}</a> · <a href="${docPath(MISSIONS_SLUG, locale)}">${escapeHtml(
      TEXT.allMissions[locale]
    )}</a></p>`;

  return {
    slug,
    locale,
    canonical: `${inputs.origin}${docPath(slug, locale)}`,
    title: fill(TEXT.placeTitle[locale], values),
    description: trimForMeta(fill(TEXT.placeDescription[locale], values), 160),
    updated: [g.accessed, inputs.terms.retrieved, provider.frozenAt]
      .sort()
      .at(-1)!,
    body: [
      docSection('what', TEXT.sectionWhat[locale], what),
      docSection('open', TEXT.sectionOpen[locale], open),
      evidence,
      docSection('source', TEXT.sectionSource[locale], sources),
    ].join('\n'),
  };
}

function indexPage(
  places: readonly GreatPlace[],
  inputs: PlacePageInputs,
  locale: Locale
): DocPage {
  const format = new Intl.NumberFormat(INTL_LOCALE[locale]);
  const count = format.format(places.length);
  const withPlaces = new Set(places.map((p) => p.body));
  const without = [...flattenBodies(inputs.config)]
    .filter(([id]) => inputs.gazetteer.has(id) && !withPlaces.has(id))
    .map(([id, cfg]) => {
      const features = inputs.gazetteer.get(id)!;
      // L'accord suit la règle de la langue : « 1 formation », pas « 1 formations ».
      const one =
        new Intl.PluralRules(INTL_LOCALE[locale]).select(features.length) ===
        'one';
      return fill(TEXT.withoutItem[locale], {
        body: bodyName(id, cfg, locale),
        count: format.format(features.length),
        formations: one
          ? TEXT.formationOne[locale]
          : TEXT.formationOther[locale],
        sized: format.format(features.filter((f) => f.diameterKm > 0).length),
      });
    });
  const rows = places.map((p) => [
    `<a href="${docPath(placeSlug(p.body, p.feature.name), locale)}">${escapeHtml(p.feature.name)}</a>`,
    bodyLink(p.body, p.bodyConfig, locale),
    `<span lang="la">${escapeHtml(p.feature.type)}</span>`,
    escapeHtml(
      `${new Intl.NumberFormat(INTL_LOCALE[locale], { maximumFractionDigits: 1 }).format(p.feature.diameterKm)} km`
    ),
  ]);
  return {
    slug: PLACES_SLUG,
    locale,
    canonical: `${inputs.origin}${docPath(PLACES_SLUG, locale)}`,
    title: TEXT.indexTitle[locale],
    description: trimForMeta(
      fill(TEXT.indexDescription[locale], { count }),
      160
    ),
    updated: [inputs.gazetteerProvider.accessed, inputs.terms.retrieved]
      .sort()
      .at(-1)!,
    body:
      `      <p>${escapeHtml(
        fill(TEXT.indexIntro[locale], {
          share: format.format(100 * GREAT_PLACE_RATIO),
          count,
          bodies: format.format(withPlaces.size),
          date: longDay(inputs.gazetteerProvider.accessed, locale),
        })
      )}</p>\n` +
      (without.length
        ? `      <p>${escapeHtml(
            fill(TEXT.indexWithout[locale], {
              list: new Intl.ListFormat(INTL_LOCALE[locale], {
                type: 'conjunction',
              }).format(without),
            })
          )}</p>\n`
        : '') +
      `      ` +
      docTable(
        TEXT.tableCaption[locale],
        [
          TEXT.colPlace[locale],
          TEXT.colBody[locale],
          TEXT.type[locale],
          TEXT.diameter[locale],
        ],
        rows
      ),
  };
}

/** L'index puis une page par grand lieu, dans une langue. */
export function placePages(inputs: PlacePageInputs, locale: Locale): DocPage[] {
  const places = allGreatPlaces(inputs);
  return [
    indexPage(places, inputs, locale),
    ...places.map((p) => placePage(p, inputs, locale)),
  ];
}
