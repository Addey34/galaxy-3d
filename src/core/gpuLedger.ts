/**
 * LE REGISTRE DES ALLOCATIONS DU PILOTE (lot 56) : ce que l'application DEMANDE à WebGL de tenir
 * en mémoire, appel par appel, et non ce que ses matériaux référencent.
 *
 * La sonde `?debug-perf` estimait la mémoire GPU en parcourant les textures ATTEINTES par les
 * matériaux de la scène. La cubemap du ciel (~512 Mio) lui a échappé jusqu'au 2026-10-18 : Three.js
 * la fabriquait lui-même, aucun matériau ne la nommait, et le relevé annonçait 528 Mio pour la
 * Terre en Explo quand le pilote en tenait plus du double. Ce registre compte à la source, depuis
 * les appels qui allouent (`texImage2D`, `texStorage2D`, `compressedTexImage2D`, `copyTexImage2D`,
 * `generateMipmap`, `renderbufferStorage*`, `bufferData`) et ceux qui libèrent (`delete*`).
 *
 * Pur et sans WebGL : les constantes sont les valeurs numériques de la spécification, et les
 * objets du pilote (`WebGLTexture`…) ne sont que des clés. L'accrochage au contexte vit dans
 * `ui/gpuLedgerHook.ts`.
 *
 * Ce qu'il ne compte pas, et le dit : le tampon de dessin du canevas (alloué par le navigateur, pas
 * par un appel), et les marges d'alignement du pilote. Ce sont les octets DEMANDÉS.
 */

/** Constantes WebGL utilisées ici (spécification WebGL 2, valeurs numériques). */
export const GL = {
  TEXTURE_2D: 0x0de1,
  TEXTURE_CUBE_MAP: 0x8513,
  TEXTURE_CUBE_MAP_POSITIVE_X: 0x8515,
  TEXTURE_CUBE_MAP_NEGATIVE_Z: 0x851a,
  TEXTURE_3D: 0x806f,
  TEXTURE_2D_ARRAY: 0x8c1a,
  TEXTURE0: 0x84c0,
} as const;

/** Octets par texel des formats internes DIMENSIONNÉS (WebGL 2, tableau 3.13 de ES 3.0). */
const SIZED: Record<number, number> = {
  0x8229: 1, // R8
  0x8f94: 1, // R8_SNORM
  0x8232: 1, // R8UI
  0x8231: 1, // R8I
  0x822d: 2, // R16F
  0x8234: 2, // R16UI
  0x8233: 2, // R16I
  0x822e: 4, // R32F
  0x8236: 4, // R32UI
  0x8235: 4, // R32I
  0x822b: 2, // RG8
  0x8f95: 2, // RG8_SNORM
  0x8238: 2, // RG8UI
  0x822f: 4, // RG16F
  0x8230: 8, // RG32F
  0x8051: 3, // RGB8
  0x8c41: 3, // SRGB8
  0x8d62: 2, // RGB565
  0x8c3a: 4, // R11F_G11F_B10F
  0x8c3d: 4, // RGB9_E5
  0x881b: 6, // RGB16F
  0x8815: 12, // RGB32F
  0x8058: 4, // RGBA8
  0x8c43: 4, // SRGB8_ALPHA8
  0x8f97: 4, // RGBA8_SNORM
  0x8056: 2, // RGBA4
  0x8057: 2, // RGB5_A1
  0x8059: 4, // RGB10_A2
  0x881a: 8, // RGBA16F
  0x8814: 16, // RGBA32F
  0x8d7c: 4, // RGBA8UI
  0x81a5: 2, // DEPTH_COMPONENT16
  0x81a6: 4, // DEPTH_COMPONENT24 (stocké sur 32 bits)
  0x8cac: 4, // DEPTH_COMPONENT32F
  0x88f0: 4, // DEPTH24_STENCIL8
  0x8cad: 8, // DEPTH32F_STENCIL8
  0x8d48: 1, // STENCIL_INDEX8
};

/** Composantes d'un format NON dimensionné (`RGBA`, `RGB`, `LUMINANCE`…). */
const UNSIZED_CHANNELS: Record<number, number> = {
  0x1908: 4, // RGBA
  0x1907: 3, // RGB
  0x190a: 2, // LUMINANCE_ALPHA
  0x1909: 1, // LUMINANCE
  0x1906: 1, // ALPHA
  0x1902: 1, // DEPTH_COMPONENT
  0x84f9: 2, // DEPTH_STENCIL
};

/** Octets par composante d'un type, ou par texel entier pour les types empaquetés. */
function typeBytes(type: number, channels: number): number {
  switch (type) {
    case 0x1406: // FLOAT
    case 0x1405: // UNSIGNED_INT
    case 0x1404: // INT
      return 4 * channels;
    case 0x140b: // HALF_FLOAT
    case 0x8d61: // HALF_FLOAT_OES
    case 0x1403: // UNSIGNED_SHORT
    case 0x1402: // SHORT
      return 2 * channels;
    case 0x8363: // UNSIGNED_SHORT_5_6_5
    case 0x8033: // UNSIGNED_SHORT_4_4_4_4
    case 0x8034: // UNSIGNED_SHORT_5_5_5_1
      return 2;
    case 0x84fa: // UNSIGNED_INT_24_8
    case 0x8368: // UNSIGNED_INT_2_10_10_10_REV
    case 0x8c3b: // UNSIGNED_INT_10F_11F_11F_REV
    case 0x8c3e: // UNSIGNED_INT_5_9_9_9_REV
      return 4;
    default:
      return channels; // UNSIGNED_BYTE, BYTE
  }
}

/**
 * Octets par texel d'un format interne. Un format dimensionné porte sa taille ; un format non
 * dimensionné la tire de son type. Un format inconnu rend 4 (le cas RGBA8), et `unknownFormats`
 * du registre le NOMME, pour qu'un octet deviné ne passe pas pour un octet compté.
 */
export function bytesPerTexel(
  internalformat: number,
  type?: number
): number | null {
  const sized = SIZED[internalformat];
  if (sized !== undefined) return sized;
  const channels = UNSIZED_CHANNELS[internalformat];
  if (channels !== undefined) return typeBytes(type ?? 0x1401, channels);
  return null;
}

const isCubeFace = (target: number): boolean =>
  target >= GL.TEXTURE_CUBE_MAP_POSITIVE_X &&
  target <= GL.TEXTURE_CUBE_MAP_NEGATIVE_Z;

/** La cible de LIAISON d'une cible d'allocation (une face de cubemap se lie en cubemap). */
const bindTarget = (target: number): number =>
  isCubeFace(target) ? GL.TEXTURE_CUBE_MAP : target;

interface TextureRecord {
  /** Cible de liaison : TEXTURE_2D, TEXTURE_CUBE_MAP, TEXTURE_3D, TEXTURE_2D_ARRAY. */
  target: number;
  /** Octets par face et par niveau, clé `face:niveau` : un re-téléversement REMPLACE. */
  levels: Map<
    string,
    {
      width: number;
      height: number;
      depth: number;
      bytes: number;
      texel: number;
    }
  >;
}

/** Une ligne du relevé : un objet du pilote et ce qu'il tient. */
export interface LedgerEntry<K> {
  key: K;
  kind: 'texture' | 'renderbuffer' | 'buffer';
  target: number;
  width: number;
  height: number;
  bytes: number;
}

export interface LedgerTotals {
  textures: {
    live: number;
    bytes: number;
    cubeBytes: number;
    cubeFaces: number;
  };
  renderbuffers: { live: number; bytes: number };
  buffers: { live: number; bytes: number };
  total: number;
  /** Formats internes rencontrés sans taille connue, comptés comme 4 octets par texel. */
  unknownFormats: number[];
}

/**
 * Le registre d'UN contexte. Les clés (`K`) sont les objets du pilote ; il ne les déréférence
 * jamais, donc un test lui passe de simples objets.
 */
export class GpuLedger<K extends object = object> {
  private readonly textures = new Map<K, TextureRecord>();
  private readonly renderbuffers = new Map<
    K,
    { width: number; height: number; bytes: number }
  >();
  private readonly buffers = new Map<K, number>();
  private readonly unknown = new Set<number>();
  private unit = 0;
  /** Texture liée, par unité puis par cible de liaison. */
  private readonly bound = new Map<string, K>();
  private boundRenderbuffer: K | null = null;
  private readonly boundBuffers = new Map<number, K>();

  activeTexture(unit: number): void {
    this.unit = unit - GL.TEXTURE0;
  }

  bindTexture(target: number, texture: K | null): void {
    const key = `${this.unit}:${target}`;
    if (texture) this.bound.set(key, texture);
    else this.bound.delete(key);
  }

  private current(target: number): TextureRecord | null {
    const texture = this.bound.get(`${this.unit}:${bindTarget(target)}`);
    if (!texture) return null;
    let record = this.textures.get(texture);
    if (!record) {
      record = { target: bindTarget(target), levels: new Map() };
      this.textures.set(texture, record);
    }
    return record;
  }

  private texel(internalformat: number, type?: number): number {
    const bytes = bytesPerTexel(internalformat, type);
    if (bytes !== null) return bytes;
    this.unknown.add(internalformat);
    return 4;
  }

  /** Un niveau d'une face (ou de la seule face d'une texture 2D) prend `width × height × depth`. */
  texImage(
    target: number,
    level: number,
    internalformat: number,
    width: number,
    height: number,
    depth = 1,
    type?: number
  ): void {
    const record = this.current(target);
    if (!record) return;
    const face = isCubeFace(target)
      ? target - GL.TEXTURE_CUBE_MAP_POSITIVE_X
      : 0;
    const texel = this.texel(internalformat, type);
    record.levels.set(`${face}:${level}`, {
      width,
      height,
      depth,
      texel,
      bytes: width * height * depth * texel,
    });
  }

  /** `compressedTexImage2D` : la taille est celle des données, pas un produit. */
  compressedTexImage(
    target: number,
    level: number,
    width: number,
    height: number,
    bytes: number
  ): void {
    const record = this.current(target);
    if (!record) return;
    const face = isCubeFace(target)
      ? target - GL.TEXTURE_CUBE_MAP_POSITIVE_X
      : 0;
    record.levels.set(`${face}:${level}`, {
      width,
      height,
      depth: 1,
      texel: 0,
      bytes,
    });
  }

  /** `texStorage2D/3D` : TOUS les niveaux d'un coup, et les six faces d'une cubemap. */
  texStorage(
    target: number,
    levels: number,
    internalformat: number,
    width: number,
    height: number,
    depth = 1
  ): void {
    const record = this.current(target);
    if (!record) return;
    record.levels.clear();
    const faces = target === GL.TEXTURE_CUBE_MAP ? 6 : 1;
    const texel = this.texel(internalformat);
    const layered = target === GL.TEXTURE_2D_ARRAY;
    for (let face = 0; face < faces; face += 1)
      for (let level = 0; level < levels; level += 1) {
        const w = Math.max(1, width >> level);
        const h = Math.max(1, height >> level);
        const d = layered ? depth : Math.max(1, depth >> level);
        record.levels.set(`${face}:${level}`, {
          width: w,
          height: h,
          depth: d,
          texel,
          bytes: w * h * d * texel,
        });
      }
  }

  /** `generateMipmap` : la chaîne entière sous le niveau 0 de chaque face. */
  generateMipmap(target: number): void {
    const record = this.current(target);
    if (!record) return;
    const faces = record.target === GL.TEXTURE_CUBE_MAP ? 6 : 1;
    const layered = record.target === GL.TEXTURE_2D_ARRAY;
    for (let face = 0; face < faces; face += 1) {
      const base = record.levels.get(`${face}:0`);
      if (!base || base.texel === 0) continue;
      let { width, height, depth } = base;
      for (
        let level = 1;
        width > 1 || height > 1 || (!layered && depth > 1);
        level += 1
      ) {
        width = Math.max(1, width >> 1);
        height = Math.max(1, height >> 1);
        if (!layered) depth = Math.max(1, depth >> 1);
        record.levels.set(`${face}:${level}`, {
          width,
          height,
          depth,
          texel: base.texel,
          bytes: width * height * depth * base.texel,
        });
      }
    }
  }

  deleteTexture(texture: K | null): void {
    if (!texture) return;
    this.textures.delete(texture);
    for (const [key, value] of this.bound)
      if (value === texture) this.bound.delete(key);
  }

  bindRenderbuffer(renderbuffer: K | null): void {
    this.boundRenderbuffer = renderbuffer;
  }

  renderbufferStorage(
    samples: number,
    internalformat: number,
    width: number,
    height: number
  ): void {
    if (!this.boundRenderbuffer) return;
    this.renderbuffers.set(this.boundRenderbuffer, {
      width,
      height,
      bytes: width * height * Math.max(1, samples) * this.texel(internalformat),
    });
  }

  deleteRenderbuffer(renderbuffer: K | null): void {
    if (!renderbuffer) return;
    this.renderbuffers.delete(renderbuffer);
    if (this.boundRenderbuffer === renderbuffer) this.boundRenderbuffer = null;
  }

  bindBuffer(target: number, buffer: K | null): void {
    if (buffer) this.boundBuffers.set(target, buffer);
    else this.boundBuffers.delete(target);
  }

  bufferData(target: number, bytes: number): void {
    const buffer = this.boundBuffers.get(target);
    if (buffer) this.buffers.set(buffer, bytes);
  }

  deleteBuffer(buffer: K | null): void {
    if (!buffer) return;
    this.buffers.delete(buffer);
    for (const [target, value] of this.boundBuffers)
      if (value === buffer) this.boundBuffers.delete(target);
  }

  /** Octets d'une texture du pilote, ou `null` si le registre ne la connaît pas. */
  textureBytes(texture: K): number | null {
    const record = this.textures.get(texture);
    if (!record) return null;
    let bytes = 0;
    for (const level of record.levels.values()) bytes += level.bytes;
    return bytes;
  }

  entries(): LedgerEntry<K>[] {
    const out: LedgerEntry<K>[] = [];
    for (const [key, record] of this.textures) {
      let bytes = 0;
      for (const level of record.levels.values()) bytes += level.bytes;
      const base = record.levels.get('0:0');
      out.push({
        key,
        kind: 'texture',
        target: record.target,
        width: base?.width ?? 0,
        height: base?.height ?? 0,
        bytes,
      });
    }
    for (const [key, rb] of this.renderbuffers)
      out.push({ key, kind: 'renderbuffer', target: 0, ...rb });
    for (const [key, bytes] of this.buffers)
      out.push({ key, kind: 'buffer', target: 0, width: 0, height: 0, bytes });
    return out;
  }

  totals(): LedgerTotals {
    let textureBytes = 0;
    let cubeBytes = 0;
    let cubeFaces = 0;
    for (const record of this.textures.values()) {
      let bytes = 0;
      const faces = new Set<string>();
      for (const [key, level] of record.levels) {
        bytes += level.bytes;
        faces.add(key.split(':')[0]!);
      }
      textureBytes += bytes;
      if (record.target === GL.TEXTURE_CUBE_MAP && bytes > 0) {
        cubeBytes += bytes;
        cubeFaces += faces.size;
      }
    }
    const renderbufferBytes = [...this.renderbuffers.values()].reduce(
      (sum, rb) => sum + rb.bytes,
      0
    );
    const bufferBytes = [...this.buffers.values()].reduce((a, b) => a + b, 0);
    return {
      textures: {
        live: this.textures.size,
        bytes: textureBytes,
        cubeBytes,
        cubeFaces,
      },
      renderbuffers: {
        live: this.renderbuffers.size,
        bytes: renderbufferBytes,
      },
      buffers: { live: this.buffers.size, bytes: bufferBytes },
      total: textureBytes + renderbufferBytes + bufferBytes,
      unknownFormats: [...this.unknown],
    };
  }
}
