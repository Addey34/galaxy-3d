/**
 * LE VOILE BLEU SUR LE SOL : LA PERSPECTIVE AÉRIENNE (lot 48, pas 7, 2026-10-13).
 *
 * Le ciel calculé (`skyLayer.ts`) éclairait la voûte, pas le sol : vue de près, une montagne à
 * 100 km avait le même contraste qu'à 1 km, et vu de l'orbite le globe n'avait pas le léger voile
 * bleu que montrent les photographies. Entre l'œil et un point du sol, l'air DIFFUSE de la lumière
 * vers l'œil et ATTÉNUE celle du sol : `couleur = sol × transmittance + diffusé`, avec exactement la
 * même intégrale que le ciel (`SCATTER_GLSL`), arrêtée au point du sol au lieu du bord de l'air.
 *
 * PAR SOMMET, et non par pixel : le voile varie lentement, les carreaux proches sont finement
 * maillés et les lointains, grossiers, sont déjà dans un voile presque uniforme. Huit échantillons
 * le long de la visée et quatre vers le Soleil, contre seize et six pour le ciel.
 *
 * Injecté APRÈS l'éclairage (`opaque_fragment`) et AVANT la courbe de tons : le voile s'ajoute à la
 * radiance linéaire, comme l'air le fait. Il ne touche que les matériaux qu'on lui confie : la
 * sphère du corps, ses carreaux d'imagerie et ses nuages.
 */
import type * as THREE from 'three';
import { SCATTER_GLSL } from '@/shaders/SkyScatteringShader';

export const AERIAL_VIEW_SAMPLES = 8;
export const AERIAL_LIGHT_SAMPLES = 4;

const FLAG = '__aerialPerspective';

export const AERIAL_VERTEX_GLSL = /* glsl */ `
  #define VIEW_SAMPLES ${AERIAL_VIEW_SAMPLES}
  #define LIGHT_SAMPLES ${AERIAL_LIGHT_SAMPLES}
  ${SCATTER_GLSL}
  varying vec3 vAerialIn;
  varying vec3 vAerialT;
`;

/** Après `project_vertex`, où `mvPosition` est la position du sommet dans le repère de la vue. */
export const AERIAL_VERTEX_MAIN = /* glsl */ `
  {
    vec3 aerialTo = mvPosition.xyz * uKmPerUnit;
    float aerialDistance = length( aerialTo );
    if ( !scatterSegment(
      -uCenterView * uKmPerUnit, aerialTo / max( aerialDistance, 1e-6 ), aerialDistance, false,
      vAerialIn, vAerialT
    ) ) {
      vAerialIn = vec3( 0.0 );
      vAerialT = vec3( 1.0 );
    }
  }
`;

/**
 * LES NUAGES : le voile du SOL QUI EST SOUS EUX (2026-10-14). Leur coque est à 1,01 rayon
 * (64 km), un écart choisi contre le z-fighting et non une altitude : presque tout l'air est
 * dessous, et un voile arrêté au sommet de la coque y valait zéro (mesuré : 1 à 2 niveaux sur 255
 * vu de 4 235 km, hors du limbe). L'image ne dit pas la hauteur d'un nuage ; le segment s'arrête
 * donc au niveau de la mer à la verticale du sommet, ce qui BORNE le voile par celui du sol
 * (exact pour un brouillard, un peu fort pour un cirrus), et au sol s'il le croise avant.
 */
export const AERIAL_VERTEX_MAIN_BELOW = /* glsl */ `
  {
    vec3 aerialCentre = uCenterView * uKmPerUnit;
    vec3 aerialTo = aerialCentre
      + normalize( mvPosition.xyz * uKmPerUnit - aerialCentre ) * uGroundKm;
    float aerialDistance = length( aerialTo );
    if ( !scatterSegment(
      -aerialCentre, aerialTo / max( aerialDistance, 1e-6 ), aerialDistance, true,
      vAerialIn, vAerialT
    ) ) {
      vAerialIn = vec3( 0.0 );
      vAerialT = vec3( 1.0 );
    }
  }
`;

export const AERIAL_FRAGMENT_APPLY = /* glsl */ `
  gl_FragColor.rgb = gl_FragColor.rgb * vAerialT + vAerialIn;
`;

/** Vrai si ce matériau porte déjà la perspective aérienne. */
export function hasAerialPerspective(material: THREE.Material): boolean {
  return material.userData[FLAG] === true;
}

/**
 * Ajoute la perspective aérienne à un matériau de sol, avec les uniforms du ciel (les MÊMES
 * objets : le ciel les met à jour, le sol les lit). Sans effet sur un matériau déjà traité.
 */
export function addAerialPerspective(
  material: THREE.Material,
  uniforms: Record<string, THREE.IUniform>,
  /** `below` : le voile du sol à la verticale (les nuages, cf. `AERIAL_VERTEX_MAIN_BELOW`). */
  endpoint: 'vertex' | 'below' = 'vertex'
): void {
  if (hasAerialPerspective(material)) return;
  material.userData[FLAG] = true;
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + AERIAL_VERTEX_GLSL)
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n' +
          (endpoint === 'below' ? AERIAL_VERTEX_MAIN_BELOW : AERIAL_VERTEX_MAIN)
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vAerialIn;\nvarying vec3 vAerialT;'
      )
      .replace(
        '#include <opaque_fragment>',
        '#include <opaque_fragment>\n' + AERIAL_FRAGMENT_APPLY
      );
  };
  const previousKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () =>
    `${previousKey()}-aerial${endpoint === 'below' ? '-below' : ''}`;
  material.needsUpdate = true;
}
