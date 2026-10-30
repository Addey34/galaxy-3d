import { describe, expect, it } from 'vitest';
import { displayGain as ruleGain } from '@/core/displayAlbedo';
import { albedos } from './displayAlbedo.json';
import { SURFACE_TILESETS } from './surfaceTilesets';
import table from './tileGain.json';
import { tileToneRatio } from './tileGain';

/**
 * `tileGain.json` est écrite par `scripts/measure-tile-gain.mjs`. Ce test la confronte à la règle
 * (`core/displayAlbedo.ts`) et au catalogue : un gain recopié ou périmé ne passe pas.
 */
describe('gains de luminosité des mosaïques', () => {
  const rows = table.rows.filter(
    (r): r is typeof r & { gain: number; tileMeanLuminance: number } =>
      r.gain !== undefined
  );

  it('chaque gain est la règle appliquée à la luminance mesurée des carreaux', () => {
    for (const row of rows)
      expect(row.gain, row.body).toBeCloseTo(
        ruleGain(row.albedo!, row.tileMeanLuminance),
        3
      );
  });

  it('chaque mosaïque d’un corps réglé par la règle a son gain, sans exception muette', () => {
    for (const [body, tileset] of SURFACE_TILESETS) {
      if ((albedos as Record<string, number>)[body] === undefined) continue;
      expect(table.gains as Record<string, number>, tileset.id).toHaveProperty(
        body
      );
    }
  });

  it('un corps hors de la règle garde la luminosité de sa mosaïque', () => {
    expect(tileToneRatio('earth')).toBe(1);
  });

  it('Mercure : les carreaux ne sont plus tenus au gain de la base (0,31)', () => {
    expect(tileToneRatio('mercury')).toBeGreaterThan(3);
  });
});
