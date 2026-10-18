/**
 * LE FOND DE CIEL, LU DIRECTEMENT DANS L'IMAGE ÉQUIRECTANGULAIRE (lot 54, 2026-10-18).
 *
 * Posée en `scene.background`, une image équirectangulaire est CONVERTIE par Three.js en cubemap
 * dont chaque face mesure la HAUTEUR de l'image (`WebGLCubeMaps`) : pour le ciel 8k, six faces
 * 4096 × 4096 en RGBA8 avec leurs mipmaps, environ 512 Mio, plus la source 8k (171 Mio), qui reste
 * référencée. Mesuré dans le navigateur (allocations du pilote) : ces ~680 Mio n'apparaissaient pas
 * dans la sonde de performance, qui ne compte que les textures des matériaux. La conversion coûtait
 * aussi un second téléversement de l'image 8k (elle passe la source en `minFilter = Linear` le temps
 * du rendu, donc une nouvelle texture GPU) et six rendus 4096² au démarrage.
 *
 * Ici, un triangle couvrant l'écran calcule la direction de visée de chaque pixel et lit l'image
 * par `equirectUv`, la même formule que la conversion de Three.js : il ne reste que la source.
 * Dessiné en premier, sans test ni écriture de profondeur, comme l'était le fond.
 *
 * UN SEUL NIVEAU DE DÉTAIL POUR TOUTE L'IMAGE, calculé du champ de vision et de la hauteur de
 * l'écran (`textureLod`). Une première version laissait le GPU le déduire des dérivées
 * (`textureGrad`, anisotropie 16) : en rendu LOGICIEL, celui de la CI, chaque image passait de
 * 102 à 293 ms sur la Lune, et deux descentes de surface ne finissaient plus (runs simultanés
 * 39112230855 et 39112232461). La cubemap ne faisait pas mieux aux pôles de l'image : sa
 * conversion lisait la source sans mipmaps.
 */
import * as THREE from 'three';

const vertexShader = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    // Un point du plan lointain en coordonnées de découpage, ramené dans le repère du monde :
    // sa direction depuis la caméra est la visée du pixel. Linéaire sur l'écran pour une
    // projection perspective, donc interpolable.
    vec4 view = inverse( projectionMatrix ) * vec4( position.xy, 1.0, 1.0 );
    vDirection = ( inverse( viewMatrix ) * vec4( view.xyz / view.w, 0.0 ) ).xyz;
    gl_Position = vec4( position.xy, 1.0, 1.0 );
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D map;
  uniform float intensity;
  uniform float lod;
  varying vec3 vDirection;
  #include <common>
  void main() {
    vec2 uv = equirectUv( normalize( vDirection ) );
    gl_FragColor = vec4( textureLod( map, uv, lod ).rgb * intensity, 1.0 );
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const bufferSize = new THREE.Vector2();

/**
 * Le niveau de mipmap où un texel de l'image couvre un pixel de l'écran, à l'équateur de
 * l'image : texels par radian (largeur / 2π) fois l'angle d'un pixel (champ vertical / hauteur).
 * Lu sur la matrice de projection, il vaut aussi pour les caméras d'un casque.
 */
export function skyLod(
  imageWidth: number,
  projectionYScale: number,
  bufferHeight: number
): number {
  if (!(imageWidth > 0 && projectionYScale > 0 && bufferHeight > 0)) return 0;
  const fov = 2 * Math.atan(1 / projectionYScale);
  return Math.max(
    0,
    Math.log2(((imageWidth / (2 * Math.PI)) * fov) / bufferHeight)
  );
}

/** Le ciel : un maillage sans volume, ignoré du lancer de rayons et jamais écarté par le frustum. */
export function createEquirectangularSky(texture: THREE.Texture): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)
  );
  const material = new THREE.ShaderMaterial({
    name: 'EquirectangularSky',
    uniforms: {
      map: { value: texture },
      intensity: { value: 1 },
      lod: { value: 0 },
    },
    vertexShader,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'sky_background';
  mesh.frustumCulled = false;
  mesh.renderOrder = -Infinity;
  mesh.raycast = () => {};
  // L'intensité reste celle de la scène : `AnimationSystem` l'efface sous un ciel de jour.
  mesh.onBeforeRender = (renderer, scene, camera) => {
    material.uniforms['intensity']!.value = scene.backgroundIntensity;
    const image = texture.image as { width?: number } | undefined;
    material.uniforms['lod']!.value = skyLod(
      image?.width ?? 0,
      camera.projectionMatrix.elements[5]!,
      renderer.getDrawingBufferSize(bufferSize).y
    );
  };
  return mesh;
}
