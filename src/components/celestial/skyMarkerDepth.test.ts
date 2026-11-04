import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ShaderLib } from 'three';

/**
 * Les repères posés sur le ciel (ciel profond, hôtes d'exoplanètes, radiants de météores, et les
 * étoiles et figures de `Starfield`) sont à
 * 2600 unités de la caméra, alors que le plan lointain `far` est adaptatif (2480 mesuré à Neptune)
 * et ne se met à jour qu'au-delà de 5 %. Sans épingler leur profondeur au plan lointain, un repère
 * à moins d'environ 17° de l'axe de visée est coupé : l'objet qu'on vient de centrer disparaît.
 */
const LAYERS = ['DeepSkyMarkers', 'ExoplanetHosts', 'MeteorRadiants'];

describe('profondeur des repères du ciel', () => {
  for (const name of LAYERS) {
    it(`${name} épingle sa profondeur au plan lointain`, () => {
      const source = readFileSync(
        new URL(`./${name}.ts`, import.meta.url),
        'utf-8'
      );
      expect(source).toContain('gl_Position.z = gl_Position.w;');
    });
  }
});

describe('étoiles et figures de constellations', () => {
  it('Starfield épingle la profondeur des points ET des lignes', () => {
    const source = readFileSync(
      new URL('./Starfield.ts', import.meta.url),
      'utf-8'
    );
    // une fois dans le shader des points, une fois injectée dans le matériau des figures
    expect(source.split('gl_Position.z = gl_Position.w;').length - 1).toBe(2);
    expect(source).toContain('#include <project_vertex>');
  });

  it("le shader des lignes de Three.js porte toujours la chaîne que l'injection remplace", () => {
    // `replace` sans effet épinglerait RIEN en silence : si Three.js renomme le morceau, on le sait ici.
    expect(ShaderLib.basic.vertexShader).toContain('#include <project_vertex>');
  });
});

describe('noms 2D du ciel', () => {
  it('testent « devant la caméra », pas « avant le plan lointain »', () => {
    const source = readFileSync(
      new URL('../../ui/skyLabels.ts', import.meta.url),
      'utf-8'
    );
    expect(source).not.toContain('world.z < 1');
    expect(source).toContain('matrixWorldInverse');
  });
});
