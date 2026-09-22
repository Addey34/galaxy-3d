import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { buildTilePatch } from './tilePatch';
import { geographicToLocalDirection } from './frames';
import { tileBounds } from './tilePyramid';

/**
 * LE CARREAU EST-IL AU BON ENDROIT, ET LE RELIEF EST-IL CELUI DE LA DONNÉE ?
 *
 * Une erreur ici ne lève rien : le carreau s'affiche, il est net, et il montre un autre endroit
 * du corps ou une altitude qui n'est pas la sienne. On compare donc des sommets à la fonction
 * MESURÉE au lot 8 contre quatre épicentres publiés (`frames.geographicToLocalDirection`), et
 * des rayons à des hauteurs données.
 */

const RADIUS = 0.27;
const BOUNDS = tileBounds({ level: 4, row: 7, column: 21 });

/** Hauteurs constantes, couronne comprise. */
function flatHeights(segments: number, value: number) {
  const apron = segments + 3;
  return { values: new Float32Array(apron * apron).fill(value), segments };
}

function vertex(
  patch: ReturnType<typeof buildTilePatch>,
  index: number
): THREE.Vector3 {
  return new THREE.Vector3(
    patch.positions[index * 3]!,
    patch.positions[index * 3 + 1]!,
    patch.positions[index * 3 + 2]!
  );
}

describe('géométrie d’un carreau', () => {
  it('place ses coins sur leur latitude et leur longitude', () => {
    const patch = buildTilePatch({
      bounds: BOUNDS,
      radius: RADIUS,
      segments: 8,
    });
    const northWest = geographicToLocalDirection(
      BOUNDS.north,
      BOUNDS.west
    ).multiplyScalar(RADIUS);
    const southEast = geographicToLocalDirection(
      BOUNDS.south,
      BOUNDS.east
    ).multiplyScalar(RADIUS);
    expect(vertex(patch, 0).distanceTo(northWest)).toBeLessThan(1e-6);
    expect(
      vertex(patch, patch.positions.length / 3 - 1).distanceTo(southEast)
    ).toBeLessThan(1e-6);
  });

  it('sans hauteurs, reste exactement sur la sphère', () => {
    const patch = buildTilePatch({
      bounds: BOUNDS,
      radius: RADIUS,
      segments: 4,
    });
    for (let i = 0; i < patch.positions.length / 3; i += 1)
      expect(vertex(patch, i).length()).toBeCloseTo(RADIUS, 6);
  });

  it('déplace RADIALEMENT de la hauteur donnée, et de rien d’autre', () => {
    const drop = 0.01;
    const patch = buildTilePatch({
      bounds: BOUNDS,
      radius: RADIUS,
      segments: 4,
      heights: flatHeights(4, drop),
    });
    const plain = buildTilePatch({
      bounds: BOUNDS,
      radius: RADIUS,
      segments: 4,
    });
    for (let i = 0; i < 25; i += 1) {
      expect(vertex(patch, i).length()).toBeCloseTo(RADIUS + drop, 6);
      // Même direction : seule la distance au centre change.
      expect(
        vertex(patch, i).normalize().distanceTo(vertex(plain, i).normalize())
      ).toBeLessThan(1e-6);
    }
  });

  it('rend la hauteur de CHAQUE échantillon, pas une moyenne', () => {
    const segments = 2;
    const apron = segments + 3;
    const values = new Float32Array(apron * apron);
    // Un seul sommet relevé : celui du milieu (i = 1, j = 1).
    values[(1 + 1) * apron + (1 + 1)] = 0.05;
    const patch = buildTilePatch({
      bounds: BOUNDS,
      radius: RADIUS,
      segments,
      heights: { values, segments },
    });
    const middle = 1 * (segments + 1) + 1;
    expect(vertex(patch, middle).length()).toBeCloseTo(RADIUS + 0.05, 6);
    expect(vertex(patch, 0).length()).toBeCloseTo(RADIUS, 6);
  });

  it('oriente ses normales vers l’extérieur', () => {
    const segments = 4;
    const apron = segments + 3;
    const values = new Float32Array(apron * apron);
    // Une pente : la normale doit basculer, mais jamais rentrer dans le corps.
    for (let j = 0; j < apron; j += 1)
      for (let i = 0; i < apron; i += 1) values[j * apron + i] = i * 0.002;
    const patch = buildTilePatch({
      bounds: BOUNDS,
      radius: RADIUS,
      segments,
      heights: { values, segments },
    });
    for (let i = 0; i < (segments + 1) ** 2; i += 1) {
      const normal = new THREE.Vector3(
        patch.normals[i * 3]!,
        patch.normals[i * 3 + 1]!,
        patch.normals[i * 3 + 2]!
      );
      expect(normal.length()).toBeCloseTo(1, 5);
      expect(normal.dot(vertex(patch, i).normalize())).toBeGreaterThan(0.9);
    }
  });

  it('calcule la normale d’un sommet de BORD sur la COURONNE, pas sur le bord lui-même', () => {
    // Sans couronne, la normale d'un sommet de bord serait calculée par différence
    // unilatérale : la pente y serait fausse et la grille des carreaux se dessinerait au
    // terminateur. Un relief COURBE le montre ; une pente droite, non, puisque les deux
    // différences y coïncident.
    const segments = 4;
    const apron = segments + 3;
    const curved = new Float32Array(apron * apron);
    for (let j = 0; j < apron; j += 1)
      for (let i = 0; i < apron; i += 1)
        curved[j * apron + i] = (i - 1) * (i - 1) * 0.0008;
    // La même chose AVEC la couronne rabattue sur le bord, c'est-à-dire ce qu'on obtiendrait
    // sans couronne du tout.
    const clamped = Float32Array.from(curved);
    for (let j = 0; j < apron; j += 1) {
      clamped[j * apron] = clamped[j * apron + 1]!;
      clamped[j * apron + apron - 1] = clamped[j * apron + apron - 2]!;
    }

    const tiltAt = (values: Float32Array, i: number, j: number): number => {
      const patch = buildTilePatch({
        bounds: BOUNDS,
        radius: RADIUS,
        segments,
        heights: { values, segments },
      });
      const index = j * (segments + 1) + i;
      const normal = new THREE.Vector3(
        patch.normals[index * 3]!,
        patch.normals[index * 3 + 1]!,
        patch.normals[index * 3 + 2]!
      );
      return normal.dot(vertex(patch, index).normalize());
    };

    // Au sommet de bord, la pente CENTRÉE vaut celle d'un sommet intérieur de même abscisse
    // dans un relief quadratique : la couronne est ce qui la rend calculable.
    // Le relief employé est un paraboloïde dont le SOMMET tombe sur le bord ouest : la pente
    // centrée y est donc nulle et la normale exactement radiale. C'est ce que la couronne
    // donne, et c'est ce qu'une différence unilatérale ne peut pas donner.
    const withApron = tiltAt(curved, 0, 2);
    const withoutApron = tiltAt(clamped, 0, 2);
    expect(withApron).toBeCloseTo(1, 7);
    expect(withoutApron).toBeLessThan(0.9999);
  });
});

describe('jupe d’un carreau', () => {
  const segments = 4;
  const patch = buildTilePatch({
    bounds: BOUNDS,
    radius: RADIUS,
    segments,
    heights: flatHeights(segments, 0),
    skirtDepth: 0.02,
  });

  it('ajoute une couronne de sommets sous le bord', () => {
    const surface = (segments + 1) ** 2;
    const total = patch.positions.length / 3;
    expect(total - surface).toBe(4 * segments);
    for (let i = surface; i < total; i += 1)
      expect(vertex(patch, i).length()).toBeCloseTo(RADIUS - 0.02, 6);
  });

  it('tourne ses triangles vers l’extérieur', () => {
    // Une jupe retournée est invisible de face : elle laisse simplement voir la sphère à
    // travers, ce qui ressemble à un trou dans le sol et non à une erreur d'orientation.
    const surface = (segments + 1) ** 2;
    const centre = new THREE.Vector3();
    for (let i = 0; i < surface; i += 1) centre.add(vertex(patch, i));
    centre.divideScalar(surface);

    let checked = 0;
    for (let i = 0; i < patch.indices.length; i += 3) {
      const a = patch.indices[i]!;
      const b = patch.indices[i + 1]!;
      const c = patch.indices[i + 2]!;
      if (a < surface && b < surface && c < surface) continue;
      const pa = vertex(patch, a);
      const normal = vertex(patch, b)
        .sub(pa)
        .cross(vertex(patch, c).sub(pa))
        .normalize();
      expect(normal.dot(pa.clone().sub(centre).normalize())).toBeGreaterThan(0);
      checked += 1;
    }
    expect(checked).toBe(2 * 4 * segments);
  });
});

describe('carreau polaire', () => {
  it('n’émet pas le triangle dégénéré du pôle', () => {
    const polar = buildTilePatch({
      bounds: tileBounds({ level: 4, row: 0, column: 0 }),
      radius: RADIUS,
      segments: 4,
    });
    const ordinary = buildTilePatch({
      bounds: BOUNDS,
      radius: RADIUS,
      segments: 4,
    });
    // Une ligne de quadrilatères perd un triangle sur deux au pôle : même règle que
    // `THREE.SphereGeometry`, qui omet le triangle dont deux sommets sont confondus.
    expect(polar.indices.length).toBe(ordinary.indices.length - 4 * 3);
  });
});
