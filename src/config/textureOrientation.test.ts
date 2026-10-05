import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

/**
 * L'ORIENTATION EN LONGITUDE DES TEXTURES (2026-10-04).
 *
 * L'application pose la longitude 0 au CENTRE de chaque carte, l'Est vers la droite
 * (`core/modelUv.ts`, et `SphereGeometry` met u = 0,5 sur +X). Beaucoup de produits publiés sont
 * centrés sur 180° : l'import gardait leur cadrage, si bien que SEPT corps ont été livrés tournés
 * d'un demi-tour sur eux-mêmes (Bennu, Cérès, Pluton, Europe, Ganymède, Callisto, Titan). Pluton
 * montrait son cœur du côté de Charon. Rien ne le voyait : une sphère tournée ressemble encore à
 * une sphère, et l'unique garde d'orientation portait sur Phobos.
 *
 * Deux mesures, chacune falsifiable par construction :
 *
 *  1. TÉMOINS NOMMÉS. Un repère de l'UAI nettement clair ou sombre, lu au gazetteer livré (jamais
 *     recopié), doit trancher sur le même parallèle à 180° de là. Un demi-tour inverse ce
 *     rapport. Seuls des témoins dont le contraste mesuré dépasse nettement le seuil sont retenus
 *     (relevé du 2026-10-04 ; Pwyll, Occator ou Odysseus étaient trop faibles sur une fenêtre de
 *     5°, et ne servent donc pas).
 *  2. RECALAGE SUR LE MODÈLE. Pour un corps drapé, la pente du modèle livré et la variance locale
 *     de sa carte se correspondent : le pic de corrélation sur tous les décalages de longitude,
 *     avec et sans miroir, doit tomber près de 0 et sans miroir. C'est cette mesure qui a trouvé
 *     Bennu (pic à 179°). Elle ne tranche pas partout : Phobos et Déimos n'y ont pas de pic net,
 *     et Phobos est tenu par Stickney dans `shapeModels.test.ts`.
 *
 * Les corps sans témoin ici ont été vérifiés le même jour contre une référence indépendante
 * (tuiles Trek ou mosaïques Cassini du PDS), écrite dans le handoff : ce fichier ne tient que ce
 * qui se mesure sans réseau.
 */

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TEXTURES = join(PROJECT_ROOT, 'public/assets/textures');
const GAZETTEER = join(PROJECT_ROOT, 'public/assets/gazetteer');
const MODELS = join(PROJECT_ROOT, 'public/assets/models');

/** Rapport minimal (clair) ou maximal (sombre, 1/RATIO) entre le repère et son antipode en longitude. */
const RATIO = 1.2;

const WITNESSES: readonly {
  body: string;
  feature: string;
  tone: 'bright' | 'dark';
}[] = [
  { body: 'pluto', feature: 'Sputnik Planitia', tone: 'bright' },
  { body: 'pluto', feature: 'Belton Regio', tone: 'dark' },
  { body: 'ganymede', feature: 'Tros', tone: 'bright' },
  { body: 'callisto', feature: 'Valhalla', tone: 'bright' },
  { body: 'titan', feature: 'Xanadu', tone: 'bright' },
  { body: 'ceres', feature: 'Haulani', tone: 'bright' },
  { body: 'europa', feature: 'Dyfed Regio', tone: 'dark' },
  { body: 'moon', feature: 'Tycho', tone: 'bright' },
  { body: 'moon', feature: 'Mare Crisium', tone: 'dark' },
  { body: 'mars', feature: 'Syrtis Major Planum', tone: 'dark' },
  { body: 'rhea', feature: 'Inktomi', tone: 'bright' },
  { body: 'iapetus', feature: 'Cassini Regio', tone: 'dark' },
];

/** Corps drapés dont le recalage pente/variance donne un pic net (mesuré le 2026-10-04). */
const REGISTERED = ['bennu', 'vesta', 'mimas', 'itokawa'] as const;

/** Le plus petit palier de surface livré : c'est lui que voit d'abord un visiteur. */
function smallestSurface(body: string): string {
  const files = readdirSync(join(TEXTURES, body))
    .filter((f) => /_surface_\dk\.jpg$/.test(f))
    .sort();
  return join(TEXTURES, body, files[0]!);
}

async function greyMap(path: string, width: number, height: number) {
  return sharp(path)
    .greyscale()
    .resize(width, height, { fit: 'fill' })
    .raw()
    .toBuffer();
}

describe('orientation des textures : témoins nommés', () => {
  it.each(WITNESSES)(
    '$body : $feature ($tone) tranche sur son antipode en longitude',
    async ({ body, feature, tone }) => {
      const names = JSON.parse(
        readFileSync(join(GAZETTEER, `${body}.json`), 'utf8')
      ) as { name: string; lat: number; lon: number }[];
      const f = names.find((n) => n.name === feature);
      expect(f, `${feature} absent du gazetteer de ${body}`).toBeDefined();
      const W = 360;
      const H = 180;
      const img = await greyMap(smallestSurface(body), W, H);
      // Moyenne 5 × 5 pixels (5°), longitude Est ramenée au cadrage de l'application.
      const mean = (lonEast: number): number => {
        const centred = ((((lonEast % 360) + 540) % 360) - 180 + 180) / 360;
        const cx = Math.floor(centred * W);
        const cy = Math.floor(((90 - f!.lat) / 180) * H);
        let sum = 0;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            const y = Math.min(H - 1, Math.max(0, cy + dy));
            sum += img[y * W + ((cx + dx + W) % W)]!;
          }
        return sum / 25;
      };
      const ratio = mean(f!.lon) / Math.max(1, mean(f!.lon + 180));
      const message = `${body} : ${feature} à ${ratio.toFixed(2)} fois son antipode — un demi-tour l'inverse`;
      if (tone === 'bright') expect(ratio, message).toBeGreaterThan(RATIO);
      else expect(ratio, message).toBeLessThan(1 / RATIO);
    }
  );
});

/** Positions du premier maillage d'un glTF binaire livré. */
function glbPositions(path: string): Float32Array {
  const bytes = readFileSync(path);
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const accessor =
    gltf.accessors[gltf.meshes[0].primitives[0].attributes.POSITION];
  const view = gltf.bufferViews[accessor.bufferView];
  const start = bytes.byteOffset + 20 + jsonLength + 8 + (view.byteOffset ?? 0);
  return new Float32Array(bytes.buffer.slice(start, start + view.byteLength));
}

describe('orientation des textures : recalage sur le modèle drapé', () => {
  it.each(REGISTERED)(
    '%s : le pic de corrélation tombe à 0°, sans miroir',
    async (body) => {
      const level = ['4k', '2k', '1k'].find((q) => {
        try {
          readFileSync(join(MODELS, body, `${body}_shape_${q}.glb`));
          return true;
        } catch {
          return false;
        }
      })!;
      const pos = glbPositions(
        join(MODELS, body, `${body}_shape_${level}.glb`)
      );
      const W = 360;
      const H = 180;
      // Rayon par cellule, dans la convention du drapé : u = 0,5 + atan2(−z, x) / 2π.
      const radius = new Float32Array(W * H).fill(NaN);
      for (let i = 0; i < pos.length / 3; i++) {
        const x = pos[3 * i]!;
        const y = pos[3 * i + 1]!;
        const z = pos[3 * i + 2]!;
        const r = Math.hypot(x, y, z);
        const u = 0.5 + Math.atan2(-z, x) / (2 * Math.PI);
        const v = 0.5 - Math.asin(Math.max(-1, Math.min(1, y / r))) / Math.PI;
        const k =
          Math.min(H - 1, Math.floor(v * H)) * W +
          Math.min(W - 1, Math.floor(u * W));
        if (!(radius[k]! >= r)) radius[k] = r;
      }
      for (let pass = 0; pass < 60; pass++) {
        const next = radius.slice();
        let holes = 0;
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++) {
            if (!Number.isNaN(radius[y * W + x]!)) continue;
            holes++;
            let sum = 0;
            let count = 0;
            for (const [dx, dy] of [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ] as const) {
              const yy = y + dy;
              if (yy < 0 || yy >= H) continue;
              const value = radius[yy * W + ((x + dx + W) % W)]!;
              if (!Number.isNaN(value)) {
                sum += value;
                count++;
              }
            }
            if (count) next[y * W + x] = sum / count;
          }
        radius.set(next);
        if (!holes) break;
      }
      const slope = new Float32Array(W * H);
      for (let y = 1; y < H - 1; y++) {
        const c = Math.max(0.15, Math.cos(((90 - (y + 0.5)) * Math.PI) / 180));
        for (let x = 0; x < W; x++) {
          const dx =
            (radius[y * W + ((x + 1) % W)]! -
              radius[y * W + ((x - 1 + W) % W)]!) /
            (2 * c);
          const dy = (radius[(y + 1) * W + x]! - radius[(y - 1) * W + x]!) / 2;
          slope[y * W + x] = Math.hypot(dx, dy) / radius[y * W + x]!;
        }
      }
      // La variance locale de la carte la plus FINE : le relief s'y lit le mieux.
      const files = readdirSync(join(TEXTURES, body))
        .filter((f) => /_surface_\dk\.jpg$/.test(f))
        .sort();
      const img = await greyMap(join(TEXTURES, body, files.at(-1)!), W, H);
      const spread = new Float32Array(W * H);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          let s = 0;
          let s2 = 0;
          for (let dy = -2; dy <= 2; dy++) {
            const yy = Math.min(H - 1, Math.max(0, y + dy));
            for (let dx = -2; dx <= 2; dx++) {
              const v = img[yy * W + ((x + dx + W) % W)]!;
              s += v;
              s2 += v * v;
            }
          }
          spread[y * W + x] = Math.sqrt(Math.max(0, s2 / 25 - (s / 25) ** 2));
        }
      const correlation = (shift: number, mirror: boolean): number => {
        let sa = 0,
          sb = 0,
          sab = 0,
          saa = 0,
          sbb = 0,
          n = 0;
        for (let y = 30; y < H - 30; y++)
          for (let x = 0; x < W; x++) {
            const a = slope[y * W + x]!;
            const b =
              spread[y * W + (((mirror ? W - 1 - x : x) + shift + W) % W)]!;
            sa += a;
            sb += b;
            sab += a * b;
            saa += a * a;
            sbb += b * b;
            n++;
          }
        const ma = sa / n;
        const mb = sb / n;
        return (
          (sab / n - ma * mb) /
          Math.sqrt((saa / n - ma * ma) * (sbb / n - mb * mb))
        );
      };
      let best = { r: -Infinity, shift: 0, mirror: false };
      for (const mirror of [false, true])
        for (let shift = 0; shift < W; shift++) {
          const r = correlation(shift, mirror);
          if (r > best.r) best = { r, shift, mirror };
        }
      const offset = Math.min(best.shift, W - best.shift);
      expect(
        best.mirror,
        `${body} : le meilleur recalage est un MIROIR (${best.shift}°)`
      ).toBe(false);
      expect(
        offset,
        `${body} : pic à ${best.shift}° (r = ${best.r.toFixed(3)}) au lieu de 0°`
      ).toBeLessThan(5);
    },
    60_000
  );
});

/**
 * Corps drapés d'une photomosaïque OMBRÉE, où le recalage pente/variance ne tranche pas
 * (mesuré le 2026-10-05) mais où l'ombrage, lui, tranche.
 */
const SHADED = ['gaspra', 'ida'] as const;

/** Positions et indices du premier maillage d'un glTF binaire livré. */
function glbMesh(path: string): { pos: Float32Array; index: Uint32Array } {
  const bytes = readFileSync(path);
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const primitive = gltf.meshes[0].primitives[0];
  const slice = (accessorIndex: number): ArrayBuffer => {
    const view = gltf.bufferViews[gltf.accessors[accessorIndex].bufferView];
    const start =
      bytes.byteOffset + 20 + jsonLength + 8 + (view.byteOffset ?? 0);
    return bytes.buffer.slice(start, start + view.byteLength) as ArrayBuffer;
  };
  const indices = gltf.accessors[primitive.indices];
  return {
    pos: new Float32Array(slice(primitive.attributes.POSITION)),
    index: Uint32Array.from(
      indices.componentType === 5125
        ? new Uint32Array(slice(primitive.indices))
        : new Uint16Array(slice(primitive.indices))
    ),
  };
}

/** Résout un système 4 × 4 par élimination de Gauss avec pivot partiel. */
function solve4(A: number[][], b: number[]): number[] {
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let i = 0; i < 4; i++) {
    let p = i;
    for (let k = i + 1; k < 4; k++)
      if (Math.abs(M[k]![i]!) > Math.abs(M[p]![i]!)) p = k;
    [M[i], M[p]] = [M[p]!, M[i]!];
    for (let k = 0; k < 4; k++) {
      if (k === i) continue;
      const f = M[k]![i]! / M[i]![i]!;
      for (let j = i; j < 5; j++) M[k]![j]! -= f * M[i]![j]!;
    }
  }
  return M.map((row, i) => row[4]! / row[i]!);
}

describe("orientation des textures : recalage par l'ombrage", () => {
  /**
   * Dans une photomosaïque, la luminosité d'une région imaginée sous un même Soleil suit
   * l'orientation des facettes : luminosité ≈ a + b·n, n étant la normale du modèle et b la
   * direction du Soleil fois l'albédo, ajustée par moindres carrés. Le R² de cet ajustement,
   * calculé pour chaque repère candidat (décalage de longitude, miroir, pôle retourné, 720 en
   * tout), doit culminer à l'IDENTITÉ : c'est la preuve que la carte et le modèle livrés
   * partagent un repère, sans rien supposer de l'un ni de l'autre.
   *
   * Mesuré le 2026-10-05 sur les fichiers livrés : Gaspra 0,486 à 358° contre 0,442 au mieux
   * dans une autre famille, Ida 0,476 à 356° contre 0,372. Le niveau du hasard, une carte posée
   * sur le modèle d'un AUTRE corps, atteint 0,46 : d'où l'exigence que ce soit la bonne famille
   * qui gagne, et près de 0°, plutôt qu'un seuil sur le R². Les cartes aplanies (Itokawa, Éros,
   * Vesta) n'ont pas d'ombrage, et cette mesure ne dit rien d'elles (R² ~ 0,1 partout).
   */
  it.each(SHADED)(
    '%s : la luminosité de la carte suit le modèle à 0°, sans miroir ni pôle retourné',
    async (body) => {
      const level = ['4k', '2k', '1k'].find((q) => {
        try {
          readFileSync(join(MODELS, body, `${body}_shape_${q}.glb`));
          return true;
        } catch {
          return false;
        }
      })!;
      const { pos, index } = glbMesh(
        join(MODELS, body, `${body}_shape_${level}.glb`)
      );
      const W = 360;
      const H = 180;
      // Rayon par cellule de 1°, échantillonné DANS chaque triangle (un sommet par cellule ne
      // suffit pas à un modèle décimé), dans la convention du drapé : nord +Y, Est vers −Z.
      const radius = new Float64Array(W * H).fill(NaN);
      const sum = new Float64Array(W * H);
      const count = new Float64Array(W * H);
      const SUB = 4;
      for (let t = 0; t < index.length; t += 3) {
        const [a, b, c] = [index[t]! * 3, index[t + 1]! * 3, index[t + 2]! * 3];
        for (let i = 0; i <= SUB; i++)
          for (let j = 0; j <= SUB - i; j++) {
            const u = i / SUB;
            const v = j / SUB;
            const w = 1 - u - v;
            const p = [0, 1, 2].map(
              (k) => u * pos[a + k]! + v * pos[b + k]! + w * pos[c + k]!
            ) as [number, number, number];
            const r = Math.hypot(...p);
            const lat = (Math.asin(p[1] / r) * 180) / Math.PI;
            const lon = (Math.atan2(-p[2], p[0]) * 180) / Math.PI;
            const x = Math.min(W - 1, Math.floor(lon + 180));
            const y = Math.min(H - 1, Math.floor(90 - lat));
            sum[y * W + x]! += r;
            count[y * W + x]!++;
          }
      }
      for (let k = 0; k < W * H; k++)
        if (count[k]) radius[k] = sum[k]! / count[k]!;
      for (let pass = 0; pass < 200; pass++) {
        const next = radius.slice();
        let holes = 0;
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++) {
            if (!Number.isNaN(radius[y * W + x]!)) continue;
            holes++;
            let s = 0;
            let n = 0;
            for (const [dx, dy] of [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ] as const) {
              const yy = y + dy;
              if (yy < 0 || yy >= H) continue;
              const value = radius[yy * W + ((x + dx + W) % W)]!;
              if (!Number.isNaN(value)) {
                s += value;
                n++;
              }
            }
            if (n) next[y * W + x] = s / n;
          }
        radius.set(next);
        if (!holes) break;
      }
      // Normale de la surface par cellule, dans le repère du fichier.
      const point = (x: number, y: number): number[] => {
        const xx = (x + W) % W;
        const yy = Math.max(0, Math.min(H - 1, y));
        const lat = ((90 - (yy + 0.5)) * Math.PI) / 180;
        const lon = ((xx + 0.5 - 180) * Math.PI) / 180;
        const r = radius[yy * W + xx]!;
        return [
          r * Math.cos(lat) * Math.cos(lon),
          r * Math.cos(lat) * Math.sin(lon),
          r * Math.sin(lat),
        ];
      };
      const normal = new Float64Array(W * H * 3);
      for (let y = 1; y < H - 1; y++)
        for (let x = 0; x < W; x++) {
          const [e, wv, n, s] = [
            point(x + 1, y),
            point(x - 1, y),
            point(x, y - 1),
            point(x, y + 1),
          ];
          const du = [0, 1, 2].map((k) => e![k]! - wv![k]!);
          const dv = [0, 1, 2].map((k) => n![k]! - s![k]!);
          let nv = [
            du[1]! * dv[2]! - du[2]! * dv[1]!,
            du[2]! * dv[0]! - du[0]! * dv[2]!,
            du[0]! * dv[1]! - du[1]! * dv[0]!,
          ];
          const p = point(x, y);
          if (nv[0]! * p[0]! + nv[1]! * p[1]! + nv[2]! * p[2]! < 0)
            nv = nv.map((v) => -v);
          const length = Math.hypot(...nv) || 1;
          normal.set(
            nv.map((v) => v / length),
            (y * W + x) * 3
          );
        }
      // Carte : luminosité par cellule, et masque des pixels IMAGÉS (texture fine présente ;
      // le gris uni de ce qui n'a jamais été vu ne dit rien de l'ombrage).
      const F = 10;
      const img = await greyMap(smallestSurface(body), W * F, H * F);
      const bright = new Float64Array(W * H);
      const imaged = new Uint8Array(W * H);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          let s = 0;
          let s2 = 0;
          for (let j = 0; j < F; j++)
            for (let i = 0; i < F; i++) {
              const v = img[(y * F + j) * W * F + x * F + i]!;
              s += v;
              s2 += v * v;
            }
          const mean = s / (F * F);
          bright[y * W + x] = mean;
          imaged[y * W + x] = s2 / (F * F) - mean * mean > 20 ? 1 : 0;
        }
      const smooth = new Float64Array(W * H).fill(NaN);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          let s = 0;
          let n = 0;
          for (let j = -2; j <= 2; j++)
            for (let i = -2; i <= 2; i++) {
              const yy = y + j;
              if (yy < 0 || yy >= H) continue;
              const k = yy * W + ((x + i + W) % W);
              if (!imaged[k]) continue;
              s += bright[k]!;
              n++;
            }
          if (n) smooth[y * W + x] = s / n;
        }
      const fit = (shift: number, mirror: boolean, flip: boolean): number => {
        const AtA = [0, 1, 2, 3].map(() => [0, 0, 0, 0]);
        const Atb = [0, 0, 0, 0];
        const samples: [number[], number, number][] = [];
        for (let y = 3; y < H - 3; y++)
          for (let x = 0; x < W; x++) {
            const k = y * W + x;
            if (!imaged[k] || Number.isNaN(smooth[k]!)) continue;
            const mx = mirror ? (W - x) % W : x;
            const kk = (flip ? H - 1 - y : y) * W + ((mx + shift) % W);
            const f = [
              1,
              normal[kk * 3]!,
              normal[kk * 3 + 1]!,
              normal[kk * 3 + 2]!,
            ];
            const w = Math.cos(((90 - (y + 0.5)) * Math.PI) / 180);
            for (let i = 0; i < 4; i++) {
              Atb[i]! += w * f[i]! * smooth[k]!;
              for (let j = 0; j < 4; j++) AtA[i]![j]! += w * f[i]! * f[j]!;
            }
            samples.push([f, smooth[k]!, w]);
          }
        const c = solve4(AtA, Atb);
        let sw = 0;
        let mean = 0;
        for (const [, b, w] of samples) {
          sw += w;
          mean += w * b;
        }
        mean /= sw;
        let ssr = 0;
        let sst = 0;
        for (const [f, b, w] of samples) {
          const predicted =
            c[0]! + c[1]! * f[1]! + c[2]! * f[2]! + c[3]! * f[3]!;
          ssr += w * (b - predicted) ** 2;
          sst += w * (b - mean) ** 2;
        }
        return 1 - ssr / sst;
      };
      const best = new Map<string, { r2: number; shift: number }>();
      for (const flip of [false, true])
        for (const mirror of [false, true])
          for (let shift = 0; shift < W; shift += 2) {
            const family = `${mirror ? 'miroir' : 'direct'}${flip ? ', pôle retourné' : ''}`;
            const r2 = fit(shift, mirror, flip);
            if (r2 > (best.get(family)?.r2 ?? -Infinity))
              best.set(family, { r2, shift });
          }
      const direct = best.get('direct')!;
      const rivals = [...best].filter(([family]) => family !== 'direct');
      for (const [family, rival] of rivals)
        expect(
          direct.r2,
          `${body} : la famille « ${family} » (R² ${rival.r2.toFixed(3)} à ${rival.shift}°) bat le repère direct (${direct.r2.toFixed(3)})`
        ).toBeGreaterThan(rival.r2);
      expect(
        Math.min(direct.shift, W - direct.shift),
        `${body} : pic à ${direct.shift}° (R² ${direct.r2.toFixed(3)}) au lieu de 0°`
      ).toBeLessThanOrEqual(6);
    },
    120_000
  );
});
