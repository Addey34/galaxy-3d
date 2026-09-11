import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createSurfaceMaterial, createRingMaterial } from './layerConfig';

/**
 * TOUT UNIFORME EMPLOYÉ DOIT ÊTRE DÉCLARÉ.
 *
 * Défaut réel, livré : le bandeau crépusculaire a gagné une seconde teinte. La variable a été
 * utilisée dans le GLSL et alimentée côté JavaScript, mais sa ligne `uniform vec3 …;` n'a pas
 * été ajoutée à la source du fragment shader. Le shader ne compile plus, et Three.js ne lève
 * rien d'exploitable : le matériau rend simplement NOIR. La Terre est devenue invisible, et
 * comme la couche nuages se dessine par-dessus, le globe avait l'air « délavé » puis
 * « transparent » plutôt que cassé.
 *
 * Rien ne l'a attrapé. `tsc` ne lit pas le GLSL, ESLint non plus, et aucun test ne compilait de
 * shader — les 925 tests étaient verts pendant que la planète principale ne s'affichait plus.
 *
 * Ce test relit la source produite par `onBeforeCompile` et compare les identifiants `uXxx`
 * UTILISÉS à ceux DÉCLARÉS. Il ne compile pas de GLSL : il n'en a pas besoin pour attraper
 * cette faute-là, qui est une simple omission de déclaration.
 */

/** Construit la source de fragment injectée par un matériau, comme le ferait Three.js. */
function injectedFragment(material: THREE.Material): string {
  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\n#include <worldpos_vertex>',
    // Les jalons que les injections recherchent ; absents, elles ne s'appliqueraient pas et le
    // test passerait sur une source vide — le mode d'échec à éviter ici.
    fragmentShader:
      '#include <common>\n' +
      '#include <map_fragment>\n' +
      'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );\n' +
      'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;\n' +
      'vec3 outgoingLight = (totalDiffuse + totalSpecular) * uLightAttenuation + totalEmissiveRadiance;\n' +
      'roughnessFactor *= texelRoughness.g;',
  } as Parameters<NonNullable<THREE.Material['onBeforeCompile']>>[0];
  material.onBeforeCompile?.(shader, {} as THREE.WebGLRenderer);
  return shader.fragmentShader;
}

/** Identifiants `uXxx` employés dans le corps du shader. */
function usedUniforms(source: string): Set<string> {
  return new Set(
    [...source.matchAll(/\bu[A-Z][A-Za-z0-9_]*/g)].map((m) => m[0])
  );
}

/** Identifiants déclarés par une ligne `uniform <type> uXxx;`. */
function declaredUniforms(source: string): Set<string> {
  return new Set(
    [...source.matchAll(/uniform\s+\w+\s+(u[A-Za-z0-9_]*)\s*[;[]/g)].map(
      (m) => m[1]!
    )
  );
}

/**
 * Fournis par Three.js lui-même : ils n'apparaissent pas dans nos déclarations parce que le
 * moteur les injecte. Les lister explicitement évite que le test devienne du bruit, et toute
 * addition ici doit être un nom que Three fournit réellement.
 */
const PROVIDED_BY_THREE = new Set(['uvTransform', 'uv2Transform']);

describe('uniformes des matériaux injectés', () => {
  const cases: [string, () => THREE.Material][] = [
    [
      'surface Terre (crépuscule, clair de Lune, ombre nuageuse, éclipse)',
      () =>
        createSurfaceMaterial(
          false,
          undefined,
          true,
          true,
          true,
          true,
          0x4a90e0
        ),
    ],
    ['anneau', () => createRingMaterial()],
  ];

  it.each(cases)('%s : chaque uniforme employé est déclaré', (_label, make) => {
    const source = injectedFragment(make());
    // Borne : sans injection le test ne prouverait rien.
    expect(source.length).toBeGreaterThan(400);

    const used = usedUniforms(source);
    const declared = declaredUniforms(source);
    const missing = [...used].filter(
      (name) => !declared.has(name) && !PROVIDED_BY_THREE.has(name)
    );
    expect(
      missing,
      `uniformes employés mais JAMAIS déclarés : ${missing.join(', ')}. Le shader ne compilerait pas et le matériau rendrait noir, sans erreur exploitable.`
    ).toEqual([]);
  });

  it('attrape vraiment une déclaration manquante', () => {
    // Falsification intégrée : on retire une déclaration d'une source réelle et on vérifie que
    // la comparaison la signale. Sans ça, ce test pourrait passer sur deux ensembles vides.
    const source = injectedFragment(
      createSurfaceMaterial(false, undefined, true, true, true, true, 0x4a90e0)
    );
    const amputated = source.replace(/uniform\s+vec3\s+uTwilightColor;/, '');
    expect(amputated).not.toBe(source);
    const missing = [...usedUniforms(amputated)].filter(
      (n) => !declaredUniforms(amputated).has(n) && !PROVIDED_BY_THREE.has(n)
    );
    expect(missing).toContain('uTwilightColor');
  });
});
