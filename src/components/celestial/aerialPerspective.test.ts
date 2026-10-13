import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  addAerialPerspective,
  AERIAL_FRAGMENT_APPLY,
  AERIAL_VERTEX_MAIN,
  hasAerialPerspective,
} from './aerialPerspective';
import { attachSky } from './skyLayer';

const compile = (material: THREE.Material) => {
  const shader = {
    uniforms: {} as Record<string, THREE.IUniform>,
    vertexShader: '#include <common>\n#include <project_vertex>',
    fragmentShader:
      '#include <common>\n#include <opaque_fragment>\n#include <tonemapping_fragment>',
  } as unknown as Parameters<NonNullable<THREE.Material['onBeforeCompile']>>[0];
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
};

describe('aerial perspective', () => {
  it('scatters per vertex after projection, and applies before the tone curve', () => {
    const material = new THREE.MeshStandardMaterial();
    const uniforms = { uKmPerUnit: { value: 1 } };
    addAerialPerspective(material, uniforms);
    const shader = compile(material);
    expect(shader.vertexShader).toContain(
      '#include <project_vertex>\n' + AERIAL_VERTEX_MAIN
    );
    // Sur la radiance LINÉAIRE : après `opaque_fragment`, avant `tonemapping_fragment`.
    const f = shader.fragmentShader;
    expect(f.indexOf(AERIAL_FRAGMENT_APPLY)).toBeGreaterThan(
      f.indexOf('#include <opaque_fragment>')
    );
    expect(f.indexOf(AERIAL_FRAGMENT_APPLY)).toBeLessThan(
      f.indexOf('#include <tonemapping_fragment>')
    );
    // Les MÊMES objets d'uniforms que le ciel : il les met à jour, le sol les lit.
    expect(shader.uniforms['uKmPerUnit']).toBe(uniforms.uKmPerUnit);
    expect(material.customProgramCacheKey()).toMatch(/-aerial$/);
  });

  it('keeps the material’s own shader work, and is added once', () => {
    const material = new THREE.MeshStandardMaterial();
    let own = 0;
    material.onBeforeCompile = () => {
      own += 1;
    };
    addAerialPerspective(material, {});
    addAerialPerspective(material, {});
    const shader = compile(material);
    expect(own).toBe(1);
    expect(shader.vertexShader.split(AERIAL_VERTEX_MAIN)).toHaveLength(2);
  });
});

describe('the sky veils the ground it is attached to', () => {
  it('patches the body’s sphere, its tiles, and every tile created afterwards', () => {
    const group = new THREE.Group();
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.02),
      new THREE.MeshBasicMaterial()
    );
    const surface = new THREE.Mesh(
      new THREE.SphereGeometry(1),
      new THREE.MeshStandardMaterial()
    );
    surface.name = 'earth_surface';
    const tile = new THREE.Mesh(
      new THREE.PlaneGeometry(),
      new THREE.MeshStandardMaterial()
    );
    tile.name = 'tile_5_3_7';
    const clouds = new THREE.Mesh(
      new THREE.SphereGeometry(1.01),
      new THREE.MeshStandardMaterial()
    );
    clouds.name = 'earth_clouds';
    group.add(surface, tile, clouds, atmosphere);

    const body = {
      group,
      renderedRadius: () => 1,
      figureRatioToward: () => 1,
      sunWorld: new THREE.Vector3(1e6, 0, 0),
      createSurfaceOverlayMaterial: (): THREE.Material =>
        new THREE.MeshStandardMaterial(),
    };
    const original = body.createSurfaceOverlayMaterial;
    const binding = attachSky(body, 'bruneton-2017', 6371, atmosphere);

    expect(hasAerialPerspective(surface.material)).toBe(true);
    expect(hasAerialPerspective(tile.material)).toBe(true);
    // Les nuages ne sont pas du sol : ils ont leur propre physique.
    expect(hasAerialPerspective(clouds.material)).toBe(false);
    expect(hasAerialPerspective(body.createSurfaceOverlayMaterial())).toBe(
      true
    );

    binding.dispose();
    expect(body.createSurfaceOverlayMaterial).toBe(original);
    expect(hasAerialPerspective(body.createSurfaceOverlayMaterial())).toBe(
      false
    );
  });
});
