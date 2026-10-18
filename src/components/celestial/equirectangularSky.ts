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
  varying vec3 vDirection;
  #include <common>
  void main() {
    vec2 uv = equirectUv( normalize( vDirection ) );
    // La couture : u saute de 1 à 0 au méridien de l'image, et sa dérivée avec lui, ce qui
    // ferait choisir le niveau de mipmap le plus grossier le long d'une ligne. La dérivée de
    // u décalé d'un demi-tour n'a pas ce saut au même endroit : on garde la plus petite.
    vec2 dx = dFdx( uv );
    vec2 dy = dFdy( uv );
    float shifted = fract( uv.x + 0.5 );
    float dxShifted = dFdx( shifted );
    float dyShifted = dFdy( shifted );
    if ( abs( dxShifted ) < abs( dx.x ) ) dx.x = dxShifted;
    if ( abs( dyShifted ) < abs( dy.x ) ) dy.x = dyShifted;
    gl_FragColor = vec4( textureGrad( map, uv, dx, dy ).rgb * intensity, 1.0 );
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Le ciel : un maillage sans volume, ignoré du lancer de rayons et jamais écarté par le frustum. */
export function createEquirectangularSky(texture: THREE.Texture): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)
  );
  const material = new THREE.ShaderMaterial({
    name: 'EquirectangularSky',
    uniforms: { map: { value: texture }, intensity: { value: 1 } },
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
  mesh.onBeforeRender = (_renderer, scene) => {
    material.uniforms['intensity']!.value = scene.backgroundIntensity;
  };
  return mesh;
}
