import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ALL_SMALL_BODY_CATEGORIES,
  julianDateToDate,
  loadSmallBodies,
  parseSbdbRows,
  parseSmallBodyDataset,
  type SmallBodyDatasetFile,
} from './sbdb';

const D2R = Math.PI / 180;

describe('julianDateToDate', () => {
  it('maps the Unix epoch JD to 1970-01-01', () => {
    expect(julianDateToDate(2_440_587.5).toISOString()).toBe(
      '1970-01-01T00:00:00.000Z'
    );
  });

  it('maps J2000.0 (JD 2451545.0) to 2000-01-01T12:00:00Z', () => {
    expect(julianDateToDate(2_451_545.0).toISOString()).toBe(
      '2000-01-01T12:00:00.000Z'
    );
  });
});

const FIELDS = ['full_name', 'a', 'e', 'i', 'om', 'w', 'ma', 'epoch'];

describe('parseSbdbRows', () => {
  it('parses rows into orbital elements with degrees converted to radians', () => {
    const rows = [
      [
        '   1 Ceres',
        '2.7691',
        '0.076',
        '10.594',
        '80.305',
        '73.597',
        '95.989',
        '2451545.0',
      ],
    ];
    const [body] = parseSbdbRows(FIELDS, rows);
    expect(body.name).toBe('1 Ceres');
    expect(body.elements.semiMajorAxisAU).toBeCloseTo(2.7691, 6);
    expect(body.elements.inclinationRad).toBeCloseTo(10.594 * D2R, 9);
    expect(body.elements.argPerihelionRad).toBeCloseTo(73.597 * D2R, 9);
    expect(body.elements.epoch.toISOString()).toBe('2000-01-01T12:00:00.000Z');
  });

  it('skips non-elliptic and non-finite rows', () => {
    const rows = [
      // a<0, e>1. Solvable depuis kepler.ts, mais le `ma` arrondi de SBDB ne date pas le
      // périhélie d'une orbite quasi parabolique (cf. parseSbdbRows) : ligne réelle.
      [
        'C/1847 J1 (Colla)',
        '-2926',
        '1.0007',
        '100.42',
        '176.08',
        '32.36',
        '-0.00',
        '2395800.5',
      ],
      ['hyperbolic', '-3.2', '1.4', '10', '20', '30', '40', '2451545.0'], // a<0, e>1
      ['garbage', 'x', 'y', 'z', '0', '0', '0', '2451545.0'], // non-finite
      ['ok', '2.5', '0.1', '5', '10', '15', '20', '2451545.0'],
    ];
    const parsed = parseSbdbRows(FIELDS, rows);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('ok');
  });

  it('returns [] when a required field is missing', () => {
    expect(parseSbdbRows(['full_name', 'a', 'e'], [['x', '2', '0.1']])).toEqual(
      []
    );
  });
});

/**
 * L'INSTANTANÉ LIVRÉ. Ce fichier est la donnée que voit un visiteur : jusqu'au lot 8b
 * l'application interrogeait JPL depuis le navigateur, ce qui n'a jamais marché en production
 * (réponse 200 sans en-tête CORS, donc jetée). Le test lit le fichier COMMITÉ, pas un double.
 */
describe('instantané des petits corps livré', () => {
  const file = JSON.parse(
    readFileSync(
      resolve(
        import.meta.dirname,
        '../../public/assets/small-bodies/dataset.json'
      ),
      'utf-8'
    )
  ) as SmallBodyDatasetFile;

  it('porte les quatre catégories, et aucune autre', () => {
    expect(Object.keys(file.categories).sort()).toEqual(
      [...ALL_SMALL_BODY_CATEGORIES].sort()
    );
  });

  it('porte une date de relevé lisible', () => {
    expect(file.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isFinite(Date.parse(file.retrieved))).toBe(true);
  });

  it('se propage réellement : chaque catégorie rend des orbites exploitables', () => {
    const dataset = parseSmallBodyDataset(file);
    expect(dataset.retrieved).toBe(file.retrieved);
    for (const category of ALL_SMALL_BODY_CATEGORIES) {
      const count = dataset.bodies.filter(
        (b) => b.category === category
      ).length;
      // Une catégorie vide dégraderait en silence : c'est exactement le défaut corrigé ici.
      expect(count, category).toBeGreaterThan(100);
    }
    expect(dataset.bodies.length).toBeGreaterThan(5000);
  });

  it('donne des éléments finis et elliptiques', () => {
    const { bodies } = parseSmallBodyDataset(file);
    for (const body of bodies.slice(0, 500)) {
      expect(body.name.length, body.name).toBeGreaterThan(0);
      expect(Number.isFinite(body.elements.semiMajorAxisAU)).toBe(true);
      expect(body.elements.eccentricity).toBeLessThan(1);
      expect(Number.isFinite(body.elements.epoch.getTime())).toBe(true);
    }
  });
});

describe('parseSmallBodyDataset', () => {
  const table = (name: string) => ({
    fields: FIELDS,
    data: [[name, '2.5', '0.1', '5', '10', '15', '20', '2451545.0']],
  });

  it('fusionne les catégories et tague chaque corps', () => {
    const dataset = parseSmallBodyDataset({
      retrieved: '2026-09-20',
      limitPerCategory: 2000,
      categories: {
        'main-belt': table('main-belt'),
        neo: table('neo'),
        comet: table('comet'),
        tno: table('tno'),
      },
    });
    expect(dataset.bodies).toHaveLength(4);
    expect(new Map(dataset.bodies.map((b) => [b.category, b.name]))).toEqual(
      new Map([
        ['main-belt', 'main-belt'],
        ['neo', 'neo'],
        ['comet', 'comet'],
        ['tno', 'tno'],
      ])
    );
  });

  it('garde les autres catégories quand une manque', () => {
    const dataset = parseSmallBodyDataset({
      retrieved: '2026-09-20',
      limitPerCategory: 2000,
      categories: { neo: table('neo'), comet: table('comet') },
    });
    expect(dataset.bodies).toHaveLength(2);
    expect(dataset.bodies.some((b) => b.category === 'tno')).toBe(false);
  });
});

describe('loadSmallBodies', () => {
  it('dégrade à un lot vide et sans date sur erreur réseau', async () => {
    const failing = (() =>
      Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    expect(await loadSmallBodies(failing)).toEqual({
      retrieved: null,
      bodies: [],
    });
  });

  it('dégrade à un lot vide sur réponse non ok', async () => {
    const notOk = (() =>
      Promise.resolve({
        ok: false,
        json: () => Promise.resolve({}),
      })) as unknown as typeof fetch;
    expect((await loadSmallBodies(notOk)).bodies).toEqual([]);
  });

  it('dégrade à un lot vide quand le serveur répond 200 avec autre chose', async () => {
    // Cas RÉEL, pas théorique : la réécriture SPA de Firebase sert `index.html` avec un code
    // 200 pour tout chemin inconnu (vérifié en production le 2026-09-20 sur ce chemin même,
    // avant le déploiement de l'actif). `res.ok` est donc vrai et ne protège de rien ; seule
    // l'analyse du corps échoue, et elle doit rendre un lot vide, pas casser le démarrage.
    const html = (() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.reject(new SyntaxError('Unexpected token <')),
      })) as unknown as typeof fetch;
    expect(await loadSmallBodies(html)).toEqual({
      retrieved: null,
      bodies: [],
    });
  });

  it('lit un instantané bien formé', async () => {
    const ok = (() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            retrieved: '2026-09-20',
            limitPerCategory: 2000,
            categories: {
              'main-belt': {
                fields: FIELDS,
                data: [
                  [
                    '2 Pallas',
                    '2.77',
                    '0.23',
                    '34.8',
                    '173',
                    '310',
                    '40',
                    '2451545.0',
                  ],
                ],
              },
            },
          }),
      })) as unknown as typeof fetch;
    const dataset = await loadSmallBodies(ok);
    expect(dataset.retrieved).toBe('2026-09-20');
    expect(dataset.bodies).toHaveLength(1);
    expect(dataset.bodies[0]!.name).toBe('2 Pallas');
    expect(dataset.bodies[0]!.category).toBe('main-belt');
  });
});
