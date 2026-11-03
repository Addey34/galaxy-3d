import { describe, expect, it } from 'vitest';
import { Rotation_EQD_EQJ } from 'astronomy-engine';
import { eciToGeodetic, gstime, json2satrec, propagate } from 'satellite.js';
import './timeScale';
import {
  ELEMENT_VALIDITY_DAYS,
  EARTH_RADIUS_KM,
  anyWithinValidity,
  epochMs,
  parseSatelliteFile,
  rotate,
  toOmm,
  withinValidity,
  type SatelliteElements,
} from './satellites';

/** L'ISS telle que CelesTrak (groupe `stations`) la publiait le 2026-11-02, relue le 2026-11-03. */
const ISS: SatelliteElements = {
  id: 25544,
  name: 'ISS (ZARYA)',
  designator: '1998-067A',
  group: 'stations',
  epoch: '2026-11-02T18:09:49.393152',
  meanMotion: 15.49154261,
  eccentricity: 0.0007124,
  inclination: 51.6331,
  raan: 334.3796,
  argPerigee: 340.7366,
  meanAnomaly: 19.3352,
  bstar: 0.0001062,
  meanMotionDot: 5.437e-5,
  meanMotionDdot: 0,
};

const file = (objects: unknown[]) => ({
  version: 1,
  source: { name: 'CelesTrak', url: 'https://celestrak.org/' },
  fetchedAt: '2026-11-03T10:41:10Z',
  groups: { stations: objects.length },
  objects,
});

describe('parseSatelliteFile', () => {
  it('lit un fichier valide', () => {
    const { file: f, rejected } = parseSatelliteFile(file([ISS]));
    expect(f.objects).toHaveLength(1);
    expect(rejected).toBe(0);
  });

  it('refuse une version inconnue, un fichier vide et une date de lecture illisible', () => {
    expect(() => parseSatelliteFile({ ...file([ISS]), version: 2 })).toThrow(
      /version/
    );
    expect(() => parseSatelliteFile(file([]))).toThrow(/aucun objet/);
    expect(() =>
      parseSatelliteFile({ ...file([ISS]), fetchedAt: 'hier' })
    ).toThrow(/date de lecture/);
    expect(() => parseSatelliteFile(null)).toThrow();
  });

  it('écarte un objet à champ illisible et le compte, sans perdre les autres', () => {
    const bad = { ...ISS, id: 1, meanMotion: Number.NaN };
    const worse = { ...ISS, id: 2, epoch: 'jamais' };
    const { file: f, rejected } = parseSatelliteFile(file([ISS, bad, worse]));
    expect(f.objects.map((o) => o.id)).toEqual([25544]);
    expect(rejected).toBe(2);
  });

  it('refuse un fichier dont plus aucun objet n’est lisible', () => {
    expect(() =>
      parseSatelliteFile(file([{ ...ISS, bstar: undefined }]))
    ).toThrow(/aucun objet lisible/);
  });
});

describe('fenêtre de validité', () => {
  const epoch = epochMs(ISS.epoch);

  it('lit l’époque de CelesTrak comme de l’UTC, avec ou sans Z', () => {
    expect(epochMs('2026-11-02T18:09:49.393152')).toBe(
      epochMs('2026-11-02T18:09:49.393152Z')
    );
    expect(epochMs('2026-11-02T18:09:49Z')).toBe(
      Date.UTC(2026, 10, 2, 18, 9, 49)
    );
  });

  it('est symétrique autour de l’époque et ferme au-delà (jamais d’extrapolation)', () => {
    const limit = ELEMENT_VALIDITY_DAYS * 86_400_000;
    expect(withinValidity(epoch, epoch)).toBe(true);
    expect(withinValidity(epoch, epoch + limit)).toBe(true);
    expect(withinValidity(epoch, epoch - limit)).toBe(true);
    expect(withinValidity(epoch, epoch + limit + 1)).toBe(false);
    expect(withinValidity(epoch, epoch - limit - 1)).toBe(false);
    // Un voyage dans le temps vers l'an 1900 n'y trouve aucun satellite.
    expect(withinValidity(epoch, Date.UTC(1900, 0, 1))).toBe(false);
  });

  it('dit si au moins un objet vaut encore', () => {
    const day = 86_400_000;
    expect(anyWithinValidity([epoch - 30 * day, epoch], epoch + 5 * day)).toBe(
      true
    );
    expect(anyWithinValidity([epoch - 30 * day], epoch)).toBe(false);
    expect(anyWithinValidity([], epoch)).toBe(false);
  });
});

describe('propagation SGP4 des éléments publiés', () => {
  const satrec = json2satrec(toOmm(ISS) as never);
  const at = new Date(epochMs(ISS.epoch));
  const state = propagate(satrec, at);

  it('place l’ISS à son orbite basse à l’époque (témoin physique)', () => {
    expect(state).not.toBeNull();
    if (!state || typeof state.position === 'boolean')
      throw new Error('pas de solution');
    const { x, y, z } = state.position;
    const radius = Math.hypot(x, y, z);
    // ~ 400 à 430 km d'altitude : rayon de 6 780 à 6 810 km.
    expect(radius).toBeGreaterThan(EARTH_RADIUS_KM + 380);
    expect(radius).toBeLessThan(EARTH_RADIUS_KM + 450);
    const v = state.velocity as { x: number; y: number; z: number };
    // Vitesse circulaire à cette altitude : ~ 7,66 km/s.
    expect(Math.hypot(v.x, v.y, v.z)).toBeGreaterThan(7.55);
    expect(Math.hypot(v.x, v.y, v.z)).toBeLessThan(7.75);
    // La latitude ne dépasse jamais l'inclinaison.
    const geo = eciToGeodetic(state.position, gstime(at));
    expect(Math.abs(geo.latitude)).toBeLessThanOrEqual((51.7 * Math.PI) / 180);
    expect(geo.height).toBeGreaterThan(380);
    expect(geo.height).toBeLessThan(450);
  });

  it('une orbite complète ramène l’ISS au même rayon, à la période près', () => {
    const period = 86_400_000 / ISS.meanMotion;
    const later = propagate(satrec, new Date(at.getTime() + period));
    if (
      !state ||
      !later ||
      typeof state.position === 'boolean' ||
      typeof later.position === 'boolean'
    )
      throw new Error('pas de solution');
    const r0 = Math.hypot(state.position.x, state.position.y, state.position.z);
    const r1 = Math.hypot(later.position.x, later.position.y, later.position.z);
    expect(Math.abs(r1 - r0)).toBeLessThan(15);
  });
});

describe('TEME vers J2000', () => {
  it('conserve les longueurs et tourne d’environ 0,37° en 2026 (la précession depuis J2000)', () => {
    const date = new Date(Date.UTC(2026, 10, 2, 18));
    const m = Rotation_EQD_EQJ(date).rot;
    const [x, y, z] = rotate(m, 6800, 1200, -300);
    expect(Math.hypot(x, y, z)).toBeCloseTo(Math.hypot(6800, 1200, -300), 6);
    // Angle entre le vecteur et son image : précession générale ≈ 50,3″ par an × 26,85 ans.
    const dot = x * 6800 + y * 1200 + z * -300;
    const cos = dot / Math.hypot(6800, 1200, -300) ** 2;
    const degrees = (Math.acos(Math.min(1, cos)) * 180) / Math.PI;
    expect(degrees).toBeGreaterThan(0.1);
    expect(degrees).toBeLessThan(0.45);
    // Soit ~ 45 km à 6 800 km : l'oublier déplacerait chaque satellite d'autant.
    const shift = Math.hypot(x - 6800, y - 1200, z + 300);
    expect(shift).toBeGreaterThan(10);
    expect(shift).toBeLessThan(50);
  });

  it('la matrice identité ne change rien', () => {
    const id = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    expect(rotate(id, 1, 2, 3)).toEqual([1, 2, 3]);
  });
});
