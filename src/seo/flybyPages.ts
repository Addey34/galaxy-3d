/**
 * PAGES DES SURVOLS (2026-10-12) : l'index `/flybys/` et une page par survol, dans les quatre
 * langues.
 *
 * `pnpm ephemeris:flybys` DÉTECTE les rencontres des sondes sur leur trajectoire vraie et les
 * mesure pour juger les segments ; `pnpm flybys:generate` mesure ensuite le point le plus proche
 * de chacune À LA SECONDE (`src/seo/flybyEvents.json`). Ces pages publient cette mesure, et rien
 * qui ne vienne d'elle.
 *
 * CE SONT DES DOCUMENTS (`documentPage.ts`), comme les pages des missions : aucun octet au
 * démarrage. La scène est à un lien, la page de la sonde ouverte à l'instant du passage en mode
 * Explo, celui qui garde les vraies distances.
 *
 * CE QUE LA PAGE AFFIRME :
 *   - la distance est comptée du CENTRE du corps, pas de sa surface, et la page le dit ;
 *   - un survol postérieur à la date de lecture de sa réponse est une PRÉDICTION, et la page le
 *     dit aussi, avec cette date ;
 *   - la solution de trajectoire qu'Horizons cite est publiée telle quelle, c'est ce qui permet
 *     de refaire la mesure.
 *
 * Module PUR : le relevé est lu par le greffon de build et passé en argument.
 */
import type { CelestialBodyConfig, CelestialConfig } from '@/types';
import { flattenBodies } from '@/config/catalog';
import { INTL_LOCALE, type Locale } from '@/i18n/locales';
import { bodyPagePath, escapeHtml, trimForMeta } from './bodyLandingPage';
import {
  docPath,
  docSection,
  docTable,
  FLYBYS_SLUG,
  formatExact,
  type DocPage,
  type DocText,
} from './documentPage';
import { longDay } from './instrumentLandingPage';

/** Un survol tel que `scripts/generate-flyby-events.mjs` l'écrit. */
export interface FlybyEvent {
  probe: string;
  body: string;
  /** Instant UTC du point le plus proche, à la seconde : `1989-08-25T03:55:40Z`. */
  closestAt: string;
  /** Distance au CENTRE du corps, km entiers. */
  closestKm: number;
  /** Vitesse relative au corps à cet instant, km/s au centième. */
  speedKmS: number;
  /** Solution de trajectoire qu'Horizons cite dans l'en-tête de sa réponse. */
  solution: string | null;
  /** Date de lecture de la réponse (`AAAA-MM-JJ`). */
  retrieved: string;
  /**
   * `centre` : Horizons sert le corps comme centre ; `difference` : il ne le sert pas (Lutetia),
   * et la position est la différence de deux vecteurs héliocentriques.
   */
  measuredFrom: 'centre' | 'difference';
}

type FlybyExclusion = 'departure' | 'edge' | 'bound' | 'phase' | 'unresolved';

export interface FlybyRecord {
  source: string;
  events: FlybyEvent[];
  excluded: { probe: string; body: string; reason: FlybyExclusion }[];
}

export interface FlybyPageInputs {
  record: FlybyRecord;
  config: CelestialConfig;
  navigable: ReadonlyMap<string, CelestialBodyConfig>;
  origin: string;
}

export const HORIZONS = {
  publisher: 'NASA/JPL Solar System Dynamics',
  title: 'Horizons System',
  url: 'https://ssd.jpl.nasa.gov/horizons/',
} as const;

const TEXT = {
  indexTitle: {
    en: 'Spacecraft flybys',
    fr: 'Les survols des sondes',
    es: 'Los sobrevuelos de las sondas',
    'pt-BR': 'Os sobrevoos das sondas',
  },
  indexDescription: {
    en: '{count} flybys of planets and small bodies by the spacecraft Galaxy follows, each closest approach measured to the second against NASA/JPL Horizons.',
    fr: '{count} survols de planètes et de petits corps par les sondes que Galaxy suit, chaque point le plus proche mesuré à la seconde contre Horizons de la NASA/JPL.',
    es: '{count} sobrevuelos de planetas y cuerpos menores por las sondas que Galaxy sigue, cada máxima aproximación medida al segundo con Horizons de la NASA/JPL.',
    'pt-BR':
      '{count} sobrevoos de planetas e corpos menores pelas sondas que a Galaxy acompanha, cada máxima aproximação medida ao segundo com o Horizons da NASA/JPL.',
  },
  indexIntro: {
    en: 'These flybys are detected on the true trajectory of each spacecraft Galaxy follows: a pass through the sphere of influence of a planet, or the Hill sphere of a small body. The closest approach of each is then measured at a one-second step, from the centre of the body. {excluded} other encounters have no page: a launch from Earth is not a flyby, an arrival that the published trajectory does not yet reach has no closest approach, and a spacecraft that stays near a body, in orbit or hovering, is not flying by it.',
    fr: 'Ces survols sont détectés sur la vraie trajectoire de chaque sonde que Galaxy suit : un passage dans la sphère d’influence d’une planète, ou dans la sphère de Hill d’un petit corps. Le point le plus proche de chacun est ensuite mesuré au pas d’une seconde, depuis le centre du corps. {excluded} autres rencontres n’ont pas de page : un lancement depuis la Terre n’est pas un survol, une arrivée que la trajectoire publiée n’atteint pas encore n’a pas de point le plus proche, et une sonde qui reste près d’un corps, en orbite ou en vol stationnaire, ne le survole pas.',
    es: 'Estos sobrevuelos se detectan en la trayectoria real de cada sonda que Galaxy sigue: un paso por la esfera de influencia de un planeta, o por la esfera de Hill de un cuerpo menor. La máxima aproximación de cada uno se mide luego con un paso de un segundo, desde el centro del cuerpo. Otros {excluded} encuentros no tienen página: un lanzamiento desde la Tierra no es un sobrevuelo, una llegada que la trayectoria publicada aún no alcanza no tiene máxima aproximación, y una sonda que permanece cerca de un cuerpo, en órbita o suspendida sobre él, no lo sobrevuela.',
    'pt-BR':
      'Estes sobrevoos são detectados na trajetória real de cada sonda que a Galaxy acompanha: uma passagem pela esfera de influência de um planeta, ou pela esfera de Hill de um corpo menor. A máxima aproximação de cada um é então medida com passo de um segundo, a partir do centro do corpo. Outros {excluded} encontros não têm página: um lançamento a partir da Terra não é um sobrevoo, uma chegada que a trajetória publicada ainda não alcança não tem máxima aproximação, e uma sonda que permanece perto de um corpo, em órbita ou pairando sobre ele, não o sobrevoa.',
  },
  tableCaption: {
    en: 'Flybys, by date',
    fr: 'Survols, par date',
    es: 'Sobrevuelos, por fecha',
    'pt-BR': 'Sobrevoos, por data',
  },
  colDate: { en: 'Date', fr: 'Date', es: 'Fecha', 'pt-BR': 'Data' },
  colProbe: {
    en: 'Spacecraft',
    fr: 'Sonde',
    es: 'Sonda',
    'pt-BR': 'Sonda',
  },
  colBody: { en: 'Body', fr: 'Corps', es: 'Cuerpo', 'pt-BR': 'Corpo' },
  colDistance: {
    en: 'Distance from centre (km)',
    fr: 'Distance au centre (km)',
    es: 'Distancia al centro (km)',
    'pt-BR': 'Distância ao centro (km)',
  },
  predictedMark: {
    en: 'prediction',
    fr: 'prédiction',
    es: 'predicción',
    'pt-BR': 'previsão',
  },
  pageTitle: {
    en: '{probe} flyby of {body}, {date}',
    fr: 'Survol de {body} par {probe}, {date}',
    es: 'Sobrevuelo de {body} por {probe}, {date}',
    'pt-BR': 'Sobrevoo de {body} por {probe}, {date}',
  },
  pageDescription: {
    en: '{probe} passed {distance} km from the centre of {body} on {date}: closest approach measured to the second against NASA/JPL Horizons, and the scene to open at that instant.',
    fr: '{probe} est passée à {distance} km du centre de {body} le {date} : point le plus proche mesuré à la seconde contre Horizons de la NASA/JPL, et la scène à ouvrir à cet instant.',
    es: '{probe} pasó a {distance} km del centro de {body} el {date}: máxima aproximación medida al segundo con Horizons de la NASA/JPL, y la escena para abrir en ese instante.',
    'pt-BR':
      '{probe} passou a {distance} km do centro de {body} em {date}: máxima aproximação medida ao segundo com o Horizons da NASA/JPL, e a cena para abrir nesse instante.',
  },
  predictedDescription: {
    en: '{probe} is predicted to pass {distance} km from the centre of {body} on {date}: closest approach computed to the second from the NASA/JPL Horizons trajectory.',
    fr: '{probe} doit passer à {distance} km du centre de {body} le {date} : point le plus proche calculé à la seconde sur la trajectoire prédite par Horizons de la NASA/JPL.',
    es: 'Se prevé que {probe} pase a {distance} km del centro de {body} el {date}: máxima aproximación calculada al segundo sobre la trayectoria prevista por Horizons de la NASA/JPL.',
    'pt-BR':
      'Prevê-se que {probe} passe a {distance} km do centro de {body} em {date}: máxima aproximação calculada ao segundo sobre a trajetória prevista pelo Horizons da NASA/JPL.',
  },
  sectionClosest: {
    en: 'Closest approach',
    fr: 'Au plus près',
    es: 'Máxima aproximación',
    'pt-BR': 'Máxima aproximação',
  },
  instant: {
    en: 'Instant (UTC)',
    fr: 'Instant (UTC)',
    es: 'Instante (UTC)',
    'pt-BR': 'Instante (UTC)',
  },
  distance: {
    en: 'Distance from the centre of {body}',
    fr: 'Distance au centre de {body}',
    es: 'Distancia al centro de {body}',
    'pt-BR': 'Distância ao centro de {body}',
  },
  speed: {
    en: 'Speed relative to {body}',
    fr: 'Vitesse par rapport à {body}',
    es: 'Velocidad respecto a {body}',
    'pt-BR': 'Velocidade em relação a {body}',
  },
  centreNote: {
    en: 'The distance is counted from the centre of the body, not from its surface.',
    fr: 'La distance est comptée depuis le centre du corps, pas depuis sa surface.',
    es: 'La distancia se cuenta desde el centro del cuerpo, no desde su superficie.',
    'pt-BR':
      'A distância é contada a partir do centro do corpo, não da sua superfície.',
  },
  predictedNote: {
    en: 'When this trajectory was read, on {date}, this flyby had not happened yet: it is a prediction, which every manoeuvre of the spacecraft can revise.',
    fr: 'Quand cette trajectoire a été lue, le {date}, ce survol n’avait pas encore eu lieu : c’est une prédiction, que chaque manœuvre de la sonde peut réviser.',
    es: 'Cuando se leyó esta trayectoria, el {date}, este sobrevuelo aún no había ocurrido: es una predicción, que cada maniobra de la sonda puede revisar.',
    'pt-BR':
      'Quando esta trajetória foi lida, em {date}, este sobrevoo ainda não havia ocorrido: é uma previsão, que cada manobra da sonda pode revisar.',
  },
  sectionInGalaxy: {
    en: 'In Galaxy',
    fr: 'Dans Galaxy',
    es: 'En Galaxy',
    'pt-BR': 'Na Galaxy',
  },
  openScene: {
    en: 'Open {probe} at this instant, at true scale',
    fr: 'Ouvrir {probe} à cet instant, à l’échelle réelle',
    es: 'Abrir {probe} en este instante, a escala real',
    'pt-BR': 'Abrir {probe} neste instante, em escala real',
  },
  pagesLead: {
    en: 'Pages of the spacecraft and of the body:',
    fr: 'Pages de la sonde et du corps :',
    es: 'Páginas de la sonda y del cuerpo:',
    'pt-BR': 'Páginas da sonda e do corpo:',
  },
  sectionMethod: {
    en: 'How it is measured',
    fr: 'Comment c’est mesuré',
    es: 'Cómo se mide',
    'pt-BR': 'Como é medido',
  },
  methodText: {
    en: 'The position of the spacecraft relative to the body is read from Horizons every minute for six hours around the approach, then every second for three minutes around the nearest minute. The closest of those positions is the one published here.',
    fr: 'La position de la sonde par rapport au corps est lue dans Horizons chaque minute pendant six heures de part et d’autre du passage, puis chaque seconde pendant trois minutes autour de la minute la plus proche. La plus proche de ces positions est celle publiée ici.',
    es: 'La posición de la sonda respecto al cuerpo se lee en Horizons cada minuto durante seis horas a cada lado del paso, y luego cada segundo durante tres minutos alrededor del minuto más cercano. La más cercana de esas posiciones es la que se publica aquí.',
    'pt-BR':
      'A posição da sonda em relação ao corpo é lida no Horizons a cada minuto durante seis horas de cada lado da passagem, e depois a cada segundo durante três minutos em torno do minuto mais próximo. A mais próxima dessas posições é a publicada aqui.',
  },
  differenceText: {
    en: 'Horizons does not serve this body as a centre: the position is the difference of the two positions it serves relative to the Sun.',
    fr: 'Horizons ne sert pas ce corps comme centre : la position est la différence des deux positions qu’il sert par rapport au Soleil.',
    es: 'Horizons no sirve este cuerpo como centro: la posición es la diferencia de las dos posiciones que sirve respecto al Sol.',
    'pt-BR':
      'O Horizons não serve este corpo como centro: a posição é a diferença das duas posições que ele serve em relação ao Sol.',
  },
  sectionSource: {
    en: 'Source',
    fr: 'Source',
    es: 'Fuente',
    'pt-BR': 'Fonte',
  },
  solution: {
    en: 'Trajectory solution cited by Horizons:',
    fr: 'Solution de trajectoire citée par Horizons :',
    es: 'Solución de trayectoria citada por Horizons:',
    'pt-BR': 'Solução de trajetória citada pelo Horizons:',
  },
  read: {
    en: 'Read on {date}.',
    fr: 'Lue le {date}.',
    es: 'Leída el {date}.',
    'pt-BR': 'Lida em {date}.',
  },
  sectionFlybys: {
    en: 'Flybys',
    fr: 'Survols',
    es: 'Sobrevuelos',
    'pt-BR': 'Sobrevoos',
  },
  /** « date : nom » ; le français met une espace avant les deux-points, pas les autres. */
  listItem: {
    en: '{date}: {name}',
    fr: '{date} : {name}',
    es: '{date}: {name}',
    'pt-BR': '{date}: {name}',
  },
  allFlybys: {
    en: 'All flybys',
    fr: 'Tous les survols',
    es: 'Todos los sobrevuelos',
    'pt-BR': 'Todos os sobrevoos',
  },
} as const satisfies Record<string, DocText>;

export const fill = (
  text: string,
  values: Readonly<Record<string, string | number>>
): string =>
  text.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match
  );

/** Le chemin d'une page de survol sans la langue : `flybys/voyager2-neptune-1989-08-25`. */
export const flybySlug = (
  event: Pick<FlybyEvent, 'probe' | 'body' | 'closestAt'>
): string =>
  `${FLYBYS_SLUG}/${event.probe}-${event.body}-${event.closestAt.slice(0, 10)}`;

/** Un survol est une prédiction quand il suit la date à laquelle sa trajectoire a été lue. */
export const isPredicted = (
  event: Pick<FlybyEvent, 'closestAt' | 'retrieved'>
): boolean => event.closestAt.slice(0, 10) > event.retrieved;

/**
 * Le lien qui ouvre la scène : la page de la sonde (son chemin la sélectionne), à l'instant du
 * passage, en Explo. La date est celle du permalien (`formatPermalinkDate`, à la seconde).
 */
export function flybySceneHref(event: FlybyEvent, locale: Locale): string {
  return `/${bodyPagePath(event.probe, locale)}/?mode=explo&date=${event.closestAt}`;
}

/** Le nom d'un corps ou d'une sonde dans une langue ; partagé avec `orbitInsertionPages.ts`. */
export function names(inputs: Pick<FlybyPageInputs, 'config' | 'navigable'>) {
  const named = new Map<string, CelestialBodyConfig>([
    ...flattenBodies(inputs.config),
    ...inputs.navigable,
  ]);
  return (id: string, locale: Locale): string => {
    const cfg = named.get(id);
    if (!cfg) throw new Error(`objet inconnu du catalogue : ${id}`);
    return cfg.displayName?.[locale] ?? cfg.displayName?.en ?? id;
  };
}

/** `03:55:40 UTC` : l'heure de l'instant publié, à la seconde, sans conversion. */
export const clock = (iso: string): string => `${iso.slice(11, 19)} UTC`;

/** Les km entiers, groupés comme la langue les groupe. */
export const km = (value: number, locale: Locale): string =>
  new Intl.NumberFormat(INTL_LOCALE[locale], {
    maximumFractionDigits: 0,
  }).format(value);

const kmPerSecond = (value: number, locale: Locale): string =>
  `${formatExact(value, locale)} km/s`;

function flybyPage(
  event: FlybyEvent,
  inputs: FlybyPageInputs,
  locale: Locale
): DocPage {
  const name = names(inputs);
  const probe = name(event.probe, locale);
  const body = name(event.body, locale);
  const day = longDay(event.closestAt.slice(0, 10), locale);
  const distance = km(event.closestKm, locale);
  const predicted = isPredicted(event);
  const slug = flybySlug(event);
  const link = (id: string, label: string): string =>
    `<a href="/${bodyPagePath(id, locale)}/">${escapeHtml(label)}</a>`;

  const closest =
    `<dl><dt>${escapeHtml(TEXT.instant[locale])}</dt><dd>${escapeHtml(`${day}, ${clock(event.closestAt)}`)}</dd>` +
    `<dt>${escapeHtml(fill(TEXT.distance[locale], { body }))}</dt><dd>${escapeHtml(distance)} km</dd>` +
    `<dt>${escapeHtml(fill(TEXT.speed[locale], { body }))}</dt><dd>${escapeHtml(kmPerSecond(event.speedKmS, locale))}</dd></dl>` +
    `<p>${escapeHtml(TEXT.centreNote[locale])}</p>` +
    (predicted
      ? `<p><strong>${escapeHtml(fill(TEXT.predictedNote[locale], { date: longDay(event.retrieved, locale) }))}</strong></p>`
      : '');

  const inGalaxy =
    `<p><a href="${escapeHtml(flybySceneHref(event, locale))}">${escapeHtml(fill(TEXT.openScene[locale], { probe }))}</a></p>` +
    `<p>${escapeHtml(TEXT.pagesLead[locale])}</p><ul><li>${link(event.probe, probe)}</li><li>${link(event.body, body)}</li></ul>`;

  const method =
    `<p>${escapeHtml(TEXT.methodText[locale])}</p>` +
    (event.measuredFrom === 'centre'
      ? ''
      : `<p>${escapeHtml(TEXT.differenceText[locale])}</p>`);

  const source =
    `<p>${escapeHtml(HORIZONS.publisher)}, <a href="${escapeHtml(HORIZONS.url)}" rel="noopener noreferrer">${escapeHtml(HORIZONS.title)}</a>. ` +
    `${escapeHtml(fill(TEXT.read[locale], { date: longDay(event.retrieved, locale) }))}</p>` +
    (event.solution
      ? `<p>${escapeHtml(TEXT.solution[locale])} <code>${escapeHtml(event.solution)}</code></p>`
      : '') +
    `<p><a href="${docPath(FLYBYS_SLUG, locale)}">${escapeHtml(TEXT.allFlybys[locale])}</a></p>`;

  return {
    slug,
    locale,
    canonical: `${inputs.origin}${docPath(slug, locale)}`,
    title: fill(TEXT.pageTitle[locale], { probe, body, date: day }),
    description: trimForMeta(
      fill(
        (predicted ? TEXT.predictedDescription : TEXT.pageDescription)[locale],
        {
          probe,
          body,
          date: day,
          distance,
        }
      ),
      160
    ),
    updated: event.retrieved,
    body: [
      docSection('closest', TEXT.sectionClosest[locale], closest),
      docSection('in-galaxy', TEXT.sectionInGalaxy[locale], inGalaxy),
      docSection('method', TEXT.sectionMethod[locale], method),
      docSection('source', TEXT.sectionSource[locale], source),
    ].join('\n'),
  };
}

function indexPage(inputs: FlybyPageInputs, locale: Locale): DocPage {
  const { record, origin } = inputs;
  const name = names(inputs);
  const format = new Intl.NumberFormat(INTL_LOCALE[locale]);
  const rows = record.events.map((event) => [
    `<a href="${docPath(flybySlug(event), locale)}">${escapeHtml(longDay(event.closestAt.slice(0, 10), locale))}</a>` +
      (isPredicted(event)
        ? ` (${escapeHtml(TEXT.predictedMark[locale])})`
        : ''),
    escapeHtml(name(event.probe, locale)),
    escapeHtml(name(event.body, locale)),
    escapeHtml(km(event.closestKm, locale)),
  ]);
  return {
    slug: FLYBYS_SLUG,
    locale,
    canonical: `${origin}${docPath(FLYBYS_SLUG, locale)}`,
    title: TEXT.indexTitle[locale],
    description: fill(TEXT.indexDescription[locale], {
      count: format.format(record.events.length),
    }),
    updated: latestRead(record),
    body:
      `      <p>${escapeHtml(
        fill(TEXT.indexIntro[locale], {
          excluded: format.format(record.excluded.length),
        })
      )}</p>\n      ` +
      docTable(
        TEXT.tableCaption[locale],
        [
          TEXT.colDate[locale],
          TEXT.colProbe[locale],
          TEXT.colBody[locale],
          TEXT.colDistance[locale],
        ],
        rows,
        3
      ),
  };
}

const latestRead = (record: FlybyRecord): string =>
  record.events
    .map((e) => e.retrieved)
    .sort()
    .at(-1)!;

/**
 * Le relevé, vérifié avant d'en tirer une page : ordre chronologique, chemins uniques, dates à
 * la seconde. Un relevé écrit à la main ou abîmé fait échouer le build plutôt que de publier.
 */
export function checkFlybyRecord(record: FlybyRecord): FlybyRecord {
  const slugs = new Set<string>();
  let previous = '';
  for (const event of record.events) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(event.closestAt))
      throw new Error(`survol daté hors format : ${event.closestAt}`);
    if (event.closestAt < previous)
      throw new Error(
        `survols hors d'ordre : ${event.closestAt} après ${previous}`
      );
    previous = event.closestAt;
    const slug = flybySlug(event);
    if (slugs.has(slug))
      throw new Error(`deux survols au même chemin : ${slug}`);
    slugs.add(slug);
    if (event.measuredFrom !== 'centre' && event.measuredFrom !== 'difference')
      throw new Error(`survol sans méthode de mesure : ${slug}`);
    if (!(event.closestKm > 0) || !(event.speedKmS > 0))
      throw new Error(`survol sans distance ou sans vitesse : ${slug}`);
  }
  return record;
}

/** L'index puis une page par survol, dans une langue. */
export function flybyPages(inputs: FlybyPageInputs, locale: Locale): DocPage[] {
  checkFlybyRecord(inputs.record);
  return [
    indexPage(inputs, locale),
    ...inputs.record.events.map((e) => flybyPage(e, inputs, locale)),
  ];
}

/**
 * Pour chaque sonde et chaque corps, le fragment HTML de ses survols, dans une langue : ce que
 * leurs pages (`bodyLandingPage.ts`, `instrumentLandingPage.ts`) ajoutent sous leurs missions.
 * Dérivé du MÊME relevé que les pages, donc un lien ne peut pas viser une page absente. Rendu
 * ici et passé tout fait : ces deux modules ne peuvent pas importer celui-ci, qui les importe.
 */
export function flybyListsByObject(
  inputs: FlybyPageInputs,
  locale: Locale
): Map<string, string> {
  const name = names(inputs);
  const items = new Map<string, string[]>();
  for (const event of checkFlybyRecord(inputs.record).events) {
    const day = longDay(event.closestAt.slice(0, 10), locale);
    const href = docPath(flybySlug(event), locale);
    for (const [id, other] of [
      [event.probe, event.body],
      [event.body, event.probe],
    ] as const) {
      const label = fill(TEXT.listItem[locale], {
        date: day,
        name: name(other, locale),
      });
      if (!items.has(id)) items.set(id, []);
      items
        .get(id)!
        .push(
          `<li><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></li>`
        );
    }
  }
  return new Map(
    [...items].map(([id, list]) => [
      id,
      `<h2>${escapeHtml(TEXT.sectionFlybys[locale])}</h2><ul>${list.join('')}</ul>`,
    ])
  );
}
