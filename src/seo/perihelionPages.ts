/**
 * PAGES DES PÉRIHÉLIES (lot 69, 2026-10-22) : l'index `/perihelia/` et une page par périhélie de
 * Parker Solar Probe ou de Solar Orbiter, dans les quatre langues.
 *
 * `pnpm perihelia:generate` lit chaque minimum local de la distance de la sonde au centre du
 * Soleil sur la trajectoire que sert Horizons, à l'heure puis à la minute puis à la seconde
 * (`src/seo/perihelia.json`). Ces pages publient cette mesure et rien qui ne vienne d'elle : pas de
 * « record » proclamé, que la trajectoire ne dit pas (la NASA parle d'un record ÉGALÉ à chaque
 * passage depuis le 2024-12-24, alors que les distances diffèrent de quelques centaines de km),
 * pas de numéro de périhélie de la mission, dont la source de Galaxy ne donne pas la convention.
 *
 * CE QUE LA PAGE AFFIRME :
 *   - l'instant, la distance au CENTRE du Soleil, l'altitude au-dessus du rayon nominal que la fiche
 *     du Soleil publie (le Soleil n'a pas de surface solide), la vitesse par rapport au Soleil ;
 *   - le rang dans la série mesurée, EN DISANT que ce n'est pas la numérotation de la mission ;
 *   - le périhélie précédent et le suivant de la même sonde, avec leur écart signé ;
 *   - une prédiction, comme les survols, quand l'instant suit la date de lecture.
 *
 * Les helpers de nom, de nombre et d'heure sont ceux des survols (`flybyPages.ts`), importés et
 * non recopiés. Module PUR : le relevé est lu par le greffon de build et passé en argument.
 */
import type { CelestialBodyConfig, CelestialConfig } from '@/types';
import { INTL_LOCALE, type Locale } from '@/i18n/locales';
import { bodyPagePath, escapeHtml, trimForMeta } from './bodyLandingPage';
import {
  docPath,
  docSection,
  docTable,
  PERIHELIA_SLUG,
  type DocPage,
  type DocText,
} from './documentPage';
import { clock, fill, HORIZONS, km, names } from './flybyPages';
import { longDay } from './instrumentLandingPage';

/** Un périhélie tel que `scripts/generate-perihelia.mjs` l'écrit. */
export interface Perihelion {
  probe: string;
  /** Instant UTC du minimum de la distance au centre du Soleil, à la seconde. */
  at: string;
  /** Distance au CENTRE du Soleil, km au mètre. */
  distanceKm: number;
  /** Distance moins le rayon du Soleil de la fiche, km au mètre. */
  altitudeKm: number;
  /** Vitesse par rapport au Soleil, km/s au mm/s. */
  speedKmS: number;
  solution: string | null;
  retrieved: string;
}

export interface PerihelionRecord {
  source: string;
  sunRadiusKm: number;
  /** Demi-fenêtre, en jours, où un minimum est le plus petit : celle du générateur. */
  halfWindowDays: number;
  bounds: { probe: string; from: string; to: string; retrieved: string }[];
  perihelia: Perihelion[];
}

export interface PerihelionPageInputs {
  record: PerihelionRecord;
  config: CelestialConfig;
  navigable: ReadonlyMap<string, CelestialBodyConfig>;
  origin: string;
}

const TEXT = {
  indexTitle: {
    en: 'Perihelia of Parker Solar Probe and Solar Orbiter',
    fr: 'Les périhélies de Parker Solar Probe et de Solar Orbiter',
    es: 'Los perihelios de Parker Solar Probe y de Solar Orbiter',
    'pt-BR': 'Os periélios da Parker Solar Probe e da Solar Orbiter',
  },
  indexDescription: {
    en: '{count} closest passes of two probes to the Sun, each instant measured to the second on its NASA/JPL Horizons trajectory.',
    fr: '{count} passages au plus près du Soleil de deux sondes, chaque instant mesuré à la seconde sur sa trajectoire Horizons de la NASA/JPL.',
    es: '{count} pasos más cercanos al Sol de dos sondas, cada instante medido al segundo sobre su trayectoria Horizons de la NASA/JPL.',
    'pt-BR':
      '{count} passagens mais próximas do Sol de duas sondas, cada instante medido ao segundo sobre sua trajetória Horizons da NASA/JPL.',
  },
  indexIntro: {
    en: 'The perihelion of a probe is the point of its orbit closest to the Sun. Here it is measured on the true trajectory of each probe Galaxy follows: the minimum of its distance to the centre of the Sun, read every hour, then every minute and every second around it. The Sun has no solid surface; the altitude shown is the distance to its centre minus the nominal radius Galaxy displays for it.',
    fr: 'Le périhélie d’une sonde est le point de son orbite le plus proche du Soleil. Il est mesuré ici sur la vraie trajectoire de chaque sonde que Galaxy suit : le minimum de sa distance au centre du Soleil, lue chaque heure, puis chaque minute et chaque seconde autour de lui. Le Soleil n’a pas de surface solide ; l’altitude affichée est la distance à son centre moins le rayon nominal que Galaxy affiche pour lui.',
    es: 'El perihelio de una sonda es el punto de su órbita más cercano al Sol. Aquí se mide sobre la trayectoria real de cada sonda que Galaxy sigue: el mínimo de su distancia al centro del Sol, leída cada hora, y luego cada minuto y cada segundo a su alrededor. El Sol no tiene superficie sólida; la altitud mostrada es la distancia a su centro menos el radio nominal que Galaxy muestra para él.',
    'pt-BR':
      'O periélio de uma sonda é o ponto de sua órbita mais próximo do Sol. Aqui ele é medido sobre a trajetória real de cada sonda que a Galaxy acompanha: o mínimo de sua distância ao centro do Sol, lida a cada hora, e depois a cada minuto e a cada segundo em torno dele. O Sol não tem superfície sólida; a altitude mostrada é a distância ao seu centro menos o raio nominal que a Galaxy exibe para ele.',
  },
  indexExtremes: {
    en: 'The closest measured pass is {probe}, on {date}, {altitude} km above the nominal radius of the Sun; the fastest is {fastProbe}, on {fastDate}, at {speed} km/s.',
    fr: 'Le passage mesuré le plus proche est celui de {probe}, le {date}, à {altitude} km au-dessus du rayon nominal du Soleil ; le plus rapide est celui de {fastProbe}, le {fastDate}, à {speed} km/s.',
    es: 'El paso medido más cercano es el de {probe}, el {date}, a {altitude} km sobre el radio nominal del Sol; el más rápido es el de {fastProbe}, el {fastDate}, a {speed} km/s.',
    'pt-BR':
      'A passagem medida mais próxima é a de {probe}, em {date}, a {altitude} km acima do raio nominal do Sol; a mais rápida é a de {fastProbe}, em {fastDate}, a {speed} km/s.',
  },
  indexExtremesSame: {
    en: 'The closest measured pass is also the fastest: {probe}, on {date}, {altitude} km above the nominal radius of the Sun, at {speed} km/s.',
    fr: 'Le passage mesuré le plus proche est aussi le plus rapide : {probe}, le {date}, à {altitude} km au-dessus du rayon nominal du Soleil, à {speed} km/s.',
    es: 'El paso medido más cercano es también el más rápido: {probe}, el {date}, a {altitude} km sobre el radio nominal del Sol, a {speed} km/s.',
    'pt-BR':
      'A passagem medida mais próxima é também a mais rápida: {probe}, em {date}, a {altitude} km acima do raio nominal do Sol, a {speed} km/s.',
  },
  indexNumbering: {
    en: 'The numbers in this series count the minima of the trajectory Horizons serves, from the first one; they are not necessarily the numbering the missions use.',
    fr: 'Les numéros de cette série comptent les minima de la trajectoire que sert Horizons, à partir du premier ; ce ne sont pas forcément ceux que les missions emploient.',
    es: 'Los números de esta serie cuentan los mínimos de la trayectoria que sirve Horizons, desde el primero; no son necesariamente los que usan las misiones.',
    'pt-BR':
      'Os números desta série contam os mínimos da trajetória que o Horizons serve, a partir do primeiro; não são necessariamente os que as missões usam.',
  },
  tableCaption: {
    en: 'Perihelia, by date',
    fr: 'Périhélies, par date',
    es: 'Perihelios, por fecha',
    'pt-BR': 'Periélios, por data',
  },
  colDate: { en: 'Date', fr: 'Date', es: 'Fecha', 'pt-BR': 'Data' },
  colProbe: { en: 'Spacecraft', fr: 'Sonde', es: 'Sonda', 'pt-BR': 'Sonda' },
  colAltitude: {
    en: 'Altitude (km)',
    fr: 'Altitude (km)',
    es: 'Altitud (km)',
    'pt-BR': 'Altitude (km)',
  },
  predictedMark: {
    en: 'prediction',
    fr: 'prédiction',
    es: 'predicción',
    'pt-BR': 'previsão',
  },
  pageTitle: {
    en: '{probe} at perihelion, {date}',
    fr: '{probe} au périhélie, {date}',
    es: '{probe} en el perihelio, {date}',
    'pt-BR': '{probe} no periélio, {date}',
  },
  pageDescription: {
    en: '{probe} passed {altitude} km above the nominal radius of the Sun on {date}, at {speed} km/s: instant measured to the second on the NASA/JPL Horizons trajectory, and the scene to open at that instant.',
    fr: '{probe} est passée à {altitude} km au-dessus du rayon nominal du Soleil le {date}, à {speed} km/s : instant mesuré à la seconde sur la trajectoire Horizons de la NASA/JPL, et la scène à ouvrir à cet instant.',
    es: '{probe} pasó a {altitude} km sobre el radio nominal del Sol el {date}, a {speed} km/s: instante medido al segundo sobre la trayectoria Horizons de la NASA/JPL, y la escena para abrir en ese instante.',
    'pt-BR':
      '{probe} passou a {altitude} km acima do raio nominal do Sol em {date}, a {speed} km/s: instante medido ao segundo sobre a trajetória Horizons da NASA/JPL, e a cena para abrir nesse instante.',
  },
  predictedDescription: {
    en: '{probe} is predicted to pass {altitude} km above the nominal radius of the Sun on {date}, at {speed} km/s: instant computed to the second on the trajectory predicted by NASA/JPL Horizons.',
    fr: '{probe} doit passer à {altitude} km au-dessus du rayon nominal du Soleil le {date}, à {speed} km/s : instant calculé à la seconde sur la trajectoire prédite par Horizons de la NASA/JPL.',
    es: 'Se prevé que {probe} pase a {altitude} km sobre el radio nominal del Sol el {date}, a {speed} km/s: instante calculado al segundo sobre la trayectoria prevista por Horizons de la NASA/JPL.',
    'pt-BR':
      'Prevê-se que {probe} passe a {altitude} km acima do raio nominal do Sol em {date}, a {speed} km/s: instante calculado ao segundo sobre a trajetória prevista pelo Horizons da NASA/JPL.',
  },
  sectionInstant: {
    en: 'The instant',
    fr: 'L’instant',
    es: 'El instante',
    'pt-BR': 'O instante',
  },
  instant: {
    en: 'Instant (UTC)',
    fr: 'Instant (UTC)',
    es: 'Instante (UTC)',
    'pt-BR': 'Instante (UTC)',
  },
  distance: {
    en: 'Distance from the centre of the Sun',
    fr: 'Distance au centre du Soleil',
    es: 'Distancia al centro del Sol',
    'pt-BR': 'Distância ao centro do Sol',
  },
  altitude: {
    en: 'Altitude above the nominal radius',
    fr: 'Altitude au-dessus du rayon nominal',
    es: 'Altitud sobre el radio nominal',
    'pt-BR': 'Altitude acima do raio nominal',
  },
  speed: {
    en: 'Speed relative to the Sun',
    fr: 'Vitesse par rapport au Soleil',
    es: 'Velocidad respecto al Sol',
    'pt-BR': 'Velocidade em relação ao Sol',
  },
  rank: {
    en: 'Perihelion no. {rank} of {count} in the series read for {probe}',
    fr: 'Périhélie n° {rank} sur {count} de la série lue pour {probe}',
    es: 'Perihelio n.º {rank} de {count} de la serie leída para {probe}',
    'pt-BR': 'Periélio n.º {rank} de {count} da série lida para {probe}',
  },
  meaning: {
    en: 'This is the instant at which the distance between {probe} and the centre of the Sun is smallest on this stretch of its orbit. The Sun has no solid surface: the altitude is that distance minus the nominal radius of {radius} km.',
    fr: 'C’est l’instant où la distance entre {probe} et le centre du Soleil est la plus petite sur ce tronçon de son orbite. Le Soleil n’a pas de surface solide : l’altitude est cette distance moins le rayon nominal de {radius} km.',
    es: 'Es el instante en que la distancia entre {probe} y el centro del Sol es la más pequeña en este tramo de su órbita. El Sol no tiene superficie sólida: la altitud es esa distancia menos el radio nominal de {radius} km.',
    'pt-BR':
      'É o instante em que a distância entre {probe} e o centro do Sol é a menor neste trecho de sua órbita. O Sol não tem superfície sólida: a altitude é essa distância menos o raio nominal de {radius} km.',
  },
  predictedNote: {
    en: 'When this trajectory was read, on {date}, this had not happened yet: it is a prediction, which every manoeuvre of the spacecraft can revise.',
    fr: 'Quand cette trajectoire a été lue, le {date}, cela n’avait pas encore eu lieu : c’est une prédiction, que chaque manœuvre de la sonde peut réviser.',
    es: 'Cuando se leyó esta trayectoria, el {date}, esto aún no había ocurrido: es una predicción, que cada maniobra de la sonda puede revisar.',
    'pt-BR':
      'Quando esta trajetória foi lida, em {date}, isto ainda não havia ocorrido: é uma previsão, que cada manobra da sonda pode revisar.',
  },
  sectionNeighbours: {
    en: 'Before and after',
    fr: 'Avant et après',
    es: 'Antes y después',
    'pt-BR': 'Antes e depois',
  },
  previous: {
    en: 'Previous perihelion',
    fr: 'Périhélie précédent',
    es: 'Perihelio anterior',
    'pt-BR': 'Periélio anterior',
  },
  next: {
    en: 'Next perihelion',
    fr: 'Périhélie suivant',
    es: 'Perihelio siguiente',
    'pt-BR': 'Próximo periélio',
  },
  neighbour: {
    en: '{date}, {distance} km from the centre ({difference} km compared with this one)',
    fr: '{date}, à {distance} km du centre ({difference} km par rapport à celui-ci)',
    es: '{date}, a {distance} km del centro ({difference} km respecto a este)',
    'pt-BR':
      '{date}, a {distance} km do centro ({difference} km em relação a este)',
  },
  noPrevious: {
    en: 'This is the first minimum of the trajectory Horizons serves for this probe.',
    fr: 'C’est le premier minimum de la trajectoire que sert Horizons pour cette sonde.',
    es: 'Es el primer mínimo de la trayectoria que sirve Horizons para esta sonda.',
    'pt-BR':
      'É o primeiro mínimo da trajetória que o Horizons serve para esta sonda.',
  },
  noNext: {
    en: 'This is the last minimum of the window read for this probe.',
    fr: 'C’est le dernier minimum de la fenêtre lue pour cette sonde.',
    es: 'Es el último mínimo de la ventana leída para esta sonda.',
    'pt-BR': 'É o último mínimo da janela lida para esta sonda.',
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
    en: 'Pages of the spacecraft and of the Sun:',
    fr: 'Pages de la sonde et du Soleil :',
    es: 'Páginas de la sonda y del Sol:',
    'pt-BR': 'Páginas da sonda e do Sol:',
  },
  sectionMethod: {
    en: 'How it is measured',
    fr: 'Comment c’est mesuré',
    es: 'Cómo se mide',
    'pt-BR': 'Como é medido',
  },
  methodText: {
    en: 'The position of the spacecraft relative to the centre of the Sun is read from Horizons every hour across the window of its published trajectory; a local minimum is the smallest distance within {days} days on either side. Around each one the position is read again every minute, then every second, and the smallest distance is kept. The rank counts these minima from the first one of the window, so it is not necessarily the numbering of the mission. A minimum at the edge of the window is not listed, since the trajectory does not show that it rises again.',
    fr: 'La position de la sonde par rapport au centre du Soleil est lue dans Horizons chaque heure sur la fenêtre de sa trajectoire publiée ; un minimum local est la plus petite distance à {days} jours de part et d’autre. Autour de chacun, la position est relue chaque minute, puis chaque seconde, et la plus petite distance est retenue. Le rang compte ces minima à partir du premier de la fenêtre, ce n’est donc pas forcément la numérotation de la mission. Un minimum au bord de la fenêtre n’est pas listé, puisque la trajectoire ne montre pas qu’elle remonte.',
    es: 'La posición de la sonda respecto al centro del Sol se lee en Horizons cada hora sobre la ventana de su trayectoria publicada; un mínimo local es la menor distancia en {days} días a cada lado. Alrededor de cada uno, la posición se vuelve a leer cada minuto, y luego cada segundo, y se conserva la menor distancia. El rango cuenta estos mínimos desde el primero de la ventana, por lo que no es necesariamente la numeración de la misión. Un mínimo en el borde de la ventana no se lista, ya que la trayectoria no muestra que vuelva a subir.',
    'pt-BR':
      'A posição da sonda em relação ao centro do Sol é lida no Horizons a cada hora sobre a janela de sua trajetória publicada; um mínimo local é a menor distância em {days} dias de cada lado. Em torno de cada um, a posição é relida a cada minuto, e depois a cada segundo, e a menor distância é mantida. A posição na série conta esses mínimos a partir do primeiro da janela, portanto não é necessariamente a numeração da missão. Um mínimo na borda da janela não é listado, pois a trajetória não mostra que ela volta a subir.',
  },
  sectionSource: { en: 'Source', fr: 'Source', es: 'Fuente', 'pt-BR': 'Fonte' },
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
  sectionList: {
    en: 'Perihelia',
    fr: 'Périhélies',
    es: 'Perihelios',
    'pt-BR': 'Periélios',
  },
  listItem: {
    en: '{date}: {name}',
    fr: '{date} : {name}',
    es: '{date}: {name}',
    'pt-BR': '{date}: {name}',
  },
  all: {
    en: 'All perihelia',
    fr: 'Tous les périhélies',
    es: 'Todos los perihelios',
    'pt-BR': 'Todos os periélios',
  },
} as const satisfies Record<string, DocText>;

/** Le chemin d'une page sans la langue : `perihelia/parker-solar-probe-2024-12-24`. */
export const perihelionSlug = (
  perihelion: Pick<Perihelion, 'probe' | 'at'>
): string =>
  `${PERIHELIA_SLUG}/${perihelion.probe}-${perihelion.at.slice(0, 10)}`;

/** Un périhélie est une prédiction quand il suit la date à laquelle sa trajectoire a été lue. */
const isPredicted = (
  perihelion: Pick<Perihelion, 'at' | 'retrieved'>
): boolean => perihelion.at.slice(0, 10) > perihelion.retrieved;

/** La page de la sonde à l'instant mesuré, en Explo (même forme que les survols). */
export function perihelionSceneHref(
  perihelion: Perihelion,
  locale: Locale
): string {
  return `/${bodyPagePath(perihelion.probe, locale)}/?mode=explo&date=${perihelion.at}`;
}

const speedKmS = (value: number, locale: Locale): string =>
  new Intl.NumberFormat(INTL_LOCALE[locale], {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

/** Un écart signé en km, le signe moins typographique de la langue, zéro sans signe. */
const signedKm = (value: number, locale: Locale): string =>
  new Intl.NumberFormat(INTL_LOCALE[locale], {
    maximumFractionDigits: 0,
    signDisplay: 'exceptZero',
  }).format(value);

/** Les périhélies d'une sonde, dans l'ordre du temps. */
const seriesOf = (record: PerihelionRecord, probe: string): Perihelion[] =>
  record.perihelia.filter((p) => p.probe === probe);

function perihelionPage(
  perihelion: Perihelion,
  inputs: PerihelionPageInputs,
  locale: Locale
): DocPage {
  const { record } = inputs;
  const name = names(inputs);
  const probe = name(perihelion.probe, locale);
  const day = longDay(perihelion.at.slice(0, 10), locale);
  const predicted = isPredicted(perihelion);
  const slug = perihelionSlug(perihelion);
  const series = seriesOf(record, perihelion.probe);
  const index = series.findIndex((p) => p.at === perihelion.at);
  const link = (id: string, label: string): string =>
    `<a href="/${bodyPagePath(id, locale)}/">${escapeHtml(label)}</a>`;

  const instant =
    `<dl><dt>${escapeHtml(TEXT.instant[locale])}</dt><dd>${escapeHtml(`${day}, ${clock(perihelion.at)}`)}</dd>` +
    `<dt>${escapeHtml(TEXT.distance[locale])}</dt><dd>${escapeHtml(km(perihelion.distanceKm, locale))} km</dd>` +
    `<dt>${escapeHtml(TEXT.altitude[locale])}</dt><dd>${escapeHtml(km(perihelion.altitudeKm, locale))} km</dd>` +
    `<dt>${escapeHtml(TEXT.speed[locale])}</dt><dd>${escapeHtml(speedKmS(perihelion.speedKmS, locale))} km/s</dd>` +
    `</dl><p>${escapeHtml(fill(TEXT.rank[locale], { rank: index + 1, count: series.length, probe }))}</p>` +
    `<p>${escapeHtml(fill(TEXT.meaning[locale], { probe, radius: km(record.sunRadiusKm, locale) }))}</p>` +
    (predicted
      ? `<p><strong>${escapeHtml(fill(TEXT.predictedNote[locale], { date: longDay(perihelion.retrieved, locale) }))}</strong></p>`
      : '');

  const neighbour = (other: Perihelion | undefined, label: DocText): string =>
    `<dt>${escapeHtml(label[locale])}</dt><dd>${
      other
        ? `<a href="${docPath(perihelionSlug(other), locale)}">${escapeHtml(
            fill(TEXT.neighbour[locale], {
              date: longDay(other.at.slice(0, 10), locale),
              distance: km(other.distanceKm, locale),
              difference: signedKm(
                other.distanceKm - perihelion.distanceKm,
                locale
              ),
            })
          )}</a>`
        : escapeHtml(
            (label === TEXT.previous ? TEXT.noPrevious : TEXT.noNext)[locale]
          )
    }</dd>`;
  const neighbours = `<dl>${neighbour(series[index - 1], TEXT.previous)}${neighbour(series[index + 1], TEXT.next)}</dl>`;

  const inGalaxy =
    `<p><a href="${escapeHtml(perihelionSceneHref(perihelion, locale))}">${escapeHtml(fill(TEXT.openScene[locale], { probe }))}</a></p>` +
    `<p>${escapeHtml(TEXT.pagesLead[locale])}</p><ul><li>${link(perihelion.probe, probe)}</li><li>${link('sun', name('sun', locale))}</li></ul>`;

  const method = `<p>${escapeHtml(fill(TEXT.methodText[locale], { days: record.halfWindowDays }))}</p>`;

  const source =
    `<p>${escapeHtml(HORIZONS.publisher)}, <a href="${escapeHtml(HORIZONS.url)}" rel="noopener noreferrer">${escapeHtml(HORIZONS.title)}</a>. ` +
    `${escapeHtml(fill(TEXT.read[locale], { date: longDay(perihelion.retrieved, locale) }))}</p>` +
    (perihelion.solution
      ? `<p>${escapeHtml(TEXT.solution[locale])} <code>${escapeHtml(perihelion.solution)}</code></p>`
      : '') +
    `<p><a href="${docPath(PERIHELIA_SLUG, locale)}">${escapeHtml(TEXT.all[locale])}</a></p>`;

  return {
    slug,
    locale,
    canonical: `${inputs.origin}${docPath(slug, locale)}`,
    title: fill(TEXT.pageTitle[locale], { probe, date: day }),
    description: trimForMeta(
      fill(
        (predicted ? TEXT.predictedDescription : TEXT.pageDescription)[locale],
        {
          probe,
          date: day,
          altitude: km(perihelion.altitudeKm, locale),
          speed: speedKmS(perihelion.speedKmS, locale),
        }
      ),
      160
    ),
    updated: perihelion.retrieved,
    body: [
      docSection('instant', TEXT.sectionInstant[locale], instant),
      docSection('neighbours', TEXT.sectionNeighbours[locale], neighbours),
      docSection('in-galaxy', TEXT.sectionInGalaxy[locale], inGalaxy),
      docSection('method', TEXT.sectionMethod[locale], method),
      docSection('source', TEXT.sectionSource[locale], source),
    ].join('\n'),
  };
}

function indexPage(inputs: PerihelionPageInputs, locale: Locale): DocPage {
  const { record, origin } = inputs;
  const name = names(inputs);
  const format = new Intl.NumberFormat(INTL_LOCALE[locale]);
  const rows = record.perihelia.map((perihelion) => [
    `<a href="${docPath(perihelionSlug(perihelion), locale)}">${escapeHtml(perihelion.at.slice(0, 10))}</a>` +
      (isPredicted(perihelion)
        ? ` (${escapeHtml(TEXT.predictedMark[locale])})`
        : ''),
    escapeHtml(name(perihelion.probe, locale)),
    escapeHtml(km(perihelion.altitudeKm, locale)),
  ]);
  // Les extrêmes se lisent parmi les passages MESURÉS : une prédiction n'est pas un record.
  const measured = record.perihelia.filter((p) => !isPredicted(p));
  const closest = measured.reduce((a, b) =>
    b.altitudeKm < a.altitudeKm ? b : a
  );
  const fastest = measured.reduce((a, b) => (b.speedKmS > a.speedKmS ? b : a));
  return {
    slug: PERIHELIA_SLUG,
    locale,
    canonical: `${origin}${docPath(PERIHELIA_SLUG, locale)}`,
    title: TEXT.indexTitle[locale],
    description: fill(TEXT.indexDescription[locale], {
      count: format.format(record.perihelia.length),
    }),
    updated: record.perihelia
      .map((p) => p.retrieved)
      .sort()
      .at(-1)!,
    body:
      `      <p>${escapeHtml(TEXT.indexIntro[locale])}</p>\n` +
      `      <p>${escapeHtml(
        fill(
          (closest === fastest ? TEXT.indexExtremesSame : TEXT.indexExtremes)[
            locale
          ],
          {
            probe: name(closest.probe, locale),
            date: longDay(closest.at.slice(0, 10), locale),
            altitude: km(closest.altitudeKm, locale),
            fastProbe: name(fastest.probe, locale),
            fastDate: longDay(fastest.at.slice(0, 10), locale),
            speed: speedKmS(fastest.speedKmS, locale),
          }
        )
      )}</p>\n` +
      `      <p>${escapeHtml(TEXT.indexNumbering[locale])}</p>\n      ` +
      docTable(
        TEXT.tableCaption[locale],
        [TEXT.colDate[locale], TEXT.colProbe[locale], TEXT.colAltitude[locale]],
        rows,
        2
      ),
  };
}

/**
 * Le relevé, vérifié avant d'en tirer une page : ordre chronologique, chemins uniques, dates à la
 * seconde, altitude cohérente avec la distance et le rayon. Un relevé abîmé fait échouer le build.
 */
export function checkPerihelionRecord(
  record: PerihelionRecord
): PerihelionRecord {
  if (record.perihelia.length === 0)
    throw new Error('relevé des périhélies vide');
  const slugs = new Set<string>();
  let previous = '';
  for (const p of record.perihelia) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(p.at))
      throw new Error(`périhélie daté hors format : ${p.at}`);
    if (p.at < previous)
      throw new Error(`périhélies hors d'ordre : ${p.at} après ${previous}`);
    previous = p.at;
    const slug = perihelionSlug(p);
    if (slugs.has(slug))
      throw new Error(`deux périhélies au même chemin : ${slug}`);
    slugs.add(slug);
    if (!(p.distanceKm > record.sunRadiusKm) || !(p.speedKmS > 0))
      throw new Error(`périhélie sans distance ou sans vitesse : ${slug}`);
    if (Math.abs(p.distanceKm - p.altitudeKm - record.sunRadiusKm) > 1)
      throw new Error(
        `altitude incohérente avec distance et rayon du Soleil : ${slug}`
      );
  }
  return record;
}

/** L'index puis une page par périhélie, dans une langue. */
export function perihelionPages(
  inputs: PerihelionPageInputs,
  locale: Locale
): DocPage[] {
  checkPerihelionRecord(inputs.record);
  return [
    indexPage(inputs, locale),
    ...inputs.record.perihelia.map((p) => perihelionPage(p, inputs, locale)),
  ];
}

/**
 * Pour chaque sonde et pour le Soleil, le fragment HTML de leurs périhélies, dans une langue, que
 * leurs pages ajoutent après leurs autres événements. Dérivé du MÊME relevé que les pages.
 */
export function perihelionListsByObject(
  inputs: PerihelionPageInputs,
  locale: Locale
): Map<string, string> {
  const name = names(inputs);
  const items = new Map<string, string[]>();
  for (const p of checkPerihelionRecord(inputs.record).perihelia) {
    const day = longDay(p.at.slice(0, 10), locale);
    const href = docPath(perihelionSlug(p), locale);
    for (const [id, other] of [
      [p.probe, 'sun'],
      ['sun', p.probe],
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
      `<h2>${escapeHtml(TEXT.sectionList[locale])}</h2><ul>${list.join('')}</ul>`,
    ])
  );
}
