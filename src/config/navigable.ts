/**
 * CORPS NAVIGABLES : le catalogue céleste PLUS les objets de la couche instrument.
 *
 * Onze sondes et trois objets interstellaires étaient dessinés comme marqueurs 2D et rien
 * d'autre : introuvables à la recherche, impossibles à cibler, absents des Réglages et sans
 * fiche. Ils sont pourtant nommés à l'écran, positionnés par les mêmes vecteurs Horizons que
 * les planètes pour les sondes, et par leurs éléments hyperboliques pour les interstellaires.
 *
 * Ce module ne les met PAS dans `CELESTIAL_CONFIG`, et c'est délibéré. Ce catalogue-là décrit
 * ce que la SCÈNE fabrique : un mesh, des textures, une ligne d'orbite fermée, une page
 * d'atterrissage, une fiche de faits sourcés. Une sonde n'a rien de tout cela — l'invariant
 * Explo lui interdit même une taille apparente plancher. L'y faire entrer aurait demandé une
 * exception dans la fabrique d'objets, dans le préchargement de textures, dans la validation du
 * catalogue, dans le calcul des orbites et dans les quatre générateurs de pages. Ce qu'on
 * partage avec le catalogue, c'est ce qui est réellement commun : un nom, une couleur, une
 * description, et le droit d'être cherché, ciblé et réglé comme n'importe quel corps.
 *
 * `NAVIGABLE_BODIES` est donc la table que consulte la couche UI (nom affiché, fiche, palette,
 * Réglages) là où elle consultait `flattenBodies(CELESTIAL_CONFIG)`. La scène, elle, continue
 * de ne connaître que le catalogue.
 */
import type {
  CelestialBodyConfig,
  CelestialConfig,
  LocalizedText,
  RealData,
} from '@/types';
import { CELESTIAL_CONFIG } from './bodies';
import { flattenBodies } from './catalog';
import { SPACECRAFT_MISSIONS } from './spacecraft';
import { INTERSTELLAR_OBJECTS } from './interstellar';

/**
 * Rayon VISUEL nominal, en unités de scène, prêté à un objet d'instrument quand la caméra le
 * cible. Ce n'est PAS un fait publié et ce n'est pas une taille à l'écran : ces objets n'ont
 * aucun mesh, et rien ici ne les rend visibles. La caméra borne son zoom en multiples du rayon
 * du corps visé (`CAMERA_CONTROLS_SETTINGS.targetMin/MaxRadiusFactor`) ; sans valeur, elle
 * retombait sur 1 unité de scène, ce qui interdisait toute approche. La valeur est choisie pour
 * le CADRAGE, comme la distance de visite ci-dessous, et n'est affichée nulle part.
 */
export const MARKER_FRAMING_RADIUS = 0.5;

/**
 * Distance de visite d'un objet d'instrument, identique dans les deux modes : un point n'a pas
 * de taille dont s'approcher, et ce qu'on veut voir en le ciblant est sa position DANS son
 * environnement. La caméra le suit ensuite comme n'importe quelle cible.
 */
const MARKER_CAMERA_DISTANCE = { educ: 8, explo: 8 };

function markerConfig(
  kind: 'spacecraft' | 'interstellar',
  displayName: LocalizedText,
  description: LocalizedText,
  color: number,
  facts: Partial<RealData> = {}
): CelestialBodyConfig {
  return {
    kind,
    displayName,
    radius: MARKER_FRAMING_RADIUS,
    rotationSpeed: 0,
    orbitalColor: color,
    // Ni texture ni couleur de repli : `buildLayers` ne crée alors AUCUNE couche. C'est ce qui
    // garantit qu'aucun mesh, sprite ou sphère mandataire n'apparaît — l'invariant Explo.
    textureResolutions: {},
    // Les faits viennent du registre avec leur provenance ; la description reste le texte du
    // catalogue. `core/bodyFacts.ts` décide seul lesquels s'affichent, exactement comme pour
    // un corps : une valeur sans source ne se montre pas plus ici qu'ailleurs.
    realData: { description, ...facts },
    cameraDistance: MARKER_CAMERA_DISTANCE,
  };
}

/**
 * Les objets d'instrument, dans l'ordre déclaré par leurs registres
 * (`src/registry/spacecraft/order.json`, `src/registry/interstellar/order.json`).
 */
export const NAVIGABLE_TARGETS: ReadonlyMap<string, CelestialBodyConfig> =
  new Map<string, CelestialBodyConfig>([
    ...SPACECRAFT_MISSIONS.map(
      (m) =>
        [
          m.name,
          markerConfig(
            'spacecraft',
            m.displayName,
            m.description,
            m.color,
            m.facts
          ),
        ] as const
    ),
    ...INTERSTELLAR_OBJECTS.map(
      (o) =>
        [
          o.name,
          markerConfig(
            'interstellar',
            o.displayName,
            // Un objet interstellaire n'a pas de description rédigée dans son registre : sa
            // désignation MPC est ce qui l'identifie, et c'est elle qu'Horizons affiche.
            { en: o.designation, fr: o.designation },
            o.color,
            o.facts
          ),
        ] as const
    ),
  ]);

/** Vrai si ce nom désigne un objet d'instrument (sonde ou interstellaire). */
export function isNavigableTarget(name: string): boolean {
  return NAVIGABLE_TARGETS.has(name);
}

/**
 * Tout ce qui se nomme, se cherche et se cible : corps du catalogue d'abord (l'ordre du
 * catalogue est une donnée), objets d'instrument ensuite.
 */
export function navigableBodies(
  config: CelestialConfig = CELESTIAL_CONFIG
): Map<string, CelestialBodyConfig> {
  const bodies = flattenBodies(config);
  for (const [name, cfg] of NAVIGABLE_TARGETS) {
    if (bodies.has(name))
      throw new Error(
        `objet d'instrument en collision avec un corps du catalogue : ${name}`
      );
    bodies.set(name, cfg);
  }
  return bodies;
}

/** Table construite une fois, partagée par la couche UI. */
export const NAVIGABLE_BODIES: ReadonlyMap<string, CelestialBodyConfig> =
  navigableBodies();
