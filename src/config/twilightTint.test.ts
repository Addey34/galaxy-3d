import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createSurfaceMaterial } from './layerConfig';

/**
 * SATURATION DES TEINTES DU BANDEAU CRÉPUSCULAIRE.
 *
 * Le même défaut a été livré deux fois de suite, aux deux extrémités du dégradé, et aucun test
 * ne pouvait le voir : les garanties portaient toutes sur la LUMINOSITÉ du bandeau (continuité,
 * absence de trou, amplitude ancrée), et elles étaient vraies. Un bandeau brun-rouge saturé et
 * un coucher de soleil crédible rendent exactement la même luminance.
 *
 *   - teinte chaude `0xff9a52` : rapport rouge/bleu de 11,6 en linéaire, mesuré 11,2 à l'écran.
 *     Rendu, un bandeau brun-rouge à bords francs en travers du disque.
 *   - teinte froide reprise telle quelle du catalogue : rapport 0,09, mesuré 0,06 à 2,9° sous
 *     l'horizon. Un bleu de synthèse sans aucun rouge, et un voile bleu jusque sur le sol
 *     encore éclairé.
 *
 * Ce test lit les uniformes RÉELLEMENT posés par le matériau et borne les deux rapports. Les
 * bornes viennent de ce qu'un ciel de soleil rasant photographié depuis l'orbite montre, pas
 * d'un réglage : chaud entre 3 et 4,5, froid entre 0,4 et 0,7. Elles sont larges exprès — leur
 * rôle est d'attraper un facteur 3, pas de figer une valeur.
 */

/** Uniformes que le matériau injecte pour de bon. */
function twilightUniforms(): Record<string, { value: THREE.Color }> {
  const material = createSurfaceMaterial(
    false,
    undefined,
    true,
    true,
    true,
    true,
    0x4a90e0
  );
  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\n#include <worldpos_vertex>',
    fragmentShader:
      '#include <common>\n' +
      '#include <map_fragment>\n' +
      'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );\n' +
      'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;\n' +
      'roughnessFactor *= texelRoughness.g;',
  } as Parameters<NonNullable<THREE.Material['onBeforeCompile']>>[0];
  material.onBeforeCompile?.(shader, {} as THREE.WebGLRenderer);
  return shader.uniforms as Record<string, { value: THREE.Color }>;
}

const luminance = (c: THREE.Color): number =>
  0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

describe('teintes du bandeau crépusculaire', () => {
  const uniforms = twilightUniforms();
  const cool = uniforms['uTwilightColor']?.value;
  const warm = uniforms['uTwilightWarmColor']?.value;

  it('pose bien les deux teintes', () => {
    // Borne : sans elles, toutes les assertions ci-dessous porteraient sur `undefined`.
    expect(cool).toBeInstanceOf(THREE.Color);
    expect(warm).toBeInstanceOf(THREE.Color);
  });

  it('garde les deux à luminance 1', () => {
    // LA séparation qui rend le dégradé possible : la teinte décide de la couleur,
    // `TWILIGHT_STRENGTH` de la luminosité. Si une teinte porte sa propre luminance, changer
    // la couleur du catalogue change silencieusement la largeur apparente du bandeau — et le
    // fondu chaud→froid devient un fondu clair→sombre.
    expect(luminance(cool!)).toBeCloseTo(1, 5);
    expect(luminance(warm!)).toBeCloseTo(1, 5);
  });

  it('tient la teinte chaude dans la gamme d’un soleil rasant', () => {
    expect(warm!.r / warm!.b).toBeGreaterThan(1.8);
    expect(warm!.r / warm!.b).toBeLessThan(2.8);
  });

  it('désature le ciel crépusculaire, qui n’est pas un bleu pur', () => {
    expect(cool!.r / cool!.b).toBeGreaterThan(0.55);
    expect(cool!.r / cool!.b).toBeLessThan(0.8);
  });

  it('garde la chaude franchement plus chaude que la froide', () => {
    // L'ordre est ce qui fait exister le coucher de soleil : l'inverser rendrait un bandeau
    // bleu au terminateur et rouge en pleine nuit.
    expect(warm!.r / warm!.b).toBeGreaterThan((cool!.r / cool!.b) * 2.5);
  });
});
