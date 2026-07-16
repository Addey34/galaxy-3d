/**
 * Fond étoilé : une immense sphère texturée vue de l'intérieur (skybox).
 * Sert de décor fixe et lointain derrière tout le système solaire.
 */
import * as THREE from 'three';

interface StarfieldOptions {
  /** Rayon de la sphère, en unités de scène (défaut 10000 — bien au-delà des orbites). */
  size?: number;
}

/**
 * Construit la skybox étoilée, prête à être ajoutée à la scène.
 * @param texture Texture équirectangulaire du ciel, plaquée sur la face interne.
 */
export function createStarfield(
  texture: THREE.Texture,
  options: StarfieldOptions = {}
): THREE.Mesh {
  const { size = 10000 } = options;

  const geometry = new THREE.SphereGeometry(size, 128, 128);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.BackSide, // on rend l'intérieur de la sphère : la caméra regarde les étoiles depuis le centre
    fog: false,
  });

  const skybox = new THREE.Mesh(geometry, material);
  skybox.name = 'starfield_skybox';
  // renderOrder = -Infinity : la skybox est dessinée avant tout le reste, quelle que soit
  // sa position dans le graphe de scène, donc les étoiles ne masquent jamais les planètes.
  skybox.renderOrder = -Infinity;

  return skybox;
}
