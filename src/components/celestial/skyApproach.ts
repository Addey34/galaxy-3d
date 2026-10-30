/**
 * Les ciels calculés posés (au plus un par corps qui en déclare un) : `AnimationSystem` y lit,
 * à chaque image, la part des étoiles visible depuis la caméra, et n'interroge donc que les corps
 * dont le ciel est chargé.
 */
export const ATTACHED_SKIES = new Set<{
  starVisibilityFrom(cameraWorld: { x: number; y: number; z: number }): number;
}>();
