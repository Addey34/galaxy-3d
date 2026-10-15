/**
 * LE RIDEAU AVANT/APRÈS (lot 50, pas 2) : un carreau qui porte DEUX images de la même tuile, une
 * par édition, et qui montre l'une à gauche d'une ligne verticale de l'écran et l'autre à droite.
 *
 * Une seule géométrie, un seul matériau : celui que le corps fournit au carreau
 * (`createSurfaceOverlayMaterial`), donc le même éclairage, la même ombre d'éclipse et le même
 * gain d'albédo des deux côtés de la ligne. Deux moteurs auraient dédoublé la pyramide, le relief
 * et le plancher d'approche pour montrer la même surface.
 *
 * Le patch REMPLACE `#include <map_fragment>` (three r176 : un `texture2D( map, vMapUv )`
 * multiplié dans `diffuseColor`) par le choix de la carte selon `gl_FragCoord.x`. Les patchs du
 * corps qui AJOUTENT du code après cet include gardent leur place derrière lui, et la variable
 * `sampledDiffuseColor` qu'ils pourraient lire existe toujours. Il est chaîné en DERNIER, après
 * ceux que le matériau porte déjà, et sa clé de programme le distingue d'un carreau sans rideau.
 */
import * as THREE from 'three';

/**
 * Abscisse de la ligne, en pixels du TAMPON de rendu (`gl_FragCoord`), partagée par tous les
 * carreaux : un seul objet uniforme, que le rideau met à jour, référencé par chaque programme.
 * À gauche, l'édition COMPARÉE ; à droite, celle de l'année de la scène.
 */
export const COMPARE_SPLIT: { value: number } = { value: 0 };

const COMPARE_KEY = '__surfaceCompareMap';

const COMPARE_MAP_FRAGMENT = /* glsl */ `
#ifdef USE_MAP
	vec4 sampledDiffuseColor = gl_FragCoord.x < uCompareSplitX
		? texture2D( uCompareMap, vMapUv )
		: texture2D( map, vMapUv );
	diffuseColor *= sampledDiffuseColor;
#endif
`;

/** La carte comparée d'un matériau déjà patché, ou `null`. */
export function compareMapOf(material: THREE.Material): THREE.Texture | null {
  const uniform = material.userData[COMPARE_KEY] as
    { value: THREE.Texture } | undefined;
  return uniform?.value ?? null;
}

/** Pose (ou remplace) la carte de l'édition comparée sur le matériau d'un carreau. */
export function setCompareMap(
  material: THREE.Material,
  texture: THREE.Texture
): void {
  const existing = material.userData[COMPARE_KEY] as
    { value: THREE.Texture } | undefined;
  if (existing) {
    existing.value = texture;
    return;
  }
  const uniform = { value: texture };
  material.userData[COMPARE_KEY] = uniform;
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms['uCompareMap'] = uniform;
    shader.uniforms['uCompareSplitX'] = COMPARE_SPLIT;
    if (!shader.fragmentShader.includes('#include <map_fragment>'))
      throw new Error('rideau : `#include <map_fragment>` absent du shader');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <map_pars_fragment>',
        '#include <map_pars_fragment>\nuniform sampler2D uCompareMap;\nuniform float uCompareSplitX;'
      )
      .replace('#include <map_fragment>', COMPARE_MAP_FRAGMENT);
  };
  const previousKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${previousKey()}-surface-compare`;
  material.needsUpdate = true;
}
