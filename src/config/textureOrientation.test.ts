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
const REGISTERED = ['bennu', 'vesta', 'mimas'] as const;

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
