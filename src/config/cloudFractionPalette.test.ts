import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CLOUD_FRACTION_PALETTE, createCloudsMaterial } from './layerConfig';

/**
 * LA TABLE DE LA PALETTE MODIS REND EXACTEMENT CE QUE RENDAIT LA CASCADE (2026-10-18).
 *
 * L'oracle est la cascade de seize `if` que la table remplace, recopiée ici MOT POUR MOT depuis
 * le GLSL retiré (en pour cent, avant la division par 100 que les deux formes partagent) : elle
 * n'existe plus que dans ce test, et c'est sa seule raison d'être. Le parcours de la table suit
 * celui du shader (`decodeCloudFraction4`) : de la dernière ligne à la première.
 */
function cascadePercent(r: number, g: number, b: number): number {
  const near = (x: number, v: number) => Math.abs(x - v) < 1.5;
  if (near(r, 102) && near(b, 119)) return g;
  if (near(r, 183) && near(b, 141)) return 6 + (g - 15);
  if (near(r, 0) && near(b, 100)) return 12 + g;
  if (near(r, 0) && near(b, 170)) return 19 + g;
  if (near(r, 0) && near(b, 255)) return 25 + g;
  if (near(g, 136) && near(b, 238)) return 31 + r;
  if (near(g, 80) && near(b, 0)) return 38 + r;
  if (near(g, 136) && near(b, 0)) return 44 + r;
  if (near(g, 220) && near(b, 0)) return 50 + r;
  if (near(r, 255) && near(g, 255)) return 57 + b;
  if (near(r, 240) && near(g, 190)) return 63 + (b - 64);
  if (near(r, 187) && near(g, 136)) return 69 + b;
  if (near(r, 122) && near(g, 90)) return 76 + (b - 3);
  if (near(r, 110) && near(g, 0)) return 82 + b;
  if (near(r, 170) && near(g, 0)) return 88 + b;
  if (near(r, 255) && near(g, 0)) return 95 + b;
  return 0;
}

function tablePercent(rgb: readonly [number, number, number]): number {
  let percent = 0;
  for (let k = CLOUD_FRACTION_PALETTE.length - 1; k >= 0; k--) {
    const { key, base, offset } = CLOUD_FRACTION_PALETTE[k]!;
    let distance = 0;
    let free = 0;
    for (let c = 0; c < 3; c++) {
      const target = key[c] ?? null;
      if (target === null) free += rgb[c]!;
      else distance = Math.max(distance, Math.abs(rgb[c]! - target));
    }
    if (distance < 1.5) percent = base + (free - offset);
  }
  return percent;
}

/** La forme du rendu logiciel, générée depuis la même table : la PREMIÈRE ligne reconnue rend. */
function firstMatchPercent(rgb: readonly [number, number, number]): number {
  for (const { key, base, offset } of CLOUD_FRACTION_PALETTE) {
    if (key.every((k, c) => k === null || Math.abs(rgb[c]! - k) < 1.5))
      return base + (rgb[key.indexOf(null)]! - offset);
  }
  return 0;
}

/** Un renderer de test qui publie le nom de son moteur de rendu. */
function rendererNamed(name: string): THREE.WebGLRenderer {
  return {
    getContext: () => ({
      getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 1 }),
      getParameter: () => name,
    }),
  } as unknown as THREE.WebGLRenderer;
}

function compiledClouds(renderer: THREE.WebGLRenderer) {
  const shader = {
    uniforms: {} as Record<string, THREE.IUniform>,
    vertexShader: '',
    fragmentShader: '#include <common>\n#include <map_fragment>',
  } as Parameters<NonNullable<THREE.Material['onBeforeCompile']>>[0];
  createCloudsMaterial().onBeforeCompile(shader, renderer);
  return shader;
}

describe('la palette des fractions nuageuses, en table', () => {
  it('rend la valeur de la cascade pour chacune des 16 777 216 couleurs', () => {
    let mismatches = 0;
    let first = '';
    const rgb: [number, number, number] = [0, 0, 0];
    for (let r = 0; r < 256; r++)
      for (let g = 0; g < 256; g++)
        for (let b = 0; b < 256; b++) {
          rgb[0] = r;
          rgb[1] = g;
          rgb[2] = b;
          const expected = cascadePercent(r, g, b);
          if (
            tablePercent(rgb) !== expected ||
            firstMatchPercent(rgb) !== expected
          ) {
            mismatches++;
            first ||= `${r},${g},${b}`;
          }
        }
    expect(mismatches, `première couleur fautive : ${first}`).toBe(0);
  }, 120_000);

  it('compile la TABLE sur un GPU, la CASCADE en rendu logiciel', () => {
    const gpu = compiledClouds(rendererNamed('ANGLE (NVIDIA, Direct3D11)'));
    expect(gpu.fragmentShader).toContain(
      'for ( int k = uCloudPaletteSize - 1;'
    );
    expect(gpu.fragmentShader).not.toContain(
      'float decodeCloudFraction( vec3 p )'
    );
    const software = compiledClouds(
      rendererNamed('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))')
    );
    expect(software.fragmentShader).toContain(
      'float decodeCloudFraction( vec3 p )'
    );
    expect(software.fragmentShader).not.toContain('uCloudPaletteSize - 1');
    // seize lignes, la division portant sur la somme entière
    expect(software.fragmentShader.match(/if \( abs\( p\./g)).toHaveLength(
      CLOUD_FRACTION_PALETTE.length
    );
    expect(software.fragmentShader).toContain(
      'return ( 6.0 + ( p.g - 15.0 ) ) / 100.0;'
    );
  });

  it('chaque ligne reconnaît sur deux canaux exactement', () => {
    for (const { key } of CLOUD_FRACTION_PALETTE)
      expect(key.filter((k) => k === null)).toHaveLength(1);
  });

  it('le matériau des nuages reçoit la longueur de la table (sans elle, la boucle ne tourne pas)', () => {
    const material = createCloudsMaterial();
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: '',
      fragmentShader: '#include <common>\n#include <map_fragment>',
    } as Parameters<NonNullable<THREE.Material['onBeforeCompile']>>[0];
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.uniforms['uCloudPaletteSize']?.value).toBe(
      CLOUD_FRACTION_PALETTE.length
    );
    expect(shader.fragmentShader).toContain(
      `vec3 CLOUD_PALETTE_KEY[${CLOUD_FRACTION_PALETTE.length}]`
    );
  });
});
