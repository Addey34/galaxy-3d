import * as THREE from 'three';

/**
 * LE LECTEUR DES MODÈLES DE FORME (GAL-ENGINE-CAPACITY-002).
 *
 * Les modèles de forme des corps irréguliers (`public/assets/models/<corps>/*_shape_*.glb`) n'utilisent
 * qu'un sous-ensemble minuscule de glTF : un nœud, un maillage, une primitive en triangles, des positions
 * et des normales en flottants (et des UV pour trois fichiers), des indices, un matériau à simples
 * facteurs. Aucun ne porte d'extension, de texture ni de transformation de nœud (relevé sur les 58 fichiers
 * livrés le 2026-11-25). Le chargeur glTF complet de three (44 729 octets) partait donc au démarrage de
 * toute adresse de corps modélisé pour lire ces quelques champs.
 *
 * Ce lecteur lit EXACTEMENT ce sous-ensemble et produit ce que le chargeur complet produit pour lui (même
 * scène, mêmes attributs, même matériau : comparé fichier par fichier dans `shapeGlb.test.ts`). Tout ce qui
 * sort du sous-ensemble lève `UnsupportedGlb`, et l'appelant repasse alors par le chargeur complet : un
 * futur modèle plus riche ne casse rien, il coûte seulement les octets de ce chargeur.
 */
export class UnsupportedGlb extends Error {}

interface Accessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  normalized?: boolean;
  sparse?: unknown;
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3 };

function fail(why: string): never {
  throw new UnsupportedGlb(why);
}

/** Lit un GLB du sous-ensemble des modèles de forme ; lève `UnsupportedGlb` pour tout le reste. */
export function parseShapeGlb(data: ArrayBuffer): { scene: THREE.Group } {
  const view = new DataView(data);
  if (data.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67)
    fail('pas un GLB');
  if (view.getUint32(4, true) !== 2) fail('version glTF');
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a) fail('premier bloc non JSON');
  const json = JSON.parse(
    new TextDecoder().decode(new Uint8Array(data, 20, jsonLength))
  ) as {
    extensionsUsed?: unknown[];
    nodes?: Array<Record<string, unknown>>;
    meshes?: Array<{
      primitives: Array<{
        attributes: Record<string, number>;
        indices?: number;
        material?: number;
        mode?: number;
        targets?: unknown;
        extensions?: unknown;
      }>;
    }>;
    accessors: Accessor[];
    bufferViews: Array<{
      byteOffset?: number;
      byteLength: number;
      byteStride?: number;
      buffer: number;
    }>;
    buffers: Array<{ uri?: string }>;
    materials?: Array<Record<string, unknown>>;
    scenes?: Array<{ nodes?: number[] }>;
  };
  if (json.extensionsUsed?.length) fail('extensions');
  const binStart = 20 + jsonLength;
  if (data.byteLength < binStart + 8) fail('pas de bloc binaire');
  const binLength = view.getUint32(binStart, true);
  if (view.getUint32(binStart + 4, true) !== 0x004e4942)
    fail('second bloc non BIN');
  const bin = binStart + 8;

  if (json.nodes?.length !== 1 || json.meshes?.length !== 1)
    fail('un seul nœud, un seul maillage');
  const node = json.nodes[0]!;
  if (Object.keys(node).some((k) => k !== 'mesh' && k !== 'name'))
    fail('transformation de nœud');
  if (node['mesh'] !== 0) fail('nœud sans maillage');
  const primitives = json.meshes[0]!.primitives;
  if (primitives.length !== 1) fail('une seule primitive');
  const primitive = primitives[0]!;
  if ((primitive.mode ?? 4) !== 4 || primitive.targets || primitive.extensions)
    fail('primitive hors triangles simples');
  if (json.buffers.length !== 1 || json.buffers[0]!.uri !== undefined)
    fail('tampon externe');

  const read = (index: number, expected: number[]): THREE.BufferAttribute => {
    const accessor = json.accessors[index];
    if (
      !accessor ||
      accessor.sparse ||
      accessor.normalized ||
      accessor.bufferView === undefined
    )
      fail('accesseur hors sous-ensemble');
    const itemSize = COMPONENTS[accessor.type];
    if (!itemSize || !expected.includes(accessor.componentType))
      fail('type d’accesseur');
    const bufferView = json.bufferViews[accessor.bufferView];
    if (!bufferView || bufferView.byteStride || bufferView.buffer !== 0)
      fail('vue entrelacée');
    const offset =
      bin + (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const length = accessor.count * itemSize;
    const end =
      offset +
      length *
        (accessor.componentType === 5126 || accessor.componentType === 5125
          ? 4
          : accessor.componentType === 5123
            ? 2
            : 1);
    if (end > bin + binLength) fail('accesseur hors du tampon');
    // Une COPIE alignée : un GLB n'aligne que sur 4 octets, et le tampon d'origine est rendu au ramasse-miettes.
    const slice = data.slice(offset, end);
    const array =
      accessor.componentType === 5126
        ? new Float32Array(slice)
        : accessor.componentType === 5125
          ? new Uint32Array(slice)
          : accessor.componentType === 5123
            ? new Uint16Array(slice)
            : new Uint8Array(slice);
    return new THREE.BufferAttribute(array, itemSize);
  };

  const attributes = primitive.attributes;
  const names = Object.keys(attributes).sort().join(',');
  if (names !== 'NORMAL,POSITION' && names !== 'NORMAL,POSITION,TEXCOORD_0')
    fail('attributs hors sous-ensemble');
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', read(attributes['POSITION']!, [5126]));
  geometry.setAttribute('normal', read(attributes['NORMAL']!, [5126]));
  if (attributes['TEXCOORD_0'] !== undefined)
    geometry.setAttribute('uv', read(attributes['TEXCOORD_0'], [5126]));
  if (primitive.indices !== undefined)
    geometry.setIndex(read(primitive.indices, [5121, 5123, 5125]));
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial();
  const source =
    primitive.material !== undefined
      ? json.materials?.[primitive.material]
      : undefined;
  if (source) {
    if (
      Object.keys(source).some(
        (k) => k !== 'name' && k !== 'pbrMetallicRoughness'
      )
    )
      fail('matériau hors sous-ensemble');
    const pbr = (source['pbrMetallicRoughness'] ?? {}) as {
      baseColorFactor?: number[];
      metallicFactor?: number;
      roughnessFactor?: number;
    };
    if (
      Object.keys(pbr).some(
        (k) =>
          !['baseColorFactor', 'metallicFactor', 'roughnessFactor'].includes(k)
      )
    )
      fail('texture de matériau');
    const [r = 1, g = 1, b = 1, a = 1] = pbr.baseColorFactor ?? [];
    // Comme le chargeur complet : les facteurs glTF sont en lumière linéaire.
    material.color.setRGB(r, g, b, THREE.LinearSRGBColorSpace);
    material.opacity = a;
    material.metalness = pbr.metallicFactor ?? 1;
    material.roughness = pbr.roughnessFactor ?? 1;
    material.name = typeof source['name'] === 'string' ? source['name'] : '';
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = typeof node['name'] === 'string' ? node['name'] : '';
  const scene = new THREE.Group();
  scene.add(mesh);
  return { scene };
}

/** Télécharge et lit un modèle de forme. */
export async function loadShapeGlb(
  url: string
): Promise<{ scene: THREE.Group }> {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`modèle ${response.status} : ${url}`);
  return parseShapeGlb(await response.arrayBuffer());
}
