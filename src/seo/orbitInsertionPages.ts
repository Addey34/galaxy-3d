/**
 * PAGES DES MISES EN ORBITE (lot 49, 2026-10-14) : l'index `/orbit-insertions/` et une page par
 * mise en orbite, dans les quatre langues.
 *
 * `pnpm orbits:generate` mesure, sur la trajectoire que sert Horizons, le PREMIER instant où une
 * sonde devient liée à un corps dans sa sphère d'influence (énergie orbitale spécifique
 * négative), à la seconde, et la manœuvre détectée la plus proche par une autre méthode
 * (`src/seo/orbitInsertions.json`). Ces pages publient cette mesure, et rien qui ne vienne
 * d'elle : pas de durée de combustion, pas de delta-v annoncé, que la trajectoire ne dit pas.
 *
 * CE QUE LA PAGE AFFIRME :
 *   - ce qu'est l'instant (le passage de l'énergie sous zéro), parce qu'une « mise en orbite »
 *     publiée par une agence est une MANŒUVRE qui dure, et que l'instant mesuré en est un point,
 *     pas forcément le début ;
 *   - l'écart à la manœuvre détectée, signé, ou l'absence de manœuvre ;
 *   - quand la fiche du corps publie l'incertitude de sa masse, de combien elle déplace l'instant ;
 *   - une prédiction, comme les survols, quand l'instant suit la date de lecture.
 *
 * Les helpers de nom, de nombre et d'heure sont ceux des survols (`flybyPages.ts`), importés et
 * non recopiés : les deux collections affichent la même chose de la même façon.
 *
 * Module PUR : le relevé est lu par le greffon de build et passé en argument.
 */
import type { CelestialBodyConfig, CelestialConfig } from '@/types';
import { INTL_LOCALE, type Locale } from '@/i18n/locales';
import { bodyPagePath, escapeHtml, trimForMeta } from './bodyLandingPage';
import {
  docPath,
  docSection,
  docTable,
  ORBIT_INSERTIONS_SLUG,
  type DocPage,
  type DocText,
} from './documentPage';
import { clock, fill, HORIZONS, km, names } from './flybyPages';
import { longDay } from './instrumentLandingPage';

/** Une mise en orbite telle que `scripts/generate-orbit-insertions.mjs` l'écrit. */
export interface OrbitInsertion {
  probe: string;
  body: string;
  /** Premier instant UTC où l'énergie relative au corps est négative, à la seconde. */
  at: string;
  /** Distance au CENTRE du corps à cet instant, km au mètre. */
  distanceKm: number;
  /** Vitesse relative au corps à cet instant, km/s au µm/s. */
  speedKmS: number;
  /** La manœuvre détectée la plus proche sur la même trajectoire, ou aucune. */
  manoeuvre: { at: string; minutesFromInsertion: number } | null;
  /** Incertitude relative de GM que la fiche du corps publie, ou `null`. */
  massRelativeUncertainty: number | null;
  /** Déplacement de l'instant, en secondes, aux deux bornes de cette incertitude. */
  massSensitivitySeconds: number | null;
  solution: string | null;
  measuredFrom: 'centre' | 'difference';
  retrieved: string;
}

export type OrbitInsertionExclusion =
  'boundAtEntry' | 'coverage' | 'unresolved';

export interface OrbitInsertionRecord {
  source: string;
  insertions: OrbitInsertion[];
  excluded: { probe: string; body: string; reason: OrbitInsertionExclusion }[];
}

export interface OrbitInsertionPageInputs {
  record: OrbitInsertionRecord;
  config: CelestialConfig;
  navigable: ReadonlyMap<string, CelestialBodyConfig>;
  origin: string;
}

const TEXT = {
  indexTitle: {
    en: 'Spacecraft orbit insertions',
    fr: 'Les mises en orbite des sondes',
    es: 'Las inserciones en órbita de las sondas',
    'pt-BR': 'As inserções em órbita das sondas',
  },
  indexDescription: {
    en: '{count} spacecraft entering orbit around a planet or a small body, each instant measured to the second on its NASA/JPL Horizons trajectory.',
    fr: '{count} sondes mises en orbite autour d’une planète ou d’un petit corps, chaque instant mesuré à la seconde sur sa trajectoire Horizons de la NASA/JPL.',
    es: '{count} sondas que entran en órbita alrededor de un planeta o de un cuerpo menor, cada instante medido al segundo sobre su trayectoria Horizons de la NASA/JPL.',
    'pt-BR':
      '{count} sondas que entram em órbita ao redor de um planeta ou de um corpo menor, cada instante medido ao segundo sobre sua trajetória Horizons da NASA/JPL.',
  },
  indexIntro: {
    en: 'A spacecraft is in orbit around a body when it no longer has the energy to leave it: its speed relative to the body falls below the escape speed at its distance. These instants are measured on the true trajectory of each spacecraft Galaxy follows, inside the sphere of influence of a planet or the Hill sphere of a small body, and only the first one counts: near a small body, proximity manoeuvres cross that threshold again and again.',
    fr: 'Une sonde est en orbite autour d’un corps quand elle n’a plus l’énergie de le quitter : sa vitesse par rapport à lui passe sous la vitesse de libération à sa distance. Ces instants sont mesurés sur la vraie trajectoire de chaque sonde que Galaxy suit, dans la sphère d’influence d’une planète ou la sphère de Hill d’un petit corps, et seul le premier compte : près d’un petit corps, les manœuvres de proximité refranchissent ce seuil à maintes reprises.',
    es: 'Una sonda está en órbita alrededor de un cuerpo cuando ya no tiene la energía para abandonarlo: su velocidad respecto a él cae por debajo de la velocidad de escape a su distancia. Estos instantes se miden sobre la trayectoria real de cada sonda que Galaxy sigue, dentro de la esfera de influencia de un planeta o la esfera de Hill de un cuerpo menor, y solo cuenta el primero: cerca de un cuerpo menor, las maniobras de proximidad vuelven a cruzar ese umbral una y otra vez.',
    'pt-BR':
      'Uma sonda está em órbita ao redor de um corpo quando já não tem energia para deixá-lo: sua velocidade em relação a ele cai abaixo da velocidade de escape à sua distância. Estes instantes são medidos sobre a trajetória real de cada sonda que a Galaxy acompanha, dentro da esfera de influência de um planeta ou da esfera de Hill de um corpo menor, e só o primeiro conta: perto de um corpo menor, as manobras de proximidade voltam a cruzar esse limiar repetidas vezes.',
  },
  excludedLead: {
    en: 'These arrivals have no page:',
    fr: 'Ces arrivées n’ont pas de page :',
    es: 'Estas llegadas no tienen página:',
    'pt-BR': 'Estas chegadas não têm página:',
  },
  boundAtEntry: {
    en: '{probe} at {body}: on the published trajectory, it is already bound when it enters the sphere of influence, a ballistic capture with no instant of crossing to publish.',
    fr: '{probe} à {body} : sur la trajectoire publiée, elle est déjà liée quand elle entre dans la sphère d’influence, une capture balistique sans instant de passage à publier.',
    es: '{probe} en {body}: en la trayectoria publicada, ya está ligada cuando entra en la esfera de influencia, una captura balística sin instante de cruce que publicar.',
    'pt-BR':
      '{probe} em {body}: na trajetória publicada, ela já está ligada quando entra na esfera de influência, uma captura balística sem instante de passagem a publicar.',
  },
  coverage: {
    en: '{probe} at {body}: the published trajectory ends before it is bound.',
    fr: '{probe} à {body} : la trajectoire publiée s’arrête avant qu’elle soit liée.',
    es: '{probe} en {body}: la trayectoria publicada termina antes de que quede ligada.',
    'pt-BR':
      '{probe} em {body}: a trajetória publicada termina antes que ela fique ligada.',
  },
  unresolved: {
    en: '{probe} at {body}: the trajectory Horizons serves jumps discontinuously near the body, and no instant can be read on it.',
    fr: '{probe} à {body} : la trajectoire que sert Horizons y fait des sauts, et aucun instant ne peut s’y lire.',
    es: '{probe} en {body}: la trayectoria que sirve Horizons da saltos cerca del cuerpo, y en ella no puede leerse ningún instante.',
    'pt-BR':
      '{probe} em {body}: a trajetória que o Horizons serve dá saltos perto do corpo, e nela nenhum instante pode ser lido.',
  },
  tableCaption: {
    en: 'Orbit insertions, by date',
    fr: 'Mises en orbite, par date',
    es: 'Inserciones en órbita, por fecha',
    'pt-BR': 'Inserções em órbita, por data',
  },
  colDate: { en: 'Date', fr: 'Date', es: 'Fecha', 'pt-BR': 'Data' },
  colProbe: { en: 'Spacecraft', fr: 'Sonde', es: 'Sonda', 'pt-BR': 'Sonda' },
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
    en: '{probe} enters orbit around {body}, {date}',
    fr: 'Mise en orbite de {probe} autour de {body}, {date}',
    es: 'Inserción en órbita de {probe} alrededor de {body}, {date}',
    'pt-BR': 'Inserção em órbita de {probe} ao redor de {body}, {date}',
  },
  pageDescription: {
    en: '{probe} became bound to {body} on {date}, {distance} km from its centre: instant measured to the second on the NASA/JPL Horizons trajectory, and the scene to open at that instant.',
    fr: '{probe} est devenue liée à {body} le {date}, à {distance} km de son centre : instant mesuré à la seconde sur la trajectoire Horizons de la NASA/JPL, et la scène à ouvrir à cet instant.',
    es: '{probe} quedó ligada a {body} el {date}, a {distance} km de su centro: instante medido al segundo sobre la trayectoria Horizons de la NASA/JPL, y la escena para abrir en ese instante.',
    'pt-BR':
      '{probe} ficou ligada a {body} em {date}, a {distance} km do seu centro: instante medido ao segundo sobre a trajetória Horizons da NASA/JPL, e a cena para abrir nesse instante.',
  },
  predictedDescription: {
    en: '{probe} is predicted to become bound to {body} on {date}, {distance} km from its centre: instant computed to the second on the trajectory predicted by NASA/JPL Horizons.',
    fr: '{probe} doit devenir liée à {body} le {date}, à {distance} km de son centre : instant calculé à la seconde sur la trajectoire prédite par Horizons de la NASA/JPL.',
    es: 'Se prevé que {probe} quede ligada a {body} el {date}, a {distance} km de su centro: instante calculado al segundo sobre la trayectoria prevista por Horizons de la NASA/JPL.',
    'pt-BR':
      'Prevê-se que {probe} fique ligada a {body} em {date}, a {distance} km do seu centro: instante calculado ao segundo sobre a trajetória prevista pelo Horizons da NASA/JPL.',
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
  meaning: {
    en: 'This is the first instant at which {probe}, inside the sphere of influence of {body}, no longer has the energy to escape its pull. An orbit insertion announced by an agency is a manoeuvre that lasts; this instant is a point within it, not necessarily its start.',
    fr: 'C’est le premier instant où {probe}, dans la sphère d’influence de {body}, n’a plus l’énergie d’échapper à son attraction. Une mise en orbite qu’annonce une agence est une manœuvre qui dure ; cet instant en est un point, pas forcément le début.',
    es: 'Es el primer instante en que {probe}, dentro de la esfera de influencia de {body}, ya no tiene la energía para escapar de su atracción. Una inserción en órbita anunciada por una agencia es una maniobra que dura; este instante es un punto de ella, no necesariamente su comienzo.',
    'pt-BR':
      'É o primeiro instante em que {probe}, dentro da esfera de influência de {body}, já não tem energia para escapar da sua atração. Uma inserção em órbita anunciada por uma agência é uma manobra que dura; este instante é um ponto dela, não necessariamente o seu início.',
  },
  predictedNote: {
    en: 'When this trajectory was read, on {date}, this had not happened yet: it is a prediction, which every manoeuvre of the spacecraft can revise.',
    fr: 'Quand cette trajectoire a été lue, le {date}, cela n’avait pas encore eu lieu : c’est une prédiction, que chaque manœuvre de la sonde peut réviser.',
    es: 'Cuando se leyó esta trayectoria, el {date}, esto aún no había ocurrido: es una predicción, que cada maniobra de la sonda puede revisar.',
    'pt-BR':
      'Quando esta trajetória foi lida, em {date}, isto ainda não havia ocorrido: é uma previsão, que cada manobra da sonda pode revisar.',
  },
  sectionManoeuvre: {
    en: 'The manoeuvre',
    fr: 'La manœuvre',
    es: 'La maniobra',
    'pt-BR': 'A manobra',
  },
  manoeuvreBefore: {
    en: 'A manoeuvre detected on the same trajectory, by another method (the trajectory departing from a coast under gravity alone), falls {minutes} min before this instant.',
    fr: 'Une manœuvre détectée sur la même trajectoire, par une autre méthode (la trajectoire qui s’écarte d’un vol sous la seule gravité), tombe {minutes} min avant cet instant.',
    es: 'Una maniobra detectada sobre la misma trayectoria, por otro método (la trayectoria que se aparta de un vuelo bajo la sola gravedad), cae {minutes} min antes de este instante.',
    'pt-BR':
      'Uma manobra detectada na mesma trajetória, por outro método (a trajetória que se afasta de um voo sob a gravidade apenas), cai {minutes} min antes deste instante.',
  },
  manoeuvreAfter: {
    en: 'A manoeuvre detected on the same trajectory, by another method (the trajectory departing from a coast under gravity alone), falls {minutes} min after this instant.',
    fr: 'Une manœuvre détectée sur la même trajectoire, par une autre méthode (la trajectoire qui s’écarte d’un vol sous la seule gravité), tombe {minutes} min après cet instant.',
    es: 'Una maniobra detectada sobre la misma trayectoria, por otro método (la trayectoria que se aparta de un vuelo bajo la sola gravedad), cae {minutes} min después de este instante.',
    'pt-BR':
      'Uma manobra detectada na mesma trajetória, por outro método (a trajetória que se afasta de um voo sob a gravidade apenas), cai {minutes} min depois deste instante.',
  },
  manoeuvreSame: {
    en: 'A manoeuvre detected on the same trajectory, by another method (the trajectory departing from a coast under gravity alone), falls within the same minute.',
    fr: 'Une manœuvre détectée sur la même trajectoire, par une autre méthode (la trajectoire qui s’écarte d’un vol sous la seule gravité), tombe dans la même minute.',
    es: 'Una maniobra detectada sobre la misma trayectoria, por otro método (la trayectoria que se aparta de un vuelo bajo la sola gravedad), cae en el mismo minuto.',
    'pt-BR':
      'Uma manobra detectada na mesma trajetória, por outro método (a trajetória que se afasta de um voo sob a gravidade apenas), cai no mesmo minuto.',
  },
  noManoeuvre: {
    en: 'No manoeuvre is detected on this trajectory: the spacecraft is captured by gravity alone.',
    fr: 'Aucune manœuvre n’est détectée sur cette trajectoire : la sonde est capturée par la seule gravité.',
    es: 'No se detecta ninguna maniobra en esta trayectoria: la sonda es capturada por la sola gravedad.',
    'pt-BR':
      'Nenhuma manobra é detectada nesta trajetória: a sonda é capturada apenas pela gravidade.',
  },
  massUnderSecond: {
    en: 'The mass of {body} is published with an uncertainty of {percent} %; across it, this instant moves by less than a second.',
    fr: 'La masse de {body} est publiée avec une incertitude de {percent} % ; d’une borne à l’autre, cet instant bouge de moins d’une seconde.',
    es: 'La masa de {body} se publica con una incertidumbre del {percent} %; de un extremo a otro, este instante se mueve menos de un segundo.',
    'pt-BR':
      'A massa de {body} é publicada com uma incerteza de {percent} %; de um extremo ao outro, este instante se move menos de um segundo.',
  },
  massSeconds: {
    en: 'The mass of {body} is published with an uncertainty of {percent} %; across it, this instant moves by up to {seconds} s.',
    fr: 'La masse de {body} est publiée avec une incertitude de {percent} % ; d’une borne à l’autre, cet instant bouge de {seconds} s au plus.',
    es: 'La masa de {body} se publica con una incertidumbre del {percent} %; de un extremo a otro, este instante se mueve hasta {seconds} s.',
    'pt-BR':
      'A massa de {body} é publicada com uma incerteza de {percent} %; de um extremo ao outro, este instante se move até {seconds} s.',
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
    en: 'The position and velocity of the spacecraft relative to the body are read from Horizons every hour across its stay in the sphere of influence, then every minute and every second around the first hour at which its energy, half the square of its speed minus the mass of the body times the gravitational constant over its distance, is negative. The mass is the one Galaxy displays for the body.',
    fr: 'La position et la vitesse de la sonde par rapport au corps sont lues dans Horizons chaque heure pendant son séjour dans la sphère d’influence, puis chaque minute et chaque seconde autour de la première heure où son énergie, la moitié du carré de sa vitesse moins la masse du corps multipliée par la constante de la gravitation et divisée par sa distance, est négative. La masse est celle que Galaxy affiche pour le corps.',
    es: 'La posición y la velocidad de la sonda respecto al cuerpo se leen en Horizons cada hora durante su estancia en la esfera de influencia, y luego cada minuto y cada segundo alrededor de la primera hora en que su energía, la mitad del cuadrado de su velocidad menos la masa del cuerpo multiplicada por la constante de gravitación y dividida por su distancia, es negativa. La masa es la que Galaxy muestra para el cuerpo.',
    'pt-BR':
      'A posição e a velocidade da sonda em relação ao corpo são lidas no Horizons a cada hora durante sua permanência na esfera de influência, e depois a cada minuto e a cada segundo em torno da primeira hora em que sua energia, metade do quadrado da sua velocidade menos a massa do corpo multiplicada pela constante gravitacional e dividida pela sua distância, é negativa. A massa é a que a Galaxy exibe para o corpo.',
  },
  differenceText: {
    en: 'Horizons does not serve this body as a centre at these dates: the position is the difference of the two positions it serves relative to the Sun.',
    fr: 'Horizons ne sert pas ce corps comme centre à ces dates : la position est la différence des deux positions qu’il sert par rapport au Soleil.',
    es: 'Horizons no sirve este cuerpo como centro en estas fechas: la posición es la diferencia de las dos posiciones que sirve respecto al Sol.',
    'pt-BR':
      'O Horizons não serve este corpo como centro nestas datas: a posição é a diferença das duas posições que ele serve em relação ao Sol.',
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
    en: 'Orbit insertions',
    fr: 'Mises en orbite',
    es: 'Inserciones en órbita',
    'pt-BR': 'Inserções em órbita',
  },
  listItem: {
    en: '{date}: {name}',
    fr: '{date} : {name}',
    es: '{date}: {name}',
    'pt-BR': '{date}: {name}',
  },
  all: {
    en: 'All orbit insertions',
    fr: 'Toutes les mises en orbite',
    es: 'Todas las inserciones en órbita',
    'pt-BR': 'Todas as inserções em órbita',
  },
} as const satisfies Record<string, DocText>;

/** Le chemin d'une page sans la langue : `orbit-insertions/juno-jupiter-2016-07-05`. */
export const orbitInsertionSlug = (
  insertion: Pick<OrbitInsertion, 'probe' | 'body' | 'at'>
): string =>
  `${ORBIT_INSERTIONS_SLUG}/${insertion.probe}-${insertion.body}-${insertion.at.slice(0, 10)}`;

/** Une mise en orbite est une prédiction quand elle suit la date à laquelle sa trajectoire a été lue. */
export const isPredicted = (
  insertion: Pick<OrbitInsertion, 'at' | 'retrieved'>
): boolean => insertion.at.slice(0, 10) > insertion.retrieved;

/** La page de la sonde à l'instant mesuré, en Explo (même forme que les survols). */
export function orbitInsertionSceneHref(
  insertion: OrbitInsertion,
  locale: Locale
): string {
  return `/${bodyPagePath(insertion.probe, locale)}/?mode=explo&date=${insertion.at}`;
}

/**
 * Une distance au centre : au km près au-delà de 100 km, au dixième en deçà, où la mesure
 * porte au mètre et où « 2 km » cacherait la différence entre Bennu (2,1) et son rayon (0,25).
 */
function distance(value: number, locale: Locale): string {
  if (value >= 100) return km(value, locale);
  return new Intl.NumberFormat(INTL_LOCALE[locale], {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

/**
 * Une vitesse : en km/s au centième, ou en cm/s quand elle passe sous le mètre par seconde, où
 * « 0,00 km/s » se lirait comme un arrêt (Bennu : 6 cm/s, 67P : 16 cm/s). Partagée avec
 * `surfaceContactPages.ts`.
 */
export function speed(valueKmS: number, locale: Locale): string {
  const format = (value: number, digits: number) =>
    new Intl.NumberFormat(INTL_LOCALE[locale], {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  return valueKmS >= 0.001
    ? `${format(valueKmS, 2)} km/s`
    : `${format(valueKmS * 100_000, 0)} cm/s`;
}

/** L'incertitude relative, en pour cent, à deux chiffres significatifs. */
const percent = (relative: number, locale: Locale): string =>
  new Intl.NumberFormat(INTL_LOCALE[locale], {
    maximumSignificantDigits: 2,
  }).format(relative * 100);

function insertionPage(
  insertion: OrbitInsertion,
  inputs: OrbitInsertionPageInputs,
  locale: Locale
): DocPage {
  const name = names(inputs);
  const probe = name(insertion.probe, locale);
  const body = name(insertion.body, locale);
  const day = longDay(insertion.at.slice(0, 10), locale);
  const shownDistance = distance(insertion.distanceKm, locale);
  const predicted = isPredicted(insertion);
  const slug = orbitInsertionSlug(insertion);
  const link = (id: string, label: string): string =>
    `<a href="/${bodyPagePath(id, locale)}/">${escapeHtml(label)}</a>`;

  const mass =
    insertion.massRelativeUncertainty === null ||
    insertion.massSensitivitySeconds === null
      ? ''
      : `<p>${escapeHtml(
          fill(
            (insertion.massSensitivitySeconds < 1
              ? TEXT.massUnderSecond
              : TEXT.massSeconds)[locale],
            {
              body,
              percent: percent(insertion.massRelativeUncertainty, locale),
              seconds: insertion.massSensitivitySeconds,
            }
          )
        )}</p>`;

  const instant =
    `<dl><dt>${escapeHtml(TEXT.instant[locale])}</dt><dd>${escapeHtml(`${day}, ${clock(insertion.at)}`)}</dd>` +
    `<dt>${escapeHtml(fill(TEXT.distance[locale], { body }))}</dt><dd>${escapeHtml(shownDistance)} km</dd>` +
    `<dt>${escapeHtml(fill(TEXT.speed[locale], { body }))}</dt><dd>${escapeHtml(speed(insertion.speedKmS, locale))}</dd></dl>` +
    `<p>${escapeHtml(fill(TEXT.meaning[locale], { probe, body }))}</p>` +
    mass +
    (predicted
      ? `<p><strong>${escapeHtml(fill(TEXT.predictedNote[locale], { date: longDay(insertion.retrieved, locale) }))}</strong></p>`
      : '');

  const gap = insertion.manoeuvre?.minutesFromInsertion;
  const manoeuvre = `<p>${escapeHtml(
    gap === undefined
      ? TEXT.noManoeuvre[locale]
      : gap === 0
        ? TEXT.manoeuvreSame[locale]
        : fill((gap < 0 ? TEXT.manoeuvreBefore : TEXT.manoeuvreAfter)[locale], {
            minutes: Math.abs(gap),
          })
  )}</p>`;

  const inGalaxy =
    `<p><a href="${escapeHtml(orbitInsertionSceneHref(insertion, locale))}">${escapeHtml(fill(TEXT.openScene[locale], { probe }))}</a></p>` +
    `<p>${escapeHtml(TEXT.pagesLead[locale])}</p><ul><li>${link(insertion.probe, probe)}</li><li>${link(insertion.body, body)}</li></ul>`;

  const method =
    `<p>${escapeHtml(TEXT.methodText[locale])}</p>` +
    (insertion.measuredFrom === 'centre'
      ? ''
      : `<p>${escapeHtml(TEXT.differenceText[locale])}</p>`);

  const source =
    `<p>${escapeHtml(HORIZONS.publisher)}, <a href="${escapeHtml(HORIZONS.url)}" rel="noopener noreferrer">${escapeHtml(HORIZONS.title)}</a>. ` +
    `${escapeHtml(fill(TEXT.read[locale], { date: longDay(insertion.retrieved, locale) }))}</p>` +
    (insertion.solution
      ? `<p>${escapeHtml(TEXT.solution[locale])} <code>${escapeHtml(insertion.solution)}</code></p>`
      : '') +
    `<p><a href="${docPath(ORBIT_INSERTIONS_SLUG, locale)}">${escapeHtml(TEXT.all[locale])}</a></p>`;

  return {
    slug,
    locale,
    canonical: `${inputs.origin}${docPath(slug, locale)}`,
    title: fill(TEXT.pageTitle[locale], { probe, body, date: day }),
    description: trimForMeta(
      fill(
        (predicted ? TEXT.predictedDescription : TEXT.pageDescription)[locale],
        { probe, body, date: day, distance: shownDistance }
      ),
      160
    ),
    updated: insertion.retrieved,
    body: [
      docSection('instant', TEXT.sectionInstant[locale], instant),
      docSection('manoeuvre', TEXT.sectionManoeuvre[locale], manoeuvre),
      docSection('in-galaxy', TEXT.sectionInGalaxy[locale], inGalaxy),
      docSection('method', TEXT.sectionMethod[locale], method),
      docSection('source', TEXT.sectionSource[locale], source),
    ].join('\n'),
  };
}

function indexPage(inputs: OrbitInsertionPageInputs, locale: Locale): DocPage {
  const { record, origin } = inputs;
  const name = names(inputs);
  const format = new Intl.NumberFormat(INTL_LOCALE[locale]);
  const rows = record.insertions.map((insertion) => [
    `<a href="${docPath(orbitInsertionSlug(insertion), locale)}">${escapeHtml(longDay(insertion.at.slice(0, 10), locale))}</a>` +
      (isPredicted(insertion)
        ? ` (${escapeHtml(TEXT.predictedMark[locale])})`
        : ''),
    escapeHtml(name(insertion.probe, locale)),
    escapeHtml(name(insertion.body, locale)),
    escapeHtml(distance(insertion.distanceKm, locale)),
  ]);
  const excluded = record.excluded.length
    ? `\n      <p>${escapeHtml(TEXT.excludedLead[locale])}</p><ul>${record.excluded
        .map(
          (e) =>
            `<li>${escapeHtml(
              fill(TEXT[e.reason][locale], {
                probe: name(e.probe, locale),
                body: name(e.body, locale),
              })
            )}</li>`
        )
        .join('')}</ul>`
    : '';
  return {
    slug: ORBIT_INSERTIONS_SLUG,
    locale,
    canonical: `${origin}${docPath(ORBIT_INSERTIONS_SLUG, locale)}`,
    title: TEXT.indexTitle[locale],
    description: fill(TEXT.indexDescription[locale], {
      count: format.format(record.insertions.length),
    }),
    updated: record.insertions
      .map((i) => i.retrieved)
      .sort()
      .at(-1)!,
    body:
      `      <p>${escapeHtml(TEXT.indexIntro[locale])}</p>\n      ` +
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
      ) +
      excluded,
  };
}

/**
 * Le relevé, vérifié avant d'en tirer une page : ordre chronologique, chemins uniques, dates à
 * la seconde, une raison connue pour chaque écart. Un relevé abîmé fait échouer le build.
 */
export function checkOrbitInsertionRecord(
  record: OrbitInsertionRecord
): OrbitInsertionRecord {
  const slugs = new Set<string>();
  let previous = '';
  for (const insertion of record.insertions) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(insertion.at))
      throw new Error(`mise en orbite datée hors format : ${insertion.at}`);
    if (insertion.at < previous)
      throw new Error(
        `mises en orbite hors d'ordre : ${insertion.at} après ${previous}`
      );
    previous = insertion.at;
    const slug = orbitInsertionSlug(insertion);
    if (slugs.has(slug))
      throw new Error(`deux mises en orbite au même chemin : ${slug}`);
    slugs.add(slug);
    if (
      insertion.measuredFrom !== 'centre' &&
      insertion.measuredFrom !== 'difference'
    )
      throw new Error(`mise en orbite sans méthode de mesure : ${slug}`);
    if (!(insertion.distanceKm > 0) || !(insertion.speedKmS > 0))
      throw new Error(`mise en orbite sans distance ou sans vitesse : ${slug}`);
  }
  for (const e of record.excluded)
    if (!['boundAtEntry', 'coverage', 'unresolved'].includes(e.reason))
      throw new Error(`écart sans raison connue : ${e.probe} / ${e.body}`);
  return record;
}

/** L'index puis une page par mise en orbite, dans une langue. */
export function orbitInsertionPages(
  inputs: OrbitInsertionPageInputs,
  locale: Locale
): DocPage[] {
  checkOrbitInsertionRecord(inputs.record);
  return [
    indexPage(inputs, locale),
    ...inputs.record.insertions.map((i) => insertionPage(i, inputs, locale)),
  ];
}

/**
 * Pour chaque sonde et chaque corps, le fragment HTML de ses mises en orbite, dans une langue,
 * que leurs pages ajoutent après leurs survols. Dérivé du MÊME relevé que les pages.
 */
export function orbitInsertionListsByObject(
  inputs: OrbitInsertionPageInputs,
  locale: Locale
): Map<string, string> {
  const name = names(inputs);
  const items = new Map<string, string[]>();
  for (const insertion of checkOrbitInsertionRecord(inputs.record).insertions) {
    const day = longDay(insertion.at.slice(0, 10), locale);
    const href = docPath(orbitInsertionSlug(insertion), locale);
    for (const [id, other] of [
      [insertion.probe, insertion.body],
      [insertion.body, insertion.probe],
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
