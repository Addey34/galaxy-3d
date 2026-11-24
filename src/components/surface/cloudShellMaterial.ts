import * as THREE from 'three';

import { REALTIME_CLOUDS_SETTINGS } from '@/config/engine';
import {
  chainOnBeforeCompile,
  createShadowAwareStandardMaterial,
  LAYER_TERMINATOR_WRAP,
  REAL_CLOUDS_PARS_GLSL,
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
          float rcAlpha = bilinearCloudAlpha( vMapUv );
          // Grossissement du texel du CARREAU, et de celui de la couche mondiale (même point, même caméra).
          float pxTile = magnificationPxPerTexel( vec2( textureSize( map, 0 ) ) * uCloudTileSpan );
          float pxGlobal = magnificationPxPerTexel( vec2( ${GLOBAL_MAP_WIDTH}.0, ${GLOBAL_MAP_WIDTH / 2}.0 ) );
          // Le fondu du carreau est celui de la règle commune (lot 48) : 3 à 6 pixels par texel.
          float fadeTile = mix( uMagFloor, 1.0, 1.0 - smoothstep( ${MAGNIFICATION_FADE_START_PX}.0, ${MAGNIFICATION_FADE_END_PX}.0, pxTile ) );
          // Ce que la couche mondiale montre encore : 1 loin, 0 une fois son texel trop grossi. Le carreau prend
          // le relais en deux fois plus court : plein quand la mondiale n'est plus qu'à la moitié, pour que le
          // recouvrement de deux alphas d'un MÊME nuage reste proche de 1 au lieu de creuser une bande pâle.
          float fadeGlobal = 1.0 - smoothstep( ${MAGNIFICATION_FADE_START_PX}.0, ${MAGNIFICATION_FADE_END_PX}.0, pxGlobal );
          float regionalWeight = clamp( 2.0 * ( 1.0 - fadeGlobal ), 0.0, 1.0 );
          rcAlpha *= fadeTile * regionalWeight * uCloudOpacity;
          float cloudSunFacing = dot( normalize( vMoonWorldNormal ), fragmentSunDir() );
          rcAlpha *= terminatorDay( cloudSunFacing, uTerminatorWrap );
          diffuseColor.a *= rcAlpha;
          diffuseColor.rgb = vec3( 1.0, 0.995, 0.985 );
        }
        #endif`;

/** Les seuils d'extraction, UNE fois pour tous les carreaux : ceux de la couche mondiale. */
const shared = {
  lumLow: { value: REALTIME_CLOUDS_SETTINGS.cloudLuminanceLow },
  lumHigh: { value: REALTIME_CLOUDS_SETTINGS.cloudLuminanceHigh },
  satMax: { value: REALTIME_CLOUDS_SETTINGS.cloudSaturationMax },
  lumLowLand: { value: REALTIME_CLOUDS_SETTINGS.cloudLuminanceLowLand },
  edgeSoft: { value: REALTIME_CLOUDS_SETTINGS.edgeSoftness },
  satOceanBoost: { value: REALTIME_CLOUDS_SETTINGS.cloudSatOceanBoost },
  opacity: { value: REALTIME_CLOUDS_SETTINGS.opacity },
  oceanMask: { value: null as THREE.Texture | null },
  hasOceanMask: { value: 0 },
};

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
  oceanMask: THREE.Texture | null
): THREE.MeshStandardMaterial {
  shared.oceanMask.value = oceanMask;
  shared.hasOceanMask.value = oceanMask ? 1 : 0;
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
  chainOnBeforeCompile(material, (shader) => {
    shader.uniforms['uMagFloor'] = magnificationFloorUniform;
    shader.uniforms['uCloudLumLow'] = shared.lumLow;
    shader.uniforms['uCloudLumHigh'] = shared.lumHigh;
    shader.uniforms['uCloudSatMax'] = shared.satMax;
    shader.uniforms['uCloudLumLowLand'] = shared.lumLowLand;
    shader.uniforms['uCloudEdgeSoft'] = shared.edgeSoft;
    shader.uniforms['uCloudSatOceanBoost'] = shared.satOceanBoost;
    shader.uniforms['uCloudOpacity'] = shared.opacity;
    shader.uniforms['uCloudOceanMask'] = shared.oceanMask;
    shader.uniforms['uHasOceanMask'] = shared.hasOceanMask;
    shader.uniforms['uCloudTile'] = tileUniform;
    shader.uniforms['uCloudTileSpan'] = spanUniform;
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
          'uniform float uCloudLumLow;\nuniform float uCloudLumHigh;\nuniform float uCloudSatMax;\nuniform float uCloudLumLowLand;\nuniform float uCloudEdgeSoft;\nuniform float uCloudSatOceanBoost;\nuniform float uCloudOpacity;\nuniform sampler2D uCloudOceanMask;\nuniform float uHasOceanMask;\nuniform vec4 uCloudTile;\nuniform vec2 uCloudTileSpan;'
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
  material.customProgramCacheKey = () => `${previousKey()}-regional-clouds-v1`;
  return material;
}
