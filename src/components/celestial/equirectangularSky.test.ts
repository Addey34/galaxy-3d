import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createEquirectangularSky, skyLod } from './equirectangularSky';

/**
 * LE CIEL SANS CUBEMAP (lot 54). Une image posée en `scene.background` est convertie par Three.js en
 * une cubemap dont chaque face mesure la hauteur de l'image : ~512 Mio pour le ciel 8k, que la sonde
 * de performance ne voit pas. Ces gardes tiennent le ciel hors de ce chemin.
 */
describe('le fond de ciel équirectangulaire', () => {
  const texture = new THREE.Texture();
  const sky = createEquirectangularSky(texture);
  const material = sky.material as THREE.ShaderMaterial;

  it('se dessine en premier, sans profondeur, toujours, et ne se laisse pas viser', () => {
    expect(sky.renderOrder).toBe(-Infinity);
    expect(sky.frustumCulled).toBe(false);
    expect(material.depthTest).toBe(false);
    expect(material.depthWrite).toBe(false);
    const hits: THREE.Intersection[] = [];
    sky.raycast(new THREE.Raycaster(), hits);
    expect(hits).toHaveLength(0);
  });

  it('lit l’image elle-même, et suit l’intensité de fond de la scène', () => {
    expect(material.uniforms['map']!.value).toBe(texture);
    const scene = new THREE.Scene();
    scene.backgroundIntensity = 0.25;
    sky.onBeforeRender(
      {
        getDrawingBufferSize: (target: THREE.Vector2) => target.set(1280, 800),
      } as unknown as THREE.WebGLRenderer,
      scene,
      new THREE.PerspectiveCamera(),
      sky.geometry,
      material,
      new THREE.Group()
    );
    expect(material.uniforms['intensity']!.value).toBe(0.25);
  });

  it('choisit le niveau de mipmap où un texel couvre un pixel', () => {
    // Champ vertical de 90° : la matrice de projection porte 1 / tan(45°) = 1.
    const fov = Math.PI / 2;
    // L'écran juste aussi fin que l'image : niveau 0.
    const height = ((8192 / (2 * Math.PI)) * fov) / 1;
    expect(skyLod(8192, 1, height)).toBeCloseTo(0, 6);
    // Moitié moins de pixels : un niveau plus haut ; plus fin que l'image : jamais négatif.
    expect(skyLod(8192, 1, height / 2)).toBeCloseTo(1, 6);
    expect(skyLod(8192, 1, height * 4)).toBe(0);
    expect(skyLod(0, 1, 800)).toBe(0);
  });

  it('aucun module ne pose une image en scene.background (seule la restauration de GlowPass y écrit)', () => {
    const root = resolve(__dirname, '../..');
    const writers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.ts$/.test(entry) && !/\.test\.ts$/.test(entry)) {
          const text = readFileSync(path, 'utf-8');
          for (const m of text.matchAll(/scene\.background\s*=\s*([^;\n]+)/g))
            writers.push(`${entry}: ${m[1]!.trim()}`);
        }
      }
    };
    walk(root);
    expect(writers.sort()).toEqual([
      'GlowPass.ts: background',
      'GlowPass.ts: null',
    ]);
  });
});
