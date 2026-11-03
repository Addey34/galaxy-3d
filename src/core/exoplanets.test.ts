import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  systemAsStar,
  UNKNOWN_DISTANCE_PC,
  type ExoplanetFile,
} from './exoplanets';
import { starDirection } from './starCatalogue';

const file = JSON.parse(
  readFileSync('public/assets/sky/exoplanets.json', 'utf8')
) as ExoplanetFile;
const find = (host: string) => file.systems.find((s) => s[0] === host)!;

describe("systèmes d'exoplanètes livrés", () => {
  it('ont la forme que leurs champs annoncent et les comptes qu’ils déclarent', () => {
    expect(file.fields).toHaveLength(8);
    expect(file.planetFields).toHaveLength(6);
    expect(file.systems).toHaveLength(file.count);
    expect(file.count).toBeGreaterThan(4500);
    const planets = file.systems.reduce((n, s) => n + s[7].length, 0);
    expect(planets).toBe(file.source.planets);
    expect(file.source.acknowledgementUrl).toMatch(/exoplanetarchive/);
    expect(file.source.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('ont des positions valides et des planètes nommées', () => {
    for (const s of file.systems) {
      expect(s[1]).toBeGreaterThanOrEqual(0);
      expect(s[1]).toBeLessThan(360);
      expect(Math.abs(s[2])).toBeLessThanOrEqual(90);
      expect(s[7].length).toBeGreaterThan(0);
      for (const p of s[7]) expect(p[0].length).toBeGreaterThan(0);
    }
  });

  it('une valeur absente est null, jamais 0 ni NaN', () => {
    for (const s of file.systems)
      for (const p of s[7])
        for (const v of p.slice(1, 5))
          if (v !== null) {
            expect(Number.isFinite(v as number)).toBe(true);
            expect(v).not.toBe(0);
          }
  });

  it('connaissent les systèmes repères : Proxima, TRAPPIST-1 et les huit planètes de Kepler-90', () => {
    const proxima = find('Proxima Cen');
    expect(proxima[3]).toBeGreaterThan(1.2);
    expect(proxima[3]).toBeLessThan(1.4);
    expect(find('TRAPPIST-1')[7]).toHaveLength(7);
    // L'archive range Kepler-90 sous l'hôte « KOI-351 » : la huitième s'y nomme « Kepler-90 i ».
    const kepler90 = find('KOI-351')[7];
    expect(kepler90).toHaveLength(8);
    expect(kepler90.some((p) => p[0] === 'Kepler-90 i')).toBe(true);
  });
});

describe('systemAsStar', () => {
  it("donne au système la forme d'une étoile du catalogue, donc sa position à une date", () => {
    const row = systemAsStar(find('Proxima Cen'));
    expect(row[8]).toBe('Proxima Cen');
    const now = [0, 0, 0];
    const later = [0, 0, 0];
    starDirection(row, 0, now);
    starDirection(row, 1000, later);
    // Proxima : environ 3,8 arcsec par an, soit environ 1,05° en 1 000 ans.
    const moved =
      (Math.acos(
        now[0]! * later[0]! + now[1]! * later[1]! + now[2]! * later[2]!
      ) *
        180) /
      Math.PI;
    expect(moved).toBeGreaterThan(0.8);
    expect(moved).toBeLessThan(1.4);
  });

  it('une distance ou un mouvement inconnus prennent les valeurs neutres du catalogue', () => {
    const row = systemAsStar([
      'X',
      10,
      20,
      null,
      null,
      null,
      null,
      [['X b', null, null, null, null, null]],
    ]);
    expect(row[4]).toBe(UNKNOWN_DISTANCE_PC);
    expect(row[5]).toBe(0);
    expect(row[6]).toBe(0);
    expect(row[3]).toBeNull();
  });
});

describe('METHOD_KEYS', () => {
  it('couvrent chaque méthode du fichier livré, et chaque clé existe dans les quatre langues', async () => {
    const { METHOD_KEYS } = await import('@/ui/exoplanetCard');
    const dictionaries = {
      en: (await import('@/i18n/dict-card-en')).cardEn,
      fr: (await import('@/i18n/dict-card-fr')).cardFr,
      es: (await import('@/i18n/dict-card-es')).cardEs,
      'pt-BR': (await import('@/i18n/dict-card-pt-BR')).cardPtBR,
    } as Record<string, Record<string, string>>;
    const used = new Set(file.systems.flatMap((s) => s[7].map((p) => p[5])));
    for (const method of used) {
      if (method === null) continue;
      expect(
        METHOD_KEYS[method],
        `méthode sans phrase : ${method}`
      ).toBeDefined();
    }
    for (const [locale, dict] of Object.entries(dictionaries))
      for (const key of Object.values(METHOD_KEYS))
        expect(dict[key], `${locale} / ${key}`).toBeTruthy();
  });

  it('toute clé exo.* écrite dans la fiche existe dans les quatre langues', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/ui/exoplanetCard.ts', 'utf8');
    const keys = [...new Set(source.match(/'exo\.[A-Za-z.]+'/g) ?? [])].map(
      (k) => k.slice(1, -1)
    );
    expect(keys.length).toBeGreaterThan(10);
    const dictionaries = [
      (await import('@/i18n/dict-card-en')).cardEn,
      (await import('@/i18n/dict-card-fr')).cardFr,
      (await import('@/i18n/dict-card-es')).cardEs,
      (await import('@/i18n/dict-card-pt-BR')).cardPtBR,
    ] as Record<string, string>[];
    for (const dict of dictionaries)
      for (const key of keys) expect(dict[key], key).toBeTruthy();
  });
});
