import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyRealCloudsMap, applyTexture } from './celestialTextures';
import { isNeutralAlphaMap, neutralAlphaMap } from './neutralAlphaMap';

describe('neutralAlphaMap', () => {
  it('est blanche : le canal vert, que Three.js lit, vaut 1 (a × 1)', () => {
    const texture = neutralAlphaMap();
    const data = texture.image.data as Uint8Array;
    expect(texture.image.width).toBe(1);
    expect(texture.image.height).toBe(1);
    expect(data[1]).toBe(255);
    expect(Array.from(data)).toEqual([255, 255, 255, 255]);
  });

  it('est UNIQUE : une seule instance pour tout le processus, reconnue par `isNeutralAlphaMap`', () => {
    expect(neutralAlphaMap()).toBe(neutralAlphaMap());
    expect(isNeutralAlphaMap(neutralAlphaMap())).toBe(true);
    expect(isNeutralAlphaMap(new THREE.Texture())).toBe(false);
    expect(isNeutralAlphaMap(null)).toBe(false);
  });

  it("ne peut pas être libérée par un consommateur qui n'en est pas propriétaire", () => {
    const texture = neutralAlphaMap();
    let disposed = 0;
    texture.addEventListener('dispose', () => (disposed += 1));
    texture.dispose();
    texture.dispose();
    expect(disposed).toBe(0);
    expect(neutralAlphaMap()).toBe(texture);
  });

  it('garde les réglages qui entrent dans la clé de programme (canal d’UV et matrice identité)', () => {
    const texture = neutralAlphaMap();
    expect(texture.channel).toBe(0);
    expect(texture.matrix.equals(new THREE.Matrix3())).toBe(true);
    expect(texture.colorSpace).toBe(THREE.NoColorSpace);
  });
});

describe('continuité du programme des nuages (statique → observation → statique)', () => {
  /** Ce que la map et de l'alphaMap qui définit `USE_MAP` / `USE_ALPHAMAP` et leur canal d'UV. */
  const signature = (m: THREE.MeshStandardMaterial) => ({
    map: m.map !== null,
    alphaMap: m.alphaMap !== null,
    alphaChannel: m.alphaMap?.channel ?? null,
  });

  function cloudsLayers() {
    const material = new THREE.MeshStandardMaterial();
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    return { layers: new Map([['clouds', mesh]]), material };
  }

  it("garde `USE_ALPHAMAP` quand l'observation remplace la carte statique", () => {
    const { layers, material } = cloudsLayers();
    applyTexture(layers, 'clouds', new THREE.Texture());
    const statique = signature(material);
    expect(statique).toEqual({ map: true, alphaMap: true, alphaChannel: 0 });

    applyRealCloudsMap(material, new THREE.Texture());
    expect(signature(material)).toEqual(statique);
    expect(isNeutralAlphaMap(material.alphaMap)).toBe(true);
  });

  it('le retour à la carte statique rend la texture statique, pas la neutre', () => {
    const { layers, material } = cloudsLayers();
    applyRealCloudsMap(material, new THREE.Texture());
    const statique = new THREE.Texture();
    applyTexture(layers, 'clouds', statique);
    expect(material.alphaMap).toBe(statique);
    expect(isNeutralAlphaMap(material.alphaMap)).toBe(false);
  });

  it('deux matériaux partagent la même texture neutre sans se la disputer', () => {
    const a = new THREE.MeshStandardMaterial();
    const b = new THREE.MeshStandardMaterial();
    applyRealCloudsMap(a, new THREE.Texture());
    applyRealCloudsMap(b, new THREE.Texture());
    expect(a.alphaMap).toBe(b.alphaMap);
    a.dispose();
    expect(b.alphaMap).toBe(neutralAlphaMap());
  });
});
