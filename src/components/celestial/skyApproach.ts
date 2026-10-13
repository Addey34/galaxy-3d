/**
 * En deçà de ce nombre de rayons (distance au centre), le ciel calculé d'un corps se charge
 * (`skyLayer.ts`). Isolé ici pour que `CelestialObject` le lise sans tirer le morceau du ciel dans
 * le démarrage. À 20 rayons la Terre occupe déjà une bonne part de l'image (le cadrage par défaut
 * la place vers 7), et la vue d'ensemble en est des centaines de fois plus loin.
 */
export const SKY_LOAD_RADII = 20;

/**
 * Les ciels calculés posés (au plus un par corps qui en déclare un) : `AnimationSystem` y lit,
 * à chaque image, la part des étoiles visible depuis la caméra, et n'interroge donc que les corps
 * dont le ciel est chargé.
 */
export const ATTACHED_SKIES = new Set<{
  starVisibilityFrom(cameraWorld: { x: number; y: number; z: number }): number;
}>();
