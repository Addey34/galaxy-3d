import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { drapeEquirectangular } from './modelUv';

/**
 * Le drapé doit poser la carte EXACTEMENT comme la sphère qu'il remplace : on le confronte donc
 * à `THREE.SphereGeometry` elle-même, sommet par sommet, et non à une formule recopiée.
 */
describe('drapeEquirectangular', () => {
  it('reproduit les coordonnées de texture de la sphère de Three.js', () => {
    const sphere = new THREE.SphereGeometry(1, 64, 32);
    const position = sphere.getAttribute('position');
    const reference = sphere.getAttribute('uv');
    const index = sphere.index!;
    const draped = drapeEquirectangular(
      position.array as Float32Array,
      index.array as Uint16Array
    );
    let compared = 0;
    for (let t = 0; t < index.count / 3; t++) {
      for (let k = 0; k < 3; k++) {
        const i = index.getX(t * 3 + k);
        const y = position.getY(i);
        // Les pôles et la couture ont, par construction, une autre coordonnée que la sphère.
        if (Math.abs(Math.abs(y) - 1) < 1e-6) continue;
        const uRef = reference.getX(i);
        if (uRef < 1e-6 || uRef > 1 - 1e-6) continue;
        const u = draped.uv[t * 6 + k * 2]!;
        const v = draped.uv[t * 6 + k * 2 + 1]!;
        expect(u % 1).toBeCloseTo(uRef, 5);
        expect(v).toBeCloseTo(reference.getY(i), 5);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(5000);
  });

  it('ne fait jamais enjamber la couture à un triangle', () => {
    const sphere = new THREE.IcosahedronGeometry(1, 30);
    const indexed = sphere.index
      ? sphere
      : (() => {
          const p = sphere.getAttribute('position');
          const idx = Array.from({ length: p.count }, (_, i) => i);
          sphere.setIndex(idx);
          return sphere;
        })();
    const draped = drapeEquirectangular(
      indexed.getAttribute('position').array as Float32Array,
      indexed.index!.array as Uint32Array
    );
    // Près d'un pôle, un triangle couvre légitimement une large plage de longitudes : la garde
    // porte sur les triangles à plus de 15° des pôles, où l'enjambement serait une couture ratée.
    let checked = 0;
    for (let t = 0; t < draped.uv.length / 6; t++) {
      const vs = [0, 1, 2].map((k) => draped.uv[t * 6 + k * 2 + 1]!);
      if (vs.some((v) => Math.abs(v - 0.5) > 75 / 180)) continue;
      const us = [0, 1, 2].map((k) => draped.uv[t * 6 + k * 2]!);
      expect(Math.max(...us) - Math.min(...us)).toBeLessThan(0.1);
      checked++;
    }
    expect(checked).toBeGreaterThan(10_000);
  });

  it('donne à un sommet polaire la longitude de son triangle', () => {
    // Un triangle dont un sommet est sur l'axe, les deux autres à λ = 10° et 20°.
    const toXYZ = (lonDeg: number, latDeg: number) => {
      const lon = (lonDeg * Math.PI) / 180;
      const lat = (latDeg * Math.PI) / 180;
      return [
        Math.cos(lat) * Math.cos(lon),
        Math.sin(lat),
        -Math.cos(lat) * Math.sin(lon),
      ];
    };
    const positions = new Float32Array([
      0,
      1,
      0,
      ...toXYZ(10, 80),
      ...toXYZ(20, 80),
    ]);
    const draped = drapeEquirectangular(positions, [0, 1, 2]);
    const expected = 0.5 + 15 / 360;
    expect(draped.uv[0]).toBeCloseTo(expected, 6);
    expect(draped.uv[1]).toBeCloseTo(1, 6);
    // Longitude EST vers −Z : 10° E tombe à u = 0,5 + 10/360.
    expect(draped.uv[2]).toBeCloseTo(0.5 + 10 / 360, 6);
  });
});
