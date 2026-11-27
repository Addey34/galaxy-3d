import { readFileSync, readdirSync } from 'node:fs';
import { shippedNeighbours } from './neighboursTestFixture';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { ExoplanetFile } from './exoplanets';
import {
  bucketOf,
  bucketUrl,
  buildHostModel,
  buildSystemModel,
  hostsByMember,
  keplerAxisAu,
  neighbourSystemOf,
  orbitExtentAu,
  orbitShape,
  planetMass,
  projectedSeparationAu,
  skyOffsetAu,
  starRadiusAu,
  SYSTEM_BUCKETS,
  type SystemHostRow,
  type SystemModel,
  type SystemPlanetRow,
  type SystemsFile,
} from './exoplanetSystems';
import {
  groupSystems,
  systemName,
  type NeighbourFile,
  type NeighbourSystem,
} from './neighbours';

const ROOT = join(process.cwd(), 'public/assets/sky');
const neighbours: NeighbourFile = shippedNeighbours();
const archive = JSON.parse(
  readFileSync(join(ROOT, 'exoplanets.json'), 'utf8')
) as ExoplanetFile;
const bucketFiles = readdirSync(join(ROOT, 'systems')).sort();
const buckets = bucketFiles.map(
  (f) =>
    JSON.parse(readFileSync(join(ROOT, 'systems', f), 'utf8')) as SystemsFile
);
const details = new Map<string, SystemHostRow>(
  buckets.flatMap((b) => b.systems.map((s) => [s[0], s] as const))
);
const systems = groupSystems(neighbours.stars);

function system(name: string): NeighbourSystem {
  const found = systems.find((s) => s.members.some((m) => m[0] === name));
  if (!found) throw new Error(`système absent : ${name}`);
  return found;
}
function model(name: string): SystemModel {
  const s = system(name);
  return buildSystemModel(
    s,
    systemName(s),
    hostsByMember(s, archive.systems),
    details
  );
}

/** Une ligne de planète écrite à la main, pour les règles. */
function planet(fields: Partial<Record<string, unknown>>): SystemPlanetRow {
  const p = {
    name: 'x b',
    period: null,
    periodCalc: null,
    axis: null,
    axisCalc: null,
    ecc: null,
    eccCalc: null,
    massE: null,
    massCalc: null,
    massKind: null,
    ...fields,
  };
  return [
    p.name,
    p.period,
    p.periodCalc,
    p.axis,
    p.axisCalc,
    p.ecc,
    p.eccCalc,
    null,
    null,
    null,
    null,
    p.massE,
    p.massCalc,
    p.massKind,
    null,
    null,
    0,
    0,
  ] as unknown as SystemPlanetRow;
}
const host = (massSun: number | null): SystemHostRow =>
  [
    'h',
    0,
    0,
    1,
    1,
    1,
    null,
    null,
    null,
    null,
    null,
    massSun,
    0,
    [],
  ] as unknown as SystemHostRow;

describe('les paquets livrés', () => {
  it('sont au nombre annoncé, et chaque système est dans le paquet que le client calcule', () => {
    expect(bucketFiles).toHaveLength(SYSTEM_BUCKETS);
    buckets.forEach((b, i) => {
      expect(b.bucket).toBe(i);
      expect(b.buckets).toBe(SYSTEM_BUCKETS);
      expect(b.count).toBe(b.systems.length);
      for (const s of b.systems) expect(bucketOf(s[0])).toBe(i);
    });
    expect(bucketUrl("Barnard's star")).toBe(
      `/assets/sky/systems/${String(bucketOf("Barnard's star")).padStart(2, '0')}.json`
    );
  });

  it('portent tous la même source datée et le compte total', () => {
    const first = buckets[0]!.source;
    for (const b of buckets) expect(b.source).toEqual(first);
    expect(first.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(details.size).toBe(first.systems);
    const planets = buckets.reduce(
      (n, b) => n + b.systems.reduce((k, s) => k + s[13].length, 0),
      0
    );
    expect(planets).toBe(first.planets);
  });

  it('une valeur absente est null, jamais un drapeau sans valeur', () => {
    for (const s of details.values())
      for (const p of s[13])
        for (const [v, c] of [
          [1, 2],
          [3, 4],
          [5, 6],
          [7, 8],
          [9, 10],
          [11, 12],
        ] as const)
          if (p[v] === null) expect(p[c], `${p[0]} champ ${v}`).toBeNull();
          else expect([0, 1]).toContain(p[c]);
  });
});

describe('les règles de représentation', () => {
  it('troisième loi de Kepler : la Terre à 1 UA, Proxima b à la valeur publiée', () => {
    expect(keplerAxisAu(365.25, 1)).toBeCloseTo(1, 12);
    const proxima = details.get('Proxima Cen')!;
    const b = proxima[13].find((p) => p[0] === 'Proxima Cen b')!;
    // La période et la masse de l'étoile publiées redonnent le demi-grand axe publié à 1 % près.
    expect(keplerAxisAu(b[1], proxima[11])! / b[3]!).toBeCloseTo(1, 1);
    expect(keplerAxisAu(null, 1)).toBeNull();
    expect(keplerAxisAu(10, null)).toBeNull();
  });

  it('une bande périastre-apoastre seulement avec a et e publiés, jamais une ellipse orientée', () => {
    const band = orbitShape(
      planet({ axis: 0.1, axisCalc: 0, ecc: 0.2, eccCalc: 0 }),
      null
    );
    expect(band.kind).toBe('band');
    if (band.kind === 'band') {
      expect(band.periastronAu).toBeCloseTo(0.08, 12);
      expect(band.apoastronAu).toBeCloseTo(0.12, 12);
    }
    expect(
      orbitShape(planet({ axis: 0.1, axisCalc: 0, ecc: 0, eccCalc: 0 }), null)
        .kind
    ).toBe('circle');
    expect(orbitShape(planet({ axis: 0.1, axisCalc: 0 }), null).kind).toBe(
      'axisOnly'
    );
    expect(orbitShape(planet({}), null).kind).toBe('none');
    // Sans demi-grand axe, la période et la masse de l'étoile le DÉRIVENT, et c'est dit.
    const derived = orbitShape(
      planet({ period: 365.25, periodCalc: 0 }),
      host(1)
    );
    expect(derived.kind).toBe('axisOnly');
    if (derived.kind === 'axisOnly') {
      expect(derived.axis.provenance).toBe('derived');
      expect(derived.axis.value).toBeCloseTo(1, 12);
    }
    // Une période sans masse d'étoile : rien n'est inventé.
    expect(
      orbitShape(planet({ period: 10, periodCalc: 0 }), host(null)).kind
    ).toBe('none');
  });

  it('un demi-grand axe calculé par l’archive est dit comme tel', () => {
    const shape = orbitShape(planet({ axis: 0.1, axisCalc: 1 }), null);
    expect(shape.kind === 'axisOnly' && shape.axis.provenance).toBe(
      'archiveCalculated'
    );
  });

  it('la masse : vraie, minimale (m sin i) ou calculée, jamais confondues', () => {
    expect(
      planetMass(planet({ massE: 2, massCalc: 0, massKind: 'Mass' }))?.kind
    ).toBe('mass');
    expect(
      planetMass(planet({ massE: 2, massCalc: 0, massKind: 'Msini' }))?.kind
    ).toBe('minimum');
    expect(
      planetMass(planet({ massE: 2, massCalc: 1, massKind: 'Mass' }))?.kind
    ).toBe('archiveCalculated');
    expect(
      planetMass(
        planet({ massE: 2, massCalc: 0, massKind: 'M-R relationship' })
      )?.kind
    ).toBe('archiveCalculated');
    expect(planetMass(planet({}))).toBeNull();
  });
});

describe('les systèmes du voisinage, sur les fichiers livrés', () => {
  // Oracle écrit à la main (désignations de l'archive lues le 2026-11-25), indépendant du calcul.
  const oracle: Array<[string, string]> = [
    ['Proxima Centauri', 'Proxima Cen'],
    ["Barnard's Star", "Barnard's star"],
    ['Struve 2398 A', 'Gl 725 A'],
    ['Struve 2398 B', 'Gl 725 B'],
    ['Groombridge 34', 'GJ 15 A'],
    ['Ran', 'eps Eri'],
    ['Gl 71', 'tau Cet'],
    ['Gl 54.1', 'YZ Cet'],
    ['GJ 1002', 'GJ 1002'],
  ];

  it.each(oracle)(
    '%s porte l’hôte %s, et lui seul parmi ses composantes',
    (star, hostName) => {
      const s = system(star);
      const hosts = hostsByMember(s, archive.systems);
      const index = s.members.findIndex((m) => m[0] === star);
      expect(hosts[index]).toContain(hostName);
      hosts.forEach((list, i) => {
        if (i !== index) expect(list).not.toContain(hostName);
      });
    }
  );

  it('chaque hôte reconnu est dans l’instantané détaillé, avec les MÊMES planètes que la couche du ciel', () => {
    for (const s of systems) {
      const m = buildSystemModel(
        s,
        systemName(s),
        hostsByMember(s, archive.systems),
        details
      );
      expect(m.missingHosts, systemName(s)).toEqual([]);
      for (const name of hostsByMember(s, archive.systems).flat()) {
        const sky = archive.systems.find((h) => h[0] === name)!;
        expect(
          details
            .get(name)![13]
            .map((p) => p[0])
            .sort(),
          name
        ).toEqual(sky[7].map((p) => p[0]).sort());
      }
    }
  });

  it('aucun rayon de planète du voisinage n’est mesuré : la vue ne peut pas le dire mesuré', () => {
    for (const s of systems) {
      const m = model(s.members[0]![0]);
      for (const p of m.planets)
        if (p.row[9] !== null) expect(p.row[10], p.row[0]).toBe(1);
    }
  });

  it('Proxima : système proche, deux orbites représentables, une étoile à sa vraie taille', () => {
    const m = model('Proxima Centauri');
    expect(m.spatial).toBe(true);
    expect(m.planets.map((p) => p.row[0])).toEqual([
      'Proxima Cen d',
      'Proxima Cen b',
    ]);
    expect(m.planets.every((p) => p.shape.kind !== 'none')).toBe(true);
    // L'archive compte trois étoiles (α Cen A, B et Proxima) ; le catalogue a un repère à part pour Proxima.
    expect(m.archiveStars).toBe(3);
    expect(m.components).toHaveLength(1);
    expect(starRadiusAu(m.components[0]!.host)).toBeGreaterThan(0);
  });

  it('Barnard : plusieurs planètes, chacune avec sa plage de distances', () => {
    const m = model("Barnard's Star");
    expect(m.planets).toHaveLength(4);
    expect(m.planets.every((p) => p.shape.kind === 'band')).toBe(true);
    // Triées du plus proche au plus lointain de l'étoile.
    const axes = m.planets.map((p) =>
      p.shape.kind === 'band' ? p.shape.axis.value : 0
    );
    expect([...axes].sort((a, b) => a - b)).toEqual(axes);
    expect(orbitExtentAu(m, 0)).toBeGreaterThan(axes[3]!);
  });

  it('Struve 2398 : deux composantes, une planète chacune, à leur séparation projetée', () => {
    const m = model('Struve 2398 A');
    expect(m.components).toHaveLength(2);
    expect(m.planets.map((p) => [p.row[0], p.component])).toEqual([
      ['Gl 725 A b', 0],
      ['Gl 725 B c', 1],
    ]);
    const sep = m.components[1]!.separationAu;
    const [x, y] = m.components[1]!.offsetAu;
    expect(Math.hypot(x, y) / sep).toBeCloseTo(1, 3);
    // Ordre de grandeur publié : environ 13″ à 3,5 pc, soit quelques dizaines d'UA.
    expect(sep).toBeGreaterThan(30);
    expect(sep).toBeLessThan(80);
  });

  it('GJ 1002 : demi-grands axes connus mais excentricités non publiées, orbite incomplète', () => {
    const m = model('GJ 1002');
    expect(m.planets).toHaveLength(2);
    expect(m.planets.every((p) => p.shape.kind === 'axisOnly')).toBe(true);
  });

  it('Sirius : deux composantes, aucune planète cataloguée, vue documentaire', () => {
    const m = model('Sirius');
    expect(m.components).toHaveLength(2);
    expect(m.planets).toEqual([]);
    expect(m.spatial).toBe(false);
  });

  it('la séparation projetée vaut l’angle × la distance (définition du parsec)', () => {
    const s = system('Sirius');
    const [a, b] = s.members;
    const sep = projectedSeparationAu(a!, b!);
    const [x, y] = skyOffsetAu(a!, b!);
    expect(Math.hypot(x, y) / sep).toBeCloseTo(1, 3);
  });
});

describe('un système choisi dans le CIEL (GAL-UNIVERSE-007)', () => {
  const skyOf = (name: string) => {
    const found = archive.systems.find((s) => s[0] === name);
    if (!found) throw new Error(`hôte absent du ciel : ${name}`);
    return found;
  };

  it('les deux instantanés partagent leurs identifiants : un seul hôte du ciel manque au détaillé, et il est nommé', () => {
    const missing = archive.systems
      .map((s) => s[0])
      .filter((name) => !details.has(name));
    // Lus à des dates différentes (couche du ciel, puis instantané détaillé) : l'écart est CONNU et borné.
    expect(missing).toEqual(['Gliese 48']);
    let same = 0;
    for (const s of archive.systems) {
      const d = details.get(s[0]);
      if (!d) continue;
      const a = s[7]
        .map((p) => p[0])
        .sort()
        .join('|');
      const b = d[13]
        .map((p) => p[0])
        .sort()
        .join('|');
      if (a === b) same += 1;
    }
    // Les planètes listées coïncident pour la quasi-totalité des hôtes communs (écart mesuré au 2026-11-25).
    expect(same / (archive.systems.length - missing.length)).toBeGreaterThan(
      0.99
    );
  });

  it('un hôte lointain : une composante, ses planètes, aucune étoile inventée', () => {
    const m = buildHostModel(skyOf('TRAPPIST-1'), details.get('TRAPPIST-1')!);
    expect(m.components).toHaveLength(1);
    expect(m.components[0]!.row).toBeNull();
    expect(m.components[0]!.archiveDistPc).toBeGreaterThan(10);
    expect(m.planets).toHaveLength(7);
    expect(m.planets.every((p) => p.shape.kind === 'band')).toBe(true);
    expect(m.spatial).toBe(true);
  });

  it('circumbinaire : la composante le dit, et aucune planète n’est rattachée à une étoile seule', () => {
    const m = buildHostModel(skyOf('Kepler-47'), details.get('Kepler-47')!);
    expect(m.components[0]!.circumbinary).toBe(true);
    expect(m.archiveStars).toBe(2);
    expect(m.planets.every((p) => p.row[17] === 1)).toBe(true);
  });

  it('absent de l’instantané détaillé : vue documentaire, la raison est portée par le modèle', () => {
    const m = buildHostModel(skyOf('Gliese 48'), null);
    expect(m.planets).toEqual([]);
    expect(m.spatial).toBe(false);
    expect(m.missingHosts).toEqual(['Gliese 48']);
  });

  it('une microlentille sans demi-grand axe ni masse d’étoile : la planète reste, sans orbite', () => {
    const name = 'KMT-2024-BLG-0404L';
    const m = buildHostModel(skyOf(name), details.get(name)!);
    expect(m.planets.some((p) => p.shape.kind === 'none')).toBe(true);
  });

  it('un hôte du ciel qui est une étoile voisine retrouve son système du catalogue', () => {
    expect(
      neighbourSystemOf('eps Eri', systems, archive.systems)?.members.map(
        (m) => m[0]
      )
    ).toEqual(['Ran']);
    expect(
      neighbourSystemOf('Gl 725 B', systems, archive.systems)
        ?.members.map((m) => m[0])
        .sort()
    ).toEqual(['Struve 2398 A', 'Struve 2398 B']);
    expect(
      neighbourSystemOf('TRAPPIST-1', systems, archive.systems)
    ).toBeNull();
    expect(
      neighbourSystemOf('pas un hôte', systems, archive.systems)
    ).toBeNull();
  });
});
