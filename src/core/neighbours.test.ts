import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  approach,
  AU_PER_PARSEC,
  distanceFacts,
  groupSystems,
  markerLabel,
  namesOf,
  neighbourAsStar,
  SAME_MARKER_ARCSEC,
  separationArcsec,
  systemName,
  totalProperMotionArcsecPerYear,
  type NeighbourFile,
  type NeighbourRow,
} from './neighbours';
import { starDirection, yearsSinceJ2000 } from './starCatalogue';

const file = JSON.parse(
  readFileSync('public/assets/sky/neighbours.json', 'utf8')
) as NeighbourFile;
const byName = (name: string): NeighbourRow => {
  const row = file.stars.find((s) => s[0] === name);
  if (!row) throw new Error(`absent : ${name}`);
  return row;
};

describe('le fichier des étoiles voisines', () => {
  it('suit son propre en-tête et ne dépasse pas sa borne de distance', () => {
    expect(file.count).toBe(file.stars.length);
    expect(file.fields).toHaveLength(file.stars[0]!.length);
    for (const s of file.stars)
      expect(s[5]).toBeLessThanOrEqual(file.source.neighbours.maxDistancePc);
  });

  it('est trié par distance, Proxima Centauri en tête', () => {
    const d = file.stars.map((s) => s[5]);
    expect([...d].sort((a, b) => a - b)).toEqual(d);
    expect(file.stars[0]![0]).toBe('Proxima Centauri');
  });

  it("dit d'où vient chaque ligne et ne publie d'incertitude que pour Gaia", () => {
    for (const s of file.stars) {
      if (s[11] === 'gaia-dr3') {
        expect(s[12]).toMatch(/^\d{10,}$/);
        expect(s[6]).toBeGreaterThan(0);
      } else {
        expect(s[11]).toBe('hyg-v44');
        expect(s[12]).toBeNull();
        expect(s[6]).toBeNull();
      }
    }
    // Les deux sources sont citées, avec le remerciement exigé verbatim par l'ESA.
    expect(file.source.gaia.acknowledgement).toMatch(
      /^This work has made use of data from the European Space Agency \(ESA\) mission Gaia/
    );
    expect(file.source.hyg.license).toBe('CC-BY-SA-4.0');
  });

  it('corrige le plafond de HYG : le mouvement propre de Barnard dépasse 9 999,99 mas/an', () => {
    const barnard = byName("Barnard's Star");
    expect(barnard[11]).toBe('gaia-dr3');
    expect(Math.abs(barnard[9])).toBeGreaterThan(10_000);
    // Aucune ligne HYG ne porte la valeur plafonnée (le générateur les écarte).
    for (const s of file.stars)
      if (s[11] === 'hyg-v44') {
        expect(Math.abs(s[8])).toBeLessThan(9999.99);
        expect(Math.abs(s[9])).toBeLessThan(9999.99);
      }
  });
});

describe('distances', () => {
  it('Proxima est à 4,25 al (Gaia DR3 : 768,07 mas), Barnard à 5,96, Sirius à 8,6', () => {
    expect(distanceFacts(byName('Proxima Centauri')).lightYears).toBeCloseTo(
      4.2465,
      3
    );
    expect(distanceFacts(byName("Barnard's Star")).lightYears).toBeCloseTo(
      5.963,
      2
    );
    expect(distanceFacts(byName('Sirius')).lightYears).toBeCloseTo(8.6, 1);
  });

  it('1 pc vaut 206 264,8 UA, et 1 UA = 1 cm met Proxima à 2,7 km', () => {
    expect(AU_PER_PARSEC).toBeCloseTo(206_264.806, 3);
    const proxima = distanceFacts(byName('Proxima Centauri'));
    expect(proxima.au).toBeCloseTo(268_540, -2);
    expect(proxima.kmAtOneCentimetre).toBeCloseTo(2.685, 2);
  });

  it("ne publie pas d'incertitude quand la source n'en donne pas", () => {
    expect(distanceFacts(byName('Sirius')).lightYearsError).toBeNull();
    const proxima = distanceFacts(byName('Proxima Centauri'));
    expect(proxima.lightYearsError).toBeGreaterThan(0);
    expect(proxima.lightYearsError!).toBeLessThan(0.001);
  });
});

describe('systèmes', () => {
  const systems = groupSystems(file.stars);

  it('regroupe les doubles indiscernables : Sirius A et B, α Cen A et B', () => {
    const sirius = systems.find((s) => systemName(s) === 'Sirius')!;
    expect(sirius.members.length).toBeGreaterThanOrEqual(2);
    const alpha = systems.find((s) =>
      s.members.some((m) => m[0] === 'Rigil Kentaurus')
    )!;
    expect(alpha.members.map((m) => m[0]).sort()).toEqual(
      ['Rigil Kentaurus', 'Toliman'].sort()
    );
    // Proxima est à plus de 2° de α Cen A et B : un autre repère.
    expect(alpha.members.some((m) => m[0] === 'Proxima Centauri')).toBe(false);
  });

  it('ne perd et ne duplique aucune étoile', () => {
    const all = systems.flatMap((s) => s.members.map((m) => m[0]));
    expect(all).toHaveLength(file.stars.length);
    expect(new Set(all).size).toBe(all.length);
  });

  it('le seuil fait la différence (falsification : un seuil négatif ne regroupe rien)', () => {
    const split = groupSystems(file.stars, -1);
    expect(split.length).toBe(file.stars.length);
    expect(systems.length).toBeLessThan(split.length);
    expect(SAME_MARKER_ARCSEC).toBeLessThanOrEqual(120);
  });

  it('nomme un système par sa composante la plus brillante', () => {
    const alpha = systems.find((s) =>
      s.members.some((m) => m[0] === 'Toliman')
    )!;
    expect(systemName(alpha)).toBe('Rigil Kentaurus');
  });

  it('retrouve un système par un alias usuel (Alpha Centauri, Proxima, Epsilon Eridani)', () => {
    const find = (n: string) =>
      systems.find((s) => namesOf(s).includes(n)) ?? null;
    expect(find('Alpha Centauri')).not.toBeNull();
    expect(find('Alpha Centauri C')).toBe(find('Proxima'));
    expect(find('Epsilon Eridani')).toBe(
      systems.find((s) => s.members.some((m) => m[0] === 'Ran')) ?? null
    );
  });

  it('séparation : deux points identiques à 0, un degré de déclinaison à 3 600″', () => {
    const a = byName('Proxima Centauri');
    expect(separationArcsec(a, a)).toBe(0);
    const shifted = [...a] as unknown as NeighbourRow;
    (shifted as unknown as number[])[4] = a[4] + 1;
    expect(separationArcsec(a, shifted)).toBeCloseTo(3600, 3);
  });
});

describe('position, mouvement, texte', () => {
  it('place Proxima à J2000 dans sa direction publiée, puis la déplace par son mouvement propre', () => {
    const star = neighbourAsStar(byName('Proxima Centauri'));
    const out = new Float64Array(3);
    starDirection(star, 0, out);
    const ra = (Math.atan2(out[1]!, out[0]!) * 180) / Math.PI;
    expect(((ra % 360) + 360) % 360).toBeCloseTo(217.4289, 3);
    const later = new Float64Array(3);
    // 26 ans après J2000 (2026) : environ 100″ de mouvement propre.
    starDirection(
      star,
      yearsSinceJ2000(new Date('2026-01-01T12:00:00Z')),
      later
    );
    const cos = out[0]! * later[0]! + out[1]! * later[1]! + out[2]! * later[2]!;
    const arcsec = (Math.acos(Math.min(1, cos)) * 180 * 3600) / Math.PI;
    expect(arcsec).toBeGreaterThan(95);
    expect(arcsec).toBeLessThan(105);
  });

  it('mouvement propre total : Barnard ~10,4″/an, la plus rapide du fichier', () => {
    const rates = file.stars.map(
      (s) => [s[0], totalProperMotionArcsecPerYear(s)] as const
    );
    const fastest = rates.reduce((a, b) => (b[1] > a[1] ? b : a));
    expect(fastest[0]).toBe("Barnard's Star");
    expect(fastest[1]).toBeCloseTo(10.39, 1);
  });

  it('sens de la vitesse radiale : Barnard se rapproche, inconnue → null', () => {
    expect(approach(byName("Barnard's Star"))).toBe('approaching');
    const unknown = file.stars.find((s) => s[10] === null);
    if (unknown) expect(approach(unknown)).toBeNull();
  });

  it("le texte d'un repère porte le nom et la distance", () => {
    const systems = groupSystems(file.stars);
    const proxima = systems.find((s) => systemName(s) === 'Proxima Centauri')!;
    expect(markerLabel(proxima, (ly) => `${ly.toFixed(1)} ly`)).toBe(
      'Proxima Centauri · 4.2 ly'
    );
  });
});
