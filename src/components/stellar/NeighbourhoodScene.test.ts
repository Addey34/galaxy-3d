import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GAIA_ENABLED } from '../../../scripts/generate-neighbours.mjs';
import type { NeighbourFile } from '@/core/neighbours';
import { auToParsecs, ECLIPTIC_RINGS_AU } from '@/core/scaleTransition';
import { distanceFromSunPc } from '@/core/stellarSpace';
import { NeighbourhoodScene, spectralColour } from './NeighbourhoodScene';

const file = JSON.parse(
  readFileSync('public/assets/sky/neighbours.json', 'utf8')
) as NeighbourFile;

/** Chaque géométrie et chaque matériau du graphe de la scène, avec son compteur de `dispose`. */
function trackDisposals(scene: NeighbourhoodScene): {
  total: number;
  disposed: () => number;
} {
  const resources = new Set<THREE.BufferGeometry | THREE.Material>();
  scene.scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) resources.add(mesh.geometry);
    const material = mesh.material as THREE.Material | THREE.Material[];
    if (material)
      for (const m of Array.isArray(material) ? material : [material])
        resources.add(m);
  });
  let count = 0;
  for (const r of resources) r.addEventListener('dispose', () => (count += 1));
  return { total: resources.size, disposed: () => count };
}

describe('la scène du voisinage solaire', () => {
  it('place un point par système (48 repères pour 61 étoiles, 49 avec HYG seul), le Soleil à l’origine', () => {
    const scene = new NeighbourhoodScene(file.stars);
    expect(file.count).toBe(61);
    expect(scene.systems).toHaveLength(GAIA_ENABLED ? 48 : 49);
    const sun = scene.scene.getObjectByName('sun') as THREE.Points;
    const sunPosition = sun.geometry.getAttribute('position');
    expect([
      sunPosition.getX(0),
      sunPosition.getY(0),
      sunPosition.getZ(0),
    ]).toEqual([0, 0, 0]);
    scene.dispose();
  });

  it('chaque étoile est à sa distance publiée du Soleil, en parsecs, sans aucun autre facteur', () => {
    const scene = new NeighbourhoodScene(file.stars);
    scene.systems.forEach((system, i) => {
      const primary = system.members.reduce((a, b) => (b[7] < a[7] ? b : a));
      expect(distanceFromSunPc(scene.positionOf(i)), primary[0]).toBeCloseTo(
        primary[5],
        4
      );
    });
    scene.dispose();
  });

  it('ses cercles d’échelle valent 1 pc, 2 pc… dans le plan galactique (Y = 0)', () => {
    const scene = new NeighbourhoodScene(file.stars);
    const rings = scene.scene.children.filter(
      (c) => c instanceof THREE.LineLoop && c.name !== 'ecliptic-ring'
    ) as THREE.LineLoop[];
    expect(rings.length).toBeGreaterThanOrEqual(5);
    rings.forEach((ring, i) => {
      const p = ring.geometry.getAttribute('position');
      for (let k = 0; k < p.count; k += 20) {
        expect(p.getY(k)).toBe(0);
        expect(Math.hypot(p.getX(k), p.getZ(k))).toBeCloseTo(i + 1, 6);
      }
    });
    scene.dispose();
  });

  it('le temps déplace les étoiles en ligne droite : Barnard se rapproche en 3 000 ans', () => {
    const scene = new NeighbourhoodScene(file.stars);
    const i = scene.systems.findIndex((s) =>
      s.members.some((m) => m[0] === "Barnard's Star")
    );
    const now = distanceFromSunPc(scene.positionOf(i));
    scene.setYears(3000);
    expect(distanceFromSunPc(scene.positionOf(i))).toBeLessThan(now);
    scene.setYears(0);
    expect(distanceFromSunPc(scene.positionOf(i))).toBeCloseTo(now, 9);
    scene.dispose();
  });

  it('sélectionne et retrouve une étoile par sa position à l’écran (clic, tap)', () => {
    const scene = new NeighbourhoodScene(file.stars, 1.6);
    scene.camera.position.set(8, 5, 7);
    scene.camera.lookAt(0, 0, 0);
    scene.camera.updateMatrixWorld();
    const target = scene.systems.findIndex((s) =>
      s.members.some((m) => m[0] === 'Proxima Centauri')
    );
    const screen = scene.project(target, 1280, 800)!;
    expect(scene.pick(screen.x, screen.y, 1280, 800, 22)).toBe(target);
    // Le point exact de l'étoile gagne sur une voisine proche (α Cen est à 0,07 pc) ; loin de toute étoile : rien.
    expect(scene.pick(2, 2, 1280, 800, 4)).toBe(-1);
    scene.setSelected(target);
    expect(scene.selectedIndex).toBe(target);
    scene.dispose();
  });

  it('pose les cercles de l’écliptique (1 UA à 100 000 UA) dans le plan incliné de 60,2° sur la Galaxie', () => {
    const scene = new NeighbourhoodScene(file.stars);
    const rings = scene.scene.children.filter(
      (c) => c.name === 'ecliptic-ring'
    ) as THREE.LineLoop[];
    expect(rings).toHaveLength(ECLIPTIC_RINGS_AU.length);
    rings.forEach((ring, i) => {
      const radius = auToParsecs(ECLIPTIC_RINGS_AU[i]!);
      const p = ring.geometry.getAttribute('position');
      let top = 0;
      for (let k = 0; k < p.count; k++) {
        // Float32 : 1e-7 de précision relative.
        expect(
          Math.hypot(p.getX(k), p.getY(k), p.getZ(k)) / radius
        ).toBeCloseTo(1, 5);
        top = Math.max(top, p.getY(k));
      }
      expect(top / radius).toBeCloseTo(Math.sin((60.19 * Math.PI) / 180), 2);
    });
    expect(scene.eclipticAnchors.map((a) => a.au)).toEqual([
      ...ECLIPTIC_RINGS_AU,
    ]);
    scene.dispose();
  });

  it('les plans de découpe suivent la distance : le Soleil à 70 UA n’est pas coupé par le plan proche', () => {
    const scene = new NeighbourhoodScene(file.stars);
    scene.fitClipping(auToParsecs(70));
    expect(scene.camera.near).toBeLessThan(auToParsecs(70) / 100);
    scene.fitClipping(30);
    expect(scene.camera.near).toBe(0.02);
    scene.dispose();
  });

  it('les repères du plan galactique se cachent en UA ; les étoiles et les cercles de l’écliptique restent', () => {
    const scene = new NeighbourhoodScene(file.stars);
    const hidden = (): string[] =>
      scene.scene.children
        .filter((c) => !c.visible)
        .map((c) => c.type + ':' + c.name);
    // La sélection et le trait de distance sont cachés tant que rien n'est choisi.
    const baseline = hidden();
    scene.setGuidesVisible(false);
    const off = scene.scene.children.filter((c) => !c.visible);
    // 5+ cercles de parsecs, l'axe, les traits vers le plan : cachés ; étoiles, Soleil, écliptique : visibles.
    expect(off.length).toBeGreaterThanOrEqual(baseline.length + 7);
    expect(
      scene.scene.children.filter(
        (c) => c.name === 'ecliptic-ring' && !c.visible
      )
    ).toHaveLength(0);
    expect(scene.scene.getObjectByName('sun')!.visible).toBe(true);
    scene.setGuidesVisible(true);
    expect(hidden()).toEqual(baseline);
    scene.dispose();
  });

  it('libère TOUTES ses ressources GPU (géométries et matériaux), une fois', () => {
    const scene = new NeighbourhoodScene(file.stars);
    const tracker = trackDisposals(scene);
    expect(tracker.total).toBeGreaterThan(10);
    scene.dispose();
    expect(tracker.disposed()).toBe(tracker.total);
    expect(scene.scene.children).toHaveLength(0);
  });

  it('couleur indicative du type spectral ; blanc si inconnu', () => {
    expect(spectralColour('M5Ve')[0]).toBe(1);
    expect(spectralColour('M5Ve')[2]).toBeLessThan(0.5);
    expect(spectralColour('G2V')[2]).toBeLessThan(0.7);
    expect(spectralColour('DA2')).toEqual(spectralColour('D'));
    expect(spectralColour('sdM4')).toEqual(spectralColour('M4'));
    expect(spectralColour(null)).toEqual([1, 1, 1]);
  });
});
