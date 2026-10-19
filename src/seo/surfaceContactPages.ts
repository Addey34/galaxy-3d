/**
 * PAGES DES CONTACTS (lot 49, pas 3, 2026-10-15) : l'index `/contacts/` et une page par contact
 * d'une sonde avec un corps, dans les quatre langues.
 *
 * `pnpm contacts:generate` lit, sur la trajectoire que sert Horizons, trois formes de contact
 * (`src/seo/surfaceContacts.json`) :
 *   - `rest` : la distance au centre d'un petit corps cesse de varier jusqu'à la fin de la
 *     trajectoire (Rosetta sur 67P) ;
 *   - `touch` : elle cesse de varier quelques secondes, puis la sonde repart (OSIRIS-REx sur
 *     Bennu) ;
 *   - `entry` : la sonde passe sous le niveau de 1 bar d'une planète géante, qui n'a pas de
 *     surface solide (Cassini dans Saturne).
 *
 * CE QUE LA PAGE AFFIRME : l'instant, la distance au centre, et le témoin qui dit que la mesure
 * décrit bien un contact (au repos, une vitesse qu'explique la rotation du corps ; au niveau de
 * 1 bar, une vitesse relative à la planète tombée bien sous celle d'avant). Rien de ce que la
 * trajectoire ne dit pas : ni le nom d'une opération, ni une perte de signal, ni la destruction
 * d'une sonde.
 *
 * Module PUR : le relevé est lu par le greffon de build et passé en argument.
 */
import type { CelestialBodyConfig, CelestialConfig } from '@/types';
import { INTL_LOCALE, type Locale } from '@/i18n/locales';
import { bodyPagePath, escapeHtml, trimForMeta } from './bodyLandingPage';
import {
  CONTACTS_SLUG,
  docPath,
  docSection,
  docTable,
  type DocPage,
  type DocText,
} from './documentPage';
import { clock, fill, HORIZONS, km, names } from './flybyPages';
import { longDay } from './instrumentLandingPage';
import { speed } from './orbitInsertionPages';

interface ContactBase {
  probe: string;
  body: string;
  /** Instant UTC du contact, à la seconde. */
  at: string;
  /**
   * Instant où la scène s'ouvre : celui du contact, sauf au niveau de 1 bar, où la sonde n'est
   * plus dessinée (la trajectoire servie traverse la planète, le fichier livré s'arrête juste
   * avant) : une minute plus tôt, ce que le lien DIT.
   */
  sceneAt: string;
  /** Distance au CENTRE du corps à cet instant, km. */
  distanceKm: number;
  solution: string | null;
  measuredFrom: 'centre' | 'difference';
  retrieved: string;
}

/** Le repos sur un petit corps, définitif (`rest`) ou bref (`touch`). */
export interface RestContact extends ContactBase {
  kind: 'rest' | 'touch';
  /** Durée du repos en secondes pour un contact bref ; `null` quand il dure jusqu'à la fin. */
  restSeconds: number | null;
  /** Vitesse relative au corps pendant le repos, km/s. */
  speedKmS: number;
  /** Vitesse d'un point de l'équateur à cette distance, par la période de la fiche, ou `null`. */
  rotationSpeedKmS: number | null;
}

/** Le passage du niveau de 1 bar d'une planète géante. */
interface EntryContact extends ContactBase {
  kind: 'entry';
  /** Latitude planétocentrique au pôle de l'UAI, degrés. */
  latitudeDeg: number;
  /** Vitesse relative à la planète en rotation au passage, km/s. */
  relativeSpeedKmS: number;
  /** La plus grande vitesse relative atteinte avant le passage, et où. */
  peak: { at: string; relativeSpeedKmS: number; altitudeKm: number };
}

export type SurfaceContact = RestContact | EntryContact;

type SurfaceContactExclusion = 'unresolved';

export interface SurfaceContactRecord {
  source: string;
  contacts: SurfaceContact[];
  excluded: { probe: string; body: string; reason: SurfaceContactExclusion }[];
}

export interface SurfaceContactPageInputs {
  record: SurfaceContactRecord;
  config: CelestialConfig;
  navigable: ReadonlyMap<string, CelestialBodyConfig>;
  origin: string;
}

const TEXT = {
  indexTitle: {
    en: 'Spacecraft contacts with a body',
    fr: 'Les contacts des sondes avec un corps',
    es: 'Los contactos de las sondas con un cuerpo',
    'pt-BR': 'Os contatos das sondas com um corpo',
  },
  indexDescription: {
    en: '{count} contacts of a spacecraft with a comet, an asteroid or a giant planet, each measured to the second on its NASA/JPL Horizons trajectory.',
    fr: '{count} contacts d’une sonde avec une comète, un astéroïde ou une planète géante, chacun mesuré à la seconde sur sa trajectoire Horizons de la NASA/JPL.',
    es: '{count} contactos de una sonda con un cometa, un asteroide o un planeta gigante, cada uno medido al segundo sobre su trayectoria Horizons de la NASA/JPL.',
    'pt-BR':
      '{count} contatos de uma sonda com um cometa, um asteroide ou um planeta gigante, cada um medido ao segundo sobre sua trajetória Horizons da NASA/JPL.',
  },
  indexIntro: {
    en: 'A trajectory meets a body in three ways: it comes to rest on a small body and stays there until it ends; it rests on it for a few seconds, then leaves; or it passes below the 1-bar level of a giant planet, which has no solid surface. Each instant is read to the second on the true trajectory of the spacecraft Galaxy follows.',
    fr: 'Une trajectoire rencontre un corps de trois façons : elle s’immobilise sur un petit corps et y reste jusqu’à sa fin ; elle s’y immobilise quelques secondes, puis repart ; ou elle passe sous le niveau de 1 bar d’une planète géante, qui n’a pas de surface solide. Chaque instant est lu à la seconde sur la vraie trajectoire des sondes que Galaxy suit.',
    es: 'Una trayectoria encuentra un cuerpo de tres maneras: queda inmóvil sobre un cuerpo menor y permanece allí hasta su final; queda inmóvil unos segundos y luego se aleja; o pasa por debajo del nivel de 1 bar de un planeta gigante, que no tiene superficie sólida. Cada instante se lee al segundo sobre la trayectoria real de las sondas que Galaxy sigue.',
    'pt-BR':
      'Uma trajetória encontra um corpo de três maneiras: fica imóvel sobre um corpo menor e permanece ali até o seu fim; fica imóvel alguns segundos e depois se afasta; ou passa abaixo do nível de 1 bar de um planeta gigante, que não tem superfície sólida. Cada instante é lido ao segundo sobre a trajetória real das sondas que a Galaxy acompanha.',
  },
  excludedLead: {
    en: 'These stays have no page:',
    fr: 'Ces séjours n’ont pas de page :',
    es: 'Estas estancias no tienen página:',
    'pt-BR': 'Estas permanências não têm página:',
  },
  unresolved: {
    en: '{probe} at {body}: the trajectory Horizons serves jumps discontinuously near the body, and no contact can be read on it.',
    fr: '{probe} à {body} : la trajectoire que sert Horizons y fait des sauts, et aucun contact ne peut s’y lire.',
    es: '{probe} en {body}: la trayectoria que sirve Horizons da saltos cerca del cuerpo, y en ella no puede leerse ningún contacto.',
    'pt-BR':
      '{probe} em {body}: a trajetória que o Horizons serve dá saltos perto do corpo, e nela nenhum contato pode ser lido.',
  },
  tableCaption: {
    en: 'Contacts, by date',
    fr: 'Contacts, par date',
    es: 'Contactos, por fecha',
    'pt-BR': 'Contatos, por data',
  },
  colDate: { en: 'Date', fr: 'Date', es: 'Fecha', 'pt-BR': 'Data' },
  colProbe: { en: 'Spacecraft', fr: 'Sonde', es: 'Sonda', 'pt-BR': 'Sonda' },
  colBody: { en: 'Body', fr: 'Corps', es: 'Cuerpo', 'pt-BR': 'Corpo' },
  colKind: { en: 'Contact', fr: 'Contact', es: 'Contacto', 'pt-BR': 'Contato' },
  kindRest: {
    en: 'at rest until the end',
    fr: 'immobile jusqu’à la fin',
    es: 'inmóvil hasta el final',
    'pt-BR': 'imóvel até o fim',
  },
  kindTouch: {
    en: 'at rest for {seconds} s',
    fr: 'immobile {seconds} s',
    es: 'inmóvil {seconds} s',
    'pt-BR': 'imóvel {seconds} s',
  },
  kindEntry: {
    en: 'below the 1-bar level',
    fr: 'sous le niveau de 1 bar',
    es: 'bajo el nivel de 1 bar',
    'pt-BR': 'abaixo do nível de 1 bar',
  },
  titleRest: {
    en: '{probe} comes to rest on {body}, {date}',
    fr: '{probe} s’immobilise sur {body}, {date}',
    es: '{probe} queda inmóvil sobre {body}, {date}',
    'pt-BR': '{probe} fica imóvel sobre {body}, {date}',
  },
  titleTouch: {
    en: '{probe} touches {body}, {date}',
    fr: '{probe} touche {body}, {date}',
    es: '{probe} toca {body}, {date}',
    'pt-BR': '{probe} toca {body}, {date}',
  },
  titleEntry: {
    en: '{probe} reaches the 1-bar level of {body}, {date}',
    fr: '{probe} atteint le niveau de 1 bar de {body}, {date}',
    es: '{probe} alcanza el nivel de 1 bar de {body}, {date}',
    'pt-BR': '{probe} atinge o nível de 1 bar de {body}, {date}',
  },
  descriptionRest: {
    en: 'On {date}, the trajectory of {probe} stops moving relative to {body}, {distance} km from its centre, and keeps it there until it ends: instant measured to the second on NASA/JPL Horizons.',
    fr: 'Le {date}, la trajectoire de {probe} cesse de bouger par rapport à {body}, à {distance} km de son centre, et l’y garde jusqu’à sa fin : instant mesuré à la seconde sur Horizons de la NASA/JPL.',
    es: 'El {date}, la trayectoria de {probe} deja de moverse respecto a {body}, a {distance} km de su centro, y la mantiene allí hasta su final: instante medido al segundo sobre Horizons de la NASA/JPL.',
    'pt-BR':
      'Em {date}, a trajetória de {probe} para de se mover em relação a {body}, a {distance} km do seu centro, e a mantém ali até o seu fim: instante medido ao segundo sobre o Horizons da NASA/JPL.',
  },
  descriptionTouch: {
    en: 'On {date}, the trajectory of {probe} rests on {body} for {seconds} s, {distance} km from its centre, then leaves: instant measured to the second on NASA/JPL Horizons.',
    fr: 'Le {date}, la trajectoire de {probe} s’immobilise {seconds} s sur {body}, à {distance} km de son centre, puis repart : instant mesuré à la seconde sur Horizons de la NASA/JPL.',
    es: 'El {date}, la trayectoria de {probe} queda inmóvil {seconds} s sobre {body}, a {distance} km de su centro, y luego se aleja: instante medido al segundo sobre Horizons de la NASA/JPL.',
    'pt-BR':
      'Em {date}, a trajetória de {probe} fica imóvel {seconds} s sobre {body}, a {distance} km do seu centro, e depois se afasta: instante medido ao segundo sobre o Horizons da NASA/JPL.',
  },
  descriptionEntry: {
    en: 'On {date}, the trajectory of {probe} passes below the 1-bar level of {body}, the reference of its radius: instant measured to the second on NASA/JPL Horizons.',
    fr: 'Le {date}, la trajectoire de {probe} passe sous le niveau de 1 bar de {body}, la référence de son rayon : instant mesuré à la seconde sur Horizons de la NASA/JPL.',
    es: 'El {date}, la trayectoria de {probe} pasa por debajo del nivel de 1 bar de {body}, la referencia de su radio: instante medido al segundo sobre Horizons de la NASA/JPL.',
    'pt-BR':
      'Em {date}, a trajetória de {probe} passa abaixo do nível de 1 bar de {body}, a referência do seu raio: instante medido ao segundo sobre o Horizons da NASA/JPL.',
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
  restFor: {
    en: 'At rest for',
    fr: 'Immobile pendant',
    es: 'Inmóvil durante',
    'pt-BR': 'Imóvel durante',
  },
  latitude: {
    en: 'Latitude (planetocentric)',
    fr: 'Latitude (planétocentrique)',
    es: 'Latitud (planetocéntrica)',
    'pt-BR': 'Latitude (planetocêntrica)',
  },
  meaningRest: {
    en: 'From this second on, the distance between {probe} and the centre of {body} no longer changes: the trajectory holds the spacecraft on the body, carried along by its rotation, until the trajectory ends.',
    fr: 'À partir de cette seconde, la distance entre {probe} et le centre de {body} ne change plus : la trajectoire garde la sonde sur le corps, emportée par sa rotation, jusqu’à la fin de la trajectoire.',
    es: 'A partir de este segundo, la distancia entre {probe} y el centro de {body} ya no cambia: la trayectoria mantiene la sonda sobre el cuerpo, arrastrada por su rotación, hasta el final de la trayectoria.',
    'pt-BR':
      'A partir deste segundo, a distância entre {probe} e o centro de {body} não muda mais: a trajetória mantém a sonda sobre o corpo, levada pela sua rotação, até o fim da trajetória.',
  },
  meaningTouch: {
    en: 'For {seconds} s from this second, the distance between {probe} and the centre of {body} no longer changes: the trajectory holds the spacecraft on the body, carried along by its rotation. Then the spacecraft moves away again.',
    fr: 'Pendant {seconds} s à partir de cette seconde, la distance entre {probe} et le centre de {body} ne change plus : la trajectoire garde la sonde sur le corps, emportée par sa rotation. Puis la sonde s’éloigne de nouveau.',
    es: 'Durante {seconds} s a partir de este segundo, la distancia entre {probe} y el centro de {body} ya no cambia: la trayectoria mantiene la sonda sobre el cuerpo, arrastrada por su rotación. Luego la sonda vuelve a alejarse.',
    'pt-BR':
      'Durante {seconds} s a partir deste segundo, a distância entre {probe} e o centro de {body} não muda mais: a trajetória mantém a sonda sobre o corpo, levada pela sua rotação. Depois a sonda volta a se afastar.',
  },
  witnessRotation: {
    en: 'Its speed meanwhile, {speed}, is that of a point of the surface: at this distance, with the rotation period Galaxy displays for {body}, a point on the equator moves at {rotation}, and a point at higher latitude more slowly.',
    fr: 'Sa vitesse pendant ce temps, {speed}, est celle d’un point de la surface : à cette distance, avec la période de rotation que Galaxy affiche pour {body}, un point de l’équateur se déplace à {rotation}, et un point de plus haute latitude plus lentement.',
    es: 'Su velocidad mientras tanto, {speed}, es la de un punto de la superficie: a esta distancia, con el período de rotación que Galaxy muestra para {body}, un punto del ecuador se desplaza a {rotation}, y un punto de mayor latitud más despacio.',
    'pt-BR':
      'Sua velocidade enquanto isso, {speed}, é a de um ponto da superfície: a esta distância, com o período de rotação que a Galaxy exibe para {body}, um ponto do equador se desloca a {rotation}, e um ponto de latitude maior mais devagar.',
  },
  meaningEntry: {
    en: '{body} has no solid surface: the level where the pressure is 1 bar is the reference of its radius. This is the second at which the trajectory of {probe} passes below that level, on the ellipsoid of the radii the International Astronomical Union publishes, oriented by the pole it publishes for {body} at that date.',
    fr: '{body} n’a pas de surface solide : le niveau où la pression vaut 1 bar est la référence de son rayon. C’est la seconde où la trajectoire de {probe} passe sous ce niveau, sur l’ellipsoïde des rayons que publie l’Union astronomique internationale, orienté par le pôle qu’elle publie pour {body} à cette date.',
    es: '{body} no tiene superficie sólida: el nivel donde la presión vale 1 bar es la referencia de su radio. Es el segundo en que la trayectoria de {probe} pasa por debajo de ese nivel, sobre el elipsoide de los radios que publica la Unión Astronómica Internacional, orientado por el polo que publica para {body} en esa fecha.',
    'pt-BR':
      '{body} não tem superfície sólida: o nível onde a pressão vale 1 bar é a referência do seu raio. É o segundo em que a trajetória de {probe} passa abaixo desse nível, sobre o elipsoide dos raios que a União Astronômica Internacional publica, orientado pelo polo que ela publica para {body} nessa data.',
  },
  witnessSlowdown: {
    en: 'Its speed relative to the rotating planet is then {speed}. At {peakTime}, {peakAltitude} km higher, it was {peak}: the trajectory has slowed down in the atmosphere, it is not a free fall crossing a sphere.',
    fr: 'Sa vitesse par rapport à la planète en rotation vaut alors {speed}. À {peakTime}, {peakAltitude} km plus haut, elle valait {peak} : la trajectoire a ralenti dans l’atmosphère, ce n’est pas une chute libre qui traverse une sphère.',
    es: 'Su velocidad respecto al planeta en rotación es entonces {speed}. A las {peakTime}, {peakAltitude} km más arriba, era {peak}: la trayectoria se ha frenado en la atmósfera, no es una caída libre que atraviesa una esfera.',
    'pt-BR':
      'Sua velocidade em relação ao planeta em rotação é então {speed}. Às {peakTime}, {peakAltitude} km mais acima, era {peak}: a trajetória desacelerou na atmosfera, não é uma queda livre que atravessa uma esfera.',
  },
  beyondEntry: {
    en: 'Horizons continues this trajectory below the 1-bar level, through the planet; Galaxy stops drawing the spacecraft just before it.',
    fr: 'Horizons prolonge cette trajectoire sous le niveau de 1 bar, à travers la planète ; Galaxy cesse de dessiner la sonde juste avant.',
    es: 'Horizons prolonga esta trayectoria por debajo del nivel de 1 bar, a través del planeta; Galaxy deja de dibujar la sonda justo antes.',
    'pt-BR':
      'O Horizons prolonga esta trajetória abaixo do nível de 1 bar, através do planeta; a Galaxy deixa de desenhar a sonda logo antes.',
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
  openSceneBefore: {
    en: 'Open {probe} one minute before this instant, at true scale',
    fr: 'Ouvrir {probe} une minute avant cet instant, à l’échelle réelle',
    es: 'Abrir {probe} un minuto antes de este instante, a escala real',
    'pt-BR': 'Abrir {probe} um minuto antes deste instante, em escala real',
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
  methodRest: {
    en: 'The position and velocity of the spacecraft relative to the body are read from Horizons every minute around its closest approach, then every second. The contact is the first run of at least three seconds during which the spacecraft neither approaches the centre of the body nor recedes from it by more than 2 mm/s.',
    fr: 'La position et la vitesse de la sonde par rapport au corps sont lues dans Horizons chaque minute autour de son passage au plus près, puis chaque seconde. Le contact est la première suite d’au moins trois secondes pendant laquelle la sonde ne s’approche ni ne s’éloigne du centre du corps de plus de 2 mm/s.',
    es: 'La posición y la velocidad de la sonda respecto al cuerpo se leen en Horizons cada minuto alrededor de su máximo acercamiento, y luego cada segundo. El contacto es la primera serie de al menos tres segundos durante la cual la sonda no se acerca al centro del cuerpo ni se aleja de él a más de 2 mm/s.',
    'pt-BR':
      'A posição e a velocidade da sonda em relação ao corpo são lidas no Horizons a cada minuto em torno da sua maior aproximação, e depois a cada segundo. O contato é a primeira sequência de pelo menos três segundos durante a qual a sonda não se aproxima do centro do corpo nem se afasta dele a mais de 2 mm/s.',
  },
  methodEntry: {
    en: 'The position and velocity of the spacecraft relative to the planet are read from Horizons every minute in the hours before the 1-bar level, then every second. The level is the ellipsoid of the equatorial and polar radii of the IAU rotation model that NASA NAIF distributes; the speed relative to the planet subtracts the rotation of a rigid body at the period of that model.',
    fr: 'La position et la vitesse de la sonde par rapport à la planète sont lues dans Horizons chaque minute dans les heures qui précèdent le niveau de 1 bar, puis chaque seconde. Le niveau est l’ellipsoïde des rayons équatorial et polaire du modèle de rotation de l’UAI que diffuse le NAIF de la NASA ; la vitesse par rapport à la planète retranche la rotation d’un corps rigide à la période de ce modèle.',
    es: 'La posición y la velocidad de la sonda respecto al planeta se leen en Horizons cada minuto en las horas previas al nivel de 1 bar, y luego cada segundo. El nivel es el elipsoide de los radios ecuatorial y polar del modelo de rotación de la UAI que distribuye el NAIF de la NASA; la velocidad respecto al planeta resta la rotación de un cuerpo rígido con el período de ese modelo.',
    'pt-BR':
      'A posição e a velocidade da sonda em relação ao planeta são lidas no Horizons a cada minuto nas horas que precedem o nível de 1 bar, e depois a cada segundo. O nível é o elipsoide dos raios equatorial e polar do modelo de rotação da UAI que o NAIF da NASA distribui; a velocidade em relação ao planeta subtrai a rotação de um corpo rígido com o período desse modelo.',
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
    en: 'Contacts',
    fr: 'Contacts',
    es: 'Contactos',
    'pt-BR': 'Contatos',
  },
  listItem: {
    en: '{date}: {name}',
    fr: '{date} : {name}',
    es: '{date}: {name}',
    'pt-BR': '{date}: {name}',
  },
  all: {
    en: 'All contacts',
    fr: 'Tous les contacts',
    es: 'Todos los contactos',
    'pt-BR': 'Todos os contatos',
  },
} as const satisfies Record<string, DocText>;

/** Le chemin d'une page sans la langue : `contacts/rosetta-churyumov-gerasimenko-2016-09-30`. */
export const surfaceContactSlug = (
  contact: Pick<SurfaceContact, 'probe' | 'body' | 'at'>
): string =>
  `${CONTACTS_SLUG}/${contact.probe}-${contact.body}-${contact.at.slice(0, 10)}`;

/** La page de la sonde à l'instant du contact, en Explo (même forme que les survols). */
export function surfaceContactSceneHref(
  contact: SurfaceContact,
  locale: Locale
): string {
  return `/${bodyPagePath(contact.probe, locale)}/?mode=explo&date=${contact.sceneAt}`;
}

/**
 * Une distance au centre : au km près au-delà de 100 km ; au mètre en deçà, où « 0,2 km »
 * cacherait que la sonde est SOUS le rayon moyen de Bennu (0,242 km), dans un creux.
 */
function distance(value: number, locale: Locale): string {
  if (value >= 100) return km(value, locale);
  return new Intl.NumberFormat(INTL_LOCALE[locale], {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(value);
}

const number = (value: number, digits: number, locale: Locale): string =>
  new Intl.NumberFormat(INTL_LOCALE[locale], {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);

function kindLabel(contact: SurfaceContact, locale: Locale): string {
  if (contact.kind === 'entry') return TEXT.kindEntry[locale];
  if (contact.restSeconds === null) return TEXT.kindRest[locale];
  return fill(TEXT.kindTouch[locale], { seconds: contact.restSeconds });
}

function title(
  contact: SurfaceContact,
  locale: Locale,
  probe: string,
  body: string,
  date: string
) {
  const template =
    contact.kind === 'entry'
      ? TEXT.titleEntry
      : contact.restSeconds === null
        ? TEXT.titleRest
        : TEXT.titleTouch;
  return fill(template[locale], { probe, body, date });
}

function contactPage(
  contact: SurfaceContact,
  inputs: SurfaceContactPageInputs,
  locale: Locale
): DocPage {
  const name = names(inputs);
  const probe = name(contact.probe, locale);
  const body = name(contact.body, locale);
  const day = longDay(contact.at.slice(0, 10), locale);
  const shownDistance = distance(contact.distanceKm, locale);
  const slug = surfaceContactSlug(contact);
  const link = (id: string, label: string): string =>
    `<a href="/${bodyPagePath(id, locale)}/">${escapeHtml(label)}</a>`;

  let facts =
    `<dt>${escapeHtml(TEXT.instant[locale])}</dt><dd>${escapeHtml(`${day}, ${clock(contact.at)}`)}</dd>` +
    `<dt>${escapeHtml(fill(TEXT.distance[locale], { body }))}</dt><dd>${escapeHtml(shownDistance)} km</dd>`;
  let meaning: string;
  let description: string;
  if (contact.kind === 'entry') {
    facts += `<dt>${escapeHtml(TEXT.latitude[locale])}</dt><dd>${escapeHtml(number(contact.latitudeDeg, 1, locale))}°</dd>`;
    meaning =
      `<p>${escapeHtml(fill(TEXT.meaningEntry[locale], { probe, body }))}</p>` +
      `<p>${escapeHtml(
        fill(TEXT.witnessSlowdown[locale], {
          speed: speed(contact.relativeSpeedKmS, locale),
          peakTime: clock(contact.peak.at),
          peakAltitude: km(contact.peak.altitudeKm, locale),
          peak: speed(contact.peak.relativeSpeedKmS, locale),
        })
      )}</p>` +
      `<p>${escapeHtml(TEXT.beyondEntry[locale])}</p>`;
    description = fill(TEXT.descriptionEntry[locale], {
      probe,
      body,
      date: day,
    });
  } else {
    const seconds = contact.restSeconds;
    if (seconds !== null)
      facts += `<dt>${escapeHtml(TEXT.restFor[locale])}</dt><dd>${seconds} s</dd>`;
    meaning =
      `<p>${escapeHtml(
        seconds === null
          ? fill(TEXT.meaningRest[locale], { probe, body })
          : fill(TEXT.meaningTouch[locale], { probe, body, seconds })
      )}</p>` +
      (contact.rotationSpeedKmS === null
        ? ''
        : `<p>${escapeHtml(
            fill(TEXT.witnessRotation[locale], {
              speed: speed(contact.speedKmS, locale),
              body,
              rotation: speed(contact.rotationSpeedKmS, locale),
            })
          )}</p>`);
    description = fill(
      (seconds === null ? TEXT.descriptionRest : TEXT.descriptionTouch)[locale],
      { probe, body, date: day, distance: shownDistance, seconds: seconds ?? 0 }
    );
  }
  const instant = `<dl>${facts}</dl>` + meaning;

  const inGalaxy =
    `<p><a href="${escapeHtml(surfaceContactSceneHref(contact, locale))}">${escapeHtml(
      fill(
        (contact.kind === 'entry' ? TEXT.openSceneBefore : TEXT.openScene)[
          locale
        ],
        { probe }
      )
    )}</a></p>` +
    `<p>${escapeHtml(TEXT.pagesLead[locale])}</p><ul><li>${link(contact.probe, probe)}</li><li>${link(contact.body, body)}</li></ul>`;

  const method =
    `<p>${escapeHtml((contact.kind === 'entry' ? TEXT.methodEntry : TEXT.methodRest)[locale])}</p>` +
    (contact.measuredFrom === 'centre'
      ? ''
      : `<p>${escapeHtml(TEXT.differenceText[locale])}</p>`);

  const source =
    `<p>${escapeHtml(HORIZONS.publisher)}, <a href="${escapeHtml(HORIZONS.url)}" rel="noopener noreferrer">${escapeHtml(HORIZONS.title)}</a>. ` +
    `${escapeHtml(fill(TEXT.read[locale], { date: longDay(contact.retrieved, locale) }))}</p>` +
    (contact.solution
      ? `<p>${escapeHtml(TEXT.solution[locale])} <code>${escapeHtml(contact.solution)}</code></p>`
      : '') +
    `<p><a href="${docPath(CONTACTS_SLUG, locale)}">${escapeHtml(TEXT.all[locale])}</a></p>`;

  return {
    slug,
    locale,
    canonical: `${inputs.origin}${docPath(slug, locale)}`,
    title: title(contact, locale, probe, body, day),
    description: trimForMeta(description, 160),
    updated: contact.retrieved,
    body: [
      docSection('instant', TEXT.sectionInstant[locale], instant),
      docSection('in-galaxy', TEXT.sectionInGalaxy[locale], inGalaxy),
      docSection('method', TEXT.sectionMethod[locale], method),
      docSection('source', TEXT.sectionSource[locale], source),
    ].join('\n'),
  };
}

function indexPage(inputs: SurfaceContactPageInputs, locale: Locale): DocPage {
  const { record, origin } = inputs;
  const name = names(inputs);
  const format = new Intl.NumberFormat(INTL_LOCALE[locale]);
  const rows = record.contacts.map((contact) => [
    `<a href="${docPath(surfaceContactSlug(contact), locale)}">${escapeHtml(longDay(contact.at.slice(0, 10), locale))}</a>`,
    escapeHtml(name(contact.probe, locale)),
    escapeHtml(name(contact.body, locale)),
    escapeHtml(kindLabel(contact, locale)),
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
    slug: CONTACTS_SLUG,
    locale,
    canonical: `${origin}${docPath(CONTACTS_SLUG, locale)}`,
    title: TEXT.indexTitle[locale],
    description: fill(TEXT.indexDescription[locale], {
      count: format.format(record.contacts.length),
    }),
    updated: record.contacts
      .map((c) => c.retrieved)
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
          TEXT.colKind[locale],
        ],
        rows,
        3
      ) +
      excluded,
  };
}

/**
 * Le relevé, vérifié avant d'en tirer une page : ordre chronologique, chemins uniques, dates à
 * la seconde, une forme et une raison connues. Un relevé abîmé fait échouer le build.
 */
export function checkSurfaceContactRecord(
  record: SurfaceContactRecord
): SurfaceContactRecord {
  const slugs = new Set<string>();
  let previous = '';
  for (const contact of record.contacts) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(contact.at))
      throw new Error(`contact daté hors format : ${contact.at}`);
    if (contact.at < previous)
      throw new Error(
        `contacts hors d'ordre : ${contact.at} après ${previous}`
      );
    previous = contact.at;
    const slug = surfaceContactSlug(contact);
    if (slugs.has(slug))
      throw new Error(`deux contacts au même chemin : ${slug}`);
    slugs.add(slug);
    if (!['rest', 'touch', 'entry'].includes(contact.kind))
      throw new Error(`contact de forme inconnue : ${slug}`);
    if (
      contact.kind !== 'entry' &&
      (contact.kind === 'rest') !== (contact.restSeconds === null)
    )
      throw new Error(`durée de repos incohérente avec la forme : ${slug}`);
    if (
      contact.measuredFrom !== 'centre' &&
      contact.measuredFrom !== 'difference'
    )
      throw new Error(`contact sans méthode de mesure : ${slug}`);
    if (!(contact.distanceKm > 0))
      throw new Error(`contact sans distance : ${slug}`);
  }
  for (const e of record.excluded)
    if (e.reason !== 'unresolved')
      throw new Error(`écart sans raison connue : ${e.probe} / ${e.body}`);
  return record;
}

/** L'index puis une page par contact, dans une langue. */
export function surfaceContactPages(
  inputs: SurfaceContactPageInputs,
  locale: Locale
): DocPage[] {
  checkSurfaceContactRecord(inputs.record);
  return [
    indexPage(inputs, locale),
    ...inputs.record.contacts.map((c) => contactPage(c, inputs, locale)),
  ];
}

/**
 * Pour chaque sonde et chaque corps, le fragment HTML de ses contacts, dans une langue, que leurs
 * pages ajoutent après leurs mises en orbite. Dérivé du MÊME relevé que les pages.
 */
export function surfaceContactListsByObject(
  inputs: SurfaceContactPageInputs,
  locale: Locale
): Map<string, string> {
  const name = names(inputs);
  const items = new Map<string, string[]>();
  for (const contact of checkSurfaceContactRecord(inputs.record).contacts) {
    const day = longDay(contact.at.slice(0, 10), locale);
    const href = docPath(surfaceContactSlug(contact), locale);
    for (const [id, other] of [
      [contact.probe, contact.body],
      [contact.body, contact.probe],
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
