/**
 * Objets interstellaires — couche instrument 2D (`src/ui/interstellarOverlay.ts`).
 *
 * Contenu uniquement, séparé du catalogue comme `spacecraft.ts` : ces corps n'ont pas de mesh
 * (quelques centaines de mètres à quelques kilomètres, invisibles à vraie échelle — l'invariant
 * Explo interdit de leur donner une taille apparente plancher) et pas d'orbite FERMÉE : ils
 * traversent le Système solaire une seule fois, sur une hyperbole (e > 1).
 *
 * Éléments : osculateurs héliocentriques écliptiques J2000, pris dans l'API JPL Horizons À
 * L'ÉPOQUE DE SA PROPRE SOLUTION, par `scripts/derive-interstellar-elements.mjs` — jamais
 * saisis à la main. Re-lancer ce script (pas une retouche) si une solution est mise à jour.
 * Convention Horizons : a < 0, anomalie moyenne non réduite (818° pour 3I, et c'est juste).
 *
 * Précision mesurée du modèle à deux corps contre les vecteurs Horizons (non-gravitationnels
 * compris) : ≤ 0,1 % de la distance sur ±20 ans autour du périhélie, 0,3 % au périhélie
 * même de 1I, qui passe à 0,26 UA du Soleil — cf. `interstellar.test.ts`.
 */
import type { LocalizedText } from '@/types';
import { hyperbolicPerihelionDate, type OrbitalElements } from '@/core/kepler';
import { DEG_TO_RAD as D2R } from '@/core/MathConstants';

export interface InterstellarObject {
  /** Clé stable (minuscule, sans espace). */
  name: string;
  displayName: LocalizedText;
  /** Désignation provisoire MPC, pour la traçabilité (celle qu'Horizons affiche). */
  designation: string;
  elements: OrbitalElements;
  /** Couleur du marqueur, de l'étiquette et de la trajectoire (0xRRGGBB). */
  color: number;
}

/**
 * Demi-largeur de la fenêtre affichée, en années juliennes autour du périhélie.
 *
 * Une trajectoire ouverte n'a pas de « tour complet » : il faut une borne. Celle-ci est la
 * plage sur laquelle le modèle est VÉRIFIÉ contre Horizons (les vecteurs de référence du test
 * vont exactement de −20 à +20 ans), pas une valeur esthétique. Hors fenêtre, ni marqueur ni
 * trajectoire : on préfère ne rien montrer qu'une extrapolation non contrôlée. À +20 ans, les
 * trois objets sont entre 116 et 245 UA du Soleil, bien au-delà de Neptune.
 */
export const INTERSTELLAR_WINDOW_YEARS = 20;

/** Points de la ligne de trajectoire, répartis en anomalie hyperbolique (cf. `kepler.ts`). */
export const INTERSTELLAR_TRAJECTORY_SAMPLES = 512;

const MS_PER_JULIAN_YEAR = 365.25 * 86_400_000;

interface RawElements {
  a: number;
  e: number;
  iDeg: number;
  omDeg: number;
  wDeg: number;
  maDeg: number;
  epoch: string;
}

function toElements(raw: RawElements): OrbitalElements {
  return {
    semiMajorAxisAU: raw.a,
    eccentricity: raw.e,
    inclinationRad: raw.iDeg * D2R,
    ascendingNodeRad: raw.omDeg * D2R,
    argPerihelionRad: raw.wDeg * D2R,
    meanAnomalyAtEpochRad: raw.maDeg * D2R,
    epoch: new Date(raw.epoch),
  };
}

export const INTERSTELLAR_OBJECTS: readonly InterstellarObject[] = [
  {
    name: 'oumuamua',
    displayName: { en: '1I/ʻOumuamua', fr: '1I/ʻOumuamua' },
    designation: '1I/2017 U1',
    // Horizons rec #50322080, solution 2018-Jun-26 (Micheli et al. 2018, accélération
    // non gravitationnelle comprise). Époque de la solution : JD 2458080.5.
    elements: toElements({
      a: -1.272345007428079,
      e: 1.201133796102373,
      iDeg: 122.7417062847287,
      omDeg: 24.59690955523243,
      wDeg: 241.8105360304899,
      maDeg: 51.15761979385638,
      epoch: '2017-11-23T00:00:00.000Z',
    }),
    color: 0x8ef5a0,
  },
  {
    name: 'borisov',
    displayName: { en: '2I/Borisov', fr: '2I/Borisov' },
    designation: 'C/2019 Q4',
    // Horizons rec #90004568, solution 2024-Jun-24. Époque de la solution : JD 2458853.5.
    elements: toElements({
      a: -0.8514922551937883,
      e: 3.356475782676598,
      iDeg: 44.05264247909137,
      omDeg: 308.1477292269942,
      wDeg: 209.1236864378081,
      maDeg: 34.42947030729184,
      epoch: '2020-01-05T00:00:00.000Z',
    }),
    color: 0x4fd6d0,
  },
  {
    name: 'atlas',
    displayName: { en: '3I/ATLAS', fr: '3I/ATLAS' },
    designation: 'C/2025 N1',
    // Horizons rec #90004935, solution 2026-Feb-19. Époque de la solution : JD 2461090.5.
    elements: toElements({
      a: -0.2638374502507929,
      e: 6.14135144931763,
      iDeg: 175.1164570850441,
      omDeg: 322.1696089290779,
      wDeg: 128.0228697185195,
      maDeg: 818.2202457999964,
      epoch: '2026-02-19T00:00:00.000Z',
    }),
    color: 0xd9f26b,
  },
];

/** Fenêtre affichée d'un objet : ±`INTERSTELLAR_WINDOW_YEARS` autour de son périhélie. */
export function interstellarWindow(object: InterstellarObject): {
  from: Date;
  perihelion: Date;
  to: Date;
} {
  const perihelion = hyperbolicPerihelionDate(object.elements);
  const half = INTERSTELLAR_WINDOW_YEARS * MS_PER_JULIAN_YEAR;
  return {
    from: new Date(perihelion.getTime() - half),
    perihelion,
    to: new Date(perihelion.getTime() + half),
  };
}
