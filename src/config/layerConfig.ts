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
  // Couche pluie IMERG : juste au-dessus des nuages, sous l'atmosphère.
  precip: 1.011,
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
    // polarCaps : masque la singularité polaire équirectangulaire (« super Groenland »)
    // par une calotte de glace propre. Réservé aux corps « type Terre » (moonlight) :
    // une calotte de glace n'a pas de sens sur une géante gazeuse (Jupiter/Saturn).
    { invertRoughnessMap: true, cloudShadow: true, moonlight, polarCaps: moonlight }
  );
}

const REAL_CLOUDS_UNIFORM_KEY = '__realCloudsUniforms';

export interface RealCloudsUniforms {
  /** 0 = couche nuages statique classique ; 1 = extraction depuis l'imagerie GIBS. */
  enabled: { value: number };
  /** Bornes de luminance (min RGB) du smoothstep d'extraction. */
  lumLow: { value: number };
  lumHigh: { value: number };
  /** Saturation maximale tolérée : au-dessus = sol coloré, rejeté. */
  satMax: { value: number };
  /**
   * Seuil de luminance bas SUR LA TERRE FERME (plus strict que sur l'océan) : le sable
   * clair d'un désert (Sahara) a une luminance proche d'un nuage → sur terre on n'accepte
   * que les nuages francs. Sur l'océan (fond sombre) le seuil `lumLow` capte même les
   * nuages fins.
   */
  lumLowLand: { value: number };
  /** Carte océan (canal g de la spec map surface : 1 = eau). Partagée depuis la surface. */
  oceanMask: { value: THREE.Texture | null };
  /** 1 quand une carte océan est fournie, sinon 0 (extraction « terre stricte » partout). */
  hasOceanMask: { value: number };
}

/** Récupère les uniforms d'extraction nuages réels d'un matériau, s'il en a. */
export function getRealCloudsUniforms(
  material: THREE.Material
): RealCloudsUniforms | undefined {
  return material.userData[REAL_CLOUDS_UNIFORM_KEY] as
    | RealCloudsUniforms
    | undefined;
}

// Extraction des nuages depuis une image satellite True Color (GIBS). L'image contient
// nuages (blanc lumineux désaturé), océans/trous (noir) ET continents (sol coloré). Le
// sable clair d'un désert a une luminance proche d'un nuage → une extraction par simple
// seuil produit de faux nuages sur le Sahara. On lève l'ambiguïté avec la CARTE OCÉAN
// (canal g de la spec map surface, déjà utilisée par le glint) : sur l'eau (fond sombre)
// on capte les nuages avec un seuil bas ; sur la terre on n'accepte que les nuages francs
// (seuil `lumLowLand` plus haut). Alpha = luminance (min RGB) × désaturation. On écrase
// la couleur vers le blanc pour ne pas teinter le nuage avec le sol résiduel.
// Injecté après <map_fragment> (diffuseColor = texel). Inerte si uRealClouds == 0.
const REAL_CLOUDS_GLSL = `
        #ifdef USE_MAP
        if ( uRealClouds > 0.5 ) {
          vec3 rc = diffuseColor.rgb;
          float rcMax = max( rc.r, max( rc.g, rc.b ) );
          float rcMin = min( rc.r, min( rc.g, rc.b ) );
          float rcSat = rcMax > 0.0001 ? ( rcMax - rcMin ) / rcMax : 0.0;
          // Océan = 1 (eau) → seuil bas ; terre = 0 → seuil haut (lumLowLand).
          float rcOcean = uHasOceanMask > 0.5
            ? texture2D( uCloudOceanMask, vMapUv ).g
            : 0.0;
          float rcLumLow = mix( uCloudLumLowLand, uCloudLumLow, rcOcean );
          float rcBright = smoothstep( rcLumLow, uCloudLumHigh, rcMin );
          float rcDesat = 1.0 - smoothstep( uCloudSatMax, uCloudSatMax + 0.15, rcSat );
          float rcAlpha = rcBright * rcDesat;
          // Atténuation POLAIRE : en projection équirectangulaire, les rangées extrêmes
          // (v→0 pôle Sud, v→1 pôle Nord) convergent au pôle → toute rangée claire s'étire
          // en une calotte (le « super Groenland » : la rangée Arctique de l'imagerie est
          // ~99 % blanche). Au-delà de ~78° de latitude la donnée est déformée/peu fiable :
          // on fond l'alpha vers 0 pour supprimer la calotte parasite.
          float rcLat = abs( vMapUv.y - 0.5 ) * 2.0; // 0 = équateur, 1 = pôle
          float rcPole = 1.0 - smoothstep( 0.86, 0.97, rcLat );
          rcAlpha *= rcPole;
          diffuseColor.a *= rcAlpha;
          // Nuage réaliste vu de l'espace : blanc très légèrement chaud (pas un blanc
          // clinique). L'éclairage jour/nuit du matériau fait le reste (face nuit sombre).
          diffuseColor.rgb = vec3( 1.0, 0.995, 0.985 );
        }
        #endif`;

export function createCloudsMaterial(): THREE.MeshStandardMaterial {
  const material = createShadowAwareStandardMaterial({
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const realClouds: RealCloudsUniforms = {
    enabled: { value: 0 },
    lumLow: { value: 0.32 },
    lumHigh: { value: 0.62 },
    satMax: { value: 0.3 },
    lumLowLand: { value: 0.55 },
    oceanMask: { value: null },
    hasOceanMask: { value: 0 },
  };
  material.userData[REAL_CLOUDS_UNIFORM_KEY] = realClouds;

  chainOnBeforeCompile(material, (shader) => {
    shader.uniforms['uRealClouds'] = realClouds.enabled;
    shader.uniforms['uCloudLumLow'] = realClouds.lumLow;
    shader.uniforms['uCloudLumHigh'] = realClouds.lumHigh;
    shader.uniforms['uCloudSatMax'] = realClouds.satMax;
    shader.uniforms['uCloudLumLowLand'] = realClouds.lumLowLand;
    shader.uniforms['uCloudOceanMask'] = realClouds.oceanMask;
    shader.uniforms['uHasOceanMask'] = realClouds.hasOceanMask;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uRealClouds;\nuniform float uCloudLumLow;\nuniform float uCloudLumHigh;\nuniform float uCloudSatMax;\nuniform float uCloudLumLowLand;\nuniform sampler2D uCloudOceanMask;\nuniform float uHasOceanMask;'
      )
      .replace('#include <map_fragment>', '#include <map_fragment>' + REAL_CLOUDS_GLSL);
  });
  // Clé de cache distincte : la variante nuages réels compile un shader différent.
  const previousCacheKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () =>
    `${previousCacheKey ? previousCacheKey() : ''}-realclouds`;

  return material;
}

const PRECIP_UNIFORM_KEY = '__precipUniforms';

export interface PrecipUniforms {
  /** 0 = couche pluie inerte ; 1 = active (une frame IMERG assignée). */
  enabled: { value: number };
  /** Opacité globale de la couche pluie. */
  opacity: { value: number };
}

/** Récupère les uniforms de la couche pluie d'un matériau, s'il en a. */
export function getPrecipUniforms(
  material: THREE.Material
): PrecipUniforms | undefined {
  return material.userData[PRECIP_UNIFORM_KEY] as PrecipUniforms | undefined;
}

// Remap de la carte de pluie IMERG (fausses couleurs) vers une teinte RÉALISTE intégrée.
// Palette IMERG : vert = pluie légère, jaune = modérée, rouge/orange = intense, cyan =
// neige/glace. On dérive l'intensité de pluie du glissement vert→rouge (rIntensity ≈
// R/(R+G)) et on détecte la neige (bleu élevé). On produit alors :
//   - pluie : gris-bleu translucide, plus dense et légèrement plus clair quand intense ;
//   - orage fort : éclat blanc chaud (cœurs convectifs) ;
//   - neige : blanc froid très diffus.
// L'alpha (masque pluie IMERG) module l'opacité. Injecté après <map_fragment>.
const PRECIP_REMAP_GLSL = `
        #ifdef USE_MAP
        if ( uPrecipEnabled > 0.5 ) {
          vec3 pc = diffuseColor.rgb;
          float pMask = diffuseColor.a; // alpha IMERG = présence de précip
          float denom = max( pc.r + pc.g, 0.0001 );
          float pRain = clamp( pc.r / denom, 0.0, 1.0 ); // 0 vert (léger) → 1 rouge (intense)
          float pSnow = clamp( ( pc.b - max( pc.r, pc.g ) ) * 2.0, 0.0, 1.0 );
          // Teinte pluie : gris-bleu → blanc chaud quand intense (cœur d'orage).
          vec3 rainLight = vec3( 0.55, 0.62, 0.72 );
          vec3 rainHeavy = vec3( 1.0, 0.97, 0.9 );
          vec3 rainCol = mix( rainLight, rainHeavy, smoothstep( 0.45, 0.85, pRain ) );
          vec3 snowCol = vec3( 0.86, 0.9, 0.96 );
          vec3 col = mix( rainCol, snowCol, pSnow );
          // Densité optique : pluie fine perceptible, orage bien dense.
          float dens = mix( 0.5, 1.0, smoothstep( 0.0, 0.8, pRain ) );
          diffuseColor.rgb = col;
          diffuseColor.a = pMask * dens * uPrecipOpacity;
        }
        #endif`;

export function createPrecipMaterial(): THREE.MeshBasicMaterial {
  // MeshBasicMaterial (non éclairé) : la pluie est une couche d'information visible de
  // jour comme de nuit, elle ne dépend pas de la PointLight du Soleil.
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    opacity: 1,
  });
  const precip: PrecipUniforms = {
    enabled: { value: 0 },
    opacity: { value: 0.85 },
  };
  material.userData[PRECIP_UNIFORM_KEY] = precip;

  chainOnBeforeCompile(material, (shader) => {
    shader.uniforms['uPrecipEnabled'] = precip.enabled;
    shader.uniforms['uPrecipOpacity'] = precip.opacity;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uPrecipEnabled;\nuniform float uPrecipOpacity;'
      )
      .replace(
        '#include <map_fragment>',
        '#include <map_fragment>' + PRECIP_REMAP_GLSL
      );
  });
  material.customProgramCacheKey = () => 'precip-remap-v1';

  return material;
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

// Reflet solaire (« sun glint ») dédié sur l'océan. La réponse spéculaire d'un
// diélectrique (metalness 0, réflectance ~4 %) éclairé par la PointLight faible
// est quasi invisible sur du bleu foncé → on ajoute un lobe spéculaire explicite.
// Rond par construction (pow(NdotH, exposant) est un lobe circulaire), masqué sur
// l'océan via la spec map (canal g élevé = eau), côté jour uniquement, en teinte
// solaire chaude. Réutilise les varyings/uniforms monde déjà posés par la branche
// moonlight (vMoonWorldPos/Normal, uMoonSunDir = direction du Soleil) et
// uGlintSunColor/Strength propres. Sans roughnessMap (USE_ROUGHNESSMAP absent), le
// masque océan est indisponible → l'effet est gardé par #ifdef.
const OCEAN_GLINT_GLSL = `
        #ifdef USE_ROUGHNESSMAP
        if ( uGlintStrength > 0.0 ) {
          vec3 gN = normalize( vMoonWorldNormal );
          vec3 gToSun = normalize( uMoonSunDir );
          vec3 gToView = normalize( cameraPosition - vMoonWorldPos );
          vec3 gHalf = normalize( gToSun + gToView );
          float gDay = max( dot( gN, gToSun ), 0.0 );
          float gNdotH = max( dot( gN, gHalf ), 0.0 );
          // Masque océan STRICT. La spec map vaut ~1 sur l'eau, ~0 sur la terre ; on
          // exige un océan franc (smoothstep 0.88→0.97). Seuil haut = la frange
          // côtière (valeurs interpolées) et la terre restent à 0 → pas de débord sur
          // les continents. Bord légèrement adouci (vs step dur) pour ne pas créer un
          // liseré net à la limite eau/terre quand le lobe touche une côte.
          float gRaw = texture2D( roughnessMap, vRoughnessMapUv ).g;
          float gOcean = smoothstep( 0.88, 0.97, gRaw );
          // Largeur du lobe = compromis réaliste. Un vrai reflet solaire océanique
          // n'est PAS un point-miroir parfait : la mer est rugueuse (vagues) et étale
          // le reflet en une tache douce (le « sunglint » des photos ISS). pow 2000
          // (miroir parfait) donnait un point sous-pixel invisible → on avait
          // l'impression que le Soleil ne se reflétait plus. pow 250 était trop large
          // et débordait des mers sur la terre. pow 450 = tache visible mais contenue,
          // strictement portée par le masque océan (pas de débord sur les côtes).
          float gOceanSpec = pow( gNdotH, 450.0 ) * gOcean;
          float gGlint = gOceanSpec * gDay * uGlintStrength;
          // Ajout du reflet SANS jamais franchir le seuil de bloom (0.82 < 0.85) :
          // on ne comble que la marge restante sous ce plafond à partir de la
          // luminance déjà présente. Ainsi le reflet éclaire l'eau sombre mais ne
          // peut pas saturer en blanc ni nourrir le bloom (donc plus de tache carrée).
          const float BLOOM_SAFE = 0.82;
          float gLum = dot( outgoingLight, vec3( 0.2126, 0.7152, 0.0722 ) );
          float gHeadroom = max( BLOOM_SAFE - gLum, 0.0 );
          outgoingLight += uGlintSunColor * min( gGlint, gHeadroom );
        }
        #endif`;

const OCEAN_GLINT_UNIFORM_KEY = '__oceanGlintUniforms';
// Intensité du reflet solaire océanique. Le lobe spéculaire est très étroit
// (pow 2000) : hors du point exact du glint, le terme est nul → un point compact
// strictement sur l'eau, sans déborder sur la terre voisine. Réglée modérée pour
// un point brillant sans saturation blanche laiteuse (effet « loupe »).
const OCEAN_GLINT_STRENGTH = 1.6;

export interface OceanGlintUniforms {
  /** Direction monde du Soleil (partagée avec le clair de Lune). */
  sunDir: { value: THREE.Vector3 };
  /** Teinte solaire chaude du reflet. */
  color: { value: THREE.Color };
  /** Intensité globale ; 0 désactive la branche shader. */
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
    polarCaps?: boolean;
  } = {}
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial(params);
  const attenuationUniform = { value: 1 };
  const invertRoughness = options.invertRoughnessMap === true;
  const cloudShadow = options.cloudShadow === true;
  const moonlight = options.moonlight === true;
  const polarCaps = options.polarCaps === true;
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

  // Direction monde du Soleil, partagée par le clair de Lune et le reflet
  // océanique. Alimentée chaque frame par CelestialObject (setSunDirection).
  const sunDirUniform = { value: new THREE.Vector3(1, 0, 0) };
  moonlightUniforms.sunDir = sunDirUniform;
  const glintUniforms: OceanGlintUniforms = {
    sunDir: sunDirUniform,
    // Teinte dorée chaude : un vrai reflet solaire sur l'eau tire vers l'or, pas le
    // blanc laiteux (qui donnait l'effet « loupe » artificiel).
    color: { value: new THREE.Color(0xffd98a) },
    strength: { value: invertRoughness ? OCEAN_GLINT_STRENGTH : 0 },
  };

  material.userData[SHADOW_AWARE_UNIFORM_KEY] = attenuationUniform;
  if (cloudShadow)
    material.userData[CLOUD_SHADOW_UNIFORM_KEY] = cloudShadowUniforms;
  if (moonlight) material.userData[MOONLIGHT_UNIFORM_KEY] = moonlightUniforms;
  if (invertRoughness)
    material.userData[OCEAN_GLINT_UNIFORM_KEY] = glintUniforms;
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
      shader.uniforms['uMoonStrength'] = moonlightUniforms.strength;
      shader.uniforms['uMoonColor'] = moonlightUniforms.color;
    }
    if (invertRoughness) {
      shader.uniforms['uGlintSunColor'] = glintUniforms.color;
      shader.uniforms['uGlintStrength'] = glintUniforms.strength;
    }
    // Direction Soleil partagée (clair de Lune + reflet océanique).
    if (moonlight || invertRoughness) {
      shader.uniforms['uMoonSunDir'] = sunDirUniform;
    }

    // Position + normale monde du fragment. Nécessaires au clair de Lune ET au
    // reflet solaire océanique : on les produit dès que l'un des deux est actif.
    if (moonlight || invertRoughness) {
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
            ? '\nuniform vec3 uMoonPosition;\nuniform float uMoonStrength;\nuniform vec3 uMoonColor;'
            : '') +
          (invertRoughness
            ? '\nuniform vec3 uGlintSunColor;\nuniform float uGlintStrength;'
            : '') +
          // uMoonSunDir (direction monde du Soleil) est partagé par le clair de
          // Lune et le reflet océanique ; déclaré si l'un des deux est actif.
          (moonlight || invertRoughness ? '\nuniform vec3 uMoonSunDir;' : '') +
          (moonlight || invertRoughness
            ? '\nvarying vec3 vMoonWorldPos;\nvarying vec3 vMoonWorldNormal;'
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
        // Terre (invertRoughness) : on EXCLUT totalSpecular du rendu. Le highlight
        // spéculaire GGX de base (PointLight du Soleil réfléchie par le diélectrique)
        // produisait une tache blanche éblouissante indépendante du masque océan —
        // visible même sur la terre ferme (Sahara, Arabie). Forcer roughnessFactor à
        // 1.0 ne suffisait pas : à roughness 1 le lobe reste non nul et sature via le
        // bloom/tone mapping. On supprime donc totalement le highlight de base ; le
        // SEUL reflet solaire devient le lobe océanique dédié (OCEAN_GLINT_GLSL),
        // masqué sur l'eau, doux et jaune. Les autres matériaux gardent totalSpecular.
        (invertRoughness
          ? 'vec3 outgoingLight = totalDiffuse * uLightAttenuation + totalEmissiveRadiance;'
          : 'vec3 outgoingLight = (totalDiffuse + totalSpecular) * uLightAttenuation + totalEmissiveRadiance;') +
          (moonlight ? MOONLIGHT_GLSL : '') +
          (invertRoughness ? OCEAN_GLINT_GLSL : '')
      );

    if (invertRoughness) {
      // Rugosité PBR forcée à 1.0 : on ignore la spec map pour la rugosité (elle ne
      // sert plus qu'au masque océan du glint dédié). La vraie suppression du highlight
      // spéculaire éblouissant se fait plus haut en excluant `totalSpecular` de
      // l'outgoingLight ; ce forçage n'est qu'une cohérence PBR (pas d'eau « miroir »
      // résiduelle si le spéculaire venait à être réintroduit).
      shader.fragmentShader = shader.fragmentShader.replace(
        'roughnessFactor *= texelRoughness.g;',
        'roughnessFactor = 1.0;'
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

    if (polarCaps) {
      // Calotte polaire de glace. En projection équirectangulaire, la rangée de
      // texels au pôle (banquise arctique/antarctique, ~blanche) converge en un point
      // → un « cap » blanc grossièrement étiré (le « super Groenland »). On masque
      // cette singularité en fondant, très près des pôles (|lat| > ~0.90 de vMapUv.y
      // depuis l'équateur), la couleur smearée vers une glace PROPRE : blanc
      // légèrement bleuté avec une micro-variation de luminance pour ne pas être plat.
      // L'éclairage jour/nuit du matériau (dotNL) s'applique ensuite normalement.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        #ifdef USE_MAP
        {
          float pcLat = abs( vMapUv.y - 0.5 ) * 2.0; // 0 équateur, 1 pôle
          float pcMix = smoothstep( 0.90, 0.985, pcLat );
          // Glace réaliste : blanc froid très légèrement bleuté, micro-grain via une
          // ondulation douce en longitude pour casser l'aspect « disque plat ».
          float pcGrain = 0.96 + 0.04 * sin( vMapUv.x * 90.0 );
          vec3 pcIce = vec3( 0.90, 0.93, 0.97 ) * pcGrain;
          diffuseColor.rgb = mix( diffuseColor.rgb, pcIce, pcMix );
        }
        #endif`
      );
    }
  });
  material.customProgramCacheKey = () =>
    `shadow-aware-standard-v2${invertRoughness ? '-invrough' : ''}${
      cloudShadow ? '-cloudshadow' : ''
    }${moonlight ? '-moonlight' : ''}${polarCaps ? '-polarcaps' : ''}`;

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

/** Récupère les uniforms du reflet solaire océanique d'un matériau, s'il en a. */
export function getOceanGlintUniforms(
  material: THREE.Material
): OceanGlintUniforms | undefined {
  return material.userData[OCEAN_GLINT_UNIFORM_KEY] as
    | OceanGlintUniforms
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
