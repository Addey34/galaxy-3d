import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';

import { parseShapeGlb, UnsupportedGlb } from './shapeGlb';

/**
 * LE LECTEUR MINIMAL PRODUIT CE QUE PRODUIT LE CHARGEUR COMPLET, sur CHAQUE modèle de forme livré
 * (GAL-ENGINE-CAPACITY-002). Si un fichier change de structure, ou si le lecteur dérive, ce test le dit
 * fichier par fichier ; un modèle hors sous-ensemble (les sondes : Draco, WebP) doit être REFUSÉ, pour que
 * l'appelant repasse par le chargeur complet.
 */
const ROOT = join(process.cwd(), 'public/assets/models');
const shapeFiles = readdirSync(ROOT)
  .filter((dir) => dir !== 'craft')
  .flatMap((dir) =>
    readdirSync(join(ROOT, dir))
      .filter((file) => file.endsWith('.glb'))
      .map((file) => join(ROOT, dir, file))
  );

const bytes = (file: string): ArrayBuffer => {
  const buffer = readFileSync(file);
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
};

const meshesOf = (scene: THREE.Object3D): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  scene.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) out.push(child as THREE.Mesh);
  });
  return out;
};

function fullParse(data: ArrayBuffer): Promise<THREE.Object3D> {
  return new Promise((resolve, reject) =>
    new GLTFLoader().parse(data, '', (gltf) => resolve(gltf.scene), reject)
  );
}

describe('les modèles de forme livrés', () => {
  it('sont au moins cinquante (garde du relevé)', () => {
    expect(shapeFiles.length).toBeGreaterThanOrEqual(50);
  });

  it.each(
    shapeFiles.map((file) => [file.split(/[\\/]/).slice(-2).join('/'), file])
  )(
    '%s : même maillage et même matériau que le chargeur complet',
    async (_name, file) => {
      const data = bytes(file);
      const mine = meshesOf(parseShapeGlb(data).scene);
      const theirs = meshesOf(await fullParse(data));
      expect(mine).toHaveLength(theirs.length);
      expect(mine).toHaveLength(1);
      const [a, b] = [mine[0]!, theirs[0]!];
      expect(a.name).toBe(b.name);
      // Aucune transformation : le corps recentre et met à l'échelle à partir des sommets bruts.
      expect(b.matrix.equals(new THREE.Matrix4())).toBe(true);
      for (const attribute of ['position', 'normal', 'uv']) {
        const x = a.geometry.getAttribute(attribute);
        const y = b.geometry.getAttribute(attribute);
        expect(!!x, attribute).toBe(!!y);
        if (!x || !y) continue;
        expect(x.itemSize).toBe(y.itemSize);
        expect(Array.from(x.array as Float32Array)).toEqual(
          Array.from(y.array as Float32Array)
        );
      }
      expect(Array.from(a.geometry.index!.array)).toEqual(
        Array.from(b.geometry.index!.array)
      );
      const ma = a.material as THREE.MeshStandardMaterial;
      const mb = b.material as THREE.MeshStandardMaterial;
      expect(ma.type).toBe(mb.type);
      expect(ma.color.getHex()).toBe(mb.color.getHex());
      expect(ma.metalness).toBe(mb.metalness);
      expect(ma.roughness).toBe(mb.roughness);
      expect(ma.opacity).toBe(mb.opacity);
      expect(ma.transparent).toBe(mb.transparent);
      expect(ma.side).toBe(mb.side);
      expect(ma.name).toBe(mb.name);
    }
  );
});

describe('hors du sous-ensemble', () => {
  it('refuse un modèle de sonde (Draco, WebP) : le chargeur complet le lira', () => {
    const craft = readdirSync(join(ROOT, 'craft')).find((f) =>
      f.endsWith('.glb')
    );
    expect(craft).toBeDefined();
    expect(() => parseShapeGlb(bytes(join(ROOT, 'craft', craft!)))).toThrow(
      UnsupportedGlb
    );
  });

  it('refuse un nœud transformé, que le lecteur ne sait pas appliquer', () => {
    const data = new Uint8Array(bytes(shapeFiles[0]!));
    const view = new DataView(data.buffer);
    const length = view.getUint32(12, true);
    const json = JSON.parse(
      new TextDecoder().decode(data.subarray(20, 20 + length))
    );
    json.nodes[0].scale = [2, 2, 2];
    // Même longueur de bloc JSON, complété d'espaces : le reste du fichier ne bouge pas.
    let text = JSON.stringify(json);
    if (text.length > length) return; // pas la place : rien à prouver avec ce fichier
    text = text.padEnd(length, ' ');
    data.set(new TextEncoder().encode(text), 20);
    expect(() => parseShapeGlb(data.buffer)).toThrow(UnsupportedGlb);
  });

  it('refuse ce qui n’est pas un GLB', () => {
    expect(() => parseShapeGlb(new ArrayBuffer(8))).toThrow(UnsupportedGlb);
  });
});
