/**
 * L'ÉCLAIRAGE DE LECTURE (GAL-IMMERSION-003) : un PLANCHER de luminance sur la surface des corps,
 * pour LIRE un relief ou une texture là où le Soleil n'éclaire pas (face nuit, ombre portée).
 * Ce n'est PAS de la lumière du Soleil : ni sa position, ni la date, ni la rotation, ni le
 * terminateur scientifique, ni les éclipses n'en dépendent. Il ne change que ce que l'écran
 * montre, et il est éteint par défaut.
 *
 * Mécanisme : `outgoingLight = max(outgoingLight, √albédo × plancher × forme)`, juste avant la
 * sortie du fragment. Un `max` et non une somme : un pixel déjà plus lumineux que le plancher
 * n'est PAS modifié, donc la face éclairée garde son contraste, et à `0` le résultat est
 * exactement celui du rendu naturel (`max(x, 0) = x` pour toute luminance positive). La racine de
 * l'albédo relève les surfaces SOMBRES (la Lune réfléchit ~12 %) sans aplatir la texture : elle
 * reste monotone, donc les contrastes de l'imagerie survivent. La forme
 * est un éclairage frontal fixe dans le repère de la CAMÉRA, qui rend lisibles les pentes de la
 * normale (carte de relief comprise) sans prétendre à une direction de lumière réelle.
 *
 * Un seul uniforme partagé par TOUS les programmes de surface : l'allumer ne recompile rien, et
 * ne crée aucun programme GPU de plus. La Terre (couche de lumières nocturnes) et les nuages ne
 * le portent pas.
 */
import * as THREE from 'three';

/** Plancher maximal (luminance linéaire) pour une surface d'albédo 1 ; le curseur va de 0 à 1 dessus. */
export const READING_LIGHT_MAX_FLOOR = 0.3;

/** Intensité courante, partagée par tous les matériaux de surface : 0 = rendu naturel. */
export const READING_LIGHT: { value: number } = { value: 0 };

const READING_LIGHT_KEY = '__readingLight';

/** Direction de l'éclairage frontal, dans le repère de la caméra (vers la scène). */
const FRONT_DIRECTION = 'normalize( vec3( -0.45, 0.6, 0.66 ) )';

const READING_LIGHT_GLSL = /* glsl */ `
	{
		float readingShape = 0.3 + 0.7 * max( dot( normal, ${FRONT_DIRECTION} ), 0.0 );
		outgoingLight = max( outgoingLight, sqrt( max( diffuseColor.rgb, vec3( 0.0 ) ) ) * ( uReadingLight * readingShape ) );
	}
	#include <opaque_fragment>`;

/** Règle l'intensité (0 à 1) ; renvoie le plancher effectivement envoyé aux matériaux. */
export function setReadingLight(intensity: number): number {
  const clamped = Number.isFinite(intensity)
    ? Math.min(1, Math.max(0, intensity))
    : 0;
  READING_LIGHT.value = clamped * READING_LIGHT_MAX_FLOOR;
  return READING_LIGHT.value;
}

/** Vrai tant que l'assistance éclaire effectivement quelque chose. */
export function isReadingLightActive(): boolean {
  return READING_LIGHT.value > 0;
}

/** Ce matériau porte-t-il le plancher ? (Terre et Soleil : non.) */
export function hasReadingLight(material: THREE.Material): boolean {
  return material.userData[READING_LIGHT_KEY] === true;
}

/**
 * Pose le plancher sur un matériau de surface (idempotent). Chaîné APRÈS les patchs du corps,
 * il lit donc la `outgoingLight` finale (éclipse, atténuation, crépuscule compris).
 */
export function installReadingLight(material: THREE.Material): void {
  if (material.userData[READING_LIGHT_KEY]) return;
  material.userData[READING_LIGHT_KEY] = true;
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    shader.uniforms['uReadingLight'] = READING_LIGHT;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uReadingLight;'
      )
      .replace('#include <opaque_fragment>', READING_LIGHT_GLSL);
  };
}
