/**
 * Contenu des tours guidés scénarisés (`src/ui/tourPlayer.ts`). Données uniquement — pas de
 * DOM, pas de Three.js. Narration en `LocalizedText`, comme `realData.description` du
 * catalogue (`config/bodies.ts`) : contenu long, donc pas dans `i18n/locales.ts` qui reste
 * réservé aux chaînes courtes de chrome UI.
 */
import type { LocalizedText } from '@/types';
import type { TourScript } from '@/core/tourEngine';
import { findUpcomingAstronomicalEvents } from '@/core/astronomicalEvents';

/** Large fenêtre de recherche : une éclipse solaire totale ou partielle survient chaque année. */
const ECLIPSE_SEARCH_HORIZON_DAYS = 3650;
const ECLIPSE_SEARCH_COUNT = 100;

/**
 * Résout la prochaine vraie date d'éclipse solaire depuis `referenceDate` — jamais une date en
 * dur (elle deviendrait fausse avec le temps). Repli sur `referenceDate` elle-même dans le cas
 * (en pratique jamais atteint sur 10 ans) où aucune éclipse n'est trouvée.
 */
export function resolveEclipseDate(referenceDate: Date): Date {
  const events = findUpcomingAstronomicalEvents(referenceDate, {
    count: ECLIPSE_SEARCH_COUNT,
    horizonDays: ECLIPSE_SEARCH_HORIZON_DAYS,
  });
  const eclipse = events.find((event) => event.kind === 'solar-eclipse');
  return eclipse?.date ?? referenceDate;
}

const eclipseIntro: LocalizedText = {
  en: 'A total solar eclipse happens when the Moon passes exactly between the Sun and the Earth, casting its shadow on our planet. We just jumped to a real upcoming eclipse date.',
  fr: 'Une éclipse solaire totale se produit quand la Lune passe exactement entre le Soleil et la Terre, projetant son ombre sur notre planète. On vient de sauter à une vraie date d’éclipse à venir.',
  es: 'Un eclipse solar total ocurre cuando la Luna pasa exactamente entre el Sol y la Tierra, proyectando su sombra sobre nuestro planeta. Acabamos de saltar a una fecha real de eclipse por venir.',
  'pt-BR':
    'Um eclipse solar total acontece quando a Lua passa exatamente entre o Sol e a Terra, projetando a sua sombra sobre o nosso planeta. Acabamos de saltar para uma data real de eclipse futuro.',
};
const eclipseMoon: LocalizedText = {
  en: 'From the Moon, you can see the shadow it casts on Earth, with the same eclipse shadow rendering used for the real-time view.',
  fr: 'Depuis la Lune, on voit l’ombre qu’elle projette sur la Terre, avec le même rendu d’ombre d’éclipse qu’en vue temps réel.',
  es: 'Desde la Luna se ve la sombra que proyecta sobre la Tierra, con el mismo dibujo de sombra de eclipse que en la vista en tiempo real.',
  'pt-BR':
    'Da Lua, vê-se a sombra que ela projeta sobre a Terra, com o mesmo desenho de sombra de eclipse da vista em tempo real.',
};

const galileanIntro: LocalizedText = {
  en: 'Jupiter and its four largest moons (Io, Europa, Ganymede and Callisto), discovered by Galileo in 1610. Time is now sped up so you can watch them orbit.',
  fr: 'Jupiter et ses quatre plus grandes lunes (Io, Europe, Ganymède et Callisto), découvertes par Galilée en 1610. Le temps est accéléré pour observer leur ronde.',
  es: 'Júpiter y sus cuatro lunas más grandes (Ío, Europa, Ganímedes y Calisto), descubiertas por Galileo en 1610. El tiempo está acelerado para observar su ronda.',
  'pt-BR':
    'Júpiter e as suas quatro maiores luas (Io, Europa, Ganímedes e Calisto), descobertas por Galileu em 1610. O tempo está acelerado para observar a sua ronda.',
};

const kuiperIntro: LocalizedText = {
  en: 'Beyond Neptune lies the Kuiper belt, home to Pluto and other dwarf planets. Let’s visit the ones confirmed massive enough to be round.',
  fr: 'Au-delà de Neptune s’étend la ceinture de Kuiper, où résident Pluton et d’autres planètes naines. Visitons celles confirmées assez massives pour être rondes.',
  es: 'Más allá de Neptuno se extiende el cinturón de Kuiper, donde residen Plutón y otros planetas enanos. Visitemos los confirmados lo bastante masivos para ser redondos.',
  'pt-BR':
    'Além de Netuno estende-se o cinturão de Kuiper, onde residem Plutão e outros planetas anões. Vamos visitar os confirmados massivos o bastante para serem redondos.',
};
const kuiperPluto: LocalizedText = {
  en: 'Pluto, the first Kuiper belt object discovered (1930), with its large moon Charon.',
  fr: 'Pluton, le premier objet de la ceinture de Kuiper découvert (1930), avec sa grande lune Charon.',
  es: 'Plutón, el primer objeto del cinturón de Kuiper descubierto (1930), con su gran luna Caronte.',
  'pt-BR':
    'Plutão, o primeiro objeto do cinturão de Kuiper descoberto (1930), com a sua grande lua Caronte.',
};
const kuiperEris: LocalizedText = {
  en: 'Eris, almost as massive as Pluto: its discovery in 2005 triggered the debate that redefined "planet".',
  fr: 'Éris, presque aussi massive que Pluton : sa découverte en 2005 a déclenché le débat qui a redéfini le mot « planète ».',
  es: 'Eris, casi tan masiva como Plutón: su descubrimiento en 2005 desencadenó el debate que redefinió la palabra «planeta».',
  'pt-BR':
    'Éris, quase tão massiva quanto Plutão: a sua descoberta em 2005 desencadeou o debate que redefiniu a palavra “planeta”.',
};
const kuiperHaumea: LocalizedText = {
  en: 'Haumea, an elongated dwarf planet spinning so fast (under 4 hours) it’s shaped like a rugby ball.',
  fr: 'Hauméa, une planète naine allongée qui tourne si vite (moins de 4 heures) qu’elle a la forme d’un ballon de rugby.',
  es: 'Haumea, un planeta enano alargado que gira tan rápido (menos de 4 horas) que tiene forma de balón de rugby.',
  'pt-BR':
    'Haumea, um planeta anão alongado que gira tão rápido (menos de 4 horas) que tem a forma de uma bola de rúgbi.',
};
const kuiperMakemake: LocalizedText = {
  en: 'Makemake, one of the brightest Kuiper belt objects, named after the creator god of Rapa Nui mythology.',
  fr: 'Makémaké, l’un des objets les plus brillants de la ceinture de Kuiper, nommé d’après le dieu créateur de la mythologie de l’île de Pâques.',
  es: 'Makemake, uno de los objetos más brillantes del cinturón de Kuiper, nombrado por el dios creador de la mitología de la isla de Pascua.',
  'pt-BR':
    'Makemake, um dos objetos mais brilhantes do cinturão de Kuiper, nomeado a partir do deus criador da mitologia da ilha de Páscoa.',
};
const kuiperSedna: LocalizedText = {
  en: 'Sedna, one of the most distant known objects in the solar system, on an extreme 11,000-year orbit.',
  fr: 'Sedna, l’un des objets connus les plus lointains du Système solaire, sur une orbite extrême de 11 000 ans.',
  es: 'Sedna, uno de los objetos conocidos más lejanos del Sistema Solar, en una órbita extrema de 11 000 años.',
  'pt-BR':
    'Sedna, um dos objetos conhecidos mais distantes do Sistema Solar, em uma órbita extrema de 11 000 anos.',
};

export const TOUR_SCRIPTS: TourScript[] = [
  {
    id: 'eclipse',
    titleKey: {
      en: 'Birth of an eclipse',
      fr: 'Naissance d’une éclipse',
      es: 'Nacimiento de un eclipse',
      'pt-BR': 'Nascimento de um eclipse',
    },
    // Le premier pas (saut à la vraie date d'éclipse) est préfixé par `tourPlayer.ts` via
    // `resolveEclipseDate` — voir le commentaire sur cette fonction.
    steps: [
      { kind: 'flyTo', body: 'earth' },
      { kind: 'caption', text: eclipseIntro },
      { kind: 'flyTo', body: 'moon' },
      { kind: 'caption', text: eclipseMoon },
    ],
  },
  {
    id: 'galileans',
    titleKey: {
      en: 'The dance of the Galilean moons',
      fr: 'La danse des Galiléennes',
      es: 'La danza de las galileanas',
      'pt-BR': 'A dança das galileanas',
    },
    steps: [
      { kind: 'flyTo', body: 'jupiter' },
      { kind: 'setTimeScale', scale: 200_000 },
      { kind: 'caption', text: galileanIntro, durationMs: 9000 },
      { kind: 'wait', ms: 9000 },
    ],
  },
  {
    id: 'kuiper',
    titleKey: {
      en: 'Journey to the edge',
      fr: 'Voyage aux confins',
      es: 'Viaje a los confines',
      'pt-BR': 'Viagem aos confins',
    },
    steps: [
      { kind: 'flyTo', body: 'pluto' },
      { kind: 'caption', text: kuiperIntro },
      { kind: 'caption', text: kuiperPluto },
      { kind: 'flyTo', body: 'eris' },
      { kind: 'caption', text: kuiperEris },
      { kind: 'flyTo', body: 'haumea' },
      { kind: 'caption', text: kuiperHaumea },
      { kind: 'flyTo', body: 'makemake' },
      { kind: 'caption', text: kuiperMakemake },
      { kind: 'flyTo', body: 'sedna' },
      { kind: 'caption', text: kuiperSedna },
    ],
  },
];
