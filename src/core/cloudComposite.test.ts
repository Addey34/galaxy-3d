import { describe, expect, it } from 'vitest';
import {
  compositeObserved,
  modisLabelOf,
  modisSiblingUrl,
  type CompositeOptions,
} from './cloudComposite';
import {
  gibsCloudUrl,
  GIBS_MODIS_AQUA_LAYER,
  GIBS_MODIS_TERRA_LAYER,
} from './gibsClouds';

const W = 24;
const H = 12;
const OPTIONS: CompositeOptions = { noDataMax: 8, growPx: 1, featherPx: 0 };

const CLOUD = [220, 225, 230] as const;
const OCEAN = [20, 40, 90] as const;
const BLACK = [0, 0, 0] as const;

/** Une image W x H : `pixel(x, y)` rend la couleur du pixel. */
function image(
  pixel: (x: number, y: number) => readonly [number, number, number]
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const [r, g, b] = pixel(x, y);
      const o = (y * W + x) * 4;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = 255;
    }
  return rgba;
}
const at = (rgba: Uint8ClampedArray, x: number, y: number) =>
  Array.from(rgba.slice((y * W + x) * 4, (y * W + x) * 4 + 3));

describe('compositeObserved', () => {
  it("rend l'image telle quelle quand elle n'a aucun trou", () => {
    const full = image(() => OCEAN);
    const other = image(() => CLOUD);
    const result = compositeObserved(full, other, W, H, OPTIONS);
    expect(Array.from(result.rgba)).toEqual(Array.from(full));
    expect(result).toMatchObject({
      primaryMissing: 0,
      filled: 0,
      stillMissing: 0,
    });
  });

  it("remplace un trou par ce que l'autre instrument a observé, et ne touche à rien d'autre", () => {
    // Une fente verticale sans donnée en x = 10..11, que le complément a observée.
    const primary = image((x) => (x === 10 || x === 11 ? BLACK : OCEAN));
    const complement = image(() => CLOUD);
    const { rgba, primaryMissing, filled, stillMissing } = compositeObserved(
      primary,
      complement,
      W,
      H,
      OPTIONS
    );
    expect(primaryMissing).toBe(2 * H);
    expect(filled).toBe(2 * H);
    expect(stillMissing).toBe(0);
    for (let y = 0; y < H; y++) {
      expect(at(rgba, 10, y)).toEqual([...CLOUD]);
      expect(at(rgba, 11, y)).toEqual([...CLOUD]);
      // Hors du trou et de sa frange (1 pixel), l'image principale est INTACTE, au bit près.
      for (const x of [0, 5, 8, 13, 20, W - 1])
        expect(at(rgba, x, y)).toEqual([...OCEAN]);
    }
  });

  it("agrandit le trou d'une frange : le bord sombre d'une fauchée ne reste pas autour du comblement", () => {
    const primary = image((x) =>
      x === 10 ? BLACK : x === 9 || x === 11 ? [10, 12, 14] : OCEAN
    );
    const complement = image(() => CLOUD);
    const { rgba } = compositeObserved(primary, complement, W, H, OPTIONS);
    // La frange sombre (x = 9 et 11, au-dessus du seuil mais ni noire ni observée) est remplacée avec lui.
    expect(at(rgba, 9, 4)).toEqual([...CLOUD]);
    expect(at(rgba, 11, 4)).toEqual([...CLOUD]);
    expect(at(rgba, 8, 4)).toEqual([...OCEAN]);
  });

  it("laisse sans donnée ce que NI l'un NI l'autre n'ont vu, et le compte", () => {
    const primary = image((x) => (x >= 10 && x <= 13 ? BLACK : OCEAN));
    // Le complément a lui aussi un trou, qui recouvre x = 12 et 13.
    const complement = image((x) => (x >= 12 && x <= 15 ? BLACK : CLOUD));
    const { rgba, primaryMissing, filled, stillMissing } = compositeObserved(
      primary,
      complement,
      W,
      H,
      OPTIONS
    );
    expect(primaryMissing).toBe(4 * H);
    expect(filled + stillMissing).toBe(primaryMissing);
    expect(stillMissing).toBeGreaterThan(0);
    // Jamais de noir recopié du complément : le pixel reste celui de l'image principale (noir aussi).
    expect(at(rgba, 13, 6)).toEqual([...BLACK]);
    // Et un pixel que le complément a observé est comblé.
    expect(at(rgba, 10, 6)).toEqual([...CLOUD]);
  });

  it('écarte le complément de son propre bord (sa frange sombre ne passe pas dans le comblement)', () => {
    const primary = image((x) => (x >= 4 && x <= 8 ? BLACK : OCEAN));
    // Le complément est noir en x = 5 (bord de fauchée) : x = 4 et 6 en sont à un pixel.
    const complement = image((x) => (x === 5 ? BLACK : CLOUD));
    const { rgba } = compositeObserved(primary, complement, W, H, OPTIONS);
    expect(at(rgba, 5, 3)).toEqual([...BLACK]);
    expect(at(rgba, 4, 3)).toEqual([...BLACK]);
    expect(at(rgba, 6, 3)).toEqual([...BLACK]);
    expect(at(rgba, 7, 3)).toEqual([...CLOUD]);
  });

  it("enroule la longitude : un trou au bord de l'image prend aussi sa frange de l'autre côté", () => {
    const primary = image((x) =>
      x === 0 ? BLACK : x === W - 1 ? [10, 12, 14] : OCEAN
    );
    const complement = image(() => CLOUD);
    const { rgba } = compositeObserved(primary, complement, W, H, OPTIONS);
    expect(at(rgba, 0, 5)).toEqual([...CLOUD]);
    expect(at(rgba, W - 1, 5)).toEqual([...CLOUD]);
    expect(at(rgba, W - 2, 5)).toEqual([...OCEAN]);
  });

  it('adoucit le raccord quand un fondu est demandé, sans jamais sortir du complément observé', () => {
    const primary = image((x) => (x >= 10 && x <= 13 ? BLACK : OCEAN));
    const complement = image(() => CLOUD);
    const { rgba } = compositeObserved(primary, complement, W, H, {
      ...OPTIONS,
      featherPx: 2,
    });
    const edge = at(rgba, 8, 4);
    // Le pixel voisin du trou (hors frange) est un mélange strict de l'océan et du nuage.
    expect(edge[0]).toBeGreaterThan(OCEAN[0]);
    expect(edge[0]).toBeLessThan(CLOUD[0]);
    expect(at(rgba, 0, 4)).toEqual([...OCEAN]);
    expect(at(rgba, 11, 4)).toEqual([...CLOUD]);
  });

  it('ne modifie jamais ses entrées, et refuse de combiner deux images de tailles différentes', () => {
    const primary = image((x) => (x === 3 ? BLACK : OCEAN));
    const complement = image(() => CLOUD);
    const before = Array.from(primary);
    const done = compositeObserved(primary, complement, W, H, OPTIONS);
    expect(Array.from(primary)).toEqual(before);
    expect(done.rgba).not.toBe(primary);

    const wrong = compositeObserved(
      primary,
      new Uint8ClampedArray(8),
      W,
      H,
      OPTIONS
    );
    expect(Array.from(wrong.rgba)).toEqual(before);
    expect(wrong.filled).toBe(0);
  });
});

describe('modisSiblingUrl', () => {
  const terra = gibsCloudUrl('2026-11-21', { layer: GIBS_MODIS_TERRA_LAYER });
  const aqua = gibsCloudUrl('2026-11-21', { layer: GIBS_MODIS_AQUA_LAYER });

  it("donne l'autre instrument pour le même jour et la même taille, et seulement la couche change", () => {
    expect(modisSiblingUrl(terra)).toBe(aqua);
    expect(modisSiblingUrl(aqua)).toBe(terra);
  });

  it("n'a pas de frère pour VIIRS ni pour une adresse illisible", () => {
    expect(modisSiblingUrl(gibsCloudUrl('2026-11-21'))).toBeNull();
    expect(modisSiblingUrl('pas une adresse')).toBeNull();
  });

  it('nomme l’instrument pour le badge', () => {
    expect(modisLabelOf(terra)).toBe('MODIS Terra');
    expect(modisLabelOf(aqua)).toBe('MODIS Aqua');
    expect(modisLabelOf(gibsCloudUrl('2026-11-21'))).toBeNull();
  });
});

/**
 * La version rapide (sommes glissantes) doit rendre EXACTEMENT ce que rend la définition naïve :
 * fenêtre carrée recomptée à chaque pixel, longitude enroulée, latitude bornée (fondu : bords
 * prolongés). Le test la réécrit en clair et compare, sur des images aléatoires et plusieurs rayons.
 */
function naive(
  primary: Uint8ClampedArray,
  complement: Uint8ClampedArray,
  w: number,
  h: number,
  o: CompositeOptions
): { rgba: Uint8ClampedArray; filled: number } {
  const n = w * h;
  const miss = (img: Uint8ClampedArray, i: number): number =>
    Math.max(img[i * 4]!, img[i * 4 + 1]!, img[i * 4 + 2]!) <= o.noDataMax
      ? 1
      : 0;
  const grow = (mask: number[], r: number): number[] =>
    mask.map((_, i) => {
      const x = i % w;
      const y = Math.floor(i / w);
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          if (mask[yy * w + ((((x + dx) % w) + w) % w)]) return 1;
        }
      return 0;
    });
  const mp = Array.from({ length: n }, (_, i) => miss(primary, i));
  const mc = Array.from({ length: n }, (_, i) => miss(complement, i));
  const hole = grow(mp, o.growPx);
  const edge = grow(mc, o.growPx);
  const weight = hole.map((v, i) => (v && !edge[i] ? 1 : 0));
  const soft = weight.map((_, i) => {
    const x = i % w;
    const y = Math.floor(i / w);
    let sum = 0;
    for (let dy = -o.featherPx; dy <= o.featherPx; dy++)
      for (let dx = -o.featherPx; dx <= o.featherPx; dx++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        sum += weight[yy * w + ((((x + dx) % w) + w) % w)]!;
      }
    return sum / (2 * o.featherPx + 1) ** 2;
  });
  const out = new Uint8ClampedArray(primary);
  let filled = 0;
  for (let i = 0; i < n; i++) {
    const wgt = edge[i] ? 0 : soft[i]!;
    if (wgt <= 0) continue;
    if (mp[i]) filled++;
    for (let c = 0; c < 3; c++)
      out[i * 4 + c] =
        primary[i * 4 + c]! * (1 - wgt) + complement[i * 4 + c]! * wgt;
  }
  return { rgba: out, filled };
}

describe('la version rapide équivaut à la définition naïve', () => {
  function random(
    w: number,
    h: number,
    seed: number,
    gapRate: number
  ): Uint8ClampedArray {
    let s = seed;
    const next = (): number => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const gap = next() < gapRate;
      for (let c = 0; c < 3; c++)
        rgba[i * 4 + c] = gap ? 0 : 20 + Math.floor(next() * 230);
      rgba[i * 4 + 3] = 255;
    }
    return rgba;
  }

  for (const [growPx, featherPx] of [
    [0, 0],
    [1, 0],
    [2, 2],
    [3, 1],
  ] as const)
    it(`rayons ${growPx} et ${featherPx}, sur des images aléatoires à trous épars et à gros blocs`, () => {
      const w = 37;
      const h = 19;
      for (const seed of [1, 2, 3, 4]) {
        // Des trous épars (0,08) donnent des franges qui se recouvrent ; des gros blocs, des raccords.
        const primary = random(w, h, seed, 0.08);
        const complement = random(w, h, seed + 100, 0.1);
        for (let y = 5; y < 11; y++)
          for (let x = 0; x < 6; x++)
            for (let c = 0; c < 3; c++) primary[(y * w + x) * 4 + c] = 0;
        const options = { noDataMax: 8, growPx, featherPx };
        const fast = compositeObserved(primary, complement, w, h, options);
        const slow = naive(primary, complement, w, h, options);
        expect(Array.from(fast.rgba)).toEqual(Array.from(slow.rgba));
        expect(fast.filled).toBe(slow.filled);
      }
    });
});
