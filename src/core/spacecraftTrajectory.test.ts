import { describe, expect, it } from 'vitest';
import {
  cruiseIntervals,
  cruiseTimes,
  intervalTimes,
  pastCount,
  revolutionTimes,
  SEGMENT_POINTS,
  UNBOUND_HALF_WINDOW_DAYS,
} from './spacecraftTrajectory';
import { gravitationalParameter } from './twoBodyPropagation';

const DAY = 86_400_000;

describe('tronçons en route', () => {
  it('retire chaque phase de la couverture, et garde ce qui la précède et la suit', () => {
    const coverage = { fromMs: 0, toMs: 100 * DAY };
    const phases = [
      { body: 'mars', fromMs: 60 * DAY, toMs: 80 * DAY },
      { body: 'venus', fromMs: 10 * DAY, toMs: 20 * DAY },
    ];
    expect(cruiseIntervals(coverage, phases)).toEqual([
      { fromMs: 0, toMs: 10 * DAY },
      { fromMs: 20 * DAY, toMs: 60 * DAY },
      { fromMs: 80 * DAY, toMs: 100 * DAY },
    ]);
  });

  it("une phase qui court jusqu'à la fin du fichier ne laisse rien après elle", () => {
    // Juno : liée à Jupiter du 2016-07-05 à la fin de son fichier.
    expect(
      cruiseIntervals({ fromMs: 0, toMs: 10 * DAY }, [
        { body: 'jupiter', fromMs: 4 * DAY, toMs: 12 * DAY },
      ])
    ).toEqual([{ fromMs: 0, toMs: 4 * DAY }]);
  });

  it('sans phase, toute la couverture est un seul tronçon', () => {
    expect(cruiseIntervals({ fromMs: 5, toMs: 9 }, [])).toEqual([
      { fromMs: 5, toMs: 9 },
    ]);
  });
});

describe('instants échantillonnés', () => {
  it("serre les instants dans un segment, sans quoi une corde traverserait la planète d'un survol", () => {
    const times = intervalTimes({ fromMs: 0, toMs: 100 * DAY }, 11, [
      { fromMs: 50 * DAY, toMs: 52 * DAY },
    ]);
    const inside = times.filter((t) => t >= 50 * DAY && t <= 52 * DAY);
    expect(inside.length).toBeGreaterThanOrEqual(SEGMENT_POINTS);
    expect(times[0]).toBe(0);
    expect(times.at(-1)).toBe(100 * DAY);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('un segment hors du tronçon n’ajoute rien', () => {
    expect(
      intervalTimes({ fromMs: 0, toMs: 10 * DAY }, 5, [
        { fromMs: 20 * DAY, toMs: 21 * DAY },
      ])
    ).toHaveLength(5);
  });

  it('répartit les instants au prorata de la durée des tronçons', () => {
    const [short, long] = cruiseTimes(
      [
        { fromMs: 0, toMs: DAY },
        { fromMs: 2 * DAY, toMs: 11 * DAY },
      ],
      [],
      100
    );
    expect(short).toHaveLength(10);
    expect(long).toHaveLength(90);
  });

  it('compte les instants déjà parcourus à une date', () => {
    expect(pastCount([0, 10, 20, 30], 15)).toBe(2);
    expect(pastCount([0, 10, 20, 30], 30)).toBe(4);
    expect(pastCount([0, 10, 20, 30], -1)).toBe(0);
  });
});

describe('révolution en cours', () => {
  // Une orbite circulaire autour de Mars à 3 790 km du centre (TGO) : sa période se recalcule.
  const mu = gravitationalParameter(6.4171e23);
  const r = 3790 / 149_597_870.7;
  const v = Math.sqrt(mu / r);
  const periodMs = 2 * Math.PI * Math.sqrt((r * r * r) / mu) * DAY;
  const wide = { fromMs: 0, toMs: 2000 * DAY };
  const now = 1000 * DAY;

  it('tient UNE période osculatrice, centrée sur la date, à instants réguliers sur un cercle', () => {
    // Témoin : environ deux heures, la période publiée de TGO.
    expect(periodMs / 3_600_000).toBeGreaterThan(1.9);
    expect(periodMs / 3_600_000).toBeLessThan(2.1);
    const times = revolutionTimes(
      { x: r, y: 0, z: 0 },
      { x: 0, y: v, z: 0 },
      mu,
      now,
      wide,
      9
    );
    expect(times).toHaveLength(9);
    expect(times.at(-1)! - times[0]!).toBeCloseTo(periodMs, -1);
    expect((times[0]! + times.at(-1)!) / 2).toBeCloseTo(now, -1);
    const steps = times.slice(1).map((t, i) => t - times[i]!);
    for (const step of steps) expect(step).toBeCloseTo(periodMs / 8, -1);
  });

  it("se serre au périapse d'une ellipse très excentrique (Juno, e ≈ 0,98)", () => {
    // Au périapse, vitesse √(μ(1+e)/r) : l'apoapse est à 99 fois la distance.
    const e = 0.98;
    const times = revolutionTimes(
      { x: r, y: 0, z: 0 },
      { x: 0, y: Math.sqrt((mu * (1 + e)) / r), z: 0 },
      mu,
      now,
      wide,
      241
    );
    const steps = times.slice(1).map((t, i) => t - times[i]!);
    const nearest = Math.min(...steps);
    const widest = Math.max(...steps);
    // La date EST le périapse : les instants les plus serrés l'entourent.
    const iNow = times.findIndex((t) => t >= now);
    expect(steps[iNow - 1]).toBeCloseTo(nearest, -1);
    expect(widest / nearest).toBeGreaterThan(50);
  });

  it('est bornée à la phase', () => {
    const times = revolutionTimes(
      { x: r, y: 0, z: 0 },
      { x: 0, y: v, z: 0 },
      mu,
      now,
      { fromMs: now - 60_000, toMs: now + DAY }
    );
    expect(Math.min(...times)).toBeGreaterThanOrEqual(now - 60_000);
  });

  it("une orbite osculatrice ouverte se trace sur quelques jours, pas sur une période qui n'existe pas", () => {
    const times = revolutionTimes(
      { x: r, y: 0, z: 0 },
      { x: 0, y: 2 * v, z: 0 },
      mu,
      100 * DAY,
      wide
    );
    expect((times.at(-1)! - times[0]!) / DAY).toBeCloseTo(
      2 * UNBOUND_HALF_WINDOW_DAYS,
      9
    );
  });
});
