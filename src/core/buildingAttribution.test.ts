import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { attributionGaps } from './buildingAttribution';

const ATTRIBUTION =
  'Contains information from Overture Maps Foundation, OpenStreetMap contributors, Google Open Buildings (CC BY 4.0) and Microsoft Global ML Building Footprints, which is made available here under the Open Database License (ODbL), https://opendatacommons.org/licenses/odbl/1-0/';

describe('attributionGaps', () => {
  it('ne trouve aucun écart quand l’attribution cite exactement les jeux présents', () => {
    expect(
      attributionGaps(
        {
          OpenStreetMap: 8876,
          'Google Open Buildings': 4755,
          'Microsoft ML Buildings': 573,
        },
        ATTRIBUTION
      )
    ).toEqual({ unmapped: [], uncited: [], citedButAbsent: [] });
  });

  it('dénonce un jeu présent que l’attribution ne cite pas', () => {
    const gaps = attributionGaps(
      { OpenStreetMap: 3, 'USGS Lidar': 12 },
      ATTRIBUTION
    );
    expect(gaps.uncited).toEqual(['USGS Lidar']);
  });

  it('dénonce une source citée mais absente de la boîte', () => {
    const gaps = attributionGaps({ OpenStreetMap: 3 }, ATTRIBUTION);
    expect(gaps.citedButAbsent).toEqual([
      'Google Open Buildings',
      'Microsoft ML Buildings',
    ]);
  });

  it('exige une décision pour un jeu source inconnu', () => {
    const gaps = attributionGaps(
      { OpenStreetMap: 3, 'Nouveau jeu': 1 },
      ATTRIBUTION
    );
    expect(gaps.unmapped).toEqual(['Nouveau jeu']);
  });

  it('ignore un jeu dont le compte est nul', () => {
    expect(
      attributionGaps({ OpenStreetMap: 3, 'USGS Lidar': 0 }, ATTRIBUTION)
        .uncited
    ).toEqual([]);
  });
});

describe('manifestes de bâtiments Overture publiés', () => {
  const root = join(process.cwd(), 'public', 'assets', 'buildings');
  const manifests = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({
      id: d.name,
      manifest: JSON.parse(
        readFileSync(join(root, d.name, 'manifest.json'), 'utf8')
      ) as {
        source: {
          typeName?: string;
          attribution: string;
          datasets?: Record<string, number>;
        };
      },
    }))
    .filter((m) => m.manifest.source.typeName === 'overture buildings');

  it('en trouve au moins un (sinon cette garde ne regarde rien)', () => {
    expect(manifests.length).toBeGreaterThan(0);
  });

  for (const { id, manifest } of manifests) {
    it(`${id} : l’attribution cite exactement les jeux présents dans la boîte`, () => {
      const { datasets, attribution } = manifest.source;
      expect(
        datasets,
        'relevé des jeux absent : rejouer pnpm buildings:bake --only ' + id
      ).toBeDefined();
      expect(attributionGaps(datasets ?? {}, attribution)).toEqual({
        unmapped: [],
        uncited: [],
        citedButAbsent: [],
      });
    });
  }
});
