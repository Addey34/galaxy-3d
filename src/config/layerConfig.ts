/**
 * Fabriques de géométries et de matériaux partagées par tous les corps célestes.
 * Centralise les conventions de rendu : facteurs d'échelle des couches (surface, nuages,
 * atmosphère, lumières), finesse des sphères/anneaux et matériaux standard réutilisés.
 */
import * as THREE from 'three';

const SHADOW_AWARE_UNIFORM_KEY = '__lightAttenuationUniform';

/**
 * Ajoute un hook `onBeforeCompile` en **préservant** celui déjà posé sur le
 * matériau (three.js n'accepte qu'un seul `onBeforeCompile` — sans ce chaînage,
 * un second patch shader écraserait silencieusement le premier). Le hook existant
 * s'exécute d'abord, puis le nouveau.
 */
function chainOnBeforeCompile(
  material: THREE.Material,
  fn: NonNullable<THREE.Material['onBeforeCompile']>
): void {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.(shader, renderer);
    fn(shader, renderer);
  };
}

// Chaque couche est légèrement plus grande que la précédente pour éviter le
// z-fighting (deux surfaces coïncidentes causent du scintillement GPU).
// `lights` est à 1.002 et non 1.01 : trop éloigné du mesh surface casse
// le calcul de la direction lumière dans le shader (décalage visible à l'oeil).
export const LAYER_RADIUS_SCALE: Record<string, number> = {
  surface: 1.0,
  clouds: 1.01,
  atmosphere: 1.02,
  lights: 1.002,
};

// 64 segments pour les planètes : bon compromis silhouette/perf (≈ 8 k triangles).
// 128 pour les anneaux de Saturne : la géométrie RingGeometry est plate, mais ses
// subdivisions radiales déterminent la précision des UVs corrigés (_correctRingUVs).
export const GEOMETRY_SEGMENTS = 64;
// Segments haute densité pour le displacement (relief géométrique) : une carte de
// hauteur n'est visible qu'avec assez de vertices. Réservé au corps proche/
// sélectionné (cf. CelestialObject) — trop coûteux pour tous les corps en continu.
export const GEOMETRY_SEGMENTS_HI = 256;
export const RING_SEGMENTS = 128;

export function createSphereGeometry(
  radius: number,
  layerType = 'surface',
  segments: number = GEOMETRY_SEGMENTS
): THREE.SphereGeometry {
  const scale = LAYER_RADIUS_SCALE[layerType] ?? 1.0;
  return new THREE.SphereGeometry(radius * scale, segments, segments);
}

export function createSurfaceMaterial(
  isSun: boolean,
  fallbackColor?: number,
  // Clair de Lune : activé pour les corps « habités » (couche lights → Terre).
  // Inerte tant que la position lunaire n'alimente pas l'uniform chaque frame.
  moonlight = false
): THREE.MeshBasicMaterial | THREE.MeshStandardMaterial {
  if (isSun) {
    // toneMapped=false : la couleur n'est pas compressée par l'ACESFilmicToneMapping
    // du renderer, donc le Soleil reste au-dessus du seuil de bloom (0.85) et
    // « brûle » franchement. On pousse la couleur en HDR (composantes > 1 via
    // multiplyScalar) : MeshBasicMaterial.color clampe à 1.0 en écriture littérale
    // (0xfff2cc plafonne le disque à ~0.95 → il effleure à peine le seuil), donc on
    // sur-expose explicitement pour que même les bandes sombres de la texture
    // franchissent 0.85 et nourrissent franchement le bloom.
    const sunMat = new THREE.MeshBasicMaterial({
      color: 0xfff2cc,
      toneMapped: false,
    });
    sunMat.color.multiplyScalar(1.6);
    return sunMat;
  }
  return createShadowAwareStandardMaterial(
    {
      color: fallbackColor ?? 0xffffff,
      roughness: 0.7,
      metalness: 0.0,
    },
    // Inversion de la spec map (convention « blanc = océan lisse ») active dès
    // qu'une roughnessMap est présente ; sans map, la branche shader est inerte.
    // cloudShadow : la branche ne s'active que si une cloud map est fournie au
    // matériau (uCloudShadowMap non nul) — voir CelestialObject.
    { invertRoughnessMap: true, cloudShadow: true, moonlight }
  );
}

export function createCloudsMaterial(): THREE.MeshStandardMaterial {
  return createShadowAwareStandardMaterial({
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

const RING_SHADOW_UNIFORM_KEY = '__ringShadowUniforms';

export interface RingShadowUniforms {
  sunDirection: { value: THREE.Vector3 };
  planetCenter: { value: THREE.Vector3 };
  planetRadius: { value: number };
}

export function createRingMaterial(): THREE.MeshStandardMaterial {
  const material = createShadowAwareStandardMaterial({
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    roughness: 0.8,
  });

  const ringShadow: RingShadowUniforms = {
    sunDirection: { value: new THREE.Vector3(1, 0, 0) },
    planetCenter: { value: new THREE.Vector3() },
    planetRadius: { value: 0 },
  };
  material.userData[RING_SHADOW_UNIFORM_KEY] = ringShadow;

  // On chaîne un second onBeforeCompile : le premier (shadow-aware) est déjà posé
  // par createShadowAwareStandardMaterial ; on le préserve et on ajoute l'ombre
  // portée de la planète sur l'anneau.
  chainOnBeforeCompile(material, (shader) => {
    shader.uniforms['uRingSunDir'] = ringShadow.sunDirection;
    shader.uniforms['uRingPlanetCenter'] = ringShadow.planetCenter;
    shader.uniforms['uRingPlanetRadius'] = ringShadow.planetRadius;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vRingWorldPos;'
      )
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\n\tvRingWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;'
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uRingSunDir;
        uniform vec3 uRingPlanetCenter;
        uniform float uRingPlanetRadius;
        varying vec3 vRingWorldPos;`
      )
      // Ombre cylindrique de la planète sur l'anneau : un point d'anneau est dans
      // l'ombre s'il est du côté opposé au Soleil ET si sa distance perpendiculaire
      // à l'axe Soleil (passant par le centre planète) est < rayon planète.
      .replace(
        'vec3 outgoingLight = (totalDiffuse + totalSpecular) * uLightAttenuation + totalEmissiveRadiance;',
        `vec3 toPoint = vRingWorldPos - uRingPlanetCenter;
        float alongSun = dot( toPoint, uRingSunDir );
        vec3 perp = toPoint - alongSun * uRingSunDir;
        float perpDist = length( perp );
        // alongSun < 0 = côté nuit ; transition douce sur le bord de l'ombre.
        float shadow = ( alongSun < 0.0 )
          ? ( 1.0 - smoothstep( uRingPlanetRadius * 0.85, uRingPlanetRadius * 1.05, perpDist ) )
          : 0.0;
        float ringShadowFactor = mix( 1.0, 0.08, shadow );
        // L'émissif (ré-illumination des particules de glace) est aussi assombri
        // par l'ombre portée de la planète : sinon l'arc occulté continuerait de
        // « briller » dans l'ombre. On laisse un léger résidu (0.15) car l'anneau
        // reçoit encore un peu de lumière diffusée hors ombre géométrique pure.
        vec3 outgoingLight = ( totalDiffuse + totalSpecular ) * uLightAttenuation * ringShadowFactor
          + totalEmissiveRadiance * mix( 1.0, 0.15, shadow );`
      );
  });
  // Clé de cache distincte : ce matériau a un shader différent des surfaces.
  material.customProgramCacheKey = () => 'shadow-aware-ring-v1';

  return material;
}

/** Récupère les uniforms d'ombre d'anneau d'un matériau, s'il en a. */
export function getRingShadowUniforms(
  material: THREE.Material
): RingShadowUniforms | undefined {
  return material.userData[RING_SHADOW_UNIFORM_KEY] as
    | RingShadowUniforms
    | undefined;
}

// Douceur du terminateur jour/nuit (wrap lighting). Adoucit UNIQUEMENT la bande
// autour du terminateur : au-delà de -w, la face nuit reste noire (le saturate
// clampe à 0). Une valeur trop haute (0.35) éclairait ~26 % tout l'hémisphère
// nuit → face nuit inondée de bleu. 0.12 = crépuscule crédible sans flood.
const TERMINATOR_WRAP = 0.12;

// Clair de Lune (réflecteur nocturne) injecté après le calcul d'outgoingLight.
// N'agit que côté nuit (masque via dot normale/dirSoleil) et proportionnellement
// a l'orientation du point vers la Lune. uMoonStrength encode la phase. Lueur
// diffuse douce ajoutee a l'albedo : pas de mesh proxy, pas d'orbe, juste un
// terme lambertien depuis la vraie position de la Lune.
const MOONLIGHT_GLSL = `
        if ( uMoonStrength > 0.0 ) {
          vec3 nrm = normalize( vMoonWorldNormal );
          vec3 toMoon = normalize( uMoonPosition - vMoonWorldPos );
          float moonFacing = max( dot( nrm, toMoon ), 0.0 );
          float nightMask = smoothstep( 0.05, -0.10, dot( nrm, uMoonSunDir ) );
          vec3 moonGlow = uMoonColor * ( moonFacing * nightMask * uMoonStrength );
          outgoingLight += moonGlow * diffuseColor.rgb;
        }`;

const CLOUD_SHADOW_UNIFORM_KEY = '__cloudShadowUniforms';

export interface CloudShadowUniforms {
  map: { value: THREE.Texture | null };
  offset: { value: number };
  strength: { value: number };
}

const MOONLIGHT_UNIFORM_KEY = '__moonlightUniforms';

export interface MoonlightUniforms {
  /** Position monde de la Lune (réflecteur nocturne). */
  position: { value: THREE.Vector3 };
  /** Direction monde du Soleil (pour n'éclairer que la face NUIT). */
  sunDir: { value: THREE.Vector3 };
  /** Intensité globale, modulée par la phase (fraction éclairée de la Lune). */
  strength: { value: number };
  /** Teinte du clair de Lune (blanc légèrement froid). */
  color: { value: THREE.Color };
}

export function createShadowAwareStandardMaterial(
  params: THREE.MeshStandardMaterialParameters,
  options: {
    invertRoughnessMap?: boolean;
    cloudShadow?: boolean;
    moonlight?: boolean;
  } = {}
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial(params);
  const attenuationUniform = { value: 1 };
  const invertRoughness = options.invertRoughnessMap === true;
  const cloudShadow = options.cloudShadow === true;
  const moonlight = options.moonlight === true;
  const cloudShadowUniforms: CloudShadowUniforms = {
    map: { value: null },
    offset: { value: 0 },
    // 0 tant qu'aucune cloud map n'est assignée : la branche shader ne
    // s'active (n'échantillonne le sampler) qu'une fois la map fournie.
    strength: { value: 0 },
  };
  const moonlightUniforms: MoonlightUniforms = {
    position: { value: new THREE.Vector3() },
    sunDir: { value: new THREE.Vector3(1, 0, 0) },
    // 0 tant que la position lunaire n'est pas fournie chaque frame : branche inerte.
    strength: { value: 0 },
    color: { value: new THREE.Color(0xbcd2ff) },
  };

  material.userData[SHADOW_AWARE_UNIFORM_KEY] = attenuationUniform;
  if (cloudShadow)
    material.userData[CLOUD_SHADOW_UNIFORM_KEY] = cloudShadowUniforms;
  if (moonlight) material.userData[MOONLIGHT_UNIFORM_KEY] = moonlightUniforms;
  chainOnBeforeCompile(material, (shader) => {
    shader.uniforms['uLightAttenuation'] = attenuationUniform;
    shader.uniforms['uTerminatorWrap'] = { value: TERMINATOR_WRAP };
    if (cloudShadow) {
      shader.uniforms['uCloudShadowMap'] = cloudShadowUniforms.map;
      shader.uniforms['uCloudShadowOffset'] = cloudShadowUniforms.offset;
      shader.uniforms['uCloudShadowStrength'] = cloudShadowUniforms.strength;
    }
    if (moonlight) {
      shader.uniforms['uMoonPosition'] = moonlightUniforms.position;
      shader.uniforms['uMoonSunDir'] = moonlightUniforms.sunDir;
      shader.uniforms['uMoonStrength'] = moonlightUniforms.strength;
      shader.uniforms['uMoonColor'] = moonlightUniforms.color;

      // Position + normale monde du fragment pour le calcul du clair de Lune
      // (dot(normale, dirVersLune)). On réutilise le chunk worldpos et on reconstruit
      // la normale monde depuis la normale objet.
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vMoonWorldPos;\nvarying vec3 vMoonWorldNormal;'
        )
        .replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\n\tvMoonWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n\tvMoonWorldNormal = normalize( mat3( modelMatrix ) * objectNormal );'
        );
    }
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uLightAttenuation;\nuniform float uTerminatorWrap;' +
          (cloudShadow
            ? '\nuniform sampler2D uCloudShadowMap;\nuniform float uCloudShadowOffset;\nuniform float uCloudShadowStrength;'
            : '') +
          (moonlight
            ? '\nuniform vec3 uMoonPosition;\nuniform vec3 uMoonSunDir;\nuniform float uMoonStrength;\nuniform vec3 uMoonColor;\nvarying vec3 vMoonWorldPos;\nvarying vec3 vMoonWorldNormal;'
            : '')
      )
      // Wrap lighting : three.js clampe dotNL à [0,1] dans RE_Direct_Physical.
      // On remappe dotNL avant le saturate pour faire déborder l'irradiance de
      // l'autre côté du terminateur (crépuscule). Une seule occurrence dans le
      // shader Standard (pars physical) — le remplacement unique est correct.
      .replace(
        'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );',
        'float dotNL = saturate( ( dot( geometryNormal, directLight.direction ) + uTerminatorWrap ) / ( 1.0 + uTerminatorWrap ) );'
      )
      .replace(
        'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
        'vec3 outgoingLight = (totalDiffuse + totalSpecular) * uLightAttenuation + totalEmissiveRadiance;' +
          (moonlight ? MOONLIGHT_GLSL : '')
      );

    if (invertRoughness) {
      // Les spec maps Terre suivent la convention « blanc = océan » (lisse).
      // On inverse le canal, MAIS on le remappe dans une plage bornée
      // [OCEAN_ROUGH, LAND_ROUGH] au lieu de [0,1] : un océan à roughness 0 est
      // un miroir parfait → le reflet solaire devient un point saturé, dur et
      // « carré » (structure de la spec map basse résolution grossie). Un plancher
      // de rugosité (~0.35) transforme ce miroir en reflet doux et étalé (sun
      // glint crédible), et supprime l'artefact carré.
      shader.fragmentShader = shader.fragmentShader.replace(
        'roughnessFactor *= texelRoughness.g;',
        'roughnessFactor *= mix( 0.95, 0.55, texelRoughness.g );'
      );
    }

    if (cloudShadow) {
      // Ombre douce des nuages projetée sur la surface. Les nuages tournent un
      // peu plus vite que le sol → on décale l'UV horizontal (longitude) par
      // uCloudShadowOffset pour suivre leur position, puis on assombrit l'albédo
      // proportionnellement à la densité nuageuse (canal rouge de la cloud map).
      // Gardé par #ifdef USE_MAP : `vMapUv` n'est déclaré (uv_pars_fragment) que
      // lorsqu'une base map est présente. Sans ce garde, le PREMIER compile (avant
      // que la texture surface async ne soit assignée → USE_MAP absent) référence
      // un `vMapUv` inexistant → shader non compilé, surface cassée en dur. L'ombre
      // n'a de sens qu'avec une surface texturée de toute façon.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        #ifdef USE_MAP
        if ( uCloudShadowStrength > 0.0 ) {
          vec2 cloudUv = vec2( vMapUv.x - uCloudShadowOffset, vMapUv.y );
          float cloudDensity = texture2D( uCloudShadowMap, cloudUv ).r;
          diffuseColor.rgb *= 1.0 - cloudDensity * uCloudShadowStrength;
        }
        #endif`
      );
    }
  });
  material.customProgramCacheKey = () =>
    `shadow-aware-standard-v2${invertRoughness ? '-invrough' : ''}${
      cloudShadow ? '-cloudshadow' : ''
    }${moonlight ? '-moonlight' : ''}`;

  return material;
}

/** Récupère les uniforms d'ombre nuageuse d'un matériau, s'il en a. */
export function getCloudShadowUniforms(
  material: THREE.Material
): CloudShadowUniforms | undefined {
  return material.userData[CLOUD_SHADOW_UNIFORM_KEY] as
    | CloudShadowUniforms
    | undefined;
}

/** Récupère les uniforms de clair de Lune d'un matériau, s'il en a. */
export function getMoonlightUniforms(
  material: THREE.Material
): MoonlightUniforms | undefined {
  return material.userData[MOONLIGHT_UNIFORM_KEY] as
    | MoonlightUniforms
    | undefined;
}

export function configureShadows(
  mesh: THREE.Mesh,
  castShadow: boolean,
  receiveShadow: boolean
): void {
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
}

export function setMaterialLightAttenuation(
  material: THREE.Material,
  attenuation: number
): void {
  if (!(material instanceof THREE.MeshStandardMaterial)) return;
  const uniform = material.userData[SHADOW_AWARE_UNIFORM_KEY] as
    { value: number } | undefined;
  if (uniform) uniform.value = attenuation;
}
