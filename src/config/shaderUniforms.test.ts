import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  createSurfaceMaterial,
  createRingMaterial,
  createCloudsMaterial,
  createPrecipMaterial,
  createThermalMaterial,
  createColoredOverlayMaterial,
} from './layerConfig';
import { TERMINATOR_WRAP_CLOUDS } from '@/core/terminator';

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

/**
 * Les jalons que les injections recherchent ; absents, elles ne s'appliqueraient pas et le
 * test passerait sur une source vide — le mode d'échec à éviter ici.
 *
 * Aucune ligne ne doit nommer un uniforme. Le talon a d'abord porté une ligne
 * `… * uLightAttenuation …` (jalon réel, mais du seul matériau d'anneau) : pour tous les
 * autres elle restait là, non déclarée, et le test signalait un défaut qu'IL avait écrit.
 * Un outil de mesure qui produit lui-même la faute qu'il cherche ne mesure rien.
 */
const BASE_STUB =
  '#include <common>\n' +
  '#include <map_fragment>\n' +
  'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );\n' +
  'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;\n' +
  'roughnessFactor *= texelRoughness.g;';

/**
 * L'anneau se greffe sur une source DÉJÀ atténuée par `createShadowAwareStandardMaterial` :
 * son jalon est cette ligne-là, et elle n'a de sens que pour lui.
 */
const RING_STUB =
  BASE_STUB +
  '\nvec3 outgoingLight = (totalDiffuse + totalSpecular) * uLightAttenuation + totalEmissiveRadiance;';

/** Construit la source de fragment injectée par un matériau, comme le ferait Three.js. */
function injectedFragment(material: THREE.Material, stub = BASE_STUB): string {
  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\n#include <worldpos_vertex>',
    fragmentShader: stub,
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

/**
 * TOUTES les combinaisons de drapeaux de la surface, pas seulement celle de la Terre.
 *
 * Une déclaration est conditionnée par un drapeau, son emploi par un autre : c'est
 * exactement la forme du défaut qui a rendu la Terre invisible, et il n'apparaît que dans
 * les combinaisons où les deux conditions divergent. Tester la seule Terre complète laisse
 * donc passer la moitié du problème — un corps qui a une atmosphère mais pas de clair de
 * Lune, par exemple, ne prend pas le même chemin d'injection.
 *
 * 32 cas, quelques millisecondes : il n'y a aucune raison d'en choisir un sous-ensemble.
 */
function surfaceCases(): [string, () => THREE.Material][] {
  const cases: [string, () => THREE.Material][] = [];
  for (let mask = 0; mask < 32; mask++) {
    const moonlight = (mask & 1) !== 0;
    const limitSpecular = (mask & 2) !== 0;
    const eclipseShadow = (mask & 4) !== 0;
    const hasAtmosphere = (mask & 8) !== 0;
    const tinted = (mask & 16) !== 0;
    const label =
      'surface [' +
      [
        moonlight ? 'clair de Lune' : null,
        limitSpecular ? 'spéculaire bornée' : null,
        eclipseShadow ? 'éclipse' : null,
        hasAtmosphere ? 'atmosphère' : null,
        tinted ? 'couleur d’air' : null,
      ]
        .filter(Boolean)
        .join(', ') +
      ']';
    cases.push([
      label || 'surface [nue]',
      () =>
        createSurfaceMaterial(
          false,
          undefined,
          moonlight,
          limitSpecular,
          eclipseShadow,
          hasAtmosphere,
          tinted ? 0x4a90e0 : undefined
        ),
    ]);
  }
  return cases;
}

describe('uniformes des matériaux injectés', () => {
  const cases: [string, () => THREE.Material, string][] = [
    ...surfaceCases().map(
      ([label, make]) =>
        [label, make, BASE_STUB] as [string, () => THREE.Material, string]
    ),
    [
      'surface sans texture (couleur de repli)',
      () => createSurfaceMaterial(false, 0x888888),
      BASE_STUB,
    ],
    ['nuages', () => createCloudsMaterial(), BASE_STUB],
    ['précipitations', () => createPrecipMaterial(), BASE_STUB],
    [
      'calque coloré (apparence physique, avec terminateur)',
      () => createColoredOverlayMaterial(0.85, TERMINATOR_WRAP_CLOUDS),
      BASE_STUB,
    ],
    ['anneau', () => createRingMaterial(), RING_STUB],
  ];

  it.each(cases)(
    '%s : chaque uniforme employé est déclaré',
    (_label, make, stub) => {
      const source = injectedFragment(make(), stub);
      // Borne : le matériau doit avoir VRAIMENT touché la source. Une longueur seuil ne dirait
      // pas la même chose — un matériau peut injecter très peu et rester correct.
      expect(source).not.toBe(stub);

      const used = usedUniforms(source);
      const declared = declaredUniforms(source);
      const missing = [...used].filter(
        (name) => !declared.has(name) && !PROVIDED_BY_THREE.has(name)
      );
      expect(
        missing,
        `uniformes employés mais JAMAIS déclarés : ${missing.join(', ')}. Le shader ne compilerait pas et le matériau rendrait noir, sans erreur exploitable.`
      ).toEqual([]);
    }
  );

  /**
   * Ces trois-là ne touchent PAS la source, et c'est voulu — donc l'assertion utile n'est pas
   * la même. Le Soleil n'est pas éclairé (il émet), et le thermique comme le calque coloré nu
   * sont des couches INSTRUMENT : la règle du projet veut qu'elles n'aient pas de terminateur
   * du tout. Les faire passer par le test ci-dessus reviendrait à exiger une injection dont
   * l'absence est la propriété recherchée ; on vérifie donc cette absence.
   */
  const inert: [string, () => THREE.Material][] = [
    ['soleil', () => createSurfaceMaterial(true)],
    ['thermique', () => createThermalMaterial()],
    [
      'calque coloré (couche instrument, sans terminateur)',
      () => createColoredOverlayMaterial(),
    ],
  ];

  it.each(inert)('%s : n’injecte rien, et ne le doit pas', (_label, make) => {
    expect(injectedFragment(make())).toBe(BASE_STUB);
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
