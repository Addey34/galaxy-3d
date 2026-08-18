import * as THREE from 'three';

/**
 * Prépare une grille météo équirectangulaire pour une sphère.
 * Le filtrage linéaire supprime les frontières visibles entre cellules 4°/8° ; le clamp vertical
 * évite de répéter artificiellement la dernière bande aux pôles, tandis que la longitude reste cyclique.
 */
export function createMeteoDataTexture(
  data: Uint8ClampedArray,
  width: number,
  height: number
): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    data,
    width,
    height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType
  );
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}