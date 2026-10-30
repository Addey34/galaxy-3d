/**
 * LE PROPRIÉTAIRE UNIQUE DES DISTANCES D'APPARITION DES COUCHES (lot D, 2026-10-30).
 *
 * Chaque couche d'un corps apparaît à SA distance, mesurée en RAYONS du corps (donc en taille
 * apparente, ce qui est cohérent d'une lune à l'autre par construction). Ces seuils vivaient
 * chacun dans le fichier de leur couche, sans qu'aucune règle écrite ne les relie : on ne pouvait
 * ni les lire d'un coup d'oeil ni vérifier qu'ils restent ordonnés. Ils sont ici, et seulement ici.
 * Les paliers de texture ont déjà leur propriétaire (`core/textureLod.ts`, `config/engine.ts`) ;
 * le fondu des orbites (`core/orbitFade.ts`) et le fond lointain de la Terre (`core/farBase.ts`)
 * gardent leur module, leurs valeurs sont relues ici pour que la table soit complète.
 *
 * Le cadrage par défaut d'un corps (`cameraDistance`) n'est PAS ici : en Explo il vaut 7 rayons,
 * en Éduc il est écrit corps par corps (4,4 à 27,8 rayons, mesuré le 2026-10-30), et c'est lui
 * qui décide de ce qu'un corps montre à son arrivée.
 *
 * Tout changement de valeur se juge à l'écran ET se relit contre `layerDistances.test.ts`.
 */
import { FAR_BASE_ENTER_RADII } from './farBase';
import { ORBIT_FADE_FAR_RADII, ORBIT_FADE_NEAR_RADII } from './orbitFade';

/**
 * Le moteur de tuiles ne travaille qu'une fois la cible assez grosse à l'écran. Au-delà, l'image
 * livrée du corps suffit largement et un carreau ne couvrirait que quelques pixels ; c'est aussi
 * ce qui garantit que survoler un corps de loin ne demande rien.
 */
export const TILE_ENGINE_ENTER_RADII = 6;

/** Au-delà de cette taille apparente le gazetteer ne charge rien : le corps n'occupe pas l'écran. */
export const GAZETTEER_LOAD_RADII = 8;

/** Rayons apparents sous lesquels on daigne CHARGER le moteur de surface. Au-delà : rien. */
export const SURFACE_PANEL_LOAD_RADII = 8;

/**
 * Le relief géométrique (displacement) densifie la surface sous ENTER et la rend à la géométrie
 * standard au-dessus de EXIT : l'écart est une hystérésis, pour qu'un corps cadré à la limite ne
 * clignote pas.
 */
export const RELIEF_TESSELLATION_ENTER_RADII = 12;
export const RELIEF_TESSELLATION_EXIT_RADII = 14;

/**
 * En deçà, le ciel calculé d'un corps se charge. À 20 rayons la Terre occupe déjà une bonne part de
 * l'image (le cadrage par défaut la place vers 7), et la vue d'ensemble en est des centaines de
 * fois plus loin.
 */
export const SKY_LOAD_RADII = 20;

/** La table complète, dans l'ordre où un visiteur qui s'approche les rencontre. */
export const LAYER_DISTANCES = {
  orbitLineFadesOutFrom: ORBIT_FADE_FAR_RADII,
  orbitLineGoneBelow: ORBIT_FADE_NEAR_RADII,
  skyLoadsBelow: SKY_LOAD_RADII,
  reliefExitsAbove: RELIEF_TESSELLATION_EXIT_RADII,
  reliefEntersBelow: RELIEF_TESSELLATION_ENTER_RADII,
  gazetteerLoadsBelow: GAZETTEER_LOAD_RADII,
  surfacePanelLoadsBelow: SURFACE_PANEL_LOAD_RADII,
  tileEngineEntersBelow: TILE_ENGINE_ENTER_RADII,
  farBaseFrom: FAR_BASE_ENTER_RADII,
} as const;
