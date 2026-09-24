import { describe, expect, it } from 'vitest';
import manifest from '../../public/assets/ephemerides/manifest.json';
import {
  BYTES_PER_SAMPLE,
  READ_AHEAD_SECONDS,
  WINDOW_MARGIN_SAMPLES,
} from './ephemerisWindow';
import { MAX_SIMULATION_SCALE } from '@/ui/speedSlider';
import {
  bytesPerSimulatedDay,
  demandBytesPerSecond,
  overheadBytesPerSecond,
  sustainableTimeScale,
} from './playbackBudget';

/**
 * LE PLAFOND DE VITESSE EST DÉRIVÉ, JAMAIS ÉCRIT À LA MAIN (phase 17D, § 9b option (c)).
 *
 * La garde centrale est la première : la formule est confrontée au MANIFESTE LIVRÉ et au seul
 * chiffre que le plan a mesuré, 2,34 Mbit/s à la vitesse maximale (§ 6, mesuré le 2026-09-23).
 * Un modèle de demande qui ne reproduit pas cette mesure serait une invention plausible.
 */
const SECONDS_PER_DAY = 86_400;

const grids = Object.values(
  (manifest as { bodies: Record<string, { stepDays: number }> }).bodies
);

describe('bytesPerSimulatedDay', () => {
  it('reproduit la mesure publiée du plan : 2,34 Mbit/s à la vitesse maximale', () => {
    const perDay = bytesPerSimulatedDay(grids);
    // 64 corps au 2026-09-24. Si le catalogue change, ce chiffre change AVEC lui : c'est le
    // point, la demande est calculée et non déclarée.
    expect(grids.length).toBe(64);
    expect(perDay).toBeCloseTo(800.2, 1);
    const atMaxSpeed = (perDay * MAX_SIMULATION_SCALE) / SECONDS_PER_DAY;
    expect(atMaxSpeed).toBeCloseTo(292_291, 0);
    expect((atMaxSpeed * 8) / 1e6).toBeCloseTo(2.34, 2);
  });

  it('ne compte que les corps passés : un corps hors couverture ne demande rien', () => {
    const one = bytesPerSimulatedDay([{ stepDays: 4 }]);
    expect(one).toBe(BYTES_PER_SAMPLE / 4);
    expect(bytesPerSimulatedDay([])).toBe(0);
  });

  it('ignore un pas absurde plutôt que de rendre Infinity', () => {
    expect(bytesPerSimulatedDay([{ stepDays: 0 }])).toBe(0);
    expect(bytesPerSimulatedDay([{ stepDays: -4 }])).toBe(0);
    expect(bytesPerSimulatedDay([{ stepDays: Number.NaN }])).toBe(0);
  });

  it('un pas deux fois plus fin coûte deux fois plus cher', () => {
    expect(bytesPerSimulatedDay([{ stepDays: 2 }])).toBe(
      2 * bytesPerSimulatedDay([{ stepDays: 4 }])
    );
  });
});

describe('overheadBytesPerSecond', () => {
  it('compte les marges redemandées à chaque glissement de fenêtre', () => {
    // Deux marges par corps, redemandées une fois par période d'avance de lecture.
    const perBody =
      (2 * WINDOW_MARGIN_SAMPLES * BYTES_PER_SAMPLE) / READ_AHEAD_SECONDS;
    expect(overheadBytesPerSecond(1)).toBe(perBody);
    expect(overheadBytesPerSecond(64)).toBe(64 * perBody);
    // 3 072 o/s pour 64 corps, soit 24,6 kbit/s : petit, mais il pèse là où le lien est pauvre.
    expect(overheadBytesPerSecond(64)).toBe(3_072);
  });

  it('rend 0 pour un compte absurde', () => {
    expect(overheadBytesPerSecond(0)).toBe(0);
    expect(overheadBytesPerSecond(-3)).toBe(0);
    expect(overheadBytesPerSecond(Number.NaN)).toBe(0);
  });
});

describe('demandBytesPerSecond', () => {
  it('croît avec la vitesse et ne dépend pas de son SIGNE', () => {
    const perDay = bytesPerSimulatedDay(grids);
    const forward = demandBytesPerSecond(86_400, perDay, grids.length);
    const backward = demandBytesPerSecond(-86_400, perDay, grids.length);
    expect(backward).toBe(forward);
    expect(
      demandBytesPerSecond(2 * 86_400, perDay, grids.length)
    ).toBeGreaterThan(forward);
  });

  it('au temps réel, la demande est presque entièrement du coût fixe', () => {
    const perDay = bytesPerSimulatedDay(grids);
    const atRealTime = demandBytesPerSecond(1, perDay, grids.length);
    expect(atRealTime - overheadBytesPerSecond(grids.length)).toBeLessThan(1);
  });
});

describe('sustainableTimeScale', () => {
  const perSimulatedDay = bytesPerSimulatedDay(grids);
  const bodyCount = grids.length;
  const ceiling = (bytesPerSecond: number | null): number | null =>
    sustainableTimeScale({
      bytesPerSecond,
      perSimulatedDay,
      bodyCount,
      maxTimeScale: MAX_SIMULATION_SCALE,
    });

  it('ne plafonne RIEN sans mesure de débit', () => {
    expect(ceiling(null)).toBeNull();
  });

  it('ne plafonne rien au-dessus de la demande maximale (2,34 Mbit/s)', () => {
    // 10 Mbit/s : le plan mesure que ce lien absorbe la vitesse maximale. Le plafond doit donc
    // être ABSENT, et pas égal au maximum : l'interface ne dit rien quand il n'y a rien à dire.
    expect(ceiling(1_250_000)).toBeNull();
    expect(ceiling(6_250_000)).toBeNull();
  });

  it('plafonne un lien à 2 Mbit/s en dessous de la vitesse maximale', () => {
    const cap = ceiling(250_000);
    expect(cap).not.toBeNull();
    expect(cap!).toBeLessThan(MAX_SIMULATION_SCALE);
    // 85,5 % du maximum, dérivé : (250 000 − 3 072) × 86 400 / 800,2.
    const expected = Math.floor(
      ((250_000 - overheadBytesPerSecond(bodyCount)) * SECONDS_PER_DAY) /
        perSimulatedDay
    );
    expect(cap).toBe(expected);
    expect(cap! / MAX_SIMULATION_SCALE).toBeCloseTo(0.845, 2);
  });

  it('un lien deux fois plus lent plafonne deux fois plus bas, à peu près', () => {
    const slow = ceiling(120_000)!;
    const slower = ceiling(60_000)!;
    expect(slower).toBeLessThan(slow);
    expect(slow / slower).toBeGreaterThan(1.9);
    expect(slow / slower).toBeLessThan(2.2);
  });

  it('ne descend JAMAIS sous le temps réel 1:1', () => {
    // Un lien qui ne couvre même pas le coût fixe : le plafond vaut 1, jamais 0 ni négatif.
    expect(ceiling(1)).toBe(1);
    expect(ceiling(3_000)).toBe(1);
    expect(ceiling(0)).toBe(1);
  });

  it("rend null quand aucun corps ne demande d'octets", () => {
    expect(
      sustainableTimeScale({
        bytesPerSecond: 1_000,
        perSimulatedDay: 0,
        bodyCount: 0,
        maxTimeScale: MAX_SIMULATION_SCALE,
      })
    ).toBeNull();
  });

  it('rend un entier : une vitesse est un nombre de secondes simulées par seconde', () => {
    const cap = ceiling(250_000)!;
    expect(Number.isInteger(cap)).toBe(true);
  });
});
