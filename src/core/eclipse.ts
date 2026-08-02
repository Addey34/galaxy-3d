import * as THREE from 'three';

const MIN_LIGHT_ATTENUATION = 0.02;
const EPSILON = 1e-9;

export interface SphericalOccluder {
  position: THREE.Vector3;
  radius: number;
}

function angularRadius(radius: number, distance: number): number {
  if (radius <= 0 || distance <= EPSILON) return 0;
  return Math.asin(Math.min(1, radius / distance));
}

function occultationFraction(
  sunAngularRadius: number,
  occluderAngularRadius: number,
  separation: number
): number {
  const sun = sunAngularRadius;
  const occ = occluderAngularRadius;
  if (sun <= 0 || occ <= 0 || separation >= sun + occ) return 0;
  if (separation <= Math.abs(sun - occ)) {
    return occ >= sun ? 1 : (occ * occ) / (sun * sun);
  }

  const sunTerm = Math.acos(
    THREE.MathUtils.clamp(
      (separation * separation + sun * sun - occ * occ) /
        (2 * separation * sun),
      -1,
      1
    )
  );
  const occTerm = Math.acos(
    THREE.MathUtils.clamp(
      (separation * separation + occ * occ - sun * sun) /
        (2 * separation * occ),
      -1,
      1
    )
  );
  const lens = Math.sqrt(
    Math.max(
      0,
      (-separation + sun + occ) *
        (separation + sun - occ) *
        (separation - sun + occ) *
        (separation + sun + occ)
    )
  );
  const overlapArea = sun * sun * sunTerm + occ * occ * occTerm - lens / 2;
  return THREE.MathUtils.clamp(overlapArea / (Math.PI * sun * sun), 0, 1);
}

export function computeLightAttenuation(
  bodyPosition: THREE.Vector3,
  sunPosition: THREE.Vector3,
  sunRadius: number,
  occluders: readonly SphericalOccluder[]
): number {
  const toSun = new THREE.Vector3().subVectors(sunPosition, bodyPosition);
  const sunDistance = toSun.length();
  if (sunDistance <= EPSILON || sunRadius <= 0) return 1;

  const sunDirection = toSun.normalize();
  const sunAngularRadius = angularRadius(sunRadius, sunDistance);
  let maxOccultation = 0;

  for (const occluder of occluders) {
    if (occluder.radius <= 0) continue;

    const toOccluder = new THREE.Vector3().subVectors(
      occluder.position,
      bodyPosition
    );
    const occluderDistance = toOccluder.length();
    if (occluderDistance <= EPSILON || occluderDistance >= sunDistance)
      continue;

    const occluderDirection = toOccluder.normalize();
    const separation = sunDirection.angleTo(occluderDirection);
    const occluderAngularRadius = angularRadius(
      occluder.radius,
      occluderDistance
    );

    maxOccultation = Math.max(
      maxOccultation,
      occultationFraction(sunAngularRadius, occluderAngularRadius, separation)
    );
    if (maxOccultation >= 1) break;
  }

  return THREE.MathUtils.lerp(1, MIN_LIGHT_ATTENUATION, maxOccultation);
}

/** Intensité solaire relative à la Terre, bornée pour conserver une image exploitable. */
export function solarIrradianceFactor(distanceAU: number): number {
  if (!Number.isFinite(distanceAU) || distanceAU <= EPSILON) return 1;
  return THREE.MathUtils.clamp(1 / (distanceAU * distanceAU), 0.03, 6);
}
