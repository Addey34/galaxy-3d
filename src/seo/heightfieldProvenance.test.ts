import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  heightfieldProvenance,
  type HeightManifestSummary,
} from './sourcesPage';

/**
 * LE SOCLE GLOBAL N'EST PAS LA BOÎTE LA PLUS FINE (lot 53). La page `/sources` lisait le socle
 * sur le maximum de toutes les entrées non nommées, donc sur les boîtes de montagne : 489 m
 * annoncés au lieu de 1,85 km sur la grille de GIBS depuis le lot 48, 153 m sur celle de
 * Sentinel-2 depuis GLO-30.
 */
const product = {
  body: 'earth',
  title: 't',
  mission: 'm',
  instrument: 'i',
  providers: [{ name: 'p' }],
  links: [{ rel: 'describedby', href: 'https://example.test/' }],
};
const matrix = {
  columnsAtLevelZero: 2,
  rowsAtLevelZero: 1,
  referenceLevel: 0,
  tileSizePx: 256,
};

describe('relief de /sources : socle, boîtes de grand relief, aires nommées', () => {
  it('sépare les trois sur un manifeste synthétique', () => {
    const p = heightfieldProvenance(product, {
      matrix,
      tiles: 1,
      bytes: 1,
      coverage: [
        { level: 6, levels: [5, 6], global: true },
        { level: 7, levels: [7, 8, 9] },
        { level: 7, levels: [7, 8, 9] },
        { level: 7, levels: [7, 8, 9] },
        { level: 8, area: { name: 'Tycho' } },
      ],
    });
    expect(p.baseLevel).toBe(6);
    expect(p.reliefBoxes).toEqual({ count: 3, level: 9 });
    expect(p.areas).toEqual([{ name: 'Tycho', level: 8 }]);
  });

  it.each(['earth', 'earth-trek'])('sur le manifeste livré de %s', (set) => {
    const manifest = JSON.parse(
      readFileSync(
        resolve(
          __dirname,
          `../../public/assets/height-tiles/${set}/manifest.json`
        ),
        'utf-8'
      )
    ) as HeightManifestSummary;
    const p = heightfieldProvenance(product, manifest);
    const global = manifest.coverage.filter((e) => e.global);
    expect(p.baseLevel).toBe(
      Math.max(...global.flatMap((e) => e.levels ?? [e.level]))
    );
    expect(p.reliefBoxes).not.toBeNull();
    expect(p.reliefBoxes!.level).toBeGreaterThan(p.baseLevel);
  });
});
