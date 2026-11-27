import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildRow,
  chooseGaia,
  GAIA_ENABLED,
  propagate,
  type GaiaCandidate,
  type HygStar,
} from '../../scripts/generate-neighbours.mjs';
import type { NeighbourFile } from '@/core/neighbours';

/**
 * LES ASSOCIATIONS HYG → GAIA DR3 (GAL-UNIVERSE-001-QUAL, lot B). Une étoile n'est adoptée de Gaia
 * que si c'est la MÊME étoile : parallaxe, mouvement propre et éclat concordent, et deux
 * composantes d'un système ne prennent jamais la même source. Mesuré le 2026-11-22 : la première
 * version (parallaxe seule) avait PERMUTÉ A et B de 61 Cyg, de Struve 2398 et de Groombridge 34,
 * adopté une composante faible pour Keid et manqué GJ 3618 (cône trop étroit).
 */

const star = (over: Partial<HygStar> = {}): HygStar => ({
  id: '1',
  hip: null,
  gl: 'Gl 1',
  proper: null,
  bf: null,
  spect: 'M1V',
  raDeg: 100,
  decDeg: 10,
  distPc: 3.5,
  pmRa: 1000,
  pmDec: 500,
  rv: 0,
  vmag: 8,
  ...over,
});
const gaia = (over: Partial<GaiaCandidate> = {}): GaiaCandidate => ({
  sourceId: '100',
  ra: 100,
  dec: 10,
  parallax: 1000 / 3.5,
  parallaxError: 0.05,
  pmRa: 1002,
  pmDec: 498,
  rv: null,
  ruwe: 1.0,
  gMag: 7,
  ...over,
});

describe('chooseGaia : la même étoile, pas une voisine', () => {
  it('adopte la contrepartie concordante', () => {
    expect(chooseGaia(star(), [gaia()]).gaia?.sourceId).toBe('100');
  });

  it('écarte une source dont le mouvement propre diffère (autre étoile, même parallaxe)', () => {
    const other = gaia({ sourceId: '200', pmRa: -900, pmDec: 100 });
    const r = chooseGaia(star(), [other]);
    expect(r.gaia).toBeNull();
    expect(r.reason).toMatch(/aucune contrepartie/);
  });

  it("écarte une source d'éclat incompatible (composante faible prise pour la brillante)", () => {
    const faint = gaia({ sourceId: '300', gMag: 16 });
    expect(chooseGaia(star({ vmag: 4.4 }), [faint]).gaia).toBeNull();
  });

  it('refuse une parallaxe à plus de 20 % de HYG, un RUWE élevé, un signal faible', () => {
    expect(chooseGaia(star(), [gaia({ parallax: 400 })]).gaia).toBeNull();
    expect(chooseGaia(star(), [gaia({ ruwe: 2.4 })]).reason).toMatch(/RUWE/);
    expect(chooseGaia(star(), [gaia({ parallaxError: 30 })]).reason).toMatch(
      /20 sigmas/
    );
  });

  it('A prend la source la plus brillante, B la suivante, et jamais deux fois la même (falsification : sans `taken`)', () => {
    const bright = gaia({ sourceId: 'A', gMag: 7.2 });
    const faint = gaia({ sourceId: 'B', gMag: 9.7, pmRa: 995 });
    const candidates = [faint, bright];
    const taken = new Set<string>();
    // L'appelant va de la composante la plus brillante de HYG à la plus faible.
    const a = chooseGaia(star({ vmag: 8.1 }), candidates, taken);
    taken.add(a.gaia!.sourceId);
    const b = chooseGaia(star({ id: '2', vmag: 11 }), candidates, taken);
    expect(a.gaia?.sourceId).toBe('A');
    expect(b.gaia?.sourceId).toBe('B');
    // Sans la mémoire des sources prises, B reprendrait A : le témoin tombe.
    expect(
      chooseGaia(star({ id: '2', vmag: 11 }), candidates).gaia?.sourceId
    ).toBe('A');
  });

  it('ne se sert pas du mouvement propre plafonné de HYG (Barnard)', () => {
    const barnard = star({
      pmRa: -797.84,
      pmDec: 9999.99,
      distPc: 1.8238,
      vmag: 9.54,
    });
    const g = gaia({
      sourceId: 'B',
      parallax: 546.98,
      pmRa: -801.55,
      pmDec: 10362.39,
      gMag: 8.2,
    });
    expect(chooseGaia(barnard, [g]).gaia?.sourceId).toBe('B');
  });
});

describe('retour de J2016 à J2000 et unités', () => {
  it('Gaia J2016,0 → J2000,0 : la position recule du mouvement propre de 16 ans', () => {
    // 1 000 mas/an en ascension droite à δ = 0 : 16″ sur 16 ans, soit 0,004444°.
    const back = propagate(100, 0, 1000, 0, -16);
    expect(100 - back.raDeg).toBeCloseTo(0.0044444, 6);
    expect(back.decDeg).toBeCloseTo(0, 9);
    // Et le mouvement en ascension droite est déjà multiplié par cos δ : à δ = 60° il double en degrés.
    const high = propagate(100, 60, 1000, 0, -16);
    expect(100 - high.raDeg).toBeCloseTo(0.0088889, 6);
  });

  it("une ligne Gaia porte distance = 1/parallaxe, l'incertitude propagée et l'identifiant", () => {
    const row = buildRow(star(), gaia({ parallax: 500, parallaxError: 0.5 }));
    // [name, ids, spectral, ra, dec, distPc, distErrPc, vmag, pmRa, pmDec, rv, origin, id]
    expect(row[5]).toBeCloseTo(2, 5);
    expect(row[6]).toBeCloseTo(0.002, 5);
    expect(row[11]).toBe('gaia-dr3');
    expect(row[12]).toBe('100');
  });

  it("une ligne HYG n'invente ni incertitude ni vitesse radiale nulle", () => {
    const row = buildRow(star({ rv: 0 }), null);
    expect(row[6]).toBeNull();
    expect(row[10]).toBeNull();
    expect(row[11]).toBe('hyg-v44');
    expect(row[12]).toBeNull();
  });
});

describe('les associations livrées', () => {
  const file = JSON.parse(
    readFileSync('public/assets/sky/neighbours.json', 'utf8')
  ) as NeighbourFile;
  const byName = new Map(file.stars.map((s) => [s[0], s]));

  it("aucune source Gaia n'est adoptée deux fois", () => {
    const ids = file.stars.map((s) => s[12]).filter((id) => id !== null);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.skipIf(!GAIA_ENABLED)(
    'les composantes A et B des trois doubles confondues par la première version sont dans le bon sens',
    () => {
      // Identifiants lus dans l'archive Gaia le 2026-11-22 : la composante la plus brillante de HYG
      // (V) porte la source la plus brillante (G), et son mouvement propre est celui de HYG.
      const expected: Array<[string, string, number, number]> = [
        ['Gl 820A', '1872046609345556480', 4164, 3250],
        ['Gl 820B', '1872046574983497216', 4106, 3156],
        ['Struve 2398 A', '2154880616774131840', -1312, 1792],
        ['Struve 2398 B', '2154880616774131712', -1400, 1863],
        ['Groombridge 34', '385334230892516480', 2892, 412],
        ['Gl 15B', '385334196532776576', 2863, 336],
      ];
      for (const [name, id, pmRa, pmDec] of expected) {
        const row = byName.get(name)!;
        expect(row[12], name).toBe(id);
        expect(row[8], name).toBeCloseTo(pmRa, -1);
        expect(row[9], name).toBeCloseTo(pmDec, -1);
      }
    }
  );

  it('Keid reste à HYG (la source Gaia retenue par la première version était une composante faible)', () => {
    expect(byName.get('Keid')![11]).toBe('hyg-v44');
  });

  it.skipIf(!GAIA_ENABLED)(
    'GJ 3618, manquée par un cône trop étroit, vient de Gaia (parallaxe 207 mas, soit 4,83 pc)',
    () => {
      const row = byName.get('GJ 3618')!;
      expect(row[11]).toBe('gaia-dr3');
      expect(row[5]).toBeCloseTo(4.83, 2);
    }
  );

  it.skipIf(!GAIA_ENABLED)(
    'Proxima est à 1,30197 pc, à 0,5 % de HYG (1,2959 pc) : la parallaxe affinée',
    () => {
      expect(byName.get('Proxima Centauri')![5]).toBeCloseTo(1.30197, 4);
    }
  );

  it('valeurs manquantes : HYG sans incertitude ni identifiant, Gaia avec les deux', () => {
    for (const s of file.stars) {
      if (s[11] === 'gaia-dr3') {
        expect(s[6]).toBeGreaterThan(0);
        expect(s[12]).not.toBeNull();
      } else {
        expect(s[6]).toBeNull();
        expect(s[12]).toBeNull();
      }
      // Distances en parsecs, positives et bornées ; ascension droite en degrés.
      expect(s[5]).toBeGreaterThan(1.2);
      expect(s[5]).toBeLessThanOrEqual(5.0 + 1e-9 + 0.1);
      expect(s[3]).toBeGreaterThanOrEqual(0);
      expect(s[3]).toBeLessThan(360);
    }
  });
});
