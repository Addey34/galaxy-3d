/**
 * Objets interstellaires — couche instrument 2D (`src/ui/interstellarOverlay.ts`).
 *
 * Données dérivées du registre `src/registry/interstellar/` : ces corps n'ont pas de mesh
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
import type { LocalizedText, RealData } from '@/types';
import { hyperbolicPerihelionDate, type OrbitalElements } from '@/core/kepler';
import { loadInterstellarObjects } from '@/registry/interstellar';

export interface InterstellarObject {
  /** Clé stable (minuscule, sans espace). */
  name: string;
  displayName: LocalizedText;
  /** Désignation provisoire MPC, pour la traçabilité (celle qu'Horizons affiche). */
  designation: string;
  elements: OrbitalElements;
  /** Couleur du marqueur, de l'étiquette et de la trajectoire (0xRRGGBB). */
  color: number;
  /**
   * Faits sourcés, prêts à être versés dans le `realData` de la fiche par
   * `config/navigable.ts` : excentricité et périhélie tirées des éléments ci-dessus, première
   * observation de la solution d'orbite, avec leurs provenances.
   */
  facts: Partial<RealData>;
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

export const INTERSTELLAR_OBJECTS: readonly InterstellarObject[] =
  loadInterstellarObjects();

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
