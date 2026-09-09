/**
 * Fabriques de géométries et de matériaux partagées par tous les corps célestes.
 * Centralise les conventions de rendu : facteurs d'échelle des couches (surface, nuages,
 * atmosphère, lumières), finesse des sphères/anneaux et matériaux standard réutilisés.
 */
import * as THREE from 'three';
import {
  TERMINATOR_GLSL,
  TERMINATOR_WRAP_ATMOSPHERE,
  TERMINATOR_WRAP_CLOUDS,
  TERMINATOR_WRAP_STORM,
  TERMINATOR_WRAP_VACUUM,
  TWILIGHT_BAND_PEAK,
} from '@/core/terminator';
import {
  BOOT_QUALITY_PROFILE,
  EARTH_OCEAN_ROUGHNESS_SETTINGS,
  LIGHTING_SETTINGS,
  REALTIME_CLOUDS_SETTINGS,
  SHADER_SETTINGS,
} from './engine';
import { MIN_LIGHT_ATTENUATION, SHADOW_GAMMA } from '@/core/eclipse';

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
  thermal: 1.013,
  // Couche pluie IMERG : juste au-dessus des nuages, sous l'atmosphère.
  precip: 1.011,
  // Particules de vent : légèrement au-dessus de la pluie.
  wind: 1.012,
  atmosphere: 1.02,
  lights: 1.002,
};

/**
 * Largeur du crépuscule de chaque couche, **par son altitude réelle**.
 *
 * La règle est celle du produit : rendre le plus réaliste possible sous nos contraintes, à
 * l'échelle équivalente. Elle sépare donc les couches en deux familles, et c'est cette
 * séparation — jamais écrite jusqu'ici — qui décide de la présence d'un terminateur :
 *
 *   - **apparence physique** (nuages, précipitations) : ce sont des OBJETS qu'on verrait
 *     depuis l'orbite. Ils sont éclairés par le Soleil, donc ils s'éteignent la nuit, chacun
 *     à la largeur de SON altitude (un sommet d'orage reste au soleil après le coucher au
 *     sol). Une entrée ici.
 *   - **couche d'instrument** (température, pression, humidité, vent) : un champ de données
 *     colorié, pas une apparence. Rien à éteindre — l'assombrir la nuit ne le rendrait pas
 *     plus réaliste, cela rendrait illisible une information qui n'a jamais prétendu être une
 *     image. Même famille que le HUD et les labels (cf. l'invariant Explo). Pas d'entrée.
 *
 * Défaut réellement livré, corrigé par cette carte : les couches MODÈLE (Open-Meteo) passent
 * par `setDataOverlay`, qui remplaçait le matériau de la couche par un `MeshBasicMaterial` nu.
 * Les nuages satellite s'éteignaient donc au terminateur et les nuages modèle — la même chose
 * physique, sur le MÊME mesh — brillaient à plein régime sur la face nuit. Deux
 * représentations d'un même objet ne peuvent pas décider différemment de leur terminateur.
 */
export const LAYER_TERMINATOR_WRAP: Record<string, number> = {
  clouds: TERMINATOR_WRAP_CLOUDS,
  precip: TERMINATOR_WRAP_STORM,
};

// 64 segments pour les planètes : bon compromis silhouette/perf (≈ 8 k triangles).
// 128 pour les anneaux de Saturne : la géométrie RingGeometry est plate, mais ses
// subdivisions radiales déterminent la précision des UVs corrigés (_correctRingUVs).
export const GEOMETRY_SEGMENTS = 64;
// Segments haute densité pour le displacement (relief géométrique) : une carte de
// hauteur n'est visible qu'avec assez de vertices. Réservé au corps proche/
// sélectionné (cf. CelestialObject) — trop coûteux pour tous les corps en continu.
export const GEOMETRY_SEGMENTS_HI = BOOT_QUALITY_PROFILE.hiResSegments;
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
  // Moonlight is enabled for bodies with a night-lights layer (Earth).
  moonlight = false,
  // Earth ocean specular is bounded to prevent an overexposed white glint.
  limitSpecular = false,
  // Per-fragment eclipse shadow (needs the same world-position varying as moonlight, but is
  // independent of it — the Moon gets it without moonlight's night-lights infrastructure).
  eclipseShadow = moonlight,
  // Atmosphère : c'est elle qui diffuse la lumière au-delà du terminateur géométrique.
  // Un corps qui en a une reçoit le crépuscule large (18°, astronomique) ; les autres
  // gardent le terminateur serré historique. Cf. TERMINATOR_WRAP_ATMOSPHERE.
  hasAtmosphere = false,
  // Couleur de l'air du corps (catalogue `atmosphereColor`) : sert au bandeau crépusculaire,
  // qui est de la lumière de CIEL et doit donc porter la couleur de ce ciel-là.
  atmosphereColor?: number
): THREE.MeshBasicMaterial | THREE.MeshStandardMaterial {
  if (isSun) {
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
    {
      invertRoughnessMap: true,
      cloudShadow: true,
      moonlight,
      limitSpecular,
      varyOceanRoughness: limitSpecular,
      eclipseShadow,
      terminatorWrap: hasAtmosphere
        ? TERMINATOR_WRAP_ATMOSPHERE
        : TERMINATOR_WRAP_VACUUM,
      // Bandeau crépusculaire : réservé aux corps qui ont À LA FOIS une atmosphère (sans
      // elle il n'y a pas de ciel à éclairer, et le terminateur y est net par construction)
      // et le socle `moonlight` dont ce terme réutilise les varyings monde. Aujourd'hui la
      // Terre seule ; l'étendre à Vénus ou Mars demande d'y activer ces varyings, pas de
      // toucher au terme lui-même.
      twilightColor:
        hasAtmosphere && moonlight
          ? (atmosphereColor ?? SHADER_SETTINGS.atmosphere.defaultColor)
          : undefined,
    }
  );
}

const EARTH_OCEAN_ROUGHNESS_GLSL = `
        uniform float uEarthOceanRoughnessBase;
        uniform float uEarthOceanRoughnessVariation;
        uniform float uEarthOceanRoughnessMin;
        uniform float uEarthOceanRoughnessMax;
        float earthOceanRoughness( vec2 uv ) {
          const float tau = 6.28318530718;
          float waveA = sin( tau * ( uv.x * ${EARTH_OCEAN_ROUGHNESS_SETTINGS.longitudeFrequencyA.toFixed(1)} + uv.y * ${EARTH_OCEAN_ROUGHNESS_SETTINGS.latitudeFrequencyA.toFixed(1)} ) );
          float waveB = sin( tau * ( uv.x * ${EARTH_OCEAN_ROUGHNESS_SETTINGS.longitudeFrequencyB.toFixed(1)} - uv.y * ${EARTH_OCEAN_ROUGHNESS_SETTINGS.latitudeFrequencyB.toFixed(1)} ) );
          float waveC = sin( tau * ( uv.x * ${EARTH_OCEAN_ROUGHNESS_SETTINGS.longitudeFrequencyC.toFixed(1)} + uv.y * ${EARTH_OCEAN_ROUGHNESS_SETTINGS.latitudeFrequencyC.toFixed(1)} ) );
          float pattern = clamp( 0.5 + 0.275 * waveA + 0.15 * waveB + 0.075 * waveC, 0.0, 1.0 );
          return clamp(
            uEarthOceanRoughnessBase
              + ( pattern - 0.5 ) * uEarthOceanRoughnessVariation,
            uEarthOceanRoughnessMin,
            uEarthOceanRoughnessMax
          );
        }`;
const REAL_CLOUDS_UNIFORM_KEY = '__realCloudsUniforms';

export interface RealCloudsUniforms {
  enabled: { value: number };
  lumLow: { value: number };
  lumHigh: { value: number };
  satMax: { value: number };
  lumLowLand: { value: number };
  oceanMask: { value: THREE.Texture | null };
  hasOceanMask: { value: number };
  edgeSoftness: { value: number };
  satOceanBoost: { value: number };
  opticalAvailabilityLow: { value: number };
  opticalAvailabilityHigh: { value: number };
  opticalBlendRadiusTexels: { value: number };
  coverageBlendRadiusTexels: { value: number };
  dayMap: { value: THREE.Texture | null };
  hasDayMap: { value: number };
  dayStrength: { value: number };
  dayTexelSize: { value: THREE.Vector2 };
  modelMap: { value: THREE.Texture | null };
  hasModelMap: { value: number };
  modelStrength: { value: number };
  nightMap: { value: THREE.Texture | null };
  hasNightMap: { value: number };
  nightStrength: { value: number };
  nightTexelSize: { value: THREE.Vector2 };
  staticMap: { value: THREE.Texture | null };
  hasStaticMap: { value: number };
  staticStrength: { value: number };
}

export function getRealCloudsUniforms(
  material: THREE.Material
): RealCloudsUniforms | undefined {
  return material.userData[REAL_CLOUDS_UNIFORM_KEY] as
    RealCloudsUniforms | undefined;
}

const CLOUD_FRACTION_DECODE_GLSL = `
        float decodeCloudFraction( vec3 c ) {
          vec3 p = floor( c * 255.0 + 0.5 );
          float r = p.r;
          float g = p.g;
          float b = p.b;
          if ( abs(r-102.0)<1.5 && abs(b-119.0)<1.5 ) return g / 100.0;
          if ( abs(r-183.0)<1.5 && abs(b-141.0)<1.5 ) return (6.0 + (g-15.0)) / 100.0;
          if ( abs(r-0.0)<1.5 && abs(b-100.0)<1.5 ) return (12.0 + g) / 100.0;
          if ( abs(r-0.0)<1.5 && abs(b-170.0)<1.5 ) return (19.0 + g) / 100.0;
          if ( abs(r-0.0)<1.5 && abs(b-255.0)<1.5 ) return (25.0 + g) / 100.0;
          if ( abs(g-136.0)<1.5 && abs(b-238.0)<1.5 ) return (31.0 + r) / 100.0;
          if ( abs(g-80.0)<1.5 && abs(b-0.0)<1.5 ) return (38.0 + r) / 100.0;
          if ( abs(g-136.0)<1.5 && abs(b-0.0)<1.5 ) return (44.0 + r) / 100.0;
          if ( abs(g-220.0)<1.5 && abs(b-0.0)<1.5 ) return (50.0 + r) / 100.0;
          if ( abs(r-255.0)<1.5 && abs(g-255.0)<1.5 ) return (57.0 + b) / 100.0;
          if ( abs(r-240.0)<1.5 && abs(g-190.0)<1.5 ) return (63.0 + (b-64.0)) / 100.0;
          if ( abs(r-187.0)<1.5 && abs(g-136.0)<1.5 ) return (69.0 + b) / 100.0;
          if ( abs(r-122.0)<1.5 && abs(g-90.0)<1.5 ) return (76.0 + (b-3.0)) / 100.0;
          if ( abs(r-110.0)<1.5 && abs(g-0.0)<1.5 ) return (82.0 + b) / 100.0;
          if ( abs(r-170.0)<1.5 && abs(g-0.0)<1.5 ) return (88.0 + b) / 100.0;
          if ( abs(r-255.0)<1.5 && abs(g-0.0)<1.5 ) return (95.0 + b) / 100.0;
          return 0.0;
        }`;

const REAL_CLOUDS_GLSL = `
        #ifdef USE_MAP
        if ( uRealClouds > 0.5 ) {
          vec3 rc = diffuseColor.rgb;
          float rcMax = max( rc.r, max( rc.g, rc.b ) );
          float rcMin = min( rc.r, min( rc.g, rc.b ) );
          float rcSat = rcMax > 0.0001 ? ( rcMax - rcMin ) / rcMax : 0.0;
          float rcOcean = uHasOceanMask > 0.5
            ? texture2D( uCloudOceanMask, vMapUv ).g
            : 0.0;
          float rcLumLow = mix( uCloudLumLowLand, uCloudLumLow, rcOcean );
          float rcBright = smoothstep( rcLumLow, uCloudLumHigh, rcMin );
          float rcSatMax = uCloudSatMax + rcOcean * uCloudSatOceanBoost;
          float rcDesat = 1.0 - smoothstep( rcSatMax, rcSatMax + uCloudEdgeSoft, rcSat );
          float rcAlpha = rcBright * rcDesat;
          // Lissage de la frontière True Color/no-data : la décision de bascule vers MODIS
          // est spatiale, tandis que rcMax reste local pour extraire les nuages optiques.
          vec2 opticalStep = uCloudDayTexelSize * uCloudOpticalBlendRadiusTexels;
          // Bornage vertical des voisins : sans lui, le voisin +opticalStep.y DÉPASSE v=1 au
          // pôle Sud et, avec wrapT=ClampToEdge, retombe sur la BANDE no-data du bord d'image.
          // opticalNeighbourMax s'effondre alors le long d'un CERCLE de latitude fixe → bascule
          // nette vers le masque MODIS = « déchirure circulaire » au pôle. On clampe donc la
          // coordonnée v des voisins verticaux à [0,1] : au pôle, le voisin = le pixel courant,
          // pas le bord no-data. Aucun effet ailleurs (loin des bords, le clamp est inactif).
          float opticalUp = clamp( vMapUv.y - opticalStep.y, 0.0, 1.0 );
          float opticalDown = clamp( vMapUv.y + opticalStep.y, 0.0, 1.0 );
          vec3 optN = texture2D( map, vMapUv ).rgb;
          vec3 optL = texture2D( map, vec2( vMapUv.x - opticalStep.x, vMapUv.y ) ).rgb;
          vec3 optR = texture2D( map, vec2( vMapUv.x + opticalStep.x, vMapUv.y ) ).rgb;
          vec3 optU = texture2D( map, vec2( vMapUv.x, opticalUp ) ).rgb;
          vec3 optD = texture2D( map, vec2( vMapUv.x, opticalDown ) ).rgb;
          float opticalNeighbourMax = (
              max( optN.r, max( optN.g, optN.b ) )
              + max( optL.r, max( optL.g, optL.b ) )
              + max( optR.r, max( optR.g, optR.b ) )
              + max( optU.r, max( optU.g, optU.b ) )
              + max( optD.r, max( optD.g, optD.b ) )
            ) / 5.0;
          float opticalAvailability = smoothstep(
            uCloudOpticalAvailabilityLow,
            uCloudOpticalAvailabilityHigh,
            opticalNeighbourMax
          );
          // Voisins verticaux clampés en v (même raison qu'opticalNeighbourMax : pas de
          // rabattement sur la bande de bord au pôle → pas d'anneau).
          // FRACTION locale (précise) : 3 samples verticaux serrés, pondérés par leur alpha.
          float dY = uCloudDayTexelSize.y;
          vec4 dayTexel1 = texture2D( uCloudDayMap, vec2( vMapUv.x, clamp( vMapUv.y - dY, 0.0, 1.0 ) ) );
          vec4 dayTexel2 = texture2D( uCloudDayMap, vMapUv );
          vec4 dayTexel3 = texture2D( uCloudDayMap, vec2( vMapUv.x, clamp( vMapUv.y + dY, 0.0, 1.0 ) ) );
          float dayFracWeight = dayTexel1.a + dayTexel2.a + dayTexel3.a;
          float dayFraction = (
              decodeCloudFraction( dayTexel1.rgb ) * dayTexel1.a
              + decodeCloudFraction( dayTexel2.rgb ) * dayTexel2.a
              + decodeCloudFraction( dayTexel3.rgb ) * dayTexel3.a
            ) / max( dayFracWeight, 0.001 );
          // COUVERTURE (frontière douce) : l'alpha MODIS est binaire (1 sur la fauchée, 0 hors) →
          // une frontière NETTE = déchirure. On l'étale sur une LARGE bande verticale (rayon
          // uCloudOpticalBlendRadiusTexels) : la moyenne des alphas sur ~16 texels donne une rampe
          // 0→1 progressive au lieu d'une marche, donc une jonction fondue avec la True Color.
          float dCov = dY * uCloudCoverageBlendRadiusTexels;
          float dayCoverRaw = (
              texture2D( uCloudDayMap, vec2( vMapUv.x, clamp( vMapUv.y - dCov * 2.0, 0.0, 1.0 ) ) ).a
              + texture2D( uCloudDayMap, vec2( vMapUv.x, clamp( vMapUv.y - dCov, 0.0, 1.0 ) ) ).a
              + dayTexel2.a
              + texture2D( uCloudDayMap, vec2( vMapUv.x, clamp( vMapUv.y + dCov, 0.0, 1.0 ) ) ).a
              + texture2D( uCloudDayMap, vec2( vMapUv.x, clamp( vMapUv.y + dCov * 2.0, 0.0, 1.0 ) ) ).a
            ) / 5.0;
          float dayCoverage = dayCoverRaw * uHasCloudDayMap;
          float dayAlpha = pow( clamp( dayFraction, 0.0, 1.0 ), 0.72 )
            * dayCoverage * uCloudDayStrength;
          // Fraction nuit : 3 samples verticaux serrés, pondérés par leur alpha.
          float nY = uCloudNightTexelSize.y;
          vec4 nightTexel1 = texture2D( uCloudNightMap, vec2( vMapUv.x, clamp( vMapUv.y - nY, 0.0, 1.0 ) ) );
          vec4 nightTexel2 = texture2D( uCloudNightMap, vMapUv );
          vec4 nightTexel3 = texture2D( uCloudNightMap, vec2( vMapUv.x, clamp( vMapUv.y + nY, 0.0, 1.0 ) ) );
          float nightFracWeight = nightTexel1.a + nightTexel2.a + nightTexel3.a;
          float nightFraction = (
              decodeCloudFraction( nightTexel1.rgb ) * nightTexel1.a
              + decodeCloudFraction( nightTexel2.rgb ) * nightTexel2.a
              + decodeCloudFraction( nightTexel3.rgb ) * nightTexel3.a
            ) / max( nightFracWeight, 0.001 );
          // Couverture nuit : même frontière douce large que le jour (alpha binaire → rampe).
          float nCov = nY * uCloudCoverageBlendRadiusTexels;
          float nightCoverRaw = (
              texture2D( uCloudNightMap, vec2( vMapUv.x, clamp( vMapUv.y - nCov * 2.0, 0.0, 1.0 ) ) ).a
              + texture2D( uCloudNightMap, vec2( vMapUv.x, clamp( vMapUv.y - nCov, 0.0, 1.0 ) ) ).a
              + nightTexel2.a
              + texture2D( uCloudNightMap, vec2( vMapUv.x, clamp( vMapUv.y + nCov, 0.0, 1.0 ) ) ).a
              + texture2D( uCloudNightMap, vec2( vMapUv.x, clamp( vMapUv.y + nCov * 2.0, 0.0, 1.0 ) ) ).a
            ) / 5.0;
          float nightCoverage = nightCoverRaw * uHasCloudNightMap;
          float nightAlpha = pow( clamp( nightFraction, 0.0, 1.0 ), 0.72 )
            * nightCoverage * uCloudNightStrength * uHasCloudNightMap;
          // Les produits NASA changent de source là où True Color n'a plus d'observation
          // (nuit polaire / couverture orbitale). On prépare un alpha de secours puis on
          // effectue UN FONDU selon la disponibilité optique ; max seul produisait une
          // couture nette au bord de la bande sans donnée.
          float nightFallbackAlpha = nightAlpha;
          // La carte jour ne complète que les pixels sans carte nuit : on évite une couture
          // créée par la superposition de deux produits MODIS différents.
          float dayGapAlpha = dayAlpha * ( 1.0 - nightCoverage );
          float supplementalAlpha = max( nightFallbackAlpha, dayGapAlpha );
          float staticCoverage = texture2D( uCloudStaticMap, vMapUv ).g;
          float staticAlpha = smoothstep( 0.08, 0.28, staticCoverage )
            * uHasCloudStaticMap;
          float staticPolarAlpha = ( 1.0 - nightCoverage ) * ( 1.0 - dayCoverage )
            * staticAlpha * uCloudStaticStrength;
          supplementalAlpha = max( supplementalAlpha, staticPolarAlpha );
          // PORTE DE COUVERTURE : les masques MODIS ont des TROUS de fauchée orbitale (bandes
          // entre passages satellite). Là où la couverture locale est partielle (bord de bande,
          // trou), on n'affiche RIEN plutôt que d'étaler des blocs géométriques disgracieux :
          // une donnée absente reste absente (invariant produit). Seules les zones BIEN couvertes
          // (couverture ≥ seuil) contribuent ; la rampe smoothstep garde une lisière douce.
          float coverGate = smoothstep( 0.35, 0.75, max( dayCoverage, nightCoverage ) );
          supplementalAlpha *= coverGate;
          // JONCTION True Color ↔ masques MODIS : c'est ici que se crée la « déchirure »
          // circulaire (couture nette entre les nuages du Sud, issus des masques MODIS, et le
          // reste de la Terre en True Color). L'ancien smoothstep(0,1, opticalAvailability)
          // RAIDISSAIT la transition (opticalAvailability est déjà un smoothstep serré) → bascule
          // sur une bande très mince = ligne visible. On veut au contraire une jonction LARGE :
          // au lieu d'un choix binaire entre les deux sources, on prend le MAX de leurs alphas
          // dans la zone de recouvrement, pondéré par une rampe douce. Résultat : là où les deux
          // sources coexistent, les nuages se fondent en continuité au lieu de se couper net.
          // Fondu de SUBSTITUTION (pas d'addition) : le masque MODIS ne comble QUE là où la
          // True Color manque. Là où l'optique est pleinement disponible (opticalBlend→1), la
          // contribution du masque s'efface TOTALEMENT — sinon les nuages MODIS s'ajoutent aux
          // nuages True Color = « deux fois plus de nuages » (visible selon l'ordre de chargement
          // des deux couches). interp élargit la bande de recouvrement pour une jonction douce
          // (transition graduelle, pas une ligne), tout en garantissant 0 masque en plein jour.
          // La True Color reste TOUJOURS pleinement visible là où elle existe (rcAlpha intact) :
          // on ne la mélange plus (mix pouvait l'atténuer si opticalBlend était bas → nuages
          // disparus). Le masque MODIS ne fait qu'AJOUTER de la couverture là où la True Color
          // est absente/faible, atténué par la disponibilité optique pour éviter le doublon en
          // plein jour. max = jamais moins de nuages que la True Color, jonction douce au Sud.
          float supplementalFill = supplementalAlpha * ( 1.0 - opticalAvailability );
          rcAlpha = max( rcAlpha, supplementalFill );
          float satelliteCoverage = max( dayCoverage, max( nightCoverage, opticalAvailability ) );
          float modelAlpha = texture2D( uCloudModelMap, vMapUv ).g
            * uHasCloudModelMap * uCloudModelStrength;
          rcAlpha = max( rcAlpha, modelAlpha * ( 1.0 - satelliteCoverage ) );
          // Anti-aliasing du bord d'extraction : les seuils (luminance/saturation) produisent
          // un alpha quasi binaire → lisières de nuages en escalier (« griffures ») visibles au
          // gros plan. On enveloppe l'alpha final d'un fondu large d'UN pixel-écran via fwidth
          // (dérivée d'écran de rcAlpha). Effet uniquement sur les bords francs ; les zones
          // pleines (alpha ~0 ou ~1) ont une dérivée nulle → inchangées. N'altère AUCUNE
          // donnée : la position des nuages reste celle vue par le satellite, seuls les bords
          // deviennent vaporeux au lieu de crénelés. Indépendant de la calibration océan/pôles.
          float rcAA = fwidth( rcAlpha );
          rcAlpha = smoothstep( 0.5 - rcAA, 0.5 + rcAA, rcAlpha );
          // Fondu jour/nuit : les nuages sont éclairés par le Soleil comme la surface → côté
          // NUIT profonde ils doivent DISPARAÎTRE (comme la pluie), pas rester une couche grise
          // opaque. On atténue l'alpha selon l'orientation de la normale monde vs Soleil (même
          // signal que la coupe de relief et le clair de Lune). Transition douce au terminateur.
          float cloudSunFacing = dot( normalize( vMoonWorldNormal ), fragmentSunDir() );
          rcAlpha *= terminatorDay( cloudSunFacing, uTerminatorWrap );
          diffuseColor.a *= rcAlpha;
          diffuseColor.rgb = vec3( 1.0, 0.995, 0.985 );
        }
        #endif`;

export function createCloudsMaterial(): THREE.MeshStandardMaterial {
  const material = createShadowAwareStandardMaterial(
    {
      transparent: true,
      opacity: REALTIME_CLOUDS_SETTINGS.opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    },
    // noSpecular : nuages = milieu diffusant, pas de reflet spéculaire (sinon lueur dans l'ombre).
    // moonlight : NON pour le glow lunaire, mais pour câbler uMoonSunPos + vMoonWorldNormal —
    // le même signal jour/nuit que la surface — afin de faire DISPARAÎTRE les nuages côté nuit
    // (fondu d'alpha, cf. CLOUD_NIGHT_FADE_GLSL), au lieu de les laisser en couche grise opaque.
    // terminatorWrap atmosphérique : une couche nuageuse n'existe QUE sur un corps qui a
    // une atmosphère, et elle doit s'éteindre au même terminateur que la surface en dessous
    // — sinon les nuages restent éclairés dans une bande où le sol est déjà noir.
    {
      noSpecular: true,
      moonlight: true,
      terminatorWrap: LAYER_TERMINATOR_WRAP['clouds'],
    }
  );
  const realClouds: RealCloudsUniforms = {
    enabled: { value: 0 },
    lumLow: { value: REALTIME_CLOUDS_SETTINGS.cloudLuminanceLow },
    lumHigh: { value: REALTIME_CLOUDS_SETTINGS.cloudLuminanceHigh },
    satMax: { value: REALTIME_CLOUDS_SETTINGS.cloudSaturationMax },
    lumLowLand: { value: REALTIME_CLOUDS_SETTINGS.cloudLuminanceLowLand },
    oceanMask: { value: null },
    hasOceanMask: { value: 0 },
    edgeSoftness: { value: REALTIME_CLOUDS_SETTINGS.edgeSoftness },
    satOceanBoost: { value: REALTIME_CLOUDS_SETTINGS.cloudSatOceanBoost },
    opticalAvailabilityLow: {
      value: REALTIME_CLOUDS_SETTINGS.cloudOpticalAvailabilityLow,
    },
    opticalAvailabilityHigh: {
      value: REALTIME_CLOUDS_SETTINGS.cloudOpticalAvailabilityHigh,
    },
    opticalBlendRadiusTexels: {
      value: REALTIME_CLOUDS_SETTINGS.cloudOpticalBlendRadiusTexels,
    },
    coverageBlendRadiusTexels: {
      value: REALTIME_CLOUDS_SETTINGS.cloudCoverageBlendRadiusTexels,
    },
    dayMap: { value: null },
    hasDayMap: { value: 0 },
    dayStrength: { value: REALTIME_CLOUDS_SETTINGS.cloudDayStrength },
    dayTexelSize: { value: new THREE.Vector2(0, 0) },
    modelMap: { value: null },
    hasModelMap: { value: 0 },
    modelStrength: { value: 0.72 },
    nightMap: { value: null },
    hasNightMap: { value: 0 },
    nightStrength: {
      value: REALTIME_CLOUDS_SETTINGS.cloudNightFallbackStrength,
    },
    nightTexelSize: { value: new THREE.Vector2(0, 0) },
    staticMap: { value: null },
    hasStaticMap: { value: 0 },
    staticStrength: {
      value: REALTIME_CLOUDS_SETTINGS.cloudStaticPolarFallbackStrength,
    },
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
    shader.uniforms['uCloudEdgeSoft'] = realClouds.edgeSoftness;
    shader.uniforms['uCloudSatOceanBoost'] = realClouds.satOceanBoost;
    shader.uniforms['uCloudOpticalAvailabilityLow'] =
      realClouds.opticalAvailabilityLow;
    shader.uniforms['uCloudOpticalAvailabilityHigh'] =
      realClouds.opticalAvailabilityHigh;
    shader.uniforms['uCloudOpticalBlendRadiusTexels'] =
      realClouds.opticalBlendRadiusTexels;
    shader.uniforms['uCloudCoverageBlendRadiusTexels'] =
      realClouds.coverageBlendRadiusTexels;
    shader.uniforms['uCloudDayMap'] = realClouds.dayMap;
    shader.uniforms['uHasCloudDayMap'] = realClouds.hasDayMap;
    shader.uniforms['uCloudDayStrength'] = realClouds.dayStrength;
    shader.uniforms['uCloudDayTexelSize'] = realClouds.dayTexelSize;
    shader.uniforms['uCloudModelMap'] = realClouds.modelMap;
    shader.uniforms['uHasCloudModelMap'] = realClouds.hasModelMap;
    shader.uniforms['uCloudModelStrength'] = realClouds.modelStrength;
    shader.uniforms['uCloudNightMap'] = realClouds.nightMap;
    shader.uniforms['uHasCloudNightMap'] = realClouds.hasNightMap;
    shader.uniforms['uCloudNightStrength'] = realClouds.nightStrength;
    shader.uniforms['uCloudNightTexelSize'] = realClouds.nightTexelSize;
    shader.uniforms['uCloudStaticMap'] = realClouds.staticMap;
    shader.uniforms['uHasCloudStaticMap'] = realClouds.hasStaticMap;
    shader.uniforms['uCloudStaticStrength'] = realClouds.staticStrength;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uRealClouds;\nuniform float uCloudLumLow;\nuniform float uCloudLumHigh;\nuniform float uCloudSatMax;\nuniform float uCloudLumLowLand;\nuniform sampler2D uCloudOceanMask;\nuniform float uHasOceanMask;\nuniform float uCloudEdgeSoft;\nuniform float uCloudSatOceanBoost;\nuniform float uCloudOpticalAvailabilityLow;\nuniform float uCloudOpticalAvailabilityHigh;\nuniform float uCloudOpticalBlendRadiusTexels;\nuniform float uCloudCoverageBlendRadiusTexels;\nuniform sampler2D uCloudDayMap;\nuniform float uHasCloudDayMap;\nuniform float uCloudDayStrength;\nuniform vec2 uCloudDayTexelSize;\nuniform sampler2D uCloudModelMap;\nuniform float uHasCloudModelMap;\nuniform float uCloudModelStrength;\nuniform sampler2D uCloudNightMap;\nuniform float uHasCloudNightMap;\nuniform float uCloudNightStrength;\nuniform vec2 uCloudNightTexelSize;\nuniform sampler2D uCloudStaticMap;\nuniform float uHasCloudStaticMap;\nuniform float uCloudStaticStrength;' +
          CLOUD_FRACTION_DECODE_GLSL
      )
      .replace(
        '#include <map_fragment>',
        '#include <map_fragment>' + REAL_CLOUDS_GLSL
      );
  });
  const previousCacheKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () =>
    `${previousCacheKey ? previousCacheKey() : ''}-realclouds-covgate3`;
  return material;
}
const THERMAL_UNIFORM_KEY = '__thermalUniforms';

export interface ThermalUniforms {
  enabled: { value: number };
  opacity: { value: number };
}

export function getThermalUniforms(
  material: THREE.Material
): ThermalUniforms | undefined {
  return material.userData[THERMAL_UNIFORM_KEY] as ThermalUniforms | undefined;
}

/** Opacité de rendu de la couche thermique une fois qu'elle porte une vraie donnée. */
export const THERMAL_DEFAULT_OPACITY = 0.72;

/**
 * Matériau de la couche température (GIBS/MERRA-2, texture déjà colorée).
 *
 * `opacity: 0` au départ, et ce n'est pas cosmétique : un MeshBasicMaterial SANS map rend
 * sa couleur de base — blanc, opaque, non éclairé — sur une sphère posée devant la Terre.
 * La texture arrive à l'exécution, et `observedTextureLayer` rend le mesh visible AU CLIC,
 * avant que la tuile ne soit décodée : sans ce garde-fou, activer la couche produisait un
 * voile blanc sur toute la planète pendant la requête. Même classe de bug que la couche
 * pluie qui chargeait la Terre en soleil blanc éblouissant (cf. createPrecipMaterial) ;
 * là-bas le `mesh.visible = false` initial masquait le problème, il ne le corrigeait pas.
 *
 * `setThermalTexture` remonte l'opacité au moment où il assigne la map — donc « pas de
 * donnée ⇒ rien à l'écran » est structurel, pas une question d'ordre d'appels.
 */
export function createThermalMaterial(): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    opacity: 0,
  });
  material.userData[THERMAL_UNIFORM_KEY] = {
    enabled: { value: 0 },
    opacity: { value: THERMAL_DEFAULT_OPACITY },
  } satisfies ThermalUniforms;
  return material;
}

const TWILIGHT_WRAP_KEY = '__twilightWrap';

/**
 * Largeur du crépuscule RÉELLEMENT appliquée par ce matériau, ou `undefined` s'il n'en a pas.
 *
 * Exposée parce que c'est précisément ce qui était invisible : deux matériaux posés tour à tour
 * sur le MÊME mesh (satellite / modèle) pouvaient diverger sans que rien ne le montre. Le
 * panneau `?debug-meteo` l'affiche désormais par couche, ce qui rend la divergence observable
 * à l'exécution — donc vérifiable par un test e2e dans un vrai contexte WebGL.
 */
export function getLayerTwilightWrap(
  material: THREE.Material
): number | undefined {
  return material.userData[TWILIGHT_WRAP_KEY] as number | undefined;
}

const OVERLAY_SUN_UNIFORM_KEY = '__overlaySunUniform';

/** Position monde du Soleil d'un overlay de donnée, s'il a un terminateur. */
export function getOverlaySunUniform(
  material: THREE.Material
): { value: THREE.Vector3 } | undefined {
  return material.userData[OVERLAY_SUN_UNIFORM_KEY] as
    { value: THREE.Vector3 } | undefined;
}

/**
 * Matériau pour les textures météo déjà colorées et porteuses de leur propre alpha.
 *
 * `terminatorWrap` absent = couche d'INSTRUMENT, rendue telle quelle (cf.
 * `LAYER_TERMINATOR_WRAP` pour la règle). Fourni, la couche représente une apparence
 * physique : on lui applique le MÊME `terminatorDay` que sa jumelle satellite, à la même
 * largeur, pour que basculer de l'une à l'autre ne change pas la nuit.
 */
export function createColoredOverlayMaterial(
  opacity = 0.85,
  terminatorWrap?: number
): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    opacity,
    toneMapped: false,
  });
  if (terminatorWrap === undefined) return material;
  material.userData[TWILIGHT_WRAP_KEY] = terminatorWrap;

  const sunPosition = { value: new THREE.Vector3() };
  material.userData[OVERLAY_SUN_UNIFORM_KEY] = sunPosition;
  chainOnBeforeCompile(material, (shader) => {
    shader.uniforms['uOverlaySunPos'] = sunPosition;
    shader.uniforms['uOverlayWrap'] = { value: terminatorWrap };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vOverlayWorldPos;\nvarying vec3 vOverlayWorldNormal;'
      )
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\n\tvOverlayWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n\tvOverlayWorldNormal = normalize( mat3( modelMatrix ) * normal );'
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uOverlaySunPos;\nuniform float uOverlayWrap;\nvarying vec3 vOverlayWorldPos;\nvarying vec3 vOverlayWorldNormal;' +
          TERMINATOR_GLSL
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          // Même fonction, même largeur que la jumelle satellite de cette couche : une
          // apparence physique s'éteint la nuit, quelle que soit la SOURCE de la donnée.
          // Un plancher garde la teinte au terminateur au lieu de couper net, exactement
          // comme la couche pluie.
          vec3 oN = normalize( vOverlayWorldNormal );
          vec3 oToSun = normalize( uOverlaySunPos - vOverlayWorldPos );
          float oDay = terminatorDay( dot( oN, oToSun ), uOverlayWrap );
          diffuseColor.rgb *= mix( 0.04, 1.0, oDay );
          diffuseColor.a *= oDay;
        }`
      );
  });
  material.customProgramCacheKey = () => 'overlay-terminator-v1';
  return material;
}
const PRECIP_UNIFORM_KEY = '__precipUniforms';

export interface PrecipUniforms {
  /** 0 = couche pluie inerte ; 1 = active (une frame IMERG assignée). */
  enabled: { value: number };
  /** Opacité globale de la couche pluie. */
  opacity: { value: number };
  /** Position monde du Soleil : éclaire la couche côté jour, l'assombrit côté nuit. */
  sunPosition: { value: THREE.Vector3 };
  /** Seconde frame IMERG (cible du fondu enchaîné). */
  mapB: { value: THREE.Texture | null };
  /** Fondu 0→1 entre la frame courante (`map`) et `mapB` : transition douce sans clignotement. */
  mix: { value: number };
}

/** Récupère les uniforms de la couche pluie d'un matériau, s'il en a. */
export function getPrecipUniforms(
  material: THREE.Material
): PrecipUniforms | undefined {
  return material.userData[PRECIP_UNIFORM_KEY] as PrecipUniforms | undefined;
}

// Remap de la carte de pluie IMERG (fausses couleurs) vers une teinte RÉALISTE intégrée.
// Rendu PHOTO-RÉALISTE « vu de l'espace » : depuis l'orbite on ne voit pas la pluie
// elle-même mais les NUAGES de pluie (systèmes convectifs) — masses denses gris-sombre,
// dont les cœurs d'orage (cumulonimbus) crèvent en blanc éclatant. On mappe donc
// l'intensité IMERG (vert léger → rouge intense) sur un dégradé gris sombre → blanc :
//   - pluie faible : gris moyen, peu opaque (voile de nuage épais) ;
//   - pluie forte : gris sombre dense (base de l'orage) ;
//   - cœur intense : sommet blanc brillant (tour convective) ;
//   - neige (cyan IMERG) : blanc froid diffus.
// L'alpha (masque IMERG) module l'opacité. Injecté après <map_fragment>.
const PRECIP_REMAP_GLSL = `
        #ifdef USE_MAP
        if ( uPrecipEnabled > 0.5 ) {
          // Fondu enchaîné entre la frame courante (map, déjà dans diffuseColor) et la
          // frame suivante (uPrecipMapB) → transition douce au changement de demi-heure
          // IMERG, sans clignotement (plus de disparition/réapparition brutale).
          vec4 pB = texture2D( uPrecipMapB, vMapUv );
          vec4 pBlend = mix( diffuseColor, pB, uPrecipMix );
          vec3 pc = pBlend.rgb;
          float pMask = pBlend.a; // alpha IMERG = présence de précip
          float denom = max( pc.r + pc.g, 0.0001 );
          float pRain = clamp( pc.r / denom, 0.0, 1.0 ); // 0 vert (léger) → 1 rouge (intense)
          float pSnow = clamp( ( pc.b - max( pc.r, pc.g ) ) * 2.0, 0.0, 1.0 );
          // Nuage de pluie : gris moyen (léger) → gris sombre (base d'orage) → blanc
          // éclatant (cœur convectif qui crève). Deux mélanges successifs.
          vec3 cloudMid = vec3( 0.62, 0.64, 0.68 );  // stratus pluvieux
          vec3 cloudDark = vec3( 0.32, 0.34, 0.40 ); // base sombre d'orage
          vec3 stormTop = vec3( 1.0, 1.0, 1.0 );     // sommet convectif brillant
          vec3 col = mix( cloudMid, cloudDark, smoothstep( 0.20, 0.55, pRain ) );
          col = mix( col, stormTop, smoothstep( 0.7, 0.95, pRain ) );
          col = mix( col, vec3( 0.85, 0.89, 0.95 ), pSnow ); // neige
          // Densité : voile fin pour la pluie faible (ne noie pas la Terre), opaque pour
          // les gros systèmes.
          float dens = mix( 0.4, 1.0, smoothstep( 0.1, 0.6, pRain ) );
          // Éclairage jour/nuit : les nuages d'orage sont éclairés par le Soleil comme
          // le reste de la Terre. Côté nuit → sombres (cohérent avec la surface/nuages),
          // avec un léger plancher pour ne pas être totalement noirs au terminateur.
          vec3 pN = normalize( vPrecipWorldNormal );
          vec3 pToSun = normalize( uPrecipSunPos - vPrecipWorldPos );
          // UNE seule fraction de jour, partagée par la couleur ET l'alpha. Avant, deux rampes
          // indépendantes se contredisaient : la couleur suivait clamp( dot*1.1 + 0.1 ) — noire
          // dès dot = -0.091 — et l'alpha un smoothstep par-dessus, éteint vers dot = -0.09.
          // La pluie disparaissait donc ~3.4× plus tôt que le sol sous elle (-0.31), alors
          // qu'un sommet d'orage est physiquement éclairé PLUS LONGTEMPS que le sol.
          float pDay = terminatorDay( dot( pN, pToSun ), uPrecipWrap );
          float pLight = mix( 0.04, 1.0, pDay );
          diffuseColor.rgb = col * pLight;
          // La pluie/les nuages d'orage sont éclairés par le Soleil comme la surface : côté
          // NUIT ils doivent DISPARAÎTRE (comme la surface qui s'assombrit), pas rester une
          // couche grise opaque. On applique donc le facteur jour/nuit AUSSI à l'alpha (fondu
          // doux au terminateur via nightVisibility), pas seulement à la couleur. Résultat :
          // pluie pleinement visible le jour, invisible dans la nuit profonde.
          diffuseColor.a = pMask * dens * uPrecipOpacity * pDay;
        } else {
          // Map présente mais couche pas encore armée : rien à dessiner. Sans ce else,
          // c'est la couleur de base du matériau (blanc opaque) qui subsistait.
          diffuseColor.a = 0.0;
        }
        #endif`;

export function createPrecipMaterial(): THREE.MeshBasicMaterial {
  // MeshBasicMaterial : le remap produit lui-même la couleur ; on ajoute un éclairage
  // jour/nuit manuel (uPrecipSunPos + normale monde) pour que les nuages d'orage
  // s'assombrissent côté nuit, comme la surface et les nuages.
  // opacity: 0 = état AU REPOS, et c'est un correctif, pas un détail.
  // La texture IMERG arrive à l'exécution (ui/precipLayer), pas depuis config.textures :
  // entre le boot et son arrivée, ce matériau n'a AUCUNE map, donc `USE_MAP` n'est pas
  // défini et tout PRECIP_REMAP_GLSL — qui vit dans ce #ifdef — est absent du programme
  // compilé. Il ne restait alors que la valeur par défaut d'un MeshBasicMaterial :
  // blanc, opaque, NON éclairé. Soit une sphère blanche pleine, insensible au Soleil,
  // posée sur la Terre : elle s'affichait exactement comme un second soleil éblouissant
  // pendant tout le chargement (et indéfiniment si IMERG échoue ou est hors ligne).
  // La couche thermique, elle, y échappait par `mesh.visible = false` ; la pluie démarre
  // visible (initial = !IS_MOBILE) et n'avait donc aucun garde-fou.
  // À 0, l'état sans données ne dessine rien. Aucun effet sur l'état actif : le remap
  // écrase `diffuseColor.a` intégralement, et l'opacité réelle passe par l'uniform
  // uPrecipOpacity — `material.opacity` n'est jamais relu (cf. setPrecipTexture).
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    opacity: 0,
  });
  const precip: PrecipUniforms = {
    enabled: { value: 0 },
    opacity: { value: 0.85 },
    sunPosition: { value: new THREE.Vector3(1, 0, 0) },
    mapB: { value: null },
    mix: { value: 0 },
  };
  material.userData[PRECIP_UNIFORM_KEY] = precip;
  material.userData[TWILIGHT_WRAP_KEY] = LAYER_TERMINATOR_WRAP['precip'];

  chainOnBeforeCompile(material, (shader) => {
    shader.uniforms['uPrecipEnabled'] = precip.enabled;
    shader.uniforms['uPrecipOpacity'] = precip.opacity;
    shader.uniforms['uPrecipSunPos'] = precip.sunPosition;
    shader.uniforms['uPrecipMapB'] = precip.mapB;
    shader.uniforms['uPrecipMix'] = precip.mix;
    // Sommets d'orage (~12 km) : leur horizon est abaissé, ils restent au soleil après le
    // coucher au sol. Dérivé de l'altitude réelle, pas réglé à l'œil (core/terminator.ts).
    shader.uniforms['uPrecipWrap'] = {
      value: LAYER_TERMINATOR_WRAP['precip'],
    };
    // Position + normale monde du fragment (pour le facteur jour/nuit).
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vPrecipWorldPos;\nvarying vec3 vPrecipWorldNormal;'
      )
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\n\tvPrecipWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n\tvPrecipWorldNormal = normalize( mat3( modelMatrix ) * normal );'
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uPrecipEnabled;\nuniform float uPrecipOpacity;\nuniform vec3 uPrecipSunPos;\nuniform sampler2D uPrecipMapB;\nuniform float uPrecipMix;\nvarying vec3 vPrecipWorldPos;\nvarying vec3 vPrecipWorldNormal;\nuniform float uPrecipWrap;' +
          TERMINATOR_GLSL
      )
      .replace(
        '#include <map_fragment>',
        '#include <map_fragment>' + PRECIP_REMAP_GLSL
      );
  });
  material.customProgramCacheKey = () => 'precip-remap-v5-sharedterm';

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
    RingShadowUniforms | undefined;
}

// Le terminateur (largeurs + courbes) vit dans core/terminator.ts, source unique partagée
// par TOUTES les couches — surface, nuages, pluie, clair de Lune, coupe de relief, lumières
// de ville et halo atmosphérique. Voir ce module pour le raisonnement physique ; ici on ne
// fait que câbler les uniforms et appeler les fonctions.
/**
 * Direction fragment → Soleil, recalculée PAR FRAGMENT depuis la position monde du point,
 * et non fournie toute faite depuis le CENTRE du corps.
 *
 * Une direction unique pour toute la sphère est fausse d'au plus asin(R / D), le demi-angle
 * sous lequel le corps voit le Soleil. En Explo c'est négligeable (~0,002° pour la Terre),
 * mais en Éducatif les distances sont compressées (√UA × 35) alors que les rayons ne le sont
 * pas : la Terre y fait 1 unité de rayon pour 35 de distance, soit asin(1/35) ≈ 1,64°.
 *
 * 1,64°, c'est l'ordre de grandeur des largeurs de crépuscule elles-mêmes (3° dans le vide,
 * 6° civil). Or l'éclairage direct de three.js, les lumières de ville, le halo atmosphérique
 * et la pluie calculent TOUS leur direction par fragment. Les trois masques de ce matériau —
 * clair de Lune, fondu jour/nuit des nuages, coupe de relief — s'en écartaient donc d'un
 * biais systématique du même ordre que la bande qu'ils sont censés suivre : le clair de Lune
 * n'était plus le complément EXACT du jour qu'il prétend être, la coupe de relief ne
 * finissait plus avant l'ombre sur tout le limbe, et les nuages s'éteignaient sur une ligne
 * décalée de celle du sol. Un défaut de centrage de même nature que celui des lumières de
 * ville, mais visible en Éducatif seulement puisqu'il est proportionnel à R/D.
 *
 * Coût : une soustraction et une normalisation par fragment. La cohérence entre couches n'est
 * atteignable d'aucune autre façon — c'est la formule employée en face qui fixe la référence,
 * pas un réglage qu'on pourrait accorder à l'oeil.
 *
 * Le GLSL reste volontairement en ASCII pur : le raisonnement vit ici, pas dans la source du
 * shader, qui traverse des compilateurs de pilote dont on ne maîtrise pas le jeu de caractères.
 */
const FRAGMENT_SUN_DIR_GLSL = `
// Direction fragment -> Soleil, PAR FRAGMENT (jamais depuis le centre du corps).
vec3 fragmentSunDir() {
  return normalize( uMoonSunPos - vMoonWorldPos );
}
`;

/**
 * Albédo de Bond de la Terre (NASA Earth fact sheet). Sert d'unique référence d'amplitude au
 * bandeau crépusculaire ci-dessous : ce n'est pas un curseur de rendu.
 */
const TWILIGHT_REFERENCE_ALBEDO = 0.306;

/**
 * Amplitude du bandeau crépusculaire, POSÉE PAR CONTINUITÉ et non réglée à l'œil.
 *
 * Au HAUT de la bande (`raw = +wrap`) le terme s'annule par construction, et le sol y émet
 * `dotNL · I · albédo / π` avec `dotNL = wrap`. On donne au maximum de la lueur exactement
 * cette valeur : la courbe rendue continue donc la rampe du jour au lieu de tomber d'une
 * falaise, et l'amplitude se déduit de trois grandeurs déjà fixées ailleurs (largeur du
 * crépuscule, intensité solaire, albédo publié) plutôt que d'un nombre choisi.
 *
 * Divisé par le maximum du profil (`TWILIGHT_BAND_PEAK`, balayé dans `core/terminator.ts`)
 * pour que l'uniforme porte bien une RADIANCE de crête et non une valeur dépendant de la
 * forme exacte de la courbe.
 */
/**
 * Teinte du bandeau, NORMALISÉE EN LUMINANCE (Rec. 709).
 *
 * La couleur du catalogue décide de la teinte, `TWILIGHT_STRENGTH` de la luminosité — sans
 * cette séparation les deux se mélangent : le bleu ciel de la Terre (0x4a90e0) a une luminance
 * de 0,26 en linéaire, il diviserait donc par presque 4 l'amplitude que l'ancrage de
 * continuité vient de fixer, et changer la teinte du catalogue changerait silencieusement la
 * largeur apparente du bandeau. Les composantes peuvent dépasser 1 : on est en linéaire HDR,
 * avant tone mapping.
 */
function twilightTint(color: number): THREE.Color {
  const tint = new THREE.Color(color);
  const luminance = 0.2126 * tint.r + 0.7152 * tint.g + 0.0722 * tint.b;
  return tint.multiplyScalar(1 / Math.max(luminance, 1e-4));
}

const TWILIGHT_PEAK_RADIANCE =
  (TERMINATOR_WRAP_ATMOSPHERE *
    LIGHTING_SETTINGS.sun.intensity *
    TWILIGHT_REFERENCE_ALBEDO) /
  Math.PI;
const TWILIGHT_STRENGTH = TWILIGHT_PEAK_RADIANCE / TWILIGHT_BAND_PEAK;

/**
 * Bandeau crépusculaire : lumière du CIEL au-dessus d'un sol déjà éteint, ajoutée après
 * `outgoingLight` comme le clair de Lune.
 *
 * Additif et INDÉPENDANT DE L'ALBÉDO — c'est la différence de fond avec `terminatorLight` :
 * la diffusion atmosphérique ne renvoie pas la couleur du sol, elle éclaire l'océan comme le
 * continent. C'est ce qui la rend capable de combler le bandeau noir mesuré entre l'extinction
 * du sol et les premières lumières de ville, là où un éclairement de sol, lui, reste noir
 * partout où l'albédo est faible.
 *
 * Le profil (`terminatorTwilight`, cf. `core/terminator.ts`) vaut 0 exactement en `+wrap` :
 * le côté éclairé garde donc le rendu qu'il avait, à l'identique. Il s'éteint de lui-même en
 * nuit profonde, donc les lumières de ville gardent tout leur contraste.
 *
 * La direction du Soleil est reprise PAR FRAGMENT (`fragmentSunDir`) et la normale monde non
 * perturbée (`vMoonWorldNormal`) : mêmes entrées que les autres masques de ce matériau, ce qui
 * est la seule façon que les couches concentriques tombent d'accord sur un même terminateur.
 */
const twilightGlsl = (sunReach: string): string => `
        {
          float twilightGraze = dot( normalize( vMoonWorldNormal ), fragmentSunDir() );
          float twilightBand = terminatorTwilight( twilightGraze, uTerminatorWrap );
          outgoingLight += uTwilightColor * ( twilightBand * uTwilightStrength${sunReach} );
        }`;

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
          // MÊME fonction que les lumières de ville : terminatorNight est la courbe des
          // couches qui APPARAISSENT la nuit, et core/terminator.ts nomme d'ailleurs le clair
          // de Lune parmi ses consommateurs. Cette ligne roulait pourtant sa propre formule,
          // 1 - terminatorDay, dont la bande s'étend de +wrap à -wrap au lieu de 0 à -wrap :
          // le clair de Lune débordait donc jusqu'à 6° AU-DESSUS de l'horizon, à 49,8 % de son
          // masque au terminateur même, là où les villes sont à 0 strict. Une couche nocturne
          // visible sur le côté éclairé — la règle produit que les villes respectent.
          // Invisible en pratique (≤ 1,2 % d'albédo à 3°, cf. MOONLIGHT_MAX_STRENGTH), mais
          // c'est une divergence de RÈGLE, et une formule de moins à maintenir à part.
          // L'alignement ne coûte rien : la garantie anti-creux est identique (minimum 1,0000
          // dans les deux cas), seule la fuite côté jour disparaît.
          float nightMask = terminatorNight( dot( nrm, fragmentSunDir() ), 0.0, uTerminatorWrap );
          vec3 moonGlow = uMoonColor * ( moonFacing * nightMask * uMoonStrength );
          outgoingLight += moonGlow * diffuseColor.rgb;
        }`;

const ECLIPSE_SHADOW_UNIFORM_KEY = '__eclipseShadowUniforms';

export interface EclipseShadowUniforms {
  sunPosition: { value: THREE.Vector3 };
  /** Rayon du Soleil en unités scène (même échelle que les positions monde). */
  sunRadius: { value: number };
  occluderPosition: { value: THREE.Vector3 };
  /** 0 = pas d'occulteur connu cette frame (ex. Lune hors catalogue) : désactive
   *  proprement le calcul (eclipseShadowAt renvoie 1.0 sans occulteur valide). */
  occluderRadius: { value: number };
}

/**
 * Traduction GLSL de `occultationFraction` (core/eclipse.ts) : aire de recouvrement de deux
 * disques angulaires (Soleil, occulteur). Même formule des deux côtés — CPU (proxy pleine-
 * sphère utilisé par tous les corps) et GPU (bande d'ombre réelle, Terre uniquement) restent
 * cohérents par construction plutôt que par deux implémentations à maintenir en parallèle.
 */
const ECLIPSE_OCCLUSION_GLSL = `
        float eclipseOcclusionFraction( float sunAngRad, float occAngRad, float separation ) {
          if ( sunAngRad <= 0.0 || occAngRad <= 0.0 || separation >= sunAngRad + occAngRad ) return 0.0;
          if ( separation <= abs( sunAngRad - occAngRad ) ) {
            return occAngRad >= sunAngRad ? 1.0 : ( occAngRad * occAngRad ) / ( sunAngRad * sunAngRad );
          }
          float sunTerm = acos( clamp(
            ( separation * separation + sunAngRad * sunAngRad - occAngRad * occAngRad )
              / ( 2.0 * separation * sunAngRad ), -1.0, 1.0 ) );
          float occTerm = acos( clamp(
            ( separation * separation + occAngRad * occAngRad - sunAngRad * sunAngRad )
              / ( 2.0 * separation * occAngRad ), -1.0, 1.0 ) );
          float lens = sqrt( max( 0.0,
            ( -separation + sunAngRad + occAngRad ) * ( separation + sunAngRad - occAngRad )
              * ( separation - sunAngRad + occAngRad ) * ( separation + sunAngRad + occAngRad ) ) );
          float overlapArea = sunAngRad * sunAngRad * sunTerm + occAngRad * occAngRad * occTerm - lens * 0.5;
          return clamp( overlapArea / ( 3.14159265359 * sunAngRad * sunAngRad ), 0.0, 1.0 );
        }
        float eclipseShadowAt( vec3 fragWorldPos, vec3 sunPos, float sunRad, vec3 occPos, float occRad ) {
          vec3 toSun = sunPos - fragWorldPos;
          float sunDist = length( toSun );
          if ( sunDist < 0.0001 || sunRad <= 0.0 ) return 1.0;
          vec3 toOcc = occPos - fragWorldPos;
          float occDist = length( toOcc );
          if ( occDist < 0.0001 || occDist >= sunDist ) return 1.0;
          float sunAngRad = asin( clamp( sunRad / sunDist, 0.0, 1.0 ) );
          float occAngRad = asin( clamp( occRad / occDist, 0.0, 1.0 ) );
          float separation = acos( clamp( dot( toSun, toOcc ) / ( sunDist * occDist ), -1.0, 1.0 ) );
          float occlusion = eclipseOcclusionFraction( sunAngRad, occAngRad, separation );
          float shaped = pow( occlusion, ${SHADOW_GAMMA.toFixed(2)} );
          return mix( 1.0, ${MIN_LIGHT_ATTENUATION.toFixed(3)}, shaped );
        }`;

/** Récupère les uniforms d'ombrage d'éclipse par fragment d'un matériau, s'il en a. */
export function getEclipseShadowUniforms(
  material: THREE.Material
): EclipseShadowUniforms | undefined {
  return material.userData[ECLIPSE_SHADOW_UNIFORM_KEY] as
    EclipseShadowUniforms | undefined;
}

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
  /**
   * Position monde du Soleil — PAS une direction. La direction est recalculée PAR FRAGMENT
   * (`fragmentSunDir()` en GLSL), au même titre que l'atmosphère, les lumières de ville, la
   * pluie et l'éclairage direct de three.js. Voir `fragmentSunDir` pour le pourquoi.
   */
  sunPosition: { value: THREE.Vector3 };
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
    limitSpecular?: boolean;
    noSpecular?: boolean;
    varyOceanRoughness?: boolean;
    /**
     * Ombre d'éclipse PAR FRAGMENT (bande d'ombre réelle Soleil/occulteur) au lieu du
     * proxy pleine-sphère de `uLightAttenuation`. Nécessite `moonlight: true` (réutilise
     * son varying `vMoonWorldPos`) — sans lui l'option est silencieusement ignorée.
     * Alimenté chaque frame par `CelestialObject.setEclipseShadowSource`.
     */
    eclipseShadow?: boolean;
    /**
     * Largeur du crépuscule en dot(N,L). Par défaut `TERMINATOR_WRAP_VACUUM` (rendu
     * historique de tous les corps) ; passer `TERMINATOR_WRAP_ATMOSPHERE` pour un corps
     * qui a une atmosphère — c'est elle qui diffuse la lumière au-delà du terminateur
     * géométrique, donc la largeur est une PROPRIÉTÉ DU CORPS, pas un réglage global.
     */
    terminatorWrap?: number;
    /**
     * Couleur du BANDEAU CRÉPUSCULAIRE (lueur du ciel au-dessus d'un sol déjà éteint) —
     * typiquement l'`atmosphereColor` du catalogue. Absente = pas de bandeau, rendu inchangé.
     * Nécessite `moonlight: true` : le terme réutilise ses varyings de normale/position monde
     * et `fragmentSunDir()`, sans quoi il déciderait du terminateur sur d'autres entrées que
     * les masques voisins — exactement ce que ce module existe pour empêcher.
     */
    twilightColor?: number;
  } = {}
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial(params);
  const attenuationUniform = { value: 1 };
  const invertRoughness = options.invertRoughnessMap === true;
  const cloudShadow = options.cloudShadow === true;
  const moonlight = options.moonlight === true;
  const limitSpecular = options.limitSpecular === true;
  const noSpecular = options.noSpecular === true;
  const varyOceanRoughness = options.varyOceanRoughness === true;
  const eclipseShadow = options.eclipseShadow === true;
  const terminatorWrap = options.terminatorWrap ?? TERMINATOR_WRAP_VACUUM;
  const twilight = options.twilightColor !== undefined && moonlight;
  // Les deux options partagent le même varying de position/normale monde du fragment.
  const needsWorldPosVarying = moonlight || eclipseShadow;
  const oceanRoughnessUniforms = {
    base: { value: EARTH_OCEAN_ROUGHNESS_SETTINGS.oceanBase },
    variation: { value: EARTH_OCEAN_ROUGHNESS_SETTINGS.oceanVariation },
    min: { value: EARTH_OCEAN_ROUGHNESS_SETTINGS.oceanMin },
    max: { value: EARTH_OCEAN_ROUGHNESS_SETTINGS.oceanMax },
  };
  const cloudShadowUniforms: CloudShadowUniforms = {
    map: { value: null },
    offset: { value: 0 },
    // 0 tant qu'aucune cloud map n'est assignée : la branche shader ne
    // s'active (n'échantillonne le sampler) qu'une fois la map fournie.
    strength: { value: 0 },
  };
  const moonlightUniforms: MoonlightUniforms = {
    position: { value: new THREE.Vector3() },
    // Le Soleil est à l'origine de la scène : (0,0,0) est donc la valeur JUSTE tant que
    // CelestialObject n'a pas encore écrit, et non un placeholder faux à corriger.
    sunPosition: { value: new THREE.Vector3() },
    // 0 tant que la position lunaire n'est pas fournie chaque frame : branche inerte.
    strength: { value: 0 },
    color: { value: new THREE.Color(0xbcd2ff) },
  };

  const eclipseShadowUniforms: EclipseShadowUniforms = {
    sunPosition: { value: new THREE.Vector3() },
    sunRadius: { value: 0 },
    occluderPosition: { value: new THREE.Vector3() },
    // 0 = pas d'occulteur cette frame → eclipseShadowAt renvoie 1.0 (inerte).
    occluderRadius: { value: 0 },
  };

  material.userData[SHADOW_AWARE_UNIFORM_KEY] = attenuationUniform;
  material.userData[TWILIGHT_WRAP_KEY] = terminatorWrap;
  if (cloudShadow)
    material.userData[CLOUD_SHADOW_UNIFORM_KEY] = cloudShadowUniforms;
  if (moonlight) material.userData[MOONLIGHT_UNIFORM_KEY] = moonlightUniforms;
  if (eclipseShadow)
    material.userData[ECLIPSE_SHADOW_UNIFORM_KEY] = eclipseShadowUniforms;
  chainOnBeforeCompile(material, (shader) => {
    shader.uniforms['uLightAttenuation'] = attenuationUniform;
    if (varyOceanRoughness) {
      shader.uniforms['uEarthOceanRoughnessBase'] = oceanRoughnessUniforms.base;
      shader.uniforms['uEarthOceanRoughnessVariation'] =
        oceanRoughnessUniforms.variation;
      shader.uniforms['uEarthOceanRoughnessMin'] = oceanRoughnessUniforms.min;
      shader.uniforms['uEarthOceanRoughnessMax'] = oceanRoughnessUniforms.max;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        '#include <common>\n' + EARTH_OCEAN_ROUGHNESS_GLSL
      );
    }
    shader.uniforms['uTerminatorWrap'] = { value: terminatorWrap };
    if (twilight) {
      shader.uniforms['uTwilightColor'] = {
        value: twilightTint(options.twilightColor as number),
      };
      shader.uniforms['uTwilightStrength'] = { value: TWILIGHT_STRENGTH };
    }
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
    // Position du Soleil, partagée par les TROIS masques décidés sur dot(N, Soleil) de ce
    // matériau : clair de Lune, fondu jour/nuit des nuages et coupe de relief.
    if (moonlight) {
      shader.uniforms['uMoonSunPos'] = moonlightUniforms.sunPosition;
    }
    if (eclipseShadow) {
      shader.uniforms['uEclipseSunPos'] = eclipseShadowUniforms.sunPosition;
      shader.uniforms['uEclipseSunRadius'] = eclipseShadowUniforms.sunRadius;
      shader.uniforms['uEclipseOccPos'] =
        eclipseShadowUniforms.occluderPosition;
      shader.uniforms['uEclipseOccRadius'] =
        eclipseShadowUniforms.occluderRadius;
    }

    // Position et normale monde du fragment : clair de Lune ET/OU ombre d'éclipse.
    if (needsWorldPosVarying) {
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
          TERMINATOR_GLSL +
          (cloudShadow
            ? '\nuniform sampler2D uCloudShadowMap;\nuniform float uCloudShadowOffset;\nuniform float uCloudShadowStrength;'
            : '') +
          (moonlight
            ? '\nuniform vec3 uMoonPosition;\nuniform float uMoonStrength;\nuniform vec3 uMoonColor;'
            : '') +
          (moonlight ? '\nuniform vec3 uMoonSunPos;' : '') +
          (twilight
            ? '\nuniform vec3 uTwilightColor;\nuniform float uTwilightStrength;'
            : '') +
          (needsWorldPosVarying
            ? '\nvarying vec3 vMoonWorldPos;\nvarying vec3 vMoonWorldNormal;'
            : '') +
          (moonlight ? FRAGMENT_SUN_DIR_GLSL : '') +
          (eclipseShadow
            ? '\nuniform vec3 uEclipseSunPos;\nuniform float uEclipseSunRadius;\nuniform vec3 uEclipseOccPos;\nuniform float uEclipseOccRadius;\n' +
              ECLIPSE_OCCLUSION_GLSL
            : '')
      )
      // Crépuscule : on remplace le calcul de dotNL de three.js par terminatorLight
      // (core/terminator.ts, partagé avec toutes les autres couches). Une seule
      // occurrence dans le shader Standard (pars physical) — remplacement unique correct.
      .replace(
        'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );',
        'float dotNL = terminatorLight( dot( geometryNormal, directLight.direction ), uTerminatorWrap );'
      )
      .replace(
        'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
        // Le spéculaire standard de Three.js reste actif pour la Terre. La carte
        // La carte oceanique convertie en rugosite controle le reflet, avec un plafond speculaire Terre pour eviter une saturation blanche.
        // noSpecular : les nuages sont un MILIEU DIFFUSANT (gouttelettes/cristaux), pas une
        // surface réfléchissante. Un lobe spéculaire GGX sur leur albédo blanc débordait au-delà
        // du terminateur → « reflets » lumineux sur la face nuit (dans l'ombre). On le supprime :
        // les nuages ne sont éclairés que par le diffus, qui suit le terminateur × uLightAttenuation
        // → face nuit correctement sombre.
        (noSpecular
          ? 'vec3 outgoingLight = totalDiffuse * uLightAttenuation'
          : limitSpecular
            ? // Compression DOUCE, pas un min() : le clamp dur laissait un LISERE gris uniforme
              // au limbe. En incidence rasante le Fresnel de Schlick tend vers 1, donc le
              // speculaire depasse le plafond sur toute cette bande et TOUS ces pixels
              // ressortaient a la meme valeur — un plateau plat, achromatique, a bord franc
              // (mesure : 0.20 lineaire -> ~121/255 en sRGB, exactement la couleur relevee).
              // Aplatir une plage entiere sur une constante, c'est fabriquer une bande.
              //
              // x / (1 + x/limit) : identique a x quand x << limit (le reflet ocean garde sa
              // dynamique), tend vers limit sans jamais l'atteindre quand x explose. Le
              // plafond joue toujours son role — empecher la saturation blanche — mais il
              // n'existe plus aucun intervalle ou la sortie est constante.
              // Occultation du speculaire en incidence RASANTE — c'est ce qui supprime le
              // lisere, la compression ci-dessus ne faisant que le rendre moins clair.
              // Mesure : avec le seul plafond, toute la bande sortait a 120/255 ; avec la
              // compression douce seule, a 83/255 — toujours un PLATEAU, car le speculaire y
              // depasse le plafond d'un ordre de grandeur et tout y retombe sur la meme
              // valeur. Le probleme n'est donc pas la courbe de compression, c'est l'amplitude.
              //
              // Physiquement : le Fresnel de Schlick tend vers 1 quand N.V -> 0, alors que sur
              // une surface rugueuse le masquage geometrique des micro-facettes eteint au
              // contraire le reflet a cet angle. On applique donc cette extinction (specular
              // horizon occlusion), avec le vocabulaire partage du module terminateur.
              'float specGraze = dot( geometryNormal, geometryViewDir );' +
              'vec3 boundedSpecular = totalSpecular / ( 1.0 + totalSpecular / vec3( 0.20 ) );' +
              'boundedSpecular *= terminatorDay( specGraze - 0.125, 0.125 );' +
              'vec3 outgoingLight = (totalDiffuse + boundedSpecular) * uLightAttenuation'
            : 'vec3 outgoingLight = (totalDiffuse + totalSpecular) * uLightAttenuation') +
          (cloudShadow ? ' * cloudDirectFactor' : '') +
          (eclipseShadow ? ' * eclipseShadowFactor' : '') +
          ' + totalEmissiveRadiance;' +
          (moonlight ? MOONLIGHT_GLSL : '') +
          // La lueur suit la MÊME atténuation solaire que l'éclairage direct : c'est sur lui
          // que son amplitude est calée, les deux doivent donc s'éteindre ensemble (distance,
          // et bande d'ombre d'éclipse là où elle est calculée par fragment).
          (twilight
            ? twilightGlsl(
                ' * uLightAttenuation' +
                  (eclipseShadow ? ' * eclipseShadowFactor' : '')
              )
            : '')
      );

    if (moonlight) {
      // Coupe la normal map à l'approche du terminateur. À lumière rasante, la normale
      // PERTURBÉE incline chaque ride du relief vers/hors du Soleil → micro-facettes en fort
      // contraste = contours durs « bleu-gris » sur la face nuit. On fond donc la normale
      // perturbée vers la normale GÉOMÉTRIQUE (lisse) : relief plein en plein jour,
      // TOTALEMENT effacé dès `RELIEF_FADE_END`.
      //
      // Ces bornes vivent dans `core/terminator.ts` et non ici, parce qu'elles engagent les
      // AUTRES couches : elles définissent la zone où la seule normale valide est la
      // géométrique, donc celle que tout masque décidé sur dot(N, Soleil) doit employer.
      // NightLightsShader s'y conforme (il n'échantillonne plus aucune normal map) ; quand il
      // ne le faisait pas, le bord des lumières suivait les pentes du terrain au lieu de
      // suivre l'ombre. `layerConfig.test.ts` verrouille les deux bouts de ce contrat.
      //
      // sunGraze sur la vraie normale monde (vMoonWorldNormal, non perturbée) : pas de
      // référence circulaire (on ne module pas la normal map par elle-même).
      // Gated moonlight → Terre uniquement (là où ces varyings existent).
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          float sunGraze = dot( normalize( vMoonWorldNormal ), fragmentSunDir() );
          // La coupe du relief doit être TERMINÉE avant que l'éclairage direct ne s'éteigne,
          // sinon la normal map reste active dans la bande déjà sombre juste avant le terminateur
          // → relief visible dans l'ombre. L'éclairage direct tombe à 0 en dot(N,L) = -uTerminatorWrap
          // (cf. TERMINATOR_WRAP_ATMOSPHERE) ; la rampe est donc DÉCALÉE côté jour, terminée dès
          // sunGraze ≤ RELIEF_FADE_END = 0, bien AVANT l'ombre. La marge n'a fait que grandir
          // avec l'élargissement du crépuscule — l'invariant tient a fortiori.
          normal = normalize( mix( nonPerturbedNormal, normal, reliefFade( sunGraze ) ) );
        }`
      );
    }

    if (invertRoughness) {
      // La carte Terre suit la convention « blanc = océan lisse ». Three.js attend
      // l'inverse pour roughnessMap : terre rugueuse (~0.92), eau peu rugueuse (~0.08).
      shader.fragmentShader = shader.fragmentShader.replace(
        'roughnessFactor *= texelRoughness.g;',
        varyOceanRoughness
          ? `roughnessFactor = mix( ${EARTH_OCEAN_ROUGHNESS_SETTINGS.land.toFixed(2)}, earthOceanRoughness( vMapUv ), texelRoughness.g );`
          : `roughnessFactor = mix( ${EARTH_OCEAN_ROUGHNESS_SETTINGS.land.toFixed(2)}, ${EARTH_OCEAN_ROUGHNESS_SETTINGS.oceanBase.toFixed(2)}, texelRoughness.g );`
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
        float cloudDirectFactor = 1.0;
        #ifdef USE_MAP
        if ( uCloudShadowStrength > 0.0 ) {
          vec2 cloudUv = vec2( vMapUv.x - uCloudShadowOffset, vMapUv.y );
          float cloudDensity = texture2D( uCloudShadowMap, cloudUv ).r;
          cloudDirectFactor = 1.0 - cloudDensity * uCloudShadowStrength;
          diffuseColor.rgb *= cloudDirectFactor;
        }
        #endif`
      );
    }

    if (eclipseShadow) {
      // Bande d'ombre réelle (Soleil occulté par la Lune), évaluée au point MONDE de ce
      // fragment — cf. ECLIPSE_OCCLUSION_GLSL, traduction fidèle de eclipse.ts. Remplace
      // le proxy pleine-sphère de uLightAttenuation UNIQUEMENT sur ce corps (Terre) :
      // AnimationSystem lui envoie une irradiance sans la composante éclipse (cf.
      // AnimationSystem._updateLighting), pour ne pas cumuler les deux effets.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float eclipseShadowFactor = eclipseShadowAt(
          vMoonWorldPos, uEclipseSunPos, uEclipseSunRadius, uEclipseOccPos, uEclipseOccRadius
        );`
      );
    }
  });
  material.customProgramCacheKey = () =>
    `shadow-aware-standard-v3${invertRoughness ? '-invrough-v2' : ''}${
      cloudShadow ? '-cloudshadow' : ''
    }${moonlight ? '-moonlight' : ''}${twilight ? '-twilight-v1' : ''}${
      varyOceanRoughness ? '-oceanrough-v1' : ''
    }${limitSpecular ? '-limitspec-v3-grazeocclusion' : ''}${noSpecular ? '-nospec' : ''}${
      eclipseShadow ? '-eclipseshadow' : ''
    }`;

  return material;
}

/** Récupère les uniforms d'ombre nuageuse d'un matériau, s'il en a. */
export function getCloudShadowUniforms(
  material: THREE.Material
): CloudShadowUniforms | undefined {
  return material.userData[CLOUD_SHADOW_UNIFORM_KEY] as
    CloudShadowUniforms | undefined;
}

/** Récupère les uniforms de clair de Lune d'un matériau, s'il en a. */
export function getMoonlightUniforms(
  material: THREE.Material
): MoonlightUniforms | undefined {
  return material.userData[MOONLIGHT_UNIFORM_KEY] as
    MoonlightUniforms | undefined;
}

/** Configure les ombres et le rendu de la maille. */
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
