/**
 * Inspection d'un point (GAL-METEO-INSPECT-002) : valeurs, disponibilité, provenance.
 * Fixtures déterministes seulement ; aucune réponse réelle, aucun réseau.
 */
import { describe, expect, it } from 'vitest';
import {
  CALM_SPEED_KMH,
  holdField,
  readScalar,
  readWind,
  type HeldField,
  type ReadContext,
} from './meteoInspect';
import type { ScalarGrid } from './meteoGrid';
import type { WindGrid } from './windField';
import type { DatedProduct } from './temporal';

const HOUR = 3_600_000;
const SCENE = new Date('2026-11-10T12:00:00Z');
const NOW = new Date('2026-11-18T09:30:00Z');
const KEY = '2026-11-10T12';

const N = Number.NaN;

/** 3 rangées (lat -90, 0, 90) × 4 colonnes (lon -180, -90, 0, 90), rangée 0 au SUD. */
function scalar(values: number[]): ScalarGrid {
  return {
    step: 90,
    latMin: -90,
    lonMin: -180,
    nLat: 3,
    nLon: 4,
    values: Float32Array.from(values),
  };
}

function wind(u: number[], v: number[]): WindGrid {
  return {
    step: 90,
    latMin: -90,
    lonMin: -180,
    nLat: 3,
    nLon: 4,
    u: Float32Array.from(u),
    v: Float32Array.from(v),
  };
}

const product = (validAt: Date): DatedProduct => ({
  kind: 'forecastModel',
  validTime: { from: validAt.getTime(), to: validAt.getTime() },
  offsetToleranceMs: HOUR,
});

function held<G>(
  grid: G,
  extra: {
    key?: string;
    provider?: string;
    realDate?: string;
    source?: 'forecast' | 'archive';
  } = {}
): HeldField<G> {
  return holdField(grid, extra.key ?? KEY, {
    plan: {
      source: extra.source ?? 'forecast',
      product: product(new Date(extra.realDate ?? SCENE.toISOString())),
    },
    realDate: extra.realDate ?? SCENE.toISOString(),
    ...(extra.provider ? { provider: extra.provider } : {}),
  });
}

const ctx = (over: Partial<ReadContext> = {}): ReadContext => ({
  sceneDate: SCENE,
  now: NOW,
  active: true,
  phase: 'ready',
  ...over,
});

// Rangée 1 (lat 0) : 10, 20, 30, 40 ; pôles à 5 et 7.
const TEMPERATURES = scalar([5, 5, 5, 5, 10, 20, 30, 40, 7, 7, 7, 7]);

describe('readScalar : nœuds, interpolation, zéros', () => {
  it('lit un nœud exactement, avec son unité', () => {
    const r = readScalar(
      'temperature',
      '°C',
      held(TEMPERATURES),
      ctx(),
      0,
      -90
    );
    expect(r).toMatchObject({
      kind: 'scalar',
      variable: 'temperature',
      unit: '°C',
      availability: 'available',
      value: 20,
    });
  });

  it('interpole entre deux nœuds (bilinéaire, via sampleScalar)', () => {
    const r = readScalar(
      'temperature',
      '°C',
      held(TEMPERATURES),
      ctx(),
      0,
      -135
    );
    expect(r.value).toBeCloseTo(15, 5);
    // Entre la rangée de l'équateur (10..40) et celle du nord (7) : à mi-latitude.
    const mid = readScalar(
      'temperature',
      '°C',
      held(TEMPERATURES),
      ctx(),
      45,
      -180
    );
    expect(mid.value).toBeCloseTo((10 + 7) / 2, 5);
  });

  it('un vrai zéro est une valeur disponible, pas une absence', () => {
    const zero = scalar(Array(12).fill(0));
    const r = readScalar('temperature', '°C', held(zero), ctx(), 12, 34);
    expect(r.availability).toBe('available');
    expect(r.value).toBe(0);
  });

  it('une cellule NaN est INDISPONIBLE (missing), jamais zéro', () => {
    const g = scalar([5, 5, 5, 5, N, 20, 30, 40, 7, 7, 7, 7]);
    const r = readScalar('pressure', 'hPa', held(g), ctx(), 0, -180);
    expect(r).toMatchObject({ availability: 'missing', value: null });
    // Interpolation touchant la cellule NaN : indisponible aussi, jamais un mélange avec elle.
    expect(
      readScalar('pressure', 'hPa', held(g), ctx(), 0, -135).value
    ).toBeNull();
    // Le voisin valide, à poids nul, reste lisible.
    expect(readScalar('pressure', 'hPa', held(g), ctx(), 0, -90).value).toBe(
      20
    );
  });

  it('antiméridien : 180° et -180° sont le même méridien, 179° interpole avec la colonne enroulée', () => {
    const a = readScalar(
      'temperature',
      '°C',
      held(TEMPERATURES),
      ctx(),
      0,
      180
    );
    const b = readScalar(
      'temperature',
      '°C',
      held(TEMPERATURES),
      ctx(),
      0,
      -180
    );
    expect(a.value).toBe(b.value);
    expect(a.value).toBe(10);
    // 179° : entre la colonne 90° (40) et la colonne -180° (10), au quart.
    const c = readScalar(
      'temperature',
      '°C',
      held(TEMPERATURES),
      ctx(),
      0,
      135
    );
    expect(c.value).toBeCloseTo(25, 5);
  });

  it('antiméridien avec un trou : NaN de part et d’autre selon le poids', () => {
    const g = scalar([5, 5, 5, 5, N, 20, 30, 40, 7, 7, 7, 7]); // colonne -180° absente
    expect(
      readScalar('humidity', '%', held(g), ctx(), 0, 179).availability
    ).toBe('missing');
    expect(readScalar('humidity', '%', held(g), ctx(), 0, 90).value).toBe(40);
  });

  it('pôles : la latitude ±90 est dans la grille, au-delà non', () => {
    expect(
      readScalar('temperature', '°C', held(TEMPERATURES), ctx(), 90, 0).value
    ).toBe(7);
    expect(
      readScalar('temperature', '°C', held(TEMPERATURES), ctx(), -90, 0).value
    ).toBe(5);
    expect(
      readScalar('temperature', '°C', held(TEMPERATURES), ctx(), 90.5, 0)
        .availability
    ).toBe('outOfCoverage');
    expect(
      readScalar('temperature', '°C', held(TEMPERATURES), ctx(), -91, 0)
        .availability
    ).toBe('outOfCoverage');
  });

  it('pas d’extrapolation hors couverture : une grille bornée refuse au-delà de ses bornes', () => {
    const band: ScalarGrid = { ...TEMPERATURES, latMin: -90, nLat: 2 }; // couvre -90 à 0
    const r = readScalar('temperature', '°C', held(band), ctx(), 45, 0);
    expect(r).toMatchObject({ availability: 'outOfCoverage', value: null });
  });

  it('coordonnées non finies : hors couverture, sans valeur', () => {
    for (const [lat, lon] of [
      [N, 0],
      [0, N],
      [Infinity, 0],
    ] as const)
      expect(
        readScalar('temperature', '°C', held(TEMPERATURES), ctx(), lat, lon)
          .availability
      ).toBe('outOfCoverage');
  });
});

describe('readScalar : portes (couche masquée, sans grille, grille d’une autre heure)', () => {
  it('une couche masquée est `inactive` : aucune valeur, aucune provenance', () => {
    const r = readScalar(
      'temperature',
      '°C',
      held(TEMPERATURES),
      ctx({ active: false }),
      0,
      0
    );
    expect(r).toMatchObject({
      availability: 'inactive',
      value: null,
      provenance: null,
    });
  });

  it('active sans grille : `noData`, avec la raison', () => {
    expect(
      readScalar(
        'temperature',
        '°C',
        null,
        ctx({ emptyReason: 'outOfRange' }),
        0,
        0
      )
    ).toMatchObject({
      availability: 'noData',
      emptyReason: 'outOfRange',
      value: null,
    });
    expect(readScalar('temperature', '°C', null, ctx(), 0, 0)).toMatchObject({
      availability: 'noData',
      emptyReason: 'notLoaded',
    });
  });

  it('grille chargée pour une AUTRE heure que la scène : `stale`, aucune valeur', () => {
    const old = held(TEMPERATURES, { key: '2026-11-10T11' });
    const r = readScalar('temperature', '°C', old, ctx(), 0, -90);
    expect(r.availability).toBe('stale');
    expect(r.value).toBeNull();
    // La provenance dit POUR QUELLE heure la grille a été chargée : de quoi l'expliquer.
    expect(r.provenance?.requestedHour).toBe('2026-11-10T11:00:00.000Z');
  });

  it('ancienne grille conservée après un ÉCHEC de chargement : stale, phase `error`', () => {
    const old = held(TEMPERATURES, { key: '2026-11-10T11' });
    const r = readScalar(
      'temperature',
      '°C',
      old,
      ctx({ phase: 'error' }),
      0,
      -90
    );
    expect(r).toMatchObject({
      availability: 'stale',
      phase: 'error',
      value: null,
    });
  });

  it('la scène revient à l’heure de la grille : la valeur redevient lisible', () => {
    const g = held(TEMPERATURES, { key: '2026-11-10T11' });
    expect(readScalar('temperature', '°C', g, ctx(), 0, -90).availability).toBe(
      'stale'
    );
    expect(
      readScalar(
        'temperature',
        '°C',
        g,
        ctx({ sceneDate: new Date('2026-11-10T11:25:00Z') }),
        0,
        -90
      ).value
    ).toBe(20);
  });

  it('la minute de la scène ne compte pas : seule l’heure UTC fait la clé', () => {
    const r = readScalar(
      'temperature',
      '°C',
      held(TEMPERATURES),
      ctx({ sceneDate: new Date('2026-11-10T12:59:59Z') }),
      0,
      -90
    );
    expect(r.availability).toBe('available');
  });
});

describe('provenance : fournisseur, produit, dates, résolution', () => {
  it('Open-Meteo : valeur horaire de HH:00, écart effectif nul', () => {
    const r = readScalar(
      'temperature',
      '°C',
      held(TEMPERATURES),
      ctx(),
      0,
      -90
    );
    expect(r.provenance).toEqual({
      provider: 'Open-Meteo',
      productKind: 'forecastModel',
      temporalCategory: 'reconstructed',
      confidence: 'nominal',
      planSource: 'forecast',
      requestedHour: '2026-11-10T12:00:00.000Z',
      effectiveDate: '2026-11-10T12:00:00.000Z',
      effectiveOffsetMs: 0,
      stepDegrees: 90,
    });
  });

  it('archive ERA5 : fournisseur et plan le disent', () => {
    const r = readScalar(
      'temperature',
      '°C',
      held(TEMPERATURES, { source: 'archive' }),
      ctx(),
      0,
      -90
    );
    expect(r.provenance).toMatchObject({
      provider: 'ECMWF ERA5',
      planSource: 'archive',
    });
  });

  it('GFS : la date EFFECTIVE du champ (pas de 3 h) diffère de l’heure demandée, sans être périmée', () => {
    const gfs = held(TEMPERATURES, {
      provider: 'NOAA GFS',
      realDate: '2026-11-10T15:00:00.000Z',
    });
    const r = readScalar('temperature', '°C', gfs, ctx(), 0, -90);
    expect(r.availability).toBe('available'); // différence LÉGITIME du fournisseur
    expect(r.value).toBe(20);
    expect(r.provenance).toMatchObject({
      provider: 'NOAA GFS',
      requestedHour: '2026-11-10T12:00:00.000Z',
      effectiveDate: '2026-11-10T15:00:00.000Z',
      effectiveOffsetMs: 3 * HOUR,
    });
  });

  it('la résolution est le pas natif de la grille, rien de plus fin', () => {
    const fine: ScalarGrid = { ...TEMPERATURES, step: 90 };
    expect(
      readScalar('temperature', '°C', held(fine), ctx(), 12, 34).provenance
        ?.stepDegrees
    ).toBe(90);
  });

  it('une prévision future est annoncée prédite ; au-delà de l’horizon fiable, confiance réduite', () => {
    const future = new Date('2026-11-25T12:00:00Z');
    const g = holdField(TEMPERATURES, '2026-11-25T12', {
      plan: {
        source: 'forecast',
        product: {
          kind: 'forecastModel',
          validTime: { from: future.getTime(), to: future.getTime() },
          offsetToleranceMs: HOUR,
          reliableHorizonMs: 7 * 24 * HOUR,
        },
      },
      realDate: future.toISOString(),
    });
    const r = readScalar(
      'temperature',
      '°C',
      g,
      ctx({ sceneDate: future }),
      0,
      -90
    );
    expect(r.provenance).toMatchObject({
      temporalCategory: 'predicted',
      confidence: 'reduced',
    });
  });
});

describe('précipitation : taux GFS et cumul horaire ne sont pas la même chose', () => {
  const rain = scalar([0, 0, 0, 0, 0, 2.5, 0, 0, 0, 0, 0, 0]);

  it('GFS : taux instantané en mm/h', () => {
    const r = readScalar(
      'precipitation',
      'mm/h',
      held(rain, { provider: 'NOAA GFS' }),
      ctx(),
      0,
      -90
    );
    expect(r).toMatchObject({
      value: 2.5,
      unit: 'mm/h',
      nature: 'instantRate',
    });
  });

  it('Open-Meteo : cumul de l’heure précédente, en mm', () => {
    const r = readScalar('precipitation', 'mm/h', held(rain), ctx(), 0, -90);
    expect(r).toMatchObject({
      value: 2.5,
      unit: 'mm',
      nature: 'precedingHourAccumulation',
    });
  });

  it('ERA5 servi par le service : cumul de l’heure précédente aussi', () => {
    const r = readScalar(
      'precipitation',
      'mm/h',
      held(rain, { provider: 'ECMWF ERA5', source: 'archive' }),
      ctx(),
      0,
      -90
    );
    expect(r.nature).toBe('precedingHourAccumulation');
  });

  it('0 mm est une valeur ; NaN est indisponible', () => {
    expect(
      readScalar('precipitation', 'mm/h', held(rain), ctx(), 0, -180).value
    ).toBe(0);
    const holes = scalar([0, 0, 0, 0, N, 1, 1, 1, 0, 0, 0, 0]);
    expect(
      readScalar('precipitation', 'mm/h', held(holes), ctx(), 0, -180)
        .availability
    ).toBe('missing');
  });

  it('les autres variables n’ont pas de nature', () => {
    expect(
      readScalar('temperature', '°C', held(TEMPERATURES), ctx(), 0, -90).nature
    ).toBeUndefined();
  });
});

describe('vent : vitesse et direction depuis u/v interpolés', () => {
  const uniform = (u: number, v: number): WindGrid =>
    wind(Array(12).fill(u), Array(12).fill(v));

  it('les quatre vents cardinaux (direction = d’où vient l’air)', () => {
    const cases: Array<[number, number, number]> = [
      [0, -10, 0], // va vers le sud : vient du nord
      [-10, 0, 90], // va vers l'ouest : vient de l'est
      [0, 10, 180], // va vers le nord : vient du sud
      [10, 0, 270], // va vers l'est : vient de l'ouest
    ];
    for (const [u, v, from] of cases) {
      const r = readWind(held(uniform(u, v)), ctx(), 20, 30);
      expect(r.availability).toBe('available');
      expect(r.speedKmh).toBeCloseTo(10, 5);
      expect(r.directionDeg).toBeCloseTo(from, 4);
      expect(r.calm).toBe(false);
    }
  });

  it('la direction vient des composantes interpolées, jamais d’angles interpolés (359° et 1°)', () => {
    // Deux nœuds voisins : vent du 359° et vent du 1°, même vitesse (10 km/h).
    const a = (359 * Math.PI) / 180;
    const b = (1 * Math.PI) / 180;
    const u = Array(12).fill(0);
    const v = Array(12).fill(0);
    // rangée 1 (équateur), colonnes 0 et 1 : u = -s·sin(d), v = -s·cos(d)
    u[4] = -10 * Math.sin(a);
    v[4] = -10 * Math.cos(a);
    u[5] = -10 * Math.sin(b);
    v[5] = -10 * Math.cos(b);
    const r = readWind(held(wind(u, v)), ctx(), 0, -135); // à mi-chemin des deux nœuds
    // Une moyenne d'angles donnerait 180° ; le vecteur moyen vient du nord (≈ 0° ou 360°).
    const d = r.directionDeg!;
    expect(Math.min(d, 360 - d)).toBeLessThan(0.01);
    expect(r.speedKmh).toBeCloseTo(10 * Math.cos(b), 3);
  });

  it('un vent calme n’a pas de direction', () => {
    const r = readWind(held(uniform(0, 0)), ctx(), 20, 30);
    expect(r).toMatchObject({
      availability: 'available',
      speedKmh: 0,
      directionDeg: null,
      calm: true,
    });
    const faint = readWind(held(uniform(CALM_SPEED_KMH / 2, 0)), ctx(), 20, 30);
    expect(faint).toMatchObject({ calm: true, directionDeg: null });
    const justOver = readWind(
      held(uniform(CALM_SPEED_KMH * 1.5, 0)),
      ctx(),
      20,
      30
    );
    expect(justOver.calm).toBe(false);
    expect(justOver.directionDeg).toBeCloseTo(270, 3);
  });

  it('vent inconnu (NaN) : `missing`, ni vitesse ni direction ni calme', () => {
    const w = uniform(5, 5);
    w.u[4] = N;
    w.v[4] = N;
    const r = readWind(held(w), ctx(), 0, -180);
    expect(r).toMatchObject({
      availability: 'missing',
      speedKmh: null,
      directionDeg: null,
      calm: null,
    });
  });

  it('antiméridien et pôles', () => {
    const w = uniform(10, 0);
    expect(readWind(held(w), ctx(), 0, 180).speedKmh).toBeCloseTo(10, 5);
    expect(readWind(held(w), ctx(), 90, 0).availability).toBe('available');
    expect(readWind(held(w), ctx(), 95, 0).availability).toBe('outOfCoverage');
    const hole = uniform(10, 0);
    hole.u[4] = N;
    hole.v[4] = N; // colonne -180° à l'équateur
    expect(readWind(held(hole), ctx(), 0, 179).availability).toBe('missing');
  });

  it('mêmes portes que les scalaires : masquée, sans grille, d’une autre heure', () => {
    const g = held(uniform(10, 0));
    expect(readWind(g, ctx({ active: false }), 0, 0).availability).toBe(
      'inactive'
    );
    expect(readWind(null, ctx(), 0, 0)).toMatchObject({
      availability: 'noData',
      emptyReason: 'notLoaded',
    });
    const old = held(uniform(10, 0), { key: '2026-11-10T09' });
    const r = readWind(old, ctx({ phase: 'error' }), 0, 0);
    expect(r).toMatchObject({
      availability: 'stale',
      speedKmh: null,
      directionDeg: null,
    });
  });

  it('GFS : date effective décalée, vent disponible', () => {
    const gfs = held(uniform(10, 0), {
      provider: 'NOAA GFS',
      realDate: '2026-11-10T09:00:00.000Z',
    });
    const r = readWind(gfs, ctx(), 0, 0);
    expect(r.availability).toBe('available');
    expect(r.provenance?.effectiveOffsetMs).toBe(-3 * HOUR);
  });
});

describe('lecture seule', () => {
  it('lire ne modifie jamais la grille gardée', () => {
    const g = scalar([5, 5, 5, 5, 10, 20, 30, 40, 7, 7, 7, 7]);
    const before = Array.from(g.values);
    const h = held(g);
    for (let i = 0; i < 20; i++)
      readScalar('temperature', '°C', h, ctx(), i * 9 - 90, i * 18 - 180);
    expect(Array.from(g.values)).toEqual(before);
  });

  it('holdField garde la RÉFÉRENCE de la grille, sans copie', () => {
    const g = scalar(Array(12).fill(1));
    expect(held(g).grid).toBe(g);
  });

  it('une lecture ne porte aucun tampon mutable de la grille', () => {
    const r = readScalar(
      'temperature',
      '°C',
      held(TEMPERATURES),
      ctx(),
      0,
      -90
    );
    expect(JSON.stringify(r)).not.toMatch(/Float32Array|values/);
  });
});
