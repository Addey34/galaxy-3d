import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CraftScene } from './CraftScene';

/**
 * La scène d'inspection d'un engin : cadrage, pièces éclairées, et surtout LIBÉRATION. Fermer
 * l'inspection doit rendre toute la mémoire GPU qu'elle a prise (géométries, matériaux, textures,
 * y compris les matériaux clonés pour éclairer une pièce).
 */
function craft(): {
  root: THREE.Group;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  texture: THREE.Texture;
} {
  const geometry = new THREE.BoxGeometry(40, 2, 2);
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture });
  const arm = new THREE.Mesh(geometry, material);
  arm.name = 'arm';
  const root = new THREE.Group();
  root.add(arm);
  return { root, geometry, material, texture };
}

describe('CraftScene', () => {
  it('ramène un modèle de n’importe quelle unité à une sphère englobante de rayon 1, centrée', () => {
    const scene = new CraftScene(1.6);
    const { root } = craft();
    root.position.set(100, -50, 7);
    scene.useModel(root);
    const box = new THREE.Box3().setFromObject(scene.scene.children.at(-1)!);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    expect(sphere.radius).toBeCloseTo(1, 5);
    expect(sphere.center.length()).toBeLessThan(1e-6);
  });

  it('refuse un fichier sans maillage au lieu de montrer une scène vide', () => {
    expect(() => new CraftScene(1).useModel(new THREE.Group())).toThrow(
      /sans maillage/
    );
  });

  it('libère géométries, matériaux et textures à la fermeture, et deux fois est sans effet', () => {
    const scene = new CraftScene(1);
    const { root, geometry, material, texture } = craft();
    scene.useModel(root);
    const events = { geometry: vi.fn(), material: vi.fn(), texture: vi.fn() };
    geometry.addEventListener('dispose', events.geometry);
    material.addEventListener('dispose', events.material);
    texture.addEventListener('dispose', events.texture);
    scene.dispose();
    scene.dispose();
    expect(events.geometry).toHaveBeenCalledTimes(1);
    expect(events.material).toHaveBeenCalledTimes(1);
    expect(events.texture).toHaveBeenCalledTimes(1);
    expect(scene.scene.children.some((c) => c.type === 'Group')).toBe(false);
  });

  it('éclairer une pièce clone le matériau, le rend à l’extinction et libère le clone', () => {
    const scene = new CraftScene(1);
    const { root, material } = craft();
    scene.useModel(root);
    const mesh = root.getObjectByName('arm') as THREE.Mesh;
    scene.highlight(['arm']);
    const lit = mesh.material as THREE.MeshStandardMaterial;
    expect(lit).not.toBe(material);
    expect(lit.emissiveIntensity).toBeGreaterThan(0);
    const disposeClone = vi.fn();
    lit.addEventListener('dispose', disposeClone);
    scene.highlight(null);
    expect(mesh.material).toBe(material);
    expect(disposeClone).toHaveBeenCalledTimes(1);
    // Un nom absent n'éclaire rien et ne lève pas.
    expect(() => scene.highlight(['absent'])).not.toThrow();
    expect(mesh.material).toBe(material);
  });

  it('compte les triangles réellement présents', () => {
    const scene = new CraftScene(1);
    scene.useModel(craft().root);
    expect(scene.triangleCount()).toBe(12);
  });
});
