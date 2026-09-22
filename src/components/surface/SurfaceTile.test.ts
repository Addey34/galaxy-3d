import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { SurfaceTile } from './SurfaceTile';
import { geographicToLocalDirection } from '@/core/frames';
import { tileBounds, WMTS_EQUIRECTANGULAR_2x1 } from '@/core/tilePyramid';

/**
 * UN CARREAU EST POSÉ SUR LA MÊME SPHÈRE QUE LA SURFACE, À LA MÊME PARAMÉTRISATION.
 *
 * C'est la décision 1 du lot 9 : un carreau hérite du pôle IAU et de la phase de rotation
 * parce qu'il est un enfant du groupe qui tourne, et il n'a le droit de recalculer NI l'un
 * NI l'autre. Ce qui reste à prouver ici est la seule chose qu'il calcule lui-même : que
 * l'emprise géographique de sa tuile tombe exactement là où `frames.geographicToLocalDirection`
 * la place — la fonction MESURÉE au lot 8 contre quatre épicentres publiés de l'USGS.
 *
 * Une erreur de convention ne se voit pas : le carreau s'affiche, il est net, et il montre un
 * autre endroit du corps. C'est pour cela que ce test compare des sommets, pas une capture.
 */
describe('géométrie d’un carreau', () => {
  const RADIUS = 0.27;

  function tileFor(index: {
    level: number;
    row: number;
    column: number;
  }): SurfaceTile {
    return new SurfaceTile({
      index,
      radius: RADIUS,
      shape: WMTS_EQUIRECTANGULAR_2x1,
      material: new THREE.MeshBasicMaterial(),
    });
  }

  /** Sommets extrêmes de la géométrie, comme `SphereGeometry` les range. */
  function corners(tile: SurfaceTile): {
    first: THREE.Vector3;
    last: THREE.Vector3;
  } {
    const position = tile.mesh.geometry.getAttribute('position');
    return {
      first: new THREE.Vector3().fromBufferAttribute(position, 0),
      last: new THREE.Vector3().fromBufferAttribute(
        position,
        position.count - 1
      ),
    };
  }

  it.each([
    { level: 0, row: 0, column: 0 },
    { level: 3, row: 2, column: 11 },
    { level: 8, row: 98, column: 471 },
  ])(
    'place les coins de la tuile $level/$row/$column sur leur latitude et leur longitude',
    (index) => {
      const bounds = tileBounds(index, WMTS_EQUIRECTANGULAR_2x1);
      const { first, last } = corners(tileFor(index));

      // `SphereGeometry` commence au coin (phiStart, thetaStart) : ouest et NORD, ce qui est
      // exactement le coin haut-gauche d'une tuile WMTS. Le dernier sommet est le coin opposé.
      const northWest = geographicToLocalDirection(
        bounds.north,
        bounds.west
      ).multiplyScalar(RADIUS);
      const southEast = geographicToLocalDirection(
        bounds.south,
        bounds.east
      ).multiplyScalar(RADIUS);

      // 1e-6 unité sur un rayon de 0,27 : c'est la précision d'un `Float32Array`, où la
      // géométrie est rangée. Une erreur de CONVENTION, elle, se compterait en dixièmes
      // d'unité — un hémisphère entier de décalage —, donc ce seuil discrimine largement.
      expect(first.distanceTo(northWest)).toBeLessThan(1e-6);
      expect(last.distanceTo(southEast)).toBeLessThan(1e-6);
    }
  );

  it('couvre exactement l’emprise de sa tuile, sans déborder ni manquer', () => {
    const index = { level: 4, row: 5, column: 20 };
    const bounds = tileBounds(index, WMTS_EQUIRECTANGULAR_2x1);
    const position = tileFor(index).mesh.geometry.getAttribute('position');
    const vertex = new THREE.Vector3();
    let minLat = 90;
    let maxLat = -90;
    let minLon = 180;
    let maxLon = -180;
    for (let i = 0; i < position.count; i += 1) {
      vertex.fromBufferAttribute(position, i).normalize();
      const lat = Math.asin(vertex.y) * (180 / Math.PI);
      const lon =
        (((Math.atan2(vertex.z, -vertex.x) / (2 * Math.PI) + 1) % 1) - 0.5) *
        360;
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
    }
    // 4 décimales de degré, soit environ 3 mètres au sol sur la Lune : très en deçà d'un
    // carreau, et au-dessus du bruit d'un `Float32Array`.
    expect(minLat).toBeCloseTo(bounds.south, 4);
    expect(maxLat).toBeCloseTo(bounds.north, 4);
    expect(minLon).toBeCloseTo(bounds.west, 4);
    expect(maxLon).toBeCloseTo(bounds.east, 4);
  });

  it('reste invisible tant qu’aucune image n’est posée', () => {
    // Un carreau blanc au-dessus de la surface serait pire que l'absence de carreau.
    const tile = tileFor({ level: 5, row: 1, column: 1 });
    expect(tile.mesh.visible).toBe(false);
    tile.setTexture(new THREE.Texture());
    expect(tile.mesh.visible).toBe(true);
  });

  it('DÉPLACE ses sommets quand on lui donne des hauteurs, et retire le décalage de profondeur', () => {
    // Les deux moitiés de la même décision (lot 9, phase 9D) : un carreau qui porte du relief
    // n'est plus sur la sphère, donc il n'a plus à se disputer son plan de profondeur — et le
    // décalage, qui s'applique aussi à la jupe, dessinait une ligne sombre le long de chaque
    // carreau. Mesuré à l'écran, invisible à la relecture.
    const segments = 4;
    const apron = segments + 3;
    const heights = {
      values: new Float32Array(apron * apron).fill(0.01),
      segments,
    };
    const tile = new SurfaceTile({
      index: { level: 6, row: 30, column: 90 },
      radius: RADIUS,
      shape: WMTS_EQUIRECTANGULAR_2x1,
      material: new THREE.MeshBasicMaterial(),
      heights,
      skirtDepth: 0.002,
    });
    expect(tile.hasHeights).toBe(true);
    const position = tile.mesh.geometry.getAttribute('position');
    const vertex = new THREE.Vector3();
    let deepest = Number.POSITIVE_INFINITY;
    let highest = 0;
    for (let i = 0; i < position.count; i += 1) {
      vertex.fromBufferAttribute(position, i);
      deepest = Math.min(deepest, vertex.length());
      highest = Math.max(highest, vertex.length());
    }
    expect(highest).toBeCloseTo(RADIUS + 0.01, 6);
    // La jupe descend de la profondeur demandée, et de rien de plus : une jupe qui rejoindrait
    // la sphère livrée ferait des murs de dix kilomètres sous chaque carreau.
    expect(deepest).toBeCloseTo(RADIUS + 0.01 - 0.002, 6);
    expect((tile.mesh.material as THREE.Material).polygonOffset).toBe(false);
  });

  it('décale la PROFONDEUR, jamais la géométrie', () => {
    // Un décalage radial serait une altitude inventée, ce que l'invariant du lot interdit :
    // les sommets doivent rester exactement sur la sphère de rayon `radius`.
    const tile = tileFor({ level: 6, row: 30, column: 90 });
    const position = tile.mesh.geometry.getAttribute('position');
    const vertex = new THREE.Vector3();
    for (let i = 0; i < position.count; i += 1) {
      vertex.fromBufferAttribute(position, i);
      expect(vertex.length()).toBeCloseTo(RADIUS, 6);
    }
    const material = tile.mesh.material as THREE.Material;
    expect(material.polygonOffset).toBe(true);
    // Le niveau le plus fin doit gagner quand deux niveaux se recouvrent brièvement.
    expect(material.polygonOffsetUnits).toBeLessThan(-6);
  });
});
