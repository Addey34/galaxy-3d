import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  ATMOSPHERE_MIN_SURFACE_PRESSURE_BAR,
  DISPLAY_LUMINANCE_PER_ALBEDO,
  bakedGain,
  displayGain as gainFor,
  faceContrast,
  meanLinearLuminance,
} from '@/core/displayAlbedo';
import { CELESTIAL_CONFIG } from './bodies';
import { allBodies } from './catalog';
import { displayGain } from './displayAlbedo';
import table from './displayAlbedo.json';
import snapshot from './factSources.snapshot.json';

/**
 * LA TABLE DES GAINS DE LUMINOSITÉ CONTRE CE QU'ELLE DÉCRIT (2026-10-07).
 *
 * `displayAlbedo.json` est écrite par `scripts/measure-display-albedo.mjs`. Ce test la confronte
 * aux trois choses dont elle dérive, sans relancer le script : l'albédo du RELEVÉ des sources, la
 * texture LIVRÉE (remesurée ici), la règle de `core/displayAlbedo.ts`. Une texture réimportée,
 * un relevé refait ou une constante changée sans régénérer la table le font échouer.
 */
const ROOT = resolve(__dirname, '../..');

interface Row {
  body: string;
  rule: 'texture' | 'baked' | 'excluded';
  albedo?: number;
  source?: { path: string; url: string };
  texture?: string;
  textureMeanLuminance?: number;
  gain?: number;
  reason?: string;
  albedos?: number[];
  textureFaceContrast?: number;
}
const rows = table.rows as Row[];
const byBody = new Map(rows.map((r) => [r.body, r]));

/** La valeur du relevé à un chemin pointé (`nssdca.bodies.moon.geometricAlbedo`). */
function atPath(path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (o, k) => (o as Record<string, unknown> | undefined)?.[k],
      snapshot
    );
}

describe('luminosité affichée : la table des gains', () => {
  it('décrit chaque corps du catalogue, une fois', () => {
    const names = allBodies(CELESTIAL_CONFIG).map((b) => b.name);
    expect(rows.map((r) => r.body).sort()).toEqual([...names].sort());
  });

  it('porte la constante de la règle', () => {
    expect(table.luminancePerAlbedo).toBe(DISPLAY_LUMINANCE_PER_ALBEDO);
  });

  it('expose à l’application exactement les gains de ses lignes', () => {
    const expected = Object.fromEntries(
      rows.filter((r) => r.gain !== undefined).map((r) => [r.body, r.gain])
    );
    expect(table.gains).toEqual(expected);
    for (const r of rows) expect(displayGain(r.body)).toBe(r.gain ?? 1);
  });

  const textured = rows.filter((r) => r.rule === 'texture');
  it('garde des corps texturés à vérifier', () => {
    expect(textured.length).toBeGreaterThan(20);
  });

  it.each(textured.map((r) => [r.body, r] as const))(
    '%s : albédo du relevé, texture remesurée, gain de la règle',
    async (_, r) => {
      const value = atPath(r.source!.path);
      const albedo =
        typeof value === 'number'
          ? value
          : (value as { value: number } | undefined)?.value;
      expect(albedo, r.source!.path).toBe(r.albedo);
      const { data, info } = await sharp(join(ROOT, r.texture!))
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const config = allBodies(CELESTIAL_CONFIG).find(
        (b) => b.name === r.body
      )!.config;
      const mean = meanLinearLuminance(
        data,
        info.width,
        info.height,
        info.channels,
        Boolean(config.model?.atlas)
      );
      expect(r.textureMeanLuminance).toBeCloseTo(mean, 4);
      expect(r.gain).toBeCloseTo(gainFor(r.albedo!, mean), 4);
    }
  );

  it('une couleur cuite est ramenée de la convention de cuisson à celle d’affichage', () => {
    const script = readFileSync(
      join(ROOT, 'scripts/display-albedo.mjs'),
      'utf8'
    );
    expect(script).toContain('0.312 / 0.12');
    const baked = rows.filter((r) => r.rule === 'baked');
    expect(baked.length).toBeGreaterThan(0);
    for (const r of baked)
      expect(r.gain).toBeCloseTo(bakedGain(0.312 / 0.12), 4);
  });

  it('toute fiche du NSSDCA à pression de surface d’au moins 1 mbar est écartée', () => {
    const bodies = snapshot.nssdca.bodies as unknown as Record<
      string,
      { surfacePressure?: { bar: number } }
    >;
    const thick = Object.entries(bodies).filter(
      ([, b]) =>
        (b.surfacePressure?.bar ?? 0) >= ATMOSPHERE_MIN_SURFACE_PRESSURE_BAR
    );
    expect(thick.map(([n]) => n)).toEqual(
      expect.arrayContaining(['mars', 'jupiter', 'venus', 'earth'])
    );
    for (const [name] of thick)
      expect(byBody.get(name)?.rule, name).toBe('excluded');
    // Les corps sans air suivent la règle (témoins, à pression publiée sous le seuil).
    for (const name of ['mercury', 'moon', 'pluto'])
      expect(byBody.get(name)?.rule, name).toBe('texture');
  });

  it('chaque corps écarté dit pourquoi, et Japet cite sa source', () => {
    for (const r of rows.filter((x) => x.rule === 'excluded'))
      expect(r.reason?.length ?? 0, r.body).toBeGreaterThan(10);
    expect(byBody.get('iapetus')?.reason).toContain('0.05 / 0.5');
    expect(byBody.get('iapetus')?.albedos).toEqual([0.05, 0.5]);
    expect(byBody.get('titan')?.reason).toContain('substantial atmosphere');
  });
});

/**
 * LE CONTRASTE ENTRE LES FACES (2026-10-07), raison mesurée pour laquelle Japet reste hors règle :
 * ses deux albédos publiés sont dans un rapport de 10, sa carte livrée n'en porte que 2.
 */
describe('luminosité affichée : le contraste entre les faces', () => {
  it('rend le rapport de deux hémisphères uniformes, et 1 sur une carte uniforme', () => {
    const W = 360;
    const H = 180;
    const image = (left: number, right: number): Uint8Array => {
      const rgb = new Uint8Array(W * H * 3);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++)
          rgb.fill(
            x < W / 2 ? left : right,
            (y * W + x) * 3,
            (y * W + x) * 3 + 3
          );
      return rgb;
    };
    const lin = (c: number): number => ((c / 255 + 0.055) / 1.055) ** 2.4;
    expect(faceContrast(image(200, 200), W, H, 3)).toBeCloseTo(1, 10);
    expect(faceContrast(image(60, 240), W, H, 3)).toBeCloseTo(
      lin(240) / lin(60),
      6
    );
  });

  const twoAlbedos = rows.filter((r) => r.albedos !== undefined);
  it.each(twoAlbedos.map((r) => [r.body, r] as const))(
    '%s : contraste remesuré sur la texture livrée, loin du rapport publié',
    async (_, r) => {
      const { data, info } = await sharp(join(ROOT, r.texture!))
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect(
        faceContrast(data, info.width, info.height, info.channels)
      ).toBeCloseTo(r.textureFaceContrast!, 4);
      const published = Math.max(...r.albedos!) / Math.min(...r.albedos!);
      // La raison ne tient que tant que la carte est loin du rapport publié : une carte
      // radiométrique livrée ferait échouer ce test, et Japet devrait alors rejoindre la règle.
      expect(r.textureFaceContrast!).toBeLessThan(published / 2);
    }
  );
});
