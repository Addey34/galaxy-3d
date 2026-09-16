import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { morphedSceneRadius, scaleToScene } from './overlayScale';
import { ScaleService } from './ScaleService';

/**
 * LE CONTRAT : aux deux extrémités du morph, une couche d'instrument doit tomber EXACTEMENT là
 * où le moteur place les corps 3D. On ne compare donc pas à une formule recopiée mais à
 * `ScaleService`, la source d'échelle de la scène — sinon les deux peuvent dériver ensemble
 * dans un test vert pendant que les marqueurs se décollent à l'écran.
 */
describe('échelle des couches d’instrument', () => {
  const scale = new ScaleService();

  it.each([0.39, 1, 5.2, 30.1, 116])(
    'à %s UA, colle à la scène en Éducatif comme en Explo',
    (au) => {
      scale.mode = 'educ';
      expect(morphedSceneRadius(au, 0)).toBeCloseTo(scale.auToScene(au), 9);
      scale.mode = 'explo';
      expect(morphedSceneRadius(au, 1)).toBeCloseTo(scale.auToScene(au), 9);
    }
  );

  it('interpole entre les deux, sans dépasser', () => {
    const educ = morphedSceneRadius(5.2, 0);
    const explo = morphedSceneRadius(5.2, 1);
    expect(morphedSceneRadius(5.2, 0.5)).toBeCloseTo((educ + explo) / 2, 9);
    // Hors bornes, on reste sur le mode correspondant : un morph ne s'extrapole pas.
    expect(morphedSceneRadius(5.2, -1)).toBeCloseTo(educ, 9);
    expect(morphedSceneRadius(5.2, 2)).toBeCloseTo(explo, 9);
  });

  it('garde la DIRECTION du point, ne change que son rayon', () => {
    const out = new THREE.Vector3();
    const source = new THREE.Vector3(3, -4, 12); // rayon 13
    scaleToScene(out, source.x, source.y, source.z, 0.37);
    expect(out.length()).toBeCloseTo(morphedSceneRadius(13, 0.37), 9);
    expect(out.clone().normalize().dot(source.clone().normalize())).toBeCloseTo(
      1,
      12
    );
  });

  it('renvoie l’origine pour un rayon nul ou absurde', () => {
    const out = new THREE.Vector3(9, 9, 9);
    expect(scaleToScene(out, 0, 0, 0, 0.5).length()).toBe(0);
    expect(morphedSceneRadius(0, 0.5)).toBe(0);
    expect(morphedSceneRadius(Number.NaN, 0.5)).toBe(0);
  });
});
