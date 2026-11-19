/**
 * Intégrité des données météo : une donnée ABSENTE n'est pas un zéro (GAL-METEO-DATA-001).
 *
 * Fixtures synthétiques seulement : aucune réponse réelle d'Open-Meteo ni du service de données.
 * Ce fichier tient la politique des absences de bout en bout, du JSON de réponse à l'octet RGBA :
 * parse (NaN, jamais 0 ; alignement géographique garanti), interpolation, encodage couleur,
 * encodage des nuages, vent, diagnostics. Les zéros légitimes sont préservés partout.
 */
import { describe, expect, it } from 'vitest';
import { PRESSURE_MODEL_SETTINGS, WIND_SETTINGS } from '@/config/engine';
import {
  assertRegularStep,
  assertUsableGrid,
  chunkCoords,
  cloudCoverToRGBA,
  countFiniteCells,
  meteoGridCoords,
  meteoGridDims,
  parseScalarGrid,
  sampleScalar,
  type ScalarGrid,
} from './meteoGrid';
import { describeMeteoGrid } from './meteoDiagnostics';
import {
  scalarGridToRGBA,
  PRECIP_PALETTE,
  TEMPERATURE_PALETTE,
} from './meteoPalette';
import {
  assertUsableWind,
  countValidWind,
  sampleWind,
  windGridFromScalars,
  type WindGrid,
} from './windField';

const COARSE = { step: 90, maxLat: 90 }; // 3 rangées × 4 colonnes = 12 points
const FINE = { step: 4, maxLat: 90 }; // 4 186 points en 5 lots

/** Un point de réponse Open-Meteo dont la série horaire vaut `series`. */
const point = (series: unknown, variable = 'temperature_2m') => ({
  hourly: { [variable]: series },
});

const cells = (count: number, make: (i: number) => unknown) =>
  Array.from({ length: count }, (_, i) => make(i));

function scalar(values: number[], nLat = 3, nLon = 4): ScalarGrid {
  return {
    step: 90,
    latMin: -90,
    lonMin: -180,
    nLat,
    nLon,
    values: Float32Array.from(values),
  };
}

describe('parseScalarGrid : une absence est NaN, jamais 0', () => {
  it('préserve les VRAIS zéros (0 °C, 0 %, 0 mm)', () => {
    const response = cells(12, (i) => point([i === 3 ? 0 : i + 1]));
    const g = parseScalarGrid(response, 'temperature_2m', COARSE, 0);
    expect(g.values[3]).toBe(0);
    expect(Object.is(g.values[3], 0)).toBe(true);
    expect(countFiniteCells(g.values)).toBe(12);
  });

  it('null, undefined, Infinity et texte deviennent NaN, sans toucher aux voisins', () => {
    const series = [null, undefined, Infinity, -Infinity, NaN, 'x', 0];
    const response = cells(12, (i) =>
      point([i < series.length ? series[i] : i])
    );
    const g = parseScalarGrid(response, 'temperature_2m', COARSE, 0);
    for (let i = 0; i < 6; i++) expect(g.values[i]).toBeNaN();
    expect(g.values[6]).toBe(0); // le zéro légitime reste un zéro
    expect(g.values[7]).toBe(7);
  });

  it('série trop courte pour l’heure demandée : NaN (et pas la dernière valeur, ni 0)', () => {
    const response = cells(12, (i) => point(i === 5 ? [1] : [1, 2]));
    const g = parseScalarGrid(response, 'temperature_2m', COARSE, 1);
    expect(g.values[5]).toBeNaN();
    expect(g.values[4]).toBe(2);
  });

  it('série ou variable absente : NaN', () => {
    const response = cells(12, (i) =>
      i === 2 ? { hourly: {} } : i === 4 ? point(undefined) : point([9])
    );
    const g = parseScalarGrid(response, 'temperature_2m', COARSE, 0);
    expect(g.values[2]).toBeNaN();
    expect(g.values[4]).toBeNaN();
    expect(g.values[3]).toBe(9);
  });

  it('un point SANS hourly garde sa cellule : les suivantes ne se décalent pas', () => {
    const response = cells(12, (i) =>
      i === 5 ? { error: true, reason: 'x' } : point([i * 10])
    );
    const g = parseScalarGrid(response, 'temperature_2m', COARSE, 0);
    expect(g.values[5]).toBeNaN();
    // Une cellule ignorée aurait fait lire 60 en position 5 et 70 en 6.
    expect(g.values[4]).toBe(40);
    expect(g.values[6]).toBe(60);
    expect(g.values[11]).toBe(110);
  });

  it('un point nul ou non objet garde aussi sa cellule', () => {
    const response = cells(12, (i) =>
      i === 1 ? null : i === 2 ? 7 : point([i])
    );
    const g = parseScalarGrid(response, 'temperature_2m', COARSE, 0);
    expect(g.values[1]).toBeNaN();
    expect(g.values[2]).toBeNaN();
    expect(g.values[3]).toBe(3);
  });

  it('trou isolé en rangée incomplète : seules les cellules absentes sont NaN', () => {
    // Rangée 1 (lat 0) sans aucune donnée, les rangées 0 et 2 valides.
    const response = cells(12, (i) =>
      i >= 4 && i < 8 ? { hourly: {} } : point([i])
    );
    const g = parseScalarGrid(response, 'temperature_2m', COARSE, 0);
    expect(countFiniteCells(g.values)).toBe(8);
    expect([...g.values.slice(0, 4)]).toEqual([0, 1, 2, 3]);
    expect([...g.values.slice(8)]).toEqual([8, 9, 10, 11]);
  });

  it('refuse une réponse trop courte ou trop longue plutôt que de décaler les cellules', () => {
    const short = cells(11, (i) => point([i]));
    const long = cells(13, (i) => point([i]));
    expect(() => parseScalarGrid(short, 'temperature_2m', COARSE)).toThrow(
      /désalignée/
    );
    expect(() => parseScalarGrid(long, 'temperature_2m', COARSE)).toThrow(
      /désalignée/
    );
    expect(() => parseScalarGrid([], 'temperature_2m', COARSE)).toThrow();
    expect(() =>
      parseScalarGrid(undefined, 'temperature_2m', COARSE)
    ).toThrow();
  });

  it('refuse une grille entièrement invalide : un échec explicite, pas une carte à zéro', () => {
    const response = cells(12, () => ({ hourly: {} }));
    expect(() => parseScalarGrid(response, 'temperature_2m', COARSE)).toThrow(
      /entièrement invalide/
    );
    const nulls = cells(12, () => point([null]));
    expect(() => parseScalarGrid(nulls, 'temperature_2m', COARSE)).toThrow(
      /entièrement invalide/
    );
  });

  it('accepte une grille de zéros (un champ nul est une donnée)', () => {
    const response = cells(12, () => point([0]));
    const g = parseScalarGrid(response, 'temperature_2m', COARSE);
    expect(countFiniteCells(g.values)).toBe(12);
    expect([...g.values].every((v) => v === 0)).toBe(true);
  });

  describe('réponses chunkées (mode POST)', () => {
    const { nLat, nLon } = meteoGridDims(FINE);
    const total = nLat * nLon;
    const sizes = chunkCoords(FINE).map((c) => c.lats.length);
    const build = (make: (i: number) => unknown): unknown[] => {
      const all = cells(total, make);
      const out: unknown[] = [];
      let at = 0;
      for (const size of sizes) {
        out.push(all.slice(at, at + size));
        at += size;
      }
      return out;
    };

    it('recompose les lots dans l’ordre, absences comprises', () => {
      const chunked = build((i) => (i === 1000 ? { hourly: {} } : point([i])));
      const g = parseScalarGrid(chunked, 'temperature_2m', FINE);
      expect(g.values[999]).toBe(999);
      expect(g.values[1000]).toBeNaN(); // premier point du 2e lot
      expect(g.values[1001]).toBe(1001);
      expect(g.values[total - 1]).toBe(total - 1);
    });

    it('un lot incomplet fait échouer : sinon tous les lots suivants glisseraient', () => {
      const chunked = build((i) => point([i]));
      (chunked[1] as unknown[]).pop(); // le 2e lot perd un point
      expect(() => parseScalarGrid(chunked, 'temperature_2m', FINE)).toThrow(
        /lot météo 2\/5 incomplet/
      );
    });

    it('un lot compensé par un surplus ailleurs échoue aussi (total juste, lots faux)', () => {
      const chunked = build((i) => point([i]));
      (chunked[1] as unknown[]).pop();
      (chunked[2] as unknown[]).push(point([0]));
      expect(() => parseScalarGrid(chunked, 'temperature_2m', FINE)).toThrow(
        /incomplet/
      );
    });

    it('un mauvais NOMBRE de lots dont les tailles se compensent échoue (total juste)', () => {
      const flat = cells(total, (i) => point([i]));
      // 4 lots de tailles inégales qui totalisent exactement la grille.
      const four = [
        flat.slice(0, 1250),
        flat.slice(1250, 2250),
        flat.slice(2250, 3250),
        flat.slice(3250),
      ];
      expect(() => parseScalarGrid(four, 'temperature_2m', FINE)).toThrow(
        /4 lots au lieu de 5/
      );
    });

    it('un lot vide ou absent échoue', () => {
      const chunked = build((i) => point([i]));
      chunked[3] = [];
      expect(() => parseScalarGrid(chunked, 'temperature_2m', FINE)).toThrow();
      expect(() =>
        parseScalarGrid(chunked.slice(0, 4), 'temperature_2m', FINE)
      ).toThrow(/désalignée/);
    });
  });
});

describe('pas de grille : la géométrie compte autant de rangées que la requête en génère', () => {
  it('refuse un pas qui ne tombe pas sur les pôles (8° : 180 / 8 n’est pas entier)', () => {
    expect(() => meteoGridDims({ step: 8, maxLat: 90 })).toThrow(/irrégulier/);
    expect(() => meteoGridCoords({ step: 8, maxLat: 90 })).toThrow(
      /irrégulier/
    );
    expect(() => assertRegularStep(0, 90)).toThrow();
    expect(() => assertRegularStep(7, 90)).toThrow();
  });
  it('la garde couvre les DEUX axes : latitude seule, puis longitude seule', () => {
    // maxLat 80, pas 16 : 160 / 16 = 10 rangées entières, mais 360 / 16 = 22,5 colonnes.
    expect(() => assertRegularStep(16, 80)).toThrow(/irrégulier/);
    // maxLat 90, pas 8 : 360 / 8 = 45 colonnes entières, mais 180 / 8 = 22,5 rangées.
    expect(() => assertRegularStep(8, 90)).toThrow(/irrégulier/);
  });
  it('accepte les pas qui tombent juste', () => {
    for (const step of [1, 2, 4, 5, 6, 9, 10, 30, 90])
      expect(() => assertRegularStep(step, 90)).not.toThrow();
  });
  it('les réglages livrés (prévision ET archive, vent compris) sont réguliers et cohérents', () => {
    for (const step of [
      PRESSURE_MODEL_SETTINGS.gridStep,
      PRESSURE_MODEL_SETTINGS.archiveGridStep,
      WIND_SETTINGS.gridStep,
      WIND_SETTINGS.archiveGridStep,
    ]) {
      const opts = { step, maxLat: 90 };
      const { lats, lons } = meteoGridCoords(opts);
      const { nLat, nLon } = meteoGridDims(opts);
      expect(lats.length).toBe(nLat * nLon);
      expect(lons.length).toBe(nLat * nLon);
      expect(Math.max(...lats)).toBe(90); // la dernière rangée est le pôle, pas 86°
    }
  });
});

describe('assertUsableGrid / countFiniteCells', () => {
  it('compte les cellules finies', () => {
    expect(countFiniteCells(Float32Array.from([0, NaN, 3, Infinity]))).toBe(2);
  });
  it('lève seulement quand aucune cellule n’est finie', () => {
    expect(() => assertUsableGrid(scalar(Array(12).fill(NaN)), 'v')).toThrow(
      /entièrement invalide/
    );
    expect(() =>
      assertUsableGrid(scalar([NaN, ...Array(11).fill(0)]), 'v')
    ).not.toThrow();
  });
});

describe('sampleScalar : interpolation aux frontières des cellules invalides', () => {
  // lat -90 | 0 | 90 sur 4 colonnes (-180, -90, 0, 90). La colonne 0 (lon -180) est invalide en
  // rangée 1 (lat 0) ; le reste vaut 10, 20, 30 puis 40.
  const g = scalar([5, 5, 5, 5, NaN, 20, 30, 40, 5, 5, 5, 5]);

  it('un nœud valide reste exact, même à côté d’un nœud invalide', () => {
    expect(sampleScalar(g, 0, -90)).toBeCloseTo(20, 5);
  });
  it('un nœud invalide rend NaN, pas 0', () => {
    expect(sampleScalar(g, 0, -180)).toBeNaN();
  });
  it('entre un nœud valide et un invalide : NaN (aucune valeur inventée)', () => {
    expect(sampleScalar(g, 0, -135)).toBeNaN();
    expect(sampleScalar(g, 0, -91)).toBeNaN();
  });
  it('un poids nul ne contamine pas : exactement sur le nœud, le voisin NaN est ignoré', () => {
    // Longitude -90 : c0 = 1, tc = 0, le voisin c = 2 est valide de toute façon ; on teste le
    // voisin invalide à gauche en se plaçant sur le nœud valide à droite d'un trou.
    const h = scalar([5, 5, 5, 5, 10, NaN, 30, 40, 5, 5, 5, 5]);
    expect(sampleScalar(h, 0, -180)).toBe(10); // nœud valide, voisin de droite NaN, poids 0
    expect(sampleScalar(h, 0, -179)).toBeNaN(); // le poids du voisin NaN devient > 0
  });
  it('enroule l’antiméridien : lon 179 pèse sur la colonne -180 (invalide) et 90', () => {
    expect(sampleScalar(g, 0, 179)).toBeNaN();
    expect(sampleScalar(g, 0, 180)).toBeNaN(); // 180 s’enroule en -180
    expect(sampleScalar(g, 0, 90)).toBe(40); // nœud valide, voisin enroulé NaN à poids nul
  });
  it('trou à l’est de l’antiméridien : le côté valide reste valide aux nœuds', () => {
    const east = scalar([5, 5, 5, 5, 10, 20, 30, NaN, 5, 5, 5, 5]);
    expect(sampleScalar(east, 0, 90)).toBeNaN(); // colonne 3 invalide
    expect(sampleScalar(east, 0, 0)).toBe(30);
    expect(sampleScalar(east, 0, -180)).toBe(10); // le voisin enroulé (col 3) n'entre pas
  });
  it('un zéro légitime s’interpole comme une valeur', () => {
    const z = scalar([0, 0, 0, 0, 0, 10, 0, 0, 0, 0, 0, 0]);
    expect(sampleScalar(z, 0, -135)).toBe(5);
    expect(sampleScalar(z, 0, -180)).toBe(0);
  });
  it('au pôle (rangée du bord) une rangée NaN voisine à poids nul est ignorée', () => {
    const p = scalar([NaN, NaN, NaN, NaN, 1, 2, 3, 4, 7, 7, 7, 7]);
    expect(sampleScalar(p, 0, -180)).toBe(1);
    expect(sampleScalar(p, -45, -180)).toBeNaN();
    expect(sampleScalar(p, 90, -180)).toBe(7);
  });
  it('retourne NaN pour une position NaN', () => {
    expect(sampleScalar(g, NaN, 0)).toBeNaN();
  });
});

describe('scalarGridToRGBA : une donnée absente est transparente', () => {
  const opts = { min: -40, max: 45 };

  it('NaN et Infinity : alpha 0, jamais une couleur de palette opaque', () => {
    const g = scalar([
      10,
      NaN,
      Infinity,
      -Infinity,
      10,
      10,
      10,
      10,
      10,
      10,
      10,
      10,
    ]);
    const { data } = scalarGridToRGBA(g, TEMPERATURE_PALETTE, opts);
    // Rangée 0 de la grille = SUD = rangée 2 de l'image (3 rangées).
    const o = (2 * 4 + 0) * 4;
    expect(data[o + 3]).toBe(255); // la cellule valide reste opaque
    for (const col of [1, 2, 3]) expect(data[o + col * 4 + 3]).toBe(0);
  });

  it('la couleur d’une cellule absente est celle d’une voisine valide (pas de noir sur la lisière)', () => {
    const g = scalar([10, NaN, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]);
    const { data } = scalarGridToRGBA(g, TEMPERATURE_PALETTE, opts);
    const o = 2 * 4 * 4;
    expect([data[o + 4], data[o + 5], data[o + 6]]).toEqual([
      data[o],
      data[o + 1],
      data[o + 2],
    ]);
    expect(data[o + 7]).toBe(0);
  });

  it('un zéro légitime reste OPAQUE pour la température (0 °C est une valeur)', () => {
    const g = scalar(Array(12).fill(0));
    const { data } = scalarGridToRGBA(g, TEMPERATURE_PALETTE, opts);
    for (let i = 0; i < 12; i++) expect(data[i * 4 + 3]).toBe(255);
  });

  it('pluie : 0 mm est transparent parce que le SEUIL le dit, NaN l’est parce que la donnée manque', () => {
    const g = scalar([0, NaN, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]);
    const { data } = scalarGridToRGBA(g, PRECIP_PALETTE, {
      min: 0,
      max: 20,
      transparentBelow: 0.1,
      maxAlpha: 200,
    });
    const o = 2 * 4 * 4;
    expect(data[o + 3]).toBe(0);
    expect(data[o + 7]).toBe(0);
    expect(data[o + 11]).toBeGreaterThan(0);
  });

  it('une grille entièrement invalide ne plante pas : tout est transparent', () => {
    const { data } = scalarGridToRGBA(
      scalar(Array(12).fill(NaN)),
      TEMPERATURE_PALETTE,
      opts
    );
    for (let i = 0; i < 12; i++) expect(data[i * 4 + 3]).toBe(0);
  });

  it('les valeurs valides sont encodées comme avant (régression GAL-VISUAL-002)', () => {
    const g = scalar(Array.from({ length: 12 }, (_, i) => -40 + i * 7));
    const a = scalarGridToRGBA(g, TEMPERATURE_PALETTE, opts);
    expect([...a.data].every((b) => b >= 0 && b <= 255)).toBe(true);
    for (let i = 0; i < 12; i++) expect(a.data[i * 4 + 3]).toBe(255);
  });
});

describe('cloudCoverToRGBA : couverture absente', () => {
  it('NaN écrit 0 (rien ajouté), un vrai 0 % aussi, 100 % reste plein', () => {
    const g = scalar([NaN, 0, 100, 50, 0, 0, 0, 0, 0, 0, 0, 0]);
    const { data } = cloudCoverToRGBA(g, 1);
    const o = 2 * 4 * 4;
    expect(data[o + 1]).toBe(0); // NaN
    expect(data[o + 5]).toBe(0); // 0 %
    expect(data[o + 9]).toBe(255); // 100 %
    expect(data[o + 13]).toBeGreaterThan(0);
    expect(data[o + 3]).toBe(255); // alpha constant : la sémantique de l'alphaMap ne change pas
    expect([...data].every((b) => Number.isInteger(b))).toBe(true);
  });
});

describe('vent : u/v inconnus plutôt qu’inventés', () => {
  const grid = (speed: number[], dir: number[]) =>
    windGridFromScalars(scalar(speed), scalar(dir));

  it('vitesse NaN : u et v NaN, pas un calme', () => {
    const w = grid([NaN, ...Array(11).fill(10)], Array(12).fill(270));
    expect(w.u[0]).toBeNaN();
    expect(w.v[0]).toBeNaN();
    expect(w.u[1]).toBeCloseTo(10, 4);
  });
  it('direction NaN avec une vitesse non nulle : inconnu', () => {
    const w = grid(Array(12).fill(10), [NaN, ...Array(11).fill(270)]);
    expect(w.u[0]).toBeNaN();
    expect(w.v[0]).toBeNaN();
  });
  it('vitesse nulle : vrai calme même sans direction (zéros préservés)', () => {
    const w = grid([0, ...Array(11).fill(10)], [NaN, ...Array(11).fill(270)]);
    expect(w.u[0]).toBe(0);
    expect(w.v[0]).toBe(0);
  });
  it('vitesse négative : invalide', () => {
    const w = grid([-3, ...Array(11).fill(10)], Array(12).fill(270));
    expect(w.u[0]).toBeNaN();
  });

  const uniform = (u: number, v: number): WindGrid => ({
    step: 90,
    latMin: -90,
    lonMin: -180,
    nLat: 3,
    nLon: 4,
    u: new Float32Array(12).fill(u),
    v: new Float32Array(12).fill(v),
  });

  it('sampleWind : NaN (u ET v) dès qu’une cellule pesante est invalide', () => {
    const g = uniform(3, 4);
    g.u[4] = NaN; // (lat 0, lon -180)
    const s = sampleWind(g, 0, -180);
    expect(s.u).toBeNaN();
    expect(s.v).toBeNaN(); // jamais un vecteur à moitié valide
    expect(sampleWind(g, 0, -135).u).toBeNaN();
    expect(sampleWind(g, 0, 179).u).toBeNaN(); // antiméridien : -180 pèse via l'enroulement
  });

  it('sampleWind : un nœud valide et un voisin invalide à poids nul restent valides', () => {
    const g = uniform(3, 4);
    g.u[5] = NaN;
    g.v[5] = NaN; // (lat 0, lon -90)
    expect(sampleWind(g, 0, -180)).toEqual({ u: 3, v: 4 });
    expect(sampleWind(g, -90, -180)).toEqual({ u: 3, v: 4 });
    expect(sampleWind(g, 0, -170).u).toBeNaN();
  });

  it('sampleWind : les valeurs valides sont inchangées, zéros compris', () => {
    const g = uniform(0, 0);
    expect(sampleWind(g, 12, 34)).toEqual({ u: 0, v: 0 });
    const h = uniform(6, -2);
    const s = sampleWind(h, 12, 34);
    expect(s.u).toBeCloseTo(6, 5);
    expect(s.v).toBeCloseTo(-2, 5);
  });

  it('sampleWind écrit dans `out` même pour un vent inconnu', () => {
    const g = uniform(NaN, NaN);
    const out = { u: 1, v: 1 };
    expect(sampleWind(g, 0, 0, out)).toBe(out);
    expect(out.u).toBeNaN();
  });
});

describe('disponibilité du vent COMPOSÉ (u et v), pas des seules vitesses', () => {
  const composed = (speed: number[], dir: number[]) =>
    windGridFromScalars(scalar(speed), scalar(dir));
  const N = Number.NaN;

  it('champ partiel : seules les cellules où u ET v sont finis comptent', () => {
    // vitesse manquante en 0, direction manquante en 1 (vitesse non nulle) : 2 cellules inconnues.
    const w = composed(
      [N, 10, ...Array(10).fill(10)],
      [270, N, ...Array(10).fill(270)]
    );
    expect(countValidWind(w)).toBe(10);
    expect(() => assertUsableWind(w)).not.toThrow();
  });

  it('disponibilités DISJOINTES : deux grilles partielles, champ composé entièrement inconnu', () => {
    // Vitesse valide sur les cellules paires, direction valide sur les impaires.
    const speed = Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? 10 : N));
    const dir = Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? N : 270));
    expect(countFiniteCells(Float32Array.from(speed))).toBe(6);
    expect(countFiniteCells(Float32Array.from(dir))).toBe(6);
    const w = composed(speed, dir);
    expect(countValidWind(w)).toBe(0); // chaque grille est utilisable, pas leur composition
    expect(() => assertUsableWind(w)).toThrow(/entièrement indisponible/);
  });

  it('vrai calme : vitesses toutes nulles et direction entièrement absente = champ DISPONIBLE', () => {
    const w = composed(Array(12).fill(0), Array(12).fill(N));
    expect(countValidWind(w)).toBe(12);
    expect(() => assertUsableWind(w)).not.toThrow();
    expect([...w.u].every((x) => x === 0)).toBe(true);
    expect([...w.v].every((x) => x === 0)).toBe(true);
  });

  it('vitesses non nulles et direction entièrement absente = vent inconnu partout', () => {
    const w = composed(Array(12).fill(5), Array(12).fill(N));
    expect(countValidWind(w)).toBe(0);
    expect(() => assertUsableWind(w)).toThrow();
  });

  it('calme local : un 0 sans direction reste un calme au milieu d’un champ partiel', () => {
    const w = composed(
      [0, 5, ...Array(10).fill(5)],
      [N, N, ...Array(10).fill(90)]
    );
    expect(w.u[0]).toBe(0);
    expect(w.v[0]).toBe(0);
    expect(w.u[1]).toBeNaN(); // vitesse non nulle sans direction
  });

  it('describeMeteoGrid : validCount explicite prime sur celui des vitesses', () => {
    const speed = scalar(Array(12).fill(10));
    expect(describeMeteoGrid(speed).validCount).toBe(12);
    expect(describeMeteoGrid({ ...speed, validCount: 4 }).validCount).toBe(4);
    expect(describeMeteoGrid({ ...speed, validCount: 0 }).validCount).toBe(0);
  });
});

describe('describeMeteoGrid : grille partiellement indisponible', () => {
  it('compte les cellules valides', () => {
    const d = describeMeteoGrid(
      scalar([NaN, 0, 1, 2, NaN, ...Array(7).fill(0)])
    );
    expect(d.sampleCount).toBe(12);
    expect(d.validCount).toBe(10);
  });
  it('sans valeurs fournies, toutes les cellules sont comptées', () => {
    const d = describeMeteoGrid({ step: 90, latMin: -90, nLat: 3, nLon: 4 });
    expect(d.validCount).toBe(12);
  });
});
