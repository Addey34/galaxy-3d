/**
 * LE CIEL D'UNE ATMOSPHÈRE, PAR DIFFUSION SIMPLE LE LONG DE LA VISÉE (lot 48, pas 6).
 *
 * Posé sur la même coque que l'ancien halo (rendue en face ARRIÈRE : on la voit de l'extérieur au
 * limbe, et de l'intérieur sur toute la voûte), il intègre pour chaque pixel la lumière du Soleil
 * diffusée une fois vers la caméra, Rayleigh et Mie, atténuée en chemin par Rayleigh, Mie et
 * l'ozone. Les coefficients viennent de `core/atmosphereScattering.ts` ; rien ici n'est réglé à
 * l'œil, sauf le nombre d'échantillons.
 *
 * TOUT SE CALCULE DANS LE REPÈRE DE LA VUE, EN KM. En coordonnées monde, la Terre est à 35
 * unités de l'origine pour un rayon de 0,0015 : en flottants 32 bits, la position d'un fragment
 * n'y est connue qu'à ~16 km près, plus que la hauteur d'échelle de l'air (8 km). Dans le repère
 * de la vue, la caméra est à l'origine et le centre du corps est un uniform calculé en double
 * précision côté CPU (`CelestialObject`), si bien que les petites distances restent exactes.
 *
 * Le rayon du sol est celui de l'ellipsoïde SOUS la caméra (le niveau de la mer), pas la sphère
 * moyenne : à 46° N il est 3,6 km plus bas, et une caméra à 1 km du sol se serait trouvée « sous
 * terre » pour le modèle. Une visée qui touche le sol s'y arrête ; l'ombre de la planète se fait
 * d'elle-même (un échantillon dont la route vers le Soleil traverse le sol ne reçoit rien), d'où
 * le crépuscule et la nuit sans terminateur à régler.
 */
import * as THREE from 'three';
import type { SkyScattering } from '@/core/atmosphereScattering';

/** Échantillons le long de la visée, puis vers le Soleil depuis chacun. */
export const SKY_VIEW_SAMPLES = 16;
export const SKY_LIGHT_SAMPLES = 6;

export interface SkyScatteringUniforms {
  uCenterView: THREE.IUniform<THREE.Vector3>;
  uSunDirView: THREE.IUniform<THREE.Vector3>;
  uKmPerUnit: THREE.IUniform<number>;
  uGroundKm: THREE.IUniform<number>;
  uTopKm: THREE.IUniform<number>;
  uSunIntensity: THREE.IUniform<number>;
  uRayleigh: THREE.IUniform<THREE.Vector3>;
  uRayleighHeight: THREE.IUniform<number>;
  uMieScattering: THREE.IUniform<number>;
  uMieExtinction: THREE.IUniform<number>;
  uMieHeight: THREE.IUniform<number>;
  uMieG: THREE.IUniform<number>;
  uOzone: THREE.IUniform<THREE.Vector3>;
  uOzonePeak: THREE.IUniform<number>;
  uOzoneHalfWidth: THREE.IUniform<number>;
  // Requis par le type des uniforms de THREE.ShaderMaterial.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: THREE.IUniform<any>;
}

export const vertexShader = /* glsl */ `
  varying vec3 vViewPosition;
  void main() {
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = view.xyz;
    gl_Position = projectionMatrix * view;
  }
`;

/**
 * LA DIFFUSION LE LONG D'UN SEGMENT, partagée par le ciel (par pixel, jusqu'au sol) et par la
 * perspective aérienne du sol (`aerialPerspective.ts`, par sommet, jusqu'au sommet). L'inclusion
 * définit `VIEW_SAMPLES` et `LIGHT_SAMPLES` avant elle. Repère centré sur le corps, en km.
 *
 * `scatterSegment` rend la lumière diffusée vers l'origine et la transmittance de l'origine au
 * bout du segment ; `false` si le segment ne traverse pas l'air.
 */
export const SCATTER_GLSL = /* glsl */ `
  #define PI 3.141592653589793

  uniform vec3 uCenterView;
  uniform vec3 uSunDirView;
  uniform float uKmPerUnit;
  uniform float uGroundKm;
  uniform float uTopKm;
  uniform float uSunIntensity;
  uniform vec3 uRayleigh;
  uniform float uRayleighHeight;
  uniform float uMieScattering;
  uniform float uMieExtinction;
  uniform float uMieHeight;
  uniform float uMieG;
  uniform vec3 uOzone;
  uniform float uOzonePeak;
  uniform float uOzoneHalfWidth;

  // Intersections d'un rayon (origine o, direction unitaire d) avec la sphère de rayon r centrée
  // à l'origine : (t proche, t lointain), ou (-1, -1) sans intersection.
  vec2 sphere( vec3 o, vec3 d, float r ) {
    float b = dot( o, d );
    float c = dot( o, o ) - r * r;
    float disc = b * b - c;
    if ( disc < 0.0 ) return vec2( -1.0 );
    float s = sqrt( disc );
    return vec2( -b - s, -b + s );
  }

  // Densités relatives (Rayleigh, Mie, ozone) à l'altitude h au-dessus du niveau de la mer.
  vec3 densities( float h ) {
    return vec3(
      exp( -h / uRayleighHeight ),
      exp( -h / uMieHeight ),
      max( 0.0, 1.0 - abs( h - uOzonePeak ) / uOzoneHalfWidth )
    );
  }

  vec3 extinction( vec3 depth ) {
    return uRayleigh * depth.x + vec3( uMieExtinction ) * depth.y + uOzone * depth.z;
  }

  bool scatterSegment(
    vec3 origin, vec3 dir, float limit, bool stopAtGround,
    out vec3 radiance, out vec3 transmittance
  ) {
    radiance = vec3( 0.0 );
    transmittance = vec3( 1.0 );
    vec2 top = sphere( origin, dir, uTopKm );
    if ( top.y <= 0.0 ) return false;
    float start = max( top.x, 0.0 );
    float end = min( top.y, limit );
    if ( stopAtGround ) {
      vec2 ground = sphere( origin, dir, uGroundKm );
      if ( ground.x > 0.0 ) end = min( end, ground.x );
    }
    if ( end <= start ) return false;

    float ds = ( end - start ) / float( VIEW_SAMPLES );
    vec3 viewDepth = vec3( 0.0 );
    vec3 sumRayleigh = vec3( 0.0 );
    vec3 sumMie = vec3( 0.0 );
    for ( int i = 0; i < VIEW_SAMPLES; i++ ) {
      vec3 p = origin + dir * ( start + ( float( i ) + 0.5 ) * ds );
      vec3 rho = densities( length( p ) - uGroundKm ) * ds;
      viewDepth += rho * 0.5;
      // Route vers le Soleil : coupée par le sol, l'échantillon est dans l'ombre de la planète.
      vec2 shadow = sphere( p, uSunDirView, uGroundKm );
      if ( shadow.x <= 0.0 ) {
        float lightEnd = sphere( p, uSunDirView, uTopKm ).y;
        float dl = lightEnd / float( LIGHT_SAMPLES );
        vec3 lightDepth = vec3( 0.0 );
        for ( int j = 0; j < LIGHT_SAMPLES; j++ ) {
          vec3 q = p + uSunDirView * ( ( float( j ) + 0.5 ) * dl );
          lightDepth += densities( length( q ) - uGroundKm ) * dl;
        }
        vec3 t = exp( -extinction( viewDepth + lightDepth ) );
        sumRayleigh += t * rho.x;
        sumMie += t * rho.y;
      }
      viewDepth += rho * 0.5;
    }

    float mu = dot( dir, uSunDirView );
    float rayleighPhase = 3.0 / ( 16.0 * PI ) * ( 1.0 + mu * mu );
    float g = uMieG;
    float miePhase = 3.0 / ( 8.0 * PI ) * ( 1.0 - g * g ) / ( 2.0 + g * g )
      * ( 1.0 + mu * mu ) / pow( 1.0 + g * g - 2.0 * g * mu, 1.5 );
    radiance = uSunIntensity * (
      uRayleigh * sumRayleigh * rayleighPhase
      + vec3( uMieScattering ) * sumMie * miePhase
    );
    transmittance = exp( -extinction( viewDepth ) );
    return true;
  }
`;

export const fragmentShader = /* glsl */ `
  #define VIEW_SAMPLES ${SKY_VIEW_SAMPLES}
  #define LIGHT_SAMPLES ${SKY_LIGHT_SAMPLES}
  ${SCATTER_GLSL}

  varying vec3 vViewPosition;

  void main() {
    // Repère centré sur le corps, en km : la caméra est en -centre.
    vec3 radiance;
    vec3 behind;
    if ( !scatterSegment(
      -uCenterView * uKmPerUnit, normalize( vViewPosition ), 1e9, true, radiance, behind
    ) ) discard;
    // Ce qui est derrière l'air (les étoiles) en sort atténué : alpha = transmittance moyenne,
    // employée comme facteur de destination (cf. le matériau).
    gl_FragColor = vec4( radiance, ( behind.r + behind.g + behind.b ) / 3.0 );
  }
`;

export function createUniforms(sky: SkyScattering): SkyScatteringUniforms {
  return {
    uCenterView: { value: new THREE.Vector3() },
    uSunDirView: { value: new THREE.Vector3(1, 0, 0) },
    uKmPerUnit: { value: 1 },
    uGroundKm: { value: 1 },
    uTopKm: { value: 1 + sky.thicknessKm },
    uSunIntensity: { value: 1 },
    uRayleigh: { value: new THREE.Vector3(...sky.rayleighScatteringPerKm) },
    uRayleighHeight: { value: sky.rayleighScaleHeightKm },
    uMieScattering: { value: sky.mieScatteringPerKm },
    uMieExtinction: { value: sky.mieExtinctionPerKm },
    uMieHeight: { value: sky.mieScaleHeightKm },
    uMieG: { value: sky.mieG },
    uOzone: { value: new THREE.Vector3(...sky.ozoneAbsorptionPerKm) },
    uOzonePeak: { value: sky.ozonePeakKm },
    uOzoneHalfWidth: { value: sky.ozoneHalfWidthKm },
  };
}

/**
 * Le matériau du ciel : face ARRIÈRE de la coque, sans écriture de profondeur, testé contre le
 * sol. Mélange `couleur = rayonnement + destination × transmittance` : la lumière diffusée
 * s'AJOUTE, ce qui est derrière l'air en sort atténué.
 */
export function createSkyMaterial(sky: SkyScattering): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: createUniforms(sky),
    transparent: true,
    side: THREE.BackSide,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.SrcAlphaFactor,
  });
  material.userData[SKY_KEY] = { thicknessKm: sky.thicknessKm };
  return material;
}

const SKY_KEY = '__skyScattering';

/** Les uniforms du ciel de ce matériau, et l'épaisseur de son air, s'il en est un. */
export function getSky(
  material: THREE.Material
): { uniforms: SkyScatteringUniforms; thicknessKm: number } | undefined {
  const data = material.userData[SKY_KEY] as
    { thicknessKm: number } | undefined;
  if (!data || !(material instanceof THREE.ShaderMaterial)) return undefined;
  return {
    uniforms: material.uniforms as SkyScatteringUniforms,
    thicknessKm: data.thicknessKm,
  };
}
