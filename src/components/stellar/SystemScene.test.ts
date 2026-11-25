import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import type { SystemModel, SystemPlanetRow } from '@/core/exoplanetSystems';
import type { NeighbourRow } from '@/core/neighbours';
import { SystemScene } from './SystemScene';

/** Un système écrit à la main : une étoile au rayon publié, une bande, un cercle, un cercle en tirets, une sans orbite. */
function model(): SystemModel {
  const row = [
    'Test',
    '',
    'M5V',
    0,
    0,
    1.3,
    null,
    11,
    0,
    0,
    null,
    'hyg-v44',
    null,
  ] as unknown as NeighbourRow;
  const planet = (name: string): SystemPlanetRow =>
    [name] as unknown as SystemPlanetRow;
  const axis = (value: number) => ({ value, provenance: 'published' as const });
  return {
    name: 'Test',
    components: [
      {
        row,
        host: [
          'Test',
          0,
          0,
          1.3,
          1,
          4,
          null,
          null,
          null,
          0.14,
          0,
          0.12,
          0,
          [],
        ] as unknown as SystemModel['components'][number]['host'],
        offsetAu: [0, 0],
        separationAu: 0,
      },
    ],
    planets: [
      {
        row: planet('Test b'),
        component: 0,
        shape: {
          kind: 'band',
          axis: axis(0.1),
          eccentricity: axis(0.2),
          periastronAu: 0.08,
          apoastronAu: 0.12,
        },
      },
      {
        row: planet('Test c'),
        component: 0,
        shape: { kind: 'circle', axis: axis(0.3), eccentricity: axis(0) },
      },
      {
        row: planet('Test d'),
        component: 0,
        shape: { kind: 'axisOnly', axis: axis(0.5) },
      },
      { row: planet('Test e'), component: 0, shape: { kind: 'none' } },
    ],
    archiveStars: 1,
    missingHosts: [],
    spatial: true,
  };
}

function lookFaceOn(scene: SystemScene, distance: number): void {
  scene.setFraming(800, 800, 0, 0);
  scene.camera.position.set(0, 0, distance);
  scene.camera.lookAt(0, 0, 0);
  scene.fitClipping(distance);
  scene.camera.updateMatrixWorld();
}

describe('SystemScene', () => {
  it('dessine une orbite par planète représentable, aucune pour celle qui n’en a pas', () => {
    const scene = new SystemScene(model());
    expect(scene.drawnPlanets).toEqual([0, 1, 2]);
    expect(scene.labelAnchor(3)).toBeNull();
    // Le nom d'une orbite est SUR le cercle de son demi-grand axe.
    expect(scene.labelAnchor(1)!.length()).toBeCloseTo(0.3, 6);
  });

  it('un clic DANS une bande la choisit ; près d’un cercle, l’orbite la plus proche ; ailleurs, rien', () => {
    const scene = new SystemScene(model());
    lookFaceOn(scene, scene.distanceToFit(0.6));
    const at = (r: number) => {
      const s = scene.projectVector(new THREE.Vector3(r, 0, 0), 800, 800)!;
      return scene.pick(s.x, s.y, 800, 800, 10);
    };
    expect(at(0.1)).toEqual({ kind: 'planet', index: 0 });
    expect(at(0.3)).toEqual({ kind: 'planet', index: 1 });
    expect(at(0.5)).toEqual({ kind: 'planet', index: 2 });
    expect(at(0.4)).toBeNull();
    // L'étoile, au centre, passe avant les orbites.
    expect(at(0)).toEqual({ kind: 'star', index: 0 });
  });

  it('la mise en évidence estompe les autres orbites et se défait', () => {
    const scene = new SystemScene(model());
    const opacities = (): number[] => {
      const out: number[] = [];
      scene.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (
          m &&
          !(m instanceof THREE.ShaderMaterial) &&
          !(m instanceof THREE.MeshBasicMaterial && !m.transparent)
        )
          out.push(m.opacity);
      });
      return out;
    };
    const before = opacities();
    scene.setSelectedPlanet(1);
    expect(opacities()).not.toEqual(before);
    scene.setSelectedPlanet(-1);
    expect(opacities()).toEqual(before);
  });

  it('libère toutes ses géométries et tous ses matériaux, comparaison comprise', () => {
    const scene = new SystemScene(model());
    scene.setComparisonRings([
      { name: 'earth', au: 1 },
      { name: 'mars', au: 1.52 },
    ]);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    scene.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      if (mesh.material) materials.add(mesh.material as THREE.Material);
    });
    expect(geometries.size).toBeGreaterThan(5);
    let freedGeometries = 0;
    let freedMaterials = 0;
    for (const g of geometries)
      g.addEventListener('dispose', () => (freedGeometries += 1));
    for (const m of materials)
      m.addEventListener('dispose', () => (freedMaterials += 1));
    scene.dispose();
    expect(freedGeometries).toBe(geometries.size);
    expect(freedMaterials).toBe(materials.size);
    expect(scene.scene.children).toHaveLength(0);
  });
});
