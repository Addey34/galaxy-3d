import * as THREE from 'three';

// Exportées : le shader d'ombrage par fragment (config/layerConfig.ts,
// createShadowAwareStandardMaterial option eclipseShadow) reproduit exactement cette
// courbe côté GPU pour la Terre en gros plan — une seule source de vérité pour le
// « look » de l'ombre, CPU (proxy pleine-sphère) et GPU (bande projetée) inclus.
export const MIN_LIGHT_ATTENUATION = 0.02;
const EPSILON = 1e-9;
/**
 * Resserrement perceptuel de l'ombre. La fraction obscurcie du disque solaire
 * est géométriquement exacte, mais l'œil ne perçoit un assombrissement net que
 * lors des phases profondes d'une éclipse (à 10 % occulté il fait encore plein
 * jour). On applique une courbe puissance : les occultations partielles restent
 * quasi lumineuses, seule l'approche de la totalité plonge le corps dans l'ombre.
 */
export const SHADOW_GAMMA = 3.2;

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

/**
 * LIMITE CONNUE (simplification délibérée, partiellement levée pour la Terre) : le résultat
 * est UN scalaire par corps et par frame, appliqué uniformément à toute la sphère via
 * `setMaterialLightAttenuation`. Une vraie éclipse n'assombrit que la portion sous l'ombre/
 * pénombre de l'occulteur — le reste du corps reste éclairé. À l'échelle du système solaire
 * (le cas d'usage normal), l'approximation est imperceptible : on est rarement assez près pour
 * résoudre la bande d'ombre. Pour la Terre spécifiquement, `config/layerConfig.ts` (option
 * `eclipseShadow` de `createShadowAwareStandardMaterial`) reproduit CETTE MÊME fonction en
 * GLSL et l'évalue par fragment (position/rayon Soleil+Lune envoyés en uniforms depuis
 * `AnimationSystem`) — le gros plan Terre pendant une éclipse voit donc la vraie bande
 * d'ombre. Les autres corps (pas de Lune, pas de varying de position monde câblé) gardent le
 * proxy pleine-sphère ci-dessous, qui reste le signal utilisé pour la vue d'ensemble.
 */
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

  // Courbe puissance : ombre resserrée sur les phases profondes (voir SHADOW_GAMMA).
  const shaped = Math.pow(maxOccultation, SHADOW_GAMMA);
  return THREE.MathUtils.lerp(1, MIN_LIGHT_ATTENUATION, shaped);
}

/** Intensité solaire relative à la Terre, bornée pour conserver une image exploitable. */
export function solarIrradianceFactor(distanceAU: number): number {
  if (!Number.isFinite(distanceAU) || distanceAU <= EPSILON) return 1;
  return THREE.MathUtils.clamp(1 / (distanceAU * distanceAU), 0.03, 6);
}
