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
  const { occlusion } = deepestOcclusion(
    bodyPosition,
    sunPosition,
    sunRadius,
    occluders
  );
  // Courbe puissance : ombre resserrée sur les phases profondes (voir SHADOW_GAMMA).
  const shaped = Math.pow(occlusion, SHADOW_GAMMA);
  return THREE.MathUtils.lerp(1, MIN_LIGHT_ATTENUATION, shaped);
}

/**
 * Occultation la plus forte subie par `bodyPosition`, et la PROFONDEUR dans l'ombre de
 * l'occulteur qui la produit (cf. umbralDepth). Un seul parcours pour les deux : le scalaire
 * seul ne distingue plus rien une fois le Soleil entièrement caché, or c'est là que la couleur
 * de l'ombre se joue.
 */
function deepestOcclusion(
  bodyPosition: THREE.Vector3,
  sunPosition: THREE.Vector3,
  sunRadius: number,
  occluders: readonly SphericalOccluder[]
): { occlusion: number; depth: number } {
  // Maths en scalaires plutôt qu'en THREE.Vector3 temporaires : cette fonction tourne dans
  // la boucle d'éclairage physique (AnimationSystem._updatePhysicalLighting, throttlée à 1
  // frame sur 6 mais pour CHAQUE corps × occulteur) — le reste de cette passe pool déjà tous
  // ses Vector3 (snapshot + liste d'occulteurs réutilisés) ; ces deux `new Vector3()` par
  // occulteur restaient le seul point d'allocation. Purement scalaire = zéro allocation, sans
  // introduire d'état partagé qui casserait la pureté de cette fonction.
  const sunDx = sunPosition.x - bodyPosition.x;
  const sunDy = sunPosition.y - bodyPosition.y;
  const sunDz = sunPosition.z - bodyPosition.z;
  const sunDistance = Math.hypot(sunDx, sunDy, sunDz);
  if (sunDistance <= EPSILON || sunRadius <= 0)
    return { occlusion: 0, depth: 0 };

  const invSunDistance = 1 / sunDistance;
  const sunDirX = sunDx * invSunDistance;
  const sunDirY = sunDy * invSunDistance;
  const sunDirZ = sunDz * invSunDistance;
  const sunAngularRadius = angularRadius(sunRadius, sunDistance);
  let maxOccultation = 0;
  let depth = 0;

  for (const occluder of occluders) {
    if (occluder.radius <= 0) continue;

    const occDx = occluder.position.x - bodyPosition.x;
    const occDy = occluder.position.y - bodyPosition.y;
    const occDz = occluder.position.z - bodyPosition.z;
    const occluderDistance = Math.hypot(occDx, occDy, occDz);
    if (occluderDistance <= EPSILON || occluderDistance >= sunDistance)
      continue;

    const invOccluderDistance = 1 / occluderDistance;
    const cosSeparation =
      (sunDirX * occDx + sunDirY * occDy + sunDirZ * occDz) *
      invOccluderDistance;
    const separation = Math.acos(THREE.MathUtils.clamp(cosSeparation, -1, 1));
    const occluderAngularRadius = angularRadius(
      occluder.radius,
      occluderDistance
    );

    const occultation = occultationFraction(
      sunAngularRadius,
      occluderAngularRadius,
      separation
    );
    if (occultation >= maxOccultation) {
      maxOccultation = occultation;
      depth = umbralDepth(sunAngularRadius, occluderAngularRadius, separation);
    }
  }

  return { occlusion: maxOccultation, depth };
}

/**
 * Ombre portée, EN COULEUR : facteur RVB à appliquer à l'éclairage direct du corps. Sert au
 * mode Éducatif, dont les positions compressées interdisent le calcul par fragment (le shader
 * fait exactement le même calcul en Explo — `eclipseShadowAt`, config/layerConfig.ts).
 * `refracts` = l'occulteur a une atmosphère ; sinon l'ombre reste neutre.
 */
export function computeUmbralShadow(
  bodyPosition: THREE.Vector3,
  sunPosition: THREE.Vector3,
  sunRadius: number,
  occluders: readonly SphericalOccluder[],
  refracts: boolean
): [number, number, number] {
  const { occlusion, depth } = deepestOcclusion(
    bodyPosition,
    sunPosition,
    sunRadius,
    occluders
  );
  const shaped = Math.pow(occlusion, SHADOW_GAMMA);
  const shadow = refracts
    ? umbralTint(depth).map((channel) => channel * UMBRA_REFRACTED_LIGHT)
    : [MIN_LIGHT_ATTENUATION, MIN_LIGHT_ATTENUATION, MIN_LIGHT_ATTENUATION];
  return shadow.map((channel) => THREE.MathUtils.lerp(1, channel, shaped)) as [
    number,
    number,
    number,
  ];
}

/**
 * OMBRE D'UN OCCULTEUR QUI A UNE ATMOSPHÈRE : elle n'est pas noire, elle est cuivrée.
 *
 * Dans l'ombre de la Terre, la Lune reçoit encore la lumière RÉFRACTÉE par l'atmosphère
 * terrestre, débarrassée de son bleu par la diffusion — le « rayon vert » de tous les levers
 * de soleil du monde à la fois. Sans ce terme, une éclipse totale de Lune s'affichait comme un
 * disque strictement noir. Avec la Lune comme occulteur (éclipse de Soleil sur la Terre), il
 * n'y a rien à réfracter : l'ombre reste neutre, `MIN_LIGHT_ATTENUATION`.
 *
 * NIVEAU — choix assumé, borné par la mesure. Physiquement, la Lune totalement éclipsée vaut
 * environ −0,8 en magnitude visuelle contre −12,7 pleine, soit 1/60 000 : à exposition unique,
 * cela rend NOIR, et aucune photographie ne montre les deux à la fois autrement qu'en brûlant
 * l'une des deux. Sur la seule image en UNE exposition qui contienne le limbe éclairé ET
 * l'ombre (ISS073-E-611649, phase partielle du 7 septembre 2025), le limbe est saturé : le
 * rapport y est donc ≤ 0,15 en linéaire. On retient 0,10 — dans cette borne, et assez pour que
 * le disque se lise.
 */
export const UMBRA_REFRACTED_LIGHT = 0.1;

/**
 * Teinte de l'ombre réfractée selon sa PROFONDEUR (0 = bord de l'ombre, 1 = axe), normalisée
 * en luminance : la teinte ne change que la couleur, jamais la clarté (même discipline que le
 * bandeau crépusculaire). Mesurée pixel par pixel sur une photographie NASA de totalité
 * (3 mars 2026, aucun pixel saturé), en LINÉAIRE — en 8 bits sRGB le même rouge se lit deux
 * fois moins rouge, piège déjà payé par ce projet. Les cinq quintiles de luminance donnent
 * R/V de 1,58 au bord à 4,08 au cœur et V/… décroissant d'autant : l'ombre rougit avec la
 * profondeur, parce que la lumière y a traversé plus d'atmosphère.
 */
export const UMBRA_TINT_FIT = {
  /** Rouge : croît linéairement avec la profondeur (1,58 au bord → 4,08 au cœur). */
  redBase: 1.58,
  redSlope: 2.5,
  /** Vert : décroît linéairement (0,86 → 0,15). */
  greenBase: 0.86,
  greenSlope: 0.71,
  /** Bleu : s'effondre au bord puis stagne — d'où le cube plutôt qu'une droite. */
  blueBase: 0.3,
  blueEdge: 0.36,
};

export function umbralTint(depth: number): [number, number, number] {
  const d = THREE.MathUtils.clamp(depth, 0, 1);
  const rest = 1 - d;
  // Ajustements des cinq quintiles mesurés (écart max 0,15 sur R, 0,02 sur V). Les
  // coefficients vivent dans UMBRA_TINT_FIT : le shader les lit de LÀ, pas d'une copie.
  const r = UMBRA_TINT_FIT.redBase + UMBRA_TINT_FIT.redSlope * d;
  const g = UMBRA_TINT_FIT.greenBase - UMBRA_TINT_FIT.greenSlope * d;
  const b =
    UMBRA_TINT_FIT.blueBase + UMBRA_TINT_FIT.blueEdge * rest * rest * rest;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [r / luminance, g / luminance, b / luminance];
}

/**
 * Profondeur dans l'ombre (0 au bord de l'ombre, 1 sur l'axe). La fraction occultée sature à 1
 * dès que le Soleil est entièrement caché : elle ne distingue plus le bord du cœur, alors que
 * c'est exactement là que la couleur change. On la reprend donc de la géométrie : l'ombre
 * proprement dite existe tant que la séparation reste sous `occulteur − Soleil` (en rayons
 * angulaires), et la profondeur est la part parcourue vers l'axe.
 */
export function umbralDepth(
  sunAngularRadius: number,
  occluderAngularRadius: number,
  separation: number
): number {
  const umbra = occluderAngularRadius - sunAngularRadius;
  if (umbra <= EPSILON) return 0;
  return THREE.MathUtils.clamp(1 - separation / umbra, 0, 1);
}

/** Intensité solaire relative à la Terre, bornée pour conserver une image exploitable. */
export function solarIrradianceFactor(distanceAU: number): number {
  if (!Number.isFinite(distanceAU) || distanceAU <= EPSILON) return 1;
  return THREE.MathUtils.clamp(1 / (distanceAU * distanceAU), 0.03, 6);
}
