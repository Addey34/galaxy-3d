import * as THREE from 'three';

import { REALTIME_CLOUDS_SETTINGS } from '@/config/engine';
import {
  bindRealCloudsUniforms,
  chainOnBeforeCompile,
  createShadowAwareStandardMaterial,
  LAYER_TERMINATOR_WRAP,
  REAL_CLOUDS_PARS_GLSL,
  realCloudsCommonGlsl,
  type RealCloudsUniforms,
} from '@/config/layerConfig';
import {
  MAGNIFICATION_FADE_END_PX,
  MAGNIFICATION_FADE_START_PX,
  MAGNIFICATION_FLOOR_PARS_GLSL,
  MAGNIFICATION_VERTEX_GLSL,
  MAGNIFICATION_VERTEX_PARS_GLSL,
  magnificationFloorUniform,
} from '@/core/dataMagnification';
import {
  CLOUD_NEAR_GLSL,
  NEAR_MODIS_GATE_HIGH,
  NEAR_MODIS_GATE_LOW,
} from '@/core/cloudNear';
import {
  tileBounds,
  type TileIndex,
  type TileMatrixShape,
} from '@/core/tilePyramid';

/**
 * LE MATÉRIAU D'UN CARREAU DE NUAGES RÉGIONAL (GAL-EARTH-CLOUD-REGIONAL-001).
 *
 * Le carreau est une tuile VIIRS vraies couleurs (250 m) posée sur la coque des nuages. Son alpha est
 * EXTRAIT de l'image par les MÊMES fonctions que la couche mondiale (`REAL_CLOUDS_PARS_GLSL`, mêmes
 * seuils), donc un nuage a le même contour dans l'une et dans l'autre, seul le texel change : 250 m au
 * lieu de 19,7 km. Rien n'est ajouté à l'image : pas de bruit, pas de détail inventé, la donnée est celle
 * de la couche mondiale, plus fine.
 *
 * Trois choses diffèrent d'avec le matériau mondial, chacune parce que la carte n'est plus UNE image du globe :
 *  - le masque d'eau est une carte MONDIALE : son UV vient de l'emprise du carreau (`uCloudTile`) ;
 *  - le grossissement se compte sur le texel du CARREAU, ramené à celui d'une carte mondiale équivalente
 *    (`uCloudTileSpan`) ;
 *  - le poids est le COMPLÉMENT de ce que la couche mondiale montre encore (`regionalWeight`), pour que le
 *    passage de l'une à l'autre ne fasse ni doublon ni trou.
 */

/** Largeur de la carte de la couche mondiale (`REALTIME_CLOUDS_SETTINGS.resolution`), hauteur moitié. */
const GLOBAL_MAP_WIDTH = REALTIME_CLOUDS_SETTINGS.resolution;

/**
 * Le masque d'eau dans le repère du CARREAU : l'extraction lit `uCloudOceanMask` avec l'UV de la carte, qui
 * est ici celui du carreau. Remplacement textuel d'une ligne de la source commune, vérifié (une dérive de
 * celle-ci ferait lever, pas livrer des seuils faux).
 */
export const REGIONAL_EXTRACTION_GLSL = ((): string => {
  const from = 'textureGrad( uCloudOceanMask, uv, gx, gy )';
  if (!REAL_CLOUDS_PARS_GLSL.includes(from))
    throw new Error(
      "nuages régionaux : l'extraction commune a changé, le masque d'eau n'est plus reconnu"
    );
  return REAL_CLOUDS_PARS_GLSL.replace(
    from,
    'textureGrad( uCloudOceanMask, uv * uCloudTile.zw + uCloudTile.xy, gx * uCloudTile.zw, gy * uCloudTile.zw )'
  );
})();

/** Le corps du fragment : extraction, fondu de grossissement, poids complémentaire, crépuscule. */
export const REGIONAL_CLOUDS_GLSL = `
        #ifdef USE_MAP
        {
          // DE PRÈS (GAL-EARTH-ATMOSPHERE-002, core/cloudNear) : l'alpha est aussi extrait d'un niveau de mipmap
          // plus grossier de la MÊME tuile, choisi pour qu'un texel effectif tienne dans quelques pixels. Une moyenne
          // de la donnée, jamais un détail ajouté. Les deux lectures sont faites hors de toute branche (dérivées).
          float pxTile = magnificationPxPerTexel( vec2( textureSize( map, 0 ) ) * uCloudTileSpan );
          float rcNearLod = uCloudNear > 0.5 ? nearCloudLod( pxTile ) : 0.0;
          vec2 rcTexSize = vec2( textureSize( map, 0 ) );
          float rcNearStep = exp2( rcNearLod );
          float rcAlphaNear = extractCloudAlpha(
            vMapUv,
            vec2( rcNearStep / rcTexSize.x, 0.0 ),
            vec2( 0.0, rcNearStep / rcTexSize.y )
          );
          // La neige est extraite comme un nuage (limite de l'extraction partagée) : de près, la règle d'effacement
          // la cachait. Le prolongement n'est montré que là où la FRACTION nuageuse MODIS du même jour (tests
          // infrarouges, qui distinguent la neige) voit un nuage ; sans couverture MODIS, la porte reste ouverte.
          vec2 rcModis = bilinearCloudFraction( uCloudDayMap, vMapUv * uCloudTile.zw + uCloudTile.xy, uCloudDayTexelSize );
          float rcNearGate = mix( 1.0, smoothstep( ${NEAR_MODIS_GATE_LOW}, ${NEAR_MODIS_GATE_HIGH}, rcModis.x ), step( 0.5, rcModis.y ) );
          float rcAlpha = mix( bilinearCloudAlpha( vMapUv ), rcAlphaNear * rcNearGate, smoothstep( 0.0, 1.0, rcNearLod ) );
          // La COMPOSITION de la couche mondiale (composeCloudAlpha, code partagé) : les masques MODIS du même jour
          // ne comblent que là où l'image vraies couleurs n'a pas d'observation (bord de fauchée, nuit), à LEUR
          // résolution (celle de la carte mondiale des masques), jamais présentés comme une mesure à 250 m.
          vec2 maskUv = vMapUv * uCloudTile.zw + uCloudTile.xy;
          rcAlpha = composeCloudAlpha(
            rcAlpha,
            vMapUv,
            maskUv,
            ( uCloudDayTexelSize * uCloudOpticalBlendRadiusTexels ) / uCloudTile.zw
          );
          // Grossissement du texel du CARREAU, et de celui de la couche mondiale (même point, même caméra).
          float pxGlobal = magnificationPxPerTexel( vec2( ${GLOBAL_MAP_WIDTH}.0, ${GLOBAL_MAP_WIDTH / 2}.0 ) );
          float fadeTile = mix( uMagFloor, 1.0, 1.0 - smoothstep( ${MAGNIFICATION_FADE_START_PX}.0, ${MAGNIFICATION_FADE_END_PX}.0, pxTile / rcNearStep ) );
          // Ce que la couche mondiale montre encore : 1 loin, 0 une fois son texel trop grossi. Le carreau prend le
          // relais en deux fois plus court, pour que deux alphas d'un MÊME nuage ne creusent pas une bande pâle.
          float fadeGlobal = 1.0 - smoothstep( ${MAGNIFICATION_FADE_START_PX}.0, ${MAGNIFICATION_FADE_END_PX}.0, pxGlobal );
          float regionalWeight = clamp( 2.0 * ( 1.0 - fadeGlobal ), 0.0, 1.0 );
          rcAlpha *= fadeTile * regionalWeight * uCloudOpacity;
          float cloudSunFacing = dot( normalize( vMoonWorldNormal ), fragmentSunDir() );
          rcAlpha *= terminatorDay( cloudSunFacing, uTerminatorWrap );
          diffuseColor.a *= rcAlpha;
          // LA TEINTE MESURÉE : le minimum des canaux de l'image (le même signal que l'extraction), ramené de 0,72
          // à 1. Un sommet très blanc reste blanc, un voile plus mince ou ombré au passage du satellite reste plus
          // gris : c'est la structure OBSERVÉE du nuage, qu'un blanc uni effaçait. Aucun bruit, aucun détail
          // ajouté. Sans observation optique (pixel noir, comblé par MODIS), le blanc de la couche mondiale.
          vec3 rcObs = textureLod( map, vMapUv, rcNearLod ).rgb;
          float rcObsMin = min( rcObs.r, min( rcObs.g, rcObs.b ) );
          float rcObsMax = max( rcObs.r, max( rcObs.g, rcObs.b ) );
          float rcShade = mix( 1.0, mix( 0.72, 1.0, smoothstep( uCloudLumLow, 0.9, rcObsMin ) ), smoothstep( 0.02, 0.08, rcObsMax ) );
          diffuseColor.rgb = mix( vec3( 1.0, 0.995, 0.985 ), vec3( rcShade ), regionalWeight );
        }
        #endif`;

/**
 * Les nuages de près (`core/cloudNear`) : `uCloudNear` vaut 1, ou 0 par `?cloud-near=0` (retour à la règle
 * d'effacement, mesure A/B sur le même build). Partagé par tous les carreaux.
 */
export const cloudNearUniforms = {
  uCloudNear: { value: 1 },
};

/** Opacité finale de la couche mondiale (`REALTIME_CLOUDS_SETTINGS.opacity`), que le carreau remet à 1 après son fondu. */
const cloudOpacity = { value: REALTIME_CLOUDS_SETTINGS.opacity };

/** L'UV de la carte mondiale pour l'UV d'un carreau : `u_global = u0 + u * du`, de même pour v. */
export function tileOceanTransform(
  index: TileIndex,
  shape: TileMatrixShape
): { xy: [number, number]; zw: [number, number]; span: [number, number] } {
  const b = tileBounds(index, shape);
  const lonSpan = b.east - b.west;
  const latSpan = b.north - b.south;
  // Le carreau a v = 1 au nord (`core/tilePatch`), comme la carte mondiale (v = 1 au pôle nord).
  return {
    xy: [(b.west + 180) / 360, (b.south + 90) / 180],
    zw: [lonSpan / 360, latSpan / 180],
    span: [360 / lonSpan, 180 / latSpan],
  };
}

export function createRegionalCloudMaterial(
  tile: { index: TileIndex; shape: TileMatrixShape } | undefined,
  realClouds: RealCloudsUniforms
): THREE.MeshStandardMaterial {
  const material = createShadowAwareStandardMaterial(
    {
      transparent: true,
      opacity: 1,
      depthWrite: false,
      side: THREE.DoubleSide,
    },
    {
      noSpecular: true,
      moonlight: true,
      eclipseShadow: true,
      terminatorWrap: LAYER_TERMINATOR_WRAP['clouds'],
    }
  );
  const t = tile
    ? tileOceanTransform(tile.index, tile.shape)
    : {
        xy: [0, 0] as [number, number],
        zw: [1, 1] as [number, number],
        span: [1, 1] as [number, number],
      };
  const tileUniform = {
    value: new THREE.Vector4(t.xy[0], t.xy[1], t.zw[0], t.zw[1]),
  };
  const spanUniform = { value: new THREE.Vector2(t.span[0], t.span[1]) };
  material.userData['__regionalClouds'] = true;
  chainOnBeforeCompile(material, (shader, renderer) => {
    // Les MÊMES objets que la couche mondiale : seuils, masque d'eau, masques MODIS jour et nuit déjà chargés.
    bindRealCloudsUniforms(shader, realClouds);
    shader.uniforms['uMagFloor'] = magnificationFloorUniform;
    shader.uniforms['uCloudOpacity'] = cloudOpacity;
    shader.uniforms['uCloudTile'] = tileUniform;
    shader.uniforms['uCloudTileSpan'] = spanUniform;
    shader.uniforms['uCloudNear'] = cloudNearUniforms.uCloudNear;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>' + MAGNIFICATION_VERTEX_PARS_GLSL
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>' + MAGNIFICATION_VERTEX_GLSL
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>' +
          MAGNIFICATION_VERTEX_PARS_GLSL +
          MAGNIFICATION_FLOOR_PARS_GLSL +
          realCloudsCommonGlsl(renderer) +
          '\nuniform float uCloudOpacity;\nuniform vec4 uCloudTile;\nuniform vec2 uCloudTileSpan;\nuniform float uCloudNear;' +
          CLOUD_NEAR_GLSL
      )
      .replace(
        '#include <map_pars_fragment>',
        '#include <map_pars_fragment>' + REGIONAL_EXTRACTION_GLSL
      )
      .replace(
        '#include <map_fragment>',
        '#include <map_fragment>' + REGIONAL_CLOUDS_GLSL
      );
  });
  const previousKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${previousKey()}-regional-clouds-v3`;
  return material;
}
