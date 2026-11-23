/**
 * Géométrie pure de l'inspection d'un engin (GAL-OBJECT-IMMERSION-001) : distance de cadrage et
 * pas de la caméra autour du modèle. Sans DOM, sans three : testé en maths pures.
 */

/**
 * Rapport entre le champ visé et la sphère englobante. Inférieur à 1 À DESSEIN : la sphère est celle de la
 * boîte (demi-diagonale), plus grande que le modèle (mesuré : 0,45 à 0,6 du rayon pour les engins longs et
 * minces), et son plein cadrage laissait l'engin à un tiers de l'écran.
 */
export const FIT_MARGIN = 0.8;

/**
 * Distance à laquelle une sphère de rayon `radius` tient entière dans le champ vertical `fovDeg`
 * d'une caméra d'allure `aspect`, la plus étroite des deux directions faisant foi (un téléphone en
 * portrait est limité par sa largeur).
 */
export function fitDistance(
  radius: number,
  fovDeg: number,
  aspect: number
): number {
  const vertical = (fovDeg * Math.PI) / 360;
  const horizontal = Math.atan(Math.tan(vertical) * Math.max(aspect, 0.05));
  return (radius * FIT_MARGIN) / Math.sin(Math.min(vertical, horizontal));
}

export interface Pose {
  /** Azimut (rad, tout réel). */
  azimuth: number;
  /** Angle polaire depuis l'axe vertical, borné à ]0, π[. */
  polar: number;
  distance: number;
}

const POLAR_EPS = 0.05;

/** Tourne la pose : l'azimut est libre, le pôle est bloqué avant de se retourner. */
export function turn(pose: Pose, dAzimuth: number, dPolar: number): Pose {
  return {
    ...pose,
    azimuth: pose.azimuth + dAzimuth,
    polar: Math.min(
      Math.PI - POLAR_EPS,
      Math.max(POLAR_EPS, pose.polar + dPolar)
    ),
  };
}

/** Multiplie la distance par `factor`, bornée à l'intervalle donné. */
export function zoom(
  pose: Pose,
  factor: number,
  min: number,
  max: number
): Pose {
  return {
    ...pose,
    distance: Math.min(max, Math.max(min, pose.distance * factor)),
  };
}
