import { describe, expect, it } from 'vitest';
import {
  PATH_REFRESH_FRACTION,
  PATH_SAMPLES,
  followVerdict,
  pathIsStale,
  pathSampleTimes,
  type FollowState,
} from './satelliteTrack';
import { ELEMENT_VALIDITY_DAYS } from './satellites';

const DAY = 86_400_000;
const EPOCH = Date.UTC(2026, 10, 2, 12);
const PERIOD = 92.96 * 60_000;

describe('pathSampleTimes', () => {
  it('trace UNE période en avant, jamais en arrière', () => {
    const plan = pathSampleTimes(EPOCH, PERIOD, EPOCH);
    expect(plan.times).toHaveLength(PATH_SAMPLES + 1);
    expect(plan.times[0]).toBe(EPOCH);
    expect(plan.times.at(-1)).toBeCloseTo(EPOCH + PERIOD, 0);
    expect(Math.min(...plan.times)).toBe(EPOCH);
    expect(plan.truncated).toBe(false);
  });

  it('coupe la trace à la fin de la validité des éléments, et le dit', () => {
    const lastValid = EPOCH + ELEMENT_VALIDITY_DAYS * DAY;
    const plan = pathSampleTimes(lastValid - PERIOD / 2, PERIOD, EPOCH);
    expect(plan.truncated).toBe(true);
    expect(plan.times.length).toBeGreaterThan(PATH_SAMPLES / 2 - 2);
    expect(plan.times.length).toBeLessThan(PATH_SAMPLES / 2 + 2);
    expect(Math.max(...plan.times)).toBeLessThanOrEqual(lastValid);
  });

  it('ne rend AUCUN point hors validité à la date de la scène', () => {
    const outside = EPOCH + (ELEMENT_VALIDITY_DAYS + 1) * DAY;
    expect(pathSampleTimes(outside, PERIOD, EPOCH).times).toEqual([]);
    expect(
      pathSampleTimes(EPOCH - (ELEMENT_VALIDITY_DAYS + 1) * DAY, PERIOD, EPOCH)
        .times
    ).toEqual([]);
  });

  it('refuse une période absurde au lieu de tracer un point', () => {
    expect(pathSampleTimes(EPOCH, 0, EPOCH).times).toEqual([]);
    expect(pathSampleTimes(EPOCH, Number.NaN, EPOCH).times).toEqual([]);
    expect(pathSampleTimes(EPOCH, -PERIOD, EPOCH).times).toEqual([]);
  });
});

describe('pathIsStale', () => {
  it('une trace jamais calculée est périmée', () => {
    expect(pathIsStale(null, EPOCH, PERIOD)).toBe(true);
  });

  it('reste valable sous la fraction de période, dans les deux sens du temps', () => {
    const limit = PERIOD * PATH_REFRESH_FRACTION;
    expect(pathIsStale(EPOCH, EPOCH + limit * 0.9, PERIOD)).toBe(false);
    expect(pathIsStale(EPOCH, EPOCH - limit * 0.9, PERIOD)).toBe(false);
    expect(pathIsStale(EPOCH, EPOCH + limit * 1.1, PERIOD)).toBe(true);
    expect(pathIsStale(EPOCH, EPOCH - limit * 1.1, PERIOD)).toBe(true);
  });

  it('à vitesse réelle elle est recalculée environ une fois par minute, pas à chaque image', () => {
    const framesPerMinute = 60 * 60;
    const stepMs = 1000 / 60;
    let recomputed = 0;
    let at: number | null = null;
    for (let i = 0; i < framesPerMinute * 5; i++) {
      const now = EPOCH + i * stepMs;
      if (pathIsStale(at, now, PERIOD)) {
        at = now;
        recomputed += 1;
      }
    }
    // Cinq minutes de temps réel : une poignée de recalculs sur 18 000 images.
    expect(recomputed).toBeGreaterThan(3);
    expect(recomputed).toBeLessThan(10);
  });
});

describe('followVerdict', () => {
  const base: FollowState = {
    present: true,
    valid: true,
    solved: true,
    cameraTarget: 'satellite-track',
    anchor: 'satellite-track',
  };

  it('continue tant que tout tient', () => {
    expect(followVerdict(base)).toBe('continue');
  });

  it('s arrête hors validité : aucune position périmée n est gardée', () => {
    expect(followVerdict({ ...base, valid: false })).toBe('stop-outside');
  });

  it('s arrête sans solution SGP4 (orbite décrue)', () => {
    expect(followVerdict({ ...base, solved: false })).toBe('stop-no-solution');
  });

  it('s arrête quand l objet a disparu du fichier', () => {
    expect(followVerdict({ ...base, present: false })).toBe('stop-missing');
  });

  it('le choix d un autre corps par le visiteur passe avant tout calcul', () => {
    expect(
      followVerdict({ ...base, cameraTarget: 'earth', valid: false })
    ).toBe('stop-retargeted');
    expect(followVerdict({ ...base, cameraTarget: null })).toBe(
      'stop-retargeted'
    );
  });
});
