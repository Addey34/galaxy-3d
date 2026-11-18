/**
 * L'ALPHAMAP NEUTRE DES NUAGES (GAL-RENDER-001C, commit B1).
 *
 * La couche nuages de la Terre a deux régimes : la carte statique (la même texture sert de `map` et
 * d'`alphaMap`) et l'observation satellite (l'alpha est EXTRAIT par le shader, l'`alphaMap` ne sert
 * plus). Retirer l'`alphaMap` au passage de l'un à l'autre supprimait `USE_ALPHAMAP` : un second jeu
 * de programmes, deux faces, environ 410 ms d'édition de liens à l'arrivée de l'observation.
 *
 * On la remplace donc par une texture BLANCHE de 1 × 1 : Three.js lit son canal vert (`a × 1`), le
 * rendu est inchangé au bit près et le programme reste le même. Elle garde aussi le même canal d'UV
 * et la même matrice que l'alphaMap d'origine, les deux seuls réglages d'une alphaMap qui entrent
 * dans la clé de programme.
 *
 * PROPRIÉTÉ : ce module est l'unique propriétaire. Une seule instance pour tout le processus, 4
 * octets côté GPU, jamais libérée : `dispose()` est neutralisé, pour qu'un consommateur qui libère
 * « les textures de ses matériaux » ne la détruise pas sous les autres matériaux qui la partagent.
 */
import * as THREE from 'three';

let shared: THREE.DataTexture | null = null;

/** La texture blanche partagée (créée au premier usage). */
export function neutralAlphaMap(): THREE.DataTexture {
  if (shared) return shared;
  const texture = new THREE.DataTexture(
    new Uint8Array([255, 255, 255, 255]),
    1,
    1
  );
  texture.name = 'neutral_alpha_map';
  texture.colorSpace = THREE.NoColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  texture.dispose = () => undefined;
  shared = texture;
  return texture;
}

/** Vrai pour la texture neutre, et pour elle seule. */
export function isNeutralAlphaMap(
  texture: THREE.Texture | null | undefined
): boolean {
  return shared !== null && texture === shared;
}
