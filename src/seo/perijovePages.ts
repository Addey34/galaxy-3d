/**
 * PAGES DES PÉRIJOVES DE JUNO (2026-10-28) : l'index `/perijoves/` et une page par périjove, dans
 * les quatre langues.
 *
 * `pnpm perijoves:generate` lit chaque minimum local de la distance de Juno au centre de Jupiter
 * sur la trajectoire que sert Horizons, à l'heure puis à la minute puis à la seconde
 * (`src/seo/perijoves.json`). Même méthode que les périhélies (`perihelionPages.ts`), avec une
 * différence : la NASA numérote ses périjoves (PJ1, PJ2…), et le générateur confronte les
 * numéros PJ1 à PJ76 à son tableau avant d'écrire une ligne. La page le dit, et dit que
 * le numéro au-delà de PJ76 prolonge la série sans qu'aucune table de la NASA le confirme.
 *
 * CE QUE LA PAGE AFFIRME :
 *   - l'instant, la distance au CENTRE de Jupiter, l'écart au rayon équatorial de la fiche de
 *     Jupiter (niveau 1 bar), la vitesse par rapport à Jupiter ;
 *   - JAMAIS une « altitude au-dessus des nuages » : Jupiter est aplatie et le périjove tombe à
 *     haute latitude, donc l'écart au rayon équatorial peut être négatif (mesuré : PJ73) et n'est
 *     pas le chiffre que la NASA publie (« 4 200 km au-dessus des nuages » pour PJ1, 4 141 km ici) ;
 *   - le périjove précédent et le suivant, avec leur écart signé ;
 *   - une prédiction, comme les survols, quand l'instant suit la date de lecture.
 *
 * Les helpers de nom, de nombre et d'heure sont ceux des survols (`flybyPages.ts`). Module PUR : le
 * relevé est lu par le greffon de build et passé en argument.
 */
import type { CelestialBodyConfig, CelestialConfig } from '@/types';
import { INTL_LOCALE, type Locale } from '@/i18n/locales';
import { bodyPagePath, escapeHtml, trimForMeta } from './bodyLandingPage';
import {
  docPath,
  docSection,
  docTable,
  PERIJOVES_SLUG,
  type DocPage,
  type DocText,
} from './documentPage';
import { clock, fill, HORIZONS, km, names } from './flybyPages';
import { longDay } from './instrumentLandingPage';

/** Un périjove tel que `scripts/generate-perijoves.mjs` l'écrit. */
export interface Perijove {
  probe: string;
  /** Numéro de la NASA (PJ1…), confronté à son tableau jusqu'à `witnessedUpTo`. */
  pj: number;
  /** Instant UTC du minimum de la distance au centre de Jupiter, à la seconde. */
  at: string;
  /** Distance au CENTRE de Jupiter, km au mètre. */
  distanceKm: number;
  /** Distance moins le rayon équatorial de la fiche de Jupiter, km au mètre ; peut être négatif. */
  altitudeKm: number;
  /** Vitesse par rapport à Jupiter, km/s au mm/s. */
  speedKmS: number;
  solution: string | null;
  retrieved: string;
}

export interface PerijoveRecord {
  source: string;
  jupiterRadiusKm: number;
  /** Demi-fenêtre, en jours, où un minimum est le plus petit : celle du générateur. */
  halfWindowDays: number;
  /** Dernier numéro confronté au tableau de la NASA. */
  witnessedUpTo: number;
  bounds: { probe: string; from: string; to: string; retrieved: string }[];
  perijoves: Perijove[];
}

export interface PerijovePageInputs {
  record: PerijoveRecord;
  config: CelestialConfig;
  navigable: ReadonlyMap<string, CelestialBodyConfig>;
  origin: string;
}

/** La page publique d'où vient la numérotation. */
const NASA_ORBITS = {
  publisher: 'NASA Science',
  title: 'Juno Orbits',
  url: 'https://science.nasa.gov/mission/juno/juno-orbits/',
} as const;

const TEXT = {
  indexTitle: {
    en: 'Perijoves of Juno',
    fr: 'Les périjoves de Juno',
    es: 'Los perijoves de Juno',
    'pt-BR': 'Os perijoves da Juno',
  },
  indexDescription: {
    en: '{count} closest passes of Juno to Jupiter, numbered as NASA numbers them, each instant measured to the second on its NASA/JPL Horizons trajectory.',
    fr: '{count} passages de Juno au plus près de Jupiter, numérotés comme la NASA les numérote, chaque instant mesuré à la seconde sur sa trajectoire Horizons de la NASA/JPL.',
    es: '{count} pasos de Juno más cerca de Júpiter, numerados como los numera la NASA, cada instante medido al segundo sobre su trayectoria Horizons de la NASA/JPL.',
    'pt-BR':
      '{count} passagens da Juno mais perto de Júpiter, numeradas como a NASA as numera, cada instante medido ao segundo sobre sua trajetória Horizons da NASA/JPL.',
  },
  indexIntro: {
    en: 'A perijove is the point of Juno’s orbit closest to Jupiter. Each one is measured here on the true trajectory of the probe: the minimum of its distance to the centre of Jupiter, read every hour, then every minute and every second around it. The last column is that distance minus the equatorial radius Galaxy displays for Jupiter (1 bar level). Jupiter is flattened and the passes happen at high latitude, so this is not the altitude above the clouds that NASA quotes, and it can be negative.',
    fr: 'Un périjove est le point de l’orbite de Juno le plus proche de Jupiter. Chacun est mesuré ici sur la vraie trajectoire de la sonde : le minimum de sa distance au centre de Jupiter, lue chaque heure, puis chaque minute et chaque seconde autour de lui. La dernière colonne est cette distance moins le rayon équatorial que Galaxy affiche pour Jupiter (niveau 1 bar). Jupiter est aplatie et les passages ont lieu à haute latitude : ce n’est donc pas l’altitude au-dessus des nuages que cite la NASA, et elle peut être négative.',
    es: 'Un perijove es el punto de la órbita de Juno más cercano a Júpiter. Cada uno se mide aquí sobre la trayectoria real de la sonda: el mínimo de su distancia al centro de Júpiter, leída cada hora, y luego cada minuto y cada segundo a su alrededor. La última columna es esa distancia menos el radio ecuatorial que Galaxy muestra para Júpiter (nivel de 1 bar). Júpiter está achatado y los pasos ocurren a alta latitud, por lo que no es la altitud sobre las nubes que cita la NASA, y puede ser negativa.',
    'pt-BR':
      'Um perijove é o ponto da órbita da Juno mais próximo de Júpiter. Cada um é medido aqui sobre a trajetória real da sonda: o mínimo de sua distância ao centro de Júpiter, lida a cada hora, e depois a cada minuto e a cada segundo em torno dele. A última coluna é essa distância menos o raio equatorial que a Galaxy exibe para Júpiter (nível de 1 bar). Júpiter é achatado e as passagens ocorrem em alta latitude, portanto não é a altitude acima das nuvens que a NASA cita, e pode ser negativa.',
  },
  indexExtremes: {
    en: 'The closest measured pass is PJ{pj}, on {date}, {distance} km from the centre of Jupiter; the farthest is PJ{farPj}, on {farDate}, {farDistance} km.',
    fr: 'Le passage mesuré le plus proche est PJ{pj}, le {date}, à {distance} km du centre de Jupiter ; le plus lointain est PJ{farPj}, le {farDate}, à {farDistance} km.',
    es: 'El paso medido más cercano es el PJ{pj}, el {date}, a {distance} km del centro de Júpiter; el más lejano es el PJ{farPj}, el {farDate}, a {farDistance} km.',
    'pt-BR':
      'A passagem medida mais próxima é a PJ{pj}, em {date}, a {distance} km do centro de Júpiter; a mais distante é a PJ{farPj}, em {farDate}, a {farDistance} km.',
  },
  indexNumbering: {
    en: 'The numbers are NASA’s: PJ0 is the orbit insertion of 5 July 2016, PJ1 the first pass after it. PJ1 to PJ{witnessed} were checked against the table on NASA’s page and fall within a day of it. Beyond PJ{witnessed}, that table stops: the number continues the series and nothing confirms it.',
    fr: 'Les numéros sont ceux de la NASA : PJ0 est l’insertion en orbite du 5 juillet 2016, PJ1 le premier passage après elle. PJ1 à PJ{witnessed} ont été confrontés au tableau de la page de la NASA et tombent à moins d’un jour de lui. Au-delà de PJ{witnessed}, ce tableau s’arrête : le numéro prolonge la série et rien ne le confirme.',
    es: 'Los números son los de la NASA: el PJ0 es la inserción en órbita del 5 de julio de 2016, el PJ1 el primer paso después. Del PJ1 al PJ{witnessed} se confrontaron con la tabla de la página de la NASA y caen a menos de un día de ella. Más allá del PJ{witnessed}, esa tabla termina: el número prolonga la serie y nada lo confirma.',
    'pt-BR':
      'Os números são os da NASA: o PJ0 é a inserção em órbita de 5 de julho de 2016, o PJ1 a primeira passagem depois dela. Do PJ1 ao PJ{witnessed} foram confrontados com a tabela da página da NASA e caem a menos de um dia dela. Além do PJ{witnessed}, essa tabela termina: o número prolonga a série e nada o confirma.',
  },
  tableCaption: {
    en: 'Perijoves, by number',
    fr: 'Périjoves, par numéro',
    es: 'Perijoves, por número',
    'pt-BR': 'Perijoves, por número',
  },
  colPj: { en: 'No.', fr: 'N°', es: 'N.º', 'pt-BR': 'N.º' },
  colDate: { en: 'Date', fr: 'Date', es: 'Fecha', 'pt-BR': 'Data' },
  colDistance: {
    en: 'Distance to centre (km)',
    fr: 'Distance au centre (km)',
    es: 'Distancia al centro (km)',
    'pt-BR': 'Distância ao centro (km)',
  },
  colGap: {
    en: 'Minus equatorial radius (km)',
    fr: 'Moins le rayon équatorial (km)',
    es: 'Menos el radio ecuatorial (km)',
    'pt-BR': 'Menos o raio equatorial (km)',
  },
  predictedMark: {
    en: 'prediction',
    fr: 'prédiction',
    es: 'predicción',
    'pt-BR': 'previsão',
  },
  pageTitle: {
    en: 'Juno at perijove {pj}, {date}',
    fr: 'Juno au périjove {pj}, {date}',
    es: 'Juno en el perijove {pj}, {date}',
    'pt-BR': 'Juno no perijove {pj}, {date}',
  },
  pageDescription: {
    en: 'Juno passed {distance} km from the centre of Jupiter on {date}, at {speed} km/s (perijove {pj}): instant measured to the second on the NASA/JPL Horizons trajectory, and the scene to open at that instant.',
    fr: 'Juno est passée à {distance} km du centre de Jupiter le {date}, à {speed} km/s (périjove {pj}) : instant mesuré à la seconde sur la trajectoire Horizons de la NASA/JPL, et la scène à ouvrir à cet instant.',
    es: 'Juno pasó a {distance} km del centro de Júpiter el {date}, a {speed} km/s (perijove {pj}): instante medido al segundo sobre la trayectoria Horizons de la NASA/JPL, y la escena para abrir en ese instante.',
    'pt-BR':
      'A Juno passou a {distance} km do centro de Júpiter em {date}, a {speed} km/s (perijove {pj}): instante medido ao segundo sobre a trajetória Horizons da NASA/JPL, e a cena para abrir nesse instante.',
  },
  predictedDescription: {
    en: 'Juno is predicted to pass {distance} km from the centre of Jupiter on {date}, at {speed} km/s (perijove {pj}): instant computed to the second on the trajectory predicted by NASA/JPL Horizons.',
    fr: 'Juno doit passer à {distance} km du centre de Jupiter le {date}, à {speed} km/s (périjove {pj}) : instant calculé à la seconde sur la trajectoire prédite par Horizons de la NASA/JPL.',
    es: 'Se prevé que Juno pase a {distance} km del centro de Júpiter el {date}, a {speed} km/s (perijove {pj}): instante calculado al segundo sobre la trayectoria prevista por Horizons de la NASA/JPL.',
    'pt-BR':
      'Prevê-se que a Juno passe a {distance} km do centro de Júpiter em {date}, a {speed} km/s (perijove {pj}): instante calculado ao segundo sobre a trajetória prevista pelo Horizons da NASA/JPL.',
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
    en: 'Distance from the centre of Jupiter',
    fr: 'Distance au centre de Jupiter',
    es: 'Distancia al centro de Júpiter',
    'pt-BR': 'Distância ao centro de Júpiter',
  },
  gap: {
    en: 'Distance minus the equatorial radius',
    fr: 'Distance moins le rayon équatorial',
    es: 'Distancia menos el radio ecuatorial',
    'pt-BR': 'Distância menos o raio equatorial',
  },
  speed: {
    en: 'Speed relative to Jupiter',
    fr: 'Vitesse par rapport à Jupiter',
    es: 'Velocidad respecto a Júpiter',
    'pt-BR': 'Velocidade em relação a Júpiter',
  },
  numberChecked: {
    en: 'This is perijove {pj}, the number NASA gives it. NASA’s table of orbits lists it and this measurement falls within a day of the date it gives.',
    fr: 'C’est le périjove {pj}, le numéro que lui donne la NASA. Le tableau des orbites de la NASA le liste et cette mesure tombe à moins d’un jour de la date qu’il donne.',
    es: 'Es el perijove {pj}, el número que le da la NASA. La tabla de órbitas de la NASA lo lista y esta medición cae a menos de un día de la fecha que da.',
    'pt-BR':
      'É o perijove {pj}, o número que a NASA lhe dá. A tabela de órbitas da NASA o lista e esta medição cai a menos de um dia da data que ela dá.',
  },
  numberContinued: {
    en: 'This is perijove {pj} by continuation of the series: the table on NASA’s page stops at PJ{witnessed}, so nothing confirms this number.',
    fr: 'C’est le périjove {pj} par prolongement de la série : le tableau de la page de la NASA s’arrête à PJ{witnessed}, rien ne confirme donc ce numéro.',
    es: 'Es el perijove {pj} por prolongación de la serie: la tabla de la página de la NASA termina en el PJ{witnessed}, por lo que nada confirma este número.',
    'pt-BR':
      'É o perijove {pj} por prolongamento da série: a tabela da página da NASA termina no PJ{witnessed}, portanto nada confirma este número.',
  },
  meaning: {
    en: 'This is the instant at which the distance between Juno and the centre of Jupiter is smallest on this orbit. Jupiter has no solid surface and is flattened: the second figure is that distance minus the equatorial radius of {radius} km (1 bar level). It is not the altitude above the clouds that NASA quotes, because the pass happens at high latitude where the planet’s radius is smaller, and it is negative when Juno passes closer to the centre than that radius.',
    fr: 'C’est l’instant où la distance entre Juno et le centre de Jupiter est la plus petite sur cette orbite. Jupiter n’a pas de surface solide et elle est aplatie : le second chiffre est cette distance moins le rayon équatorial de {radius} km (niveau 1 bar). Ce n’est pas l’altitude au-dessus des nuages que cite la NASA, car le passage a lieu à haute latitude où le rayon de la planète est plus petit, et il est négatif quand Juno passe plus près du centre que ce rayon.',
    es: 'Es el instante en que la distancia entre Juno y el centro de Júpiter es la más pequeña en esta órbita. Júpiter no tiene superficie sólida y está achatado: la segunda cifra es esa distancia menos el radio ecuatorial de {radius} km (nivel de 1 bar). No es la altitud sobre las nubes que cita la NASA, porque el paso ocurre a alta latitud donde el radio del planeta es menor, y es negativa cuando Juno pasa más cerca del centro que ese radio.',
    'pt-BR':
      'É o instante em que a distância entre a Juno e o centro de Júpiter é a menor nesta órbita. Júpiter não tem superfície sólida e é achatado: o segundo número é essa distância menos o raio equatorial de {radius} km (nível de 1 bar). Não é a altitude acima das nuvens que a NASA cita, pois a passagem ocorre em alta latitude, onde o raio do planeta é menor, e é negativo quando a Juno passa mais perto do centro que esse raio.',
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
    en: 'Previous perijove',
    fr: 'Périjove précédent',
    es: 'Perijove anterior',
    'pt-BR': 'Perijove anterior',
  },
  next: {
    en: 'Next perijove',
    fr: 'Périjove suivant',
    es: 'Perijove siguiente',
    'pt-BR': 'Próximo perijove',
  },
  neighbour: {
    en: 'PJ{pj}, {date}, {distance} km from the centre ({difference} km compared with this one)',
    fr: 'PJ{pj}, {date}, à {distance} km du centre ({difference} km par rapport à celui-ci)',
    es: 'PJ{pj}, {date}, a {distance} km del centro ({difference} km respecto a este)',
    'pt-BR':
      'PJ{pj}, {date}, a {distance} km do centro ({difference} km em relação a este)',
  },
  noPrevious: {
    en: 'This is PJ1, the first pass after the orbit insertion.',
    fr: 'C’est PJ1, le premier passage après l’insertion en orbite.',
    es: 'Es el PJ1, el primer paso después de la inserción en órbita.',
    'pt-BR': 'É o PJ1, a primeira passagem depois da inserção em órbita.',
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
    en: 'Pages of the spacecraft and of the planet:',
    fr: 'Pages de la sonde et de la planète :',
    es: 'Páginas de la sonda y del planeta:',
    'pt-BR': 'Páginas da sonda e do planeta:',
  },
  sectionMethod: {
    en: 'How it is measured',
    fr: 'Comment c’est mesuré',
    es: 'Cómo se mide',
    'pt-BR': 'Como é medido',
  },
  methodText: {
    en: 'The position of the spacecraft relative to the centre of Jupiter is read from Horizons every hour across the window of its published trajectory; a local minimum is the smallest distance within {days} days on either side. Around each one the position is read again every minute, then every second, and the smallest distance is kept. A minimum at the edge of the window is not listed, since the trajectory does not show that it rises again: that is why the orbit insertion is not in this series and the first minimum is PJ1.',
    fr: 'La position de la sonde par rapport au centre de Jupiter est lue dans Horizons chaque heure sur la fenêtre de sa trajectoire publiée ; un minimum local est la plus petite distance à {days} jours de part et d’autre. Autour de chacun, la position est relue chaque minute, puis chaque seconde, et la plus petite distance est retenue. Un minimum au bord de la fenêtre n’est pas listé, puisque la trajectoire ne montre pas qu’elle remonte : c’est pourquoi l’insertion en orbite n’est pas dans cette série et que le premier minimum est PJ1.',
    es: 'La posición de la sonda respecto al centro de Júpiter se lee en Horizons cada hora sobre la ventana de su trayectoria publicada; un mínimo local es la menor distancia en {days} días a cada lado. Alrededor de cada uno, la posición se vuelve a leer cada minuto, y luego cada segundo, y se conserva la menor distancia. Un mínimo en el borde de la ventana no se lista, ya que la trayectoria no muestra que vuelva a subir: por eso la inserción en órbita no está en esta serie y el primer mínimo es el PJ1.',
    'pt-BR':
      'A posição da sonda em relação ao centro de Júpiter é lida no Horizons a cada hora sobre a janela de sua trajetória publicada; um mínimo local é a menor distância em {days} dias de cada lado. Em torno de cada um, a posição é relida a cada minuto, e depois a cada segundo, e a menor distância é mantida. Um mínimo na borda da janela não é listado, pois a trajetória não mostra que ela volta a subir: por isso a inserção em órbita não está nesta série e o primeiro mínimo é o PJ1.',
  },
  sectionSource: { en: 'Source', fr: 'Source', es: 'Fuente', 'pt-BR': 'Fonte' },
  solution: {
    en: 'Trajectory solution cited by Horizons:',
    fr: 'Solution de trajectoire citée par Horizons :',
    es: 'Solución de trayectoria citada por Horizons:',
    'pt-BR': 'Solução de trajetória citada pelo Horizons:',
  },
  numbering: {
    en: 'Numbering:',
    fr: 'Numérotation :',
    es: 'Numeración:',
    'pt-BR': 'Numeração:',
  },
  read: {
    en: 'Read on {date}.',
    fr: 'Lue le {date}.',
    es: 'Leída el {date}.',
    'pt-BR': 'Lida em {date}.',
  },
  sectionList: {
    en: 'Perijoves',
    fr: 'Périjoves',
    es: 'Perijoves',
    'pt-BR': 'Perijoves',
  },
  listItem: {
    en: 'PJ{pj}, {date}',
    fr: 'PJ{pj}, {date}',
    es: 'PJ{pj}, {date}',
    'pt-BR': 'PJ{pj}, {date}',
  },
  all: {
    en: 'All perijoves',
    fr: 'Tous les périjoves',
    es: 'Todos los perijoves',
    'pt-BR': 'Todos os perijoves',
  },
} as const satisfies Record<string, DocText>;

/** Le chemin d'une page sans la langue : `perijoves/juno-2023-12-30`. */
export const perijoveSlug = (
  perijove: Pick<Perijove, 'probe' | 'at'>
): string => `${PERIJOVES_SLUG}/${perijove.probe}-${perijove.at.slice(0, 10)}`;

/** Un périjove est une prédiction quand il suit la date à laquelle sa trajectoire a été lue. */
const isPredicted = (perijove: Pick<Perijove, 'at' | 'retrieved'>): boolean =>
  perijove.at.slice(0, 10) > perijove.retrieved;

/** La page de la sonde à l'instant mesuré, en Explo (même forme que les survols). */
export function perijoveSceneHref(perijove: Perijove, locale: Locale): string {
  return `/${bodyPagePath(perijove.probe, locale)}/?mode=explo&date=${perijove.at}`;
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

function perijovePage(
  perijove: Perijove,
  inputs: PerijovePageInputs,
  locale: Locale
): DocPage {
  const { record } = inputs;
  const name = names(inputs);
  const probe = name(perijove.probe, locale);
  const day = longDay(perijove.at.slice(0, 10), locale);
  const predicted = isPredicted(perijove);
  const slug = perijoveSlug(perijove);
  const series = record.perijoves;
  const index = series.findIndex((p) => p.at === perijove.at);
  const link = (id: string, label: string): string =>
    `<a href="/${bodyPagePath(id, locale)}/">${escapeHtml(label)}</a>`;
  const checked = perijove.pj <= record.witnessedUpTo;

  const instant =
    `<dl><dt>${escapeHtml(TEXT.instant[locale])}</dt><dd>${escapeHtml(`${day}, ${clock(perijove.at)}`)}</dd>` +
    `<dt>${escapeHtml(TEXT.distance[locale])}</dt><dd>${escapeHtml(km(perijove.distanceKm, locale))} km</dd>` +
    `<dt>${escapeHtml(TEXT.gap[locale])}</dt><dd>${escapeHtml(signedKm(perijove.altitudeKm, locale))} km</dd>` +
    `<dt>${escapeHtml(TEXT.speed[locale])}</dt><dd>${escapeHtml(speedKmS(perijove.speedKmS, locale))} km/s</dd>` +
    `</dl><p>${escapeHtml(
      fill((checked ? TEXT.numberChecked : TEXT.numberContinued)[locale], {
        pj: perijove.pj,
        witnessed: record.witnessedUpTo,
      })
    )}</p>` +
    `<p>${escapeHtml(fill(TEXT.meaning[locale], { radius: km(record.jupiterRadiusKm, locale) }))}</p>` +
    (predicted
      ? `<p><strong>${escapeHtml(fill(TEXT.predictedNote[locale], { date: longDay(perijove.retrieved, locale) }))}</strong></p>`
      : '');

  const neighbour = (other: Perijove | undefined, label: DocText): string =>
    `<dt>${escapeHtml(label[locale])}</dt><dd>${
      other
        ? `<a href="${docPath(perijoveSlug(other), locale)}">${escapeHtml(
            fill(TEXT.neighbour[locale], {
              pj: other.pj,
              date: longDay(other.at.slice(0, 10), locale),
              distance: km(other.distanceKm, locale),
              difference: signedKm(
                other.distanceKm - perijove.distanceKm,
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
    `<p><a href="${escapeHtml(perijoveSceneHref(perijove, locale))}">${escapeHtml(fill(TEXT.openScene[locale], { probe }))}</a></p>` +
    `<p>${escapeHtml(TEXT.pagesLead[locale])}</p><ul><li>${link(perijove.probe, probe)}</li><li>${link('jupiter', name('jupiter', locale))}</li></ul>`;

  const method = `<p>${escapeHtml(fill(TEXT.methodText[locale], { days: record.halfWindowDays }))}</p>`;

  const source =
    `<p>${escapeHtml(HORIZONS.publisher)}, <a href="${escapeHtml(HORIZONS.url)}" rel="noopener noreferrer">${escapeHtml(HORIZONS.title)}</a>. ` +
    `${escapeHtml(fill(TEXT.read[locale], { date: longDay(perijove.retrieved, locale) }))}</p>` +
    (perijove.solution
      ? `<p>${escapeHtml(TEXT.solution[locale])} <code>${escapeHtml(perijove.solution)}</code></p>`
      : '') +
    `<p>${escapeHtml(TEXT.numbering[locale])} ${escapeHtml(NASA_ORBITS.publisher)}, <a href="${escapeHtml(NASA_ORBITS.url)}" rel="noopener noreferrer">${escapeHtml(NASA_ORBITS.title)}</a>.</p>` +
    `<p><a href="${docPath(PERIJOVES_SLUG, locale)}">${escapeHtml(TEXT.all[locale])}</a></p>`;

  return {
    slug,
    locale,
    canonical: `${inputs.origin}${docPath(slug, locale)}`,
    title: fill(TEXT.pageTitle[locale], { pj: perijove.pj, date: day }),
    description: trimForMeta(
      fill(
        (predicted ? TEXT.predictedDescription : TEXT.pageDescription)[locale],
        {
          pj: perijove.pj,
          date: day,
          distance: km(perijove.distanceKm, locale),
          speed: speedKmS(perijove.speedKmS, locale),
        }
      ),
      160
    ),
    updated: perijove.retrieved,
    body: [
      docSection('instant', TEXT.sectionInstant[locale], instant),
      docSection('neighbours', TEXT.sectionNeighbours[locale], neighbours),
      docSection('in-galaxy', TEXT.sectionInGalaxy[locale], inGalaxy),
      docSection('method', TEXT.sectionMethod[locale], method),
      docSection('source', TEXT.sectionSource[locale], source),
    ].join('\n'),
  };
}

function indexPage(inputs: PerijovePageInputs, locale: Locale): DocPage {
  const { record, origin } = inputs;
  const format = new Intl.NumberFormat(INTL_LOCALE[locale]);
  const rows = record.perijoves.map((perijove) => [
    String(perijove.pj),
    `<a href="${docPath(perijoveSlug(perijove), locale)}">${escapeHtml(perijove.at.slice(0, 10))}</a>` +
      (isPredicted(perijove)
        ? ` (${escapeHtml(TEXT.predictedMark[locale])})`
        : ''),
    escapeHtml(km(perijove.distanceKm, locale)),
    escapeHtml(signedKm(perijove.altitudeKm, locale)),
  ]);
  // Les extrêmes se lisent parmi les passages MESURÉS : une prédiction n'est pas un record.
  const measured = record.perijoves.filter((p) => !isPredicted(p));
  const closest = measured.reduce((a, b) =>
    b.distanceKm < a.distanceKm ? b : a
  );
  const farthest = measured.reduce((a, b) =>
    b.distanceKm > a.distanceKm ? b : a
  );
  return {
    slug: PERIJOVES_SLUG,
    locale,
    canonical: `${origin}${docPath(PERIJOVES_SLUG, locale)}`,
    title: TEXT.indexTitle[locale],
    description: fill(TEXT.indexDescription[locale], {
      count: format.format(record.perijoves.length),
    }),
    updated: record.perijoves
      .map((p) => p.retrieved)
      .sort()
      .at(-1)!,
    body:
      `      <p>${escapeHtml(TEXT.indexIntro[locale])}</p>\n` +
      `      <p>${escapeHtml(
        fill(TEXT.indexExtremes[locale], {
          pj: closest.pj,
          date: longDay(closest.at.slice(0, 10), locale),
          distance: km(closest.distanceKm, locale),
          farPj: farthest.pj,
          farDate: longDay(farthest.at.slice(0, 10), locale),
          farDistance: km(farthest.distanceKm, locale),
        })
      )}</p>\n` +
      `      <p>${escapeHtml(fill(TEXT.indexNumbering[locale], { witnessed: record.witnessedUpTo }))}</p>\n      ` +
      docTable(
        TEXT.tableCaption[locale],
        [
          TEXT.colPj[locale],
          TEXT.colDate[locale],
          TEXT.colDistance[locale],
          TEXT.colGap[locale],
        ],
        rows,
        2
      ),
  };
}

/**
 * Le relevé, vérifié avant d'en tirer une page : ordre chronologique, numéros consécutifs depuis
 * PJ1, chemins uniques, dates à la seconde, écart cohérent avec la distance et le rayon. Un
 * relevé abîmé fait échouer le build.
 */
export function checkPerijoveRecord(record: PerijoveRecord): PerijoveRecord {
  if (record.perijoves.length === 0)
    throw new Error('relevé des périjoves vide');
  const slugs = new Set<string>();
  let previous = '';
  record.perijoves.forEach((p, i) => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(p.at))
      throw new Error(`périjove daté hors format : ${p.at}`);
    if (p.at < previous)
      throw new Error(`périjoves hors d'ordre : ${p.at} après ${previous}`);
    previous = p.at;
    if (p.pj !== i + 1)
      throw new Error(`numéro ${p.pj} à la place ${i + 1} : ${p.at}`);
    const slug = perijoveSlug(p);
    if (slugs.has(slug))
      throw new Error(`deux périjoves au même chemin : ${slug}`);
    slugs.add(slug);
    if (!(p.distanceKm > 0) || !(p.speedKmS > 0))
      throw new Error(`périjove sans distance ou sans vitesse : ${slug}`);
    if (Math.abs(p.distanceKm - p.altitudeKm - record.jupiterRadiusKm) > 1)
      throw new Error(
        `écart incohérent avec distance et rayon de Jupiter : ${slug}`
      );
  });
  return record;
}

/** L'index puis une page par périjove, dans une langue. */
export function perijovePages(
  inputs: PerijovePageInputs,
  locale: Locale
): DocPage[] {
  checkPerijoveRecord(inputs.record);
  return [
    indexPage(inputs, locale),
    ...inputs.record.perijoves.map((p) => perijovePage(p, inputs, locale)),
  ];
}

/**
 * Pour Juno et pour Jupiter, le fragment HTML de leurs périjoves, dans une langue, que leurs pages
 * ajoutent après leurs autres événements. Dérivé du MÊME relevé que les pages.
 */
export function perijoveListsByObject(
  inputs: PerijovePageInputs,
  locale: Locale
): Map<string, string> {
  const items: string[] = [];
  for (const p of checkPerijoveRecord(inputs.record).perijoves) {
    const label = fill(TEXT.listItem[locale], {
      pj: p.pj,
      date: longDay(p.at.slice(0, 10), locale),
    });
    items.push(
      `<li><a href="${escapeHtml(docPath(perijoveSlug(p), locale))}">${escapeHtml(label)}</a></li>`
    );
  }
  const html = `<h2>${escapeHtml(TEXT.sectionList[locale])}</h2><ul>${items.join('')}</ul>`;
  return new Map([
    ['juno', html],
    ['jupiter', html],
  ]);
}
