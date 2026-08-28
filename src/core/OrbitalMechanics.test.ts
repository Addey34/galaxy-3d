import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { CelestialBodyConfig, CelestialConfig } from '@/types';
import {
  educationalParentOrbitScale,
  OrbitalMechanics,
  computeGreenwichSubsolarLongitude,
} from './OrbitalMechanics';
import { SQRT_K } from './ScaleService';
import { CELESTIAL_CONFIG } from '@/config/bodies';

const DAY_MS = 86_400_000;

/**
 * Instance minimale pour tester le THROTTLE de recalcul de positions dans `update()`.
 * On contourne le vrai constructeur (services lourds) via `Object.create`, on injecte une
 * horloge factice dont on pilote la date, on neutralise le morph, et on espionne `_updateBody`
 * (la sortie observable : appelé = positions recalculées ce frame). `_minRecomputeThresholdMs`
 * est fixé explicitement pour rendre le seuil déterministe, indépendamment du catalogue.
 */
function makeThrottleHarness(thresholdMs: number): {
  mechanics: OrbitalMechanics;
  setDate: (ms: number) => void;
  updateBody: ReturnType<typeof vi.fn>;
} {
  const mechanics = Object.create(
    OrbitalMechanics.prototype
  ) as OrbitalMechanics;

  let currentMs = 0;
  const clock = {
    get date(): Date {
      return new Date(currentMs);
    },
    syncToRealTime: () => {},
    setTimeScale: () => {},
    timeScale: 1,
    // Utilisé par _afterTimeTravel via addTimeOffset dans un test.
    addDays: (days: number) => {
      currentMs += days * DAY_MS;
    },
    resetOffset: () => {},
  };

  const config: CelestialConfig = {
    bodies: {
      probe: {
        kind: 'planet',
        radius: 1,
        rotationSpeed: 0,
        orbitalColor: 0xffffff,
        textureResolutions: {},
        textures: {},
        realData: { orbitPeriodDays: 1 },
      } as CelestialBodyConfig,
    },
  };

  const updateBody = vi.fn();
  // Les initialiseurs de champs de classe ne s'exécutent pas avec Object.create : on pose
  // explicitement l'état que lit le throttle (null = force le recalcul du premier frame).
  Object.defineProperty(mechanics, '_lastPositionMs', {
    value: null,
    writable: true,
  });
  Object.defineProperty(mechanics, '_morphActive', {
    value: false,
    writable: true,
  });
  Object.defineProperty(mechanics, '_prevPaused', {
    value: false,
    writable: true,
  });
  Object.defineProperty(mechanics, 'clock', { value: clock });
  Object.defineProperty(mechanics, 'config', { value: config });
  Object.defineProperty(mechanics, 'bodies', { value: {} });
  Object.defineProperty(mechanics, '_advanceMorph', { value: () => {} });
  Object.defineProperty(mechanics, 'syncAnglesFromEphemeris', {
    value: () => {},
  });
  Object.defineProperty(mechanics, '_updateBody', { value: updateBody });
  Object.defineProperty(mechanics, '_minRecomputeThresholdMs', {
    value: thresholdMs,
    writable: true,
  });

  return {
    mechanics,
    setDate: (ms: number) => {
      currentMs = ms;
    },
    updateBody,
  };
}

describe('OrbitalMechanics orbit sampling', () => {
  it('keeps Jupiter moons ordered and outside the enlarged educational Jupiter', () => {
    const jupiter = CELESTIAL_CONFIG.bodies.jupiter;
    const scale = educationalParentOrbitScale(jupiter);
    const radii = ['io', 'europa', 'ganymede', 'callisto'].map((name) => {
      const distanceAU = jupiter.satellites?.[name].realData?.distanceAU ?? 0;
      return Math.sqrt(distanceAU) * SQRT_K * scale;
    });

    expect(scale).toBeGreaterThan(1);
    expect(radii[0]).toBeGreaterThan(jupiter.radius);
    expect(radii[0]).toBeLessThan(radii[1]);
    expect(radii[1]).toBeLessThan(radii[2]);
    expect(radii[2]).toBeLessThan(radii[3]);
  });
  it('rejects a heliocentric ephemeris at the wrong planetary distance', () => {
    const mechanics = Object.create(
      OrbitalMechanics.prototype
    ) as OrbitalMechanics;
    const fallbackElements = {
      semiMajorAxisAU: 1.524,
      eccentricity: 0,
      inclinationRad: 0,
      ascendingNodeRad: 0,
      argPerihelionRad: 0,
      meanAnomalyAtEpochRad: 0,
      epoch: new Date('2026-01-01T00:00:00Z'),
    };
    Object.defineProperty(mechanics, 'horizons', {
      value: {
        getHeliocentricAU: () => new THREE.Vector3(4.6, 0, 0),
      },
    });
    Object.defineProperty(mechanics, 'elements', {
      value: {
        getHeliocentricAU: () => new THREE.Vector3(1.524, 0, 0),
      },
    });

    const config = {
      kind: 'planet',
      radius: 0.53,
      rotationSpeed: 0,
      orbitalColor: 0xffffff,
      textureResolutions: {},
      textures: {},
      realData: { distanceAU: 1.524 },
      orbitalElements: fallbackElements,
    } as CelestialBodyConfig;
    const position = (
      mechanics as unknown as {
        _positionAU: (
          name: string,
          config: CelestialBodyConfig,
          date: Date
        ) => THREE.Vector3 | null;
      }
    )._positionAU('mars', config, new Date('2026-08-09T00:00:00Z'));

    expect(position?.length()).toBeCloseTo(1.524, 8);
  });
  it('starts the Explo curve opposite the current body and closes it there', () => {
    const mechanics = Object.create(
      OrbitalMechanics.prototype
    ) as OrbitalMechanics;
    Object.defineProperty(mechanics, 'scale', { value: { mode: 'explo' } });
    Object.defineProperty(mechanics, '_positionAU', {
      value: (_name: string, _cfg: CelestialBodyConfig, date: Date) =>
        new THREE.Vector3(date.getTime() / DAY_MS, 0, 0),
    });

    const config = {
      kind: 'asteroid',
      radius: 0.1,
      rotationSpeed: 0,
      orbitalColor: 0xffffff,
      textureResolutions: {},
      textures: {},
      realData: { distanceAU: 2, orbitPeriodDays: 8 },
    } as CelestialBodyConfig;
    const date = new Date('2026-08-02T00:00:00Z');
    const points = mechanics.computeOrbitPoints('test', config, date, 4);

    expect(points).not.toBeNull();
    const seamStart = points![0];
    const seamEnd = points![12];
    expect(seamStart).toBeCloseTo((date.getTime() / DAY_MS - 4) * 35);
    expect(seamEnd).toBeCloseTo(seamStart);
    expect(seamStart).not.toBeCloseTo((date.getTime() / DAY_MS) * 35);
  });
  it('keeps real radial variation in compressed educational orbits', () => {
    const mechanics = Object.create(
      OrbitalMechanics.prototype
    ) as OrbitalMechanics;
    Object.defineProperty(mechanics, 'scale', { value: { mode: 'educ' } });
    Object.defineProperty(mechanics, '_positionAU', {
      value: (_name: string, _cfg: CelestialBodyConfig, date: Date) => {
        const phase = (date.getTime() / DAY_MS) % 8;
        return new THREE.Vector3(
          1.5 + 0.5 * Math.cos((phase / 8) * Math.PI * 2),
          0,
          0
        );
      },
    });
    const config = { realData: { orbitPeriodDays: 8 } } as CelestialBodyConfig;
    const points = mechanics.computeOrbitPoints(
      'test',
      config,
      new Date('2026-08-02T00:00:00Z'),
      8
    );
    const radii = [0, 1, 2, 3].map((i) => Math.abs(points![i * 3]));
    expect(
      new Set(radii.map((radius) => radius.toFixed(6))).size
    ).toBeGreaterThan(1);
  });
  it('derives the recompute threshold from the fastest orbital period', () => {
    // Le corps le plus rapide du catalogue (période la plus courte) fixe le seuil global :
    // fraction d'orbite (0,5°/360°) × période. On construit une vraie instance sur le vrai
    // catalogue (les dépendances de service ne sont pas touchées par le constructeur) et on
    // compare au minimum calculé indépendamment ici.
    let minPeriodDays = Infinity;
    const walk = (
      bodies: Record<string, CelestialBodyConfig>
    ): void => {
      for (const cfg of Object.values(bodies)) {
        const period = cfg.realData?.orbitPeriodDays;
        if (period && period > 0 && period < minPeriodDays)
          minPeriodDays = period;
        if (cfg.satellites) walk(cfg.satellites);
      }
    };
    walk(CELESTIAL_CONFIG.bodies);
    const expectedMs = minPeriodDays * DAY_MS * (0.5 / 360);

    const noopClock = {
      date: new Date(),
      syncToRealTime() {},
      setTimeScale() {},
      timeScale: 1,
    };
    const mechanics = new OrbitalMechanics(
      noopClock as never,
      {} as never,
      {} as never,
      { getHeliocentricAU: () => null, getParentRelativeAU: () => null } as never,
      CELESTIAL_CONFIG,
      {}
    );

    expect(
      (mechanics as unknown as { _minRecomputeThresholdMs: number })
        ._minRecomputeThresholdMs
    ).toBeCloseTo(expectedMs, 3);
  });

  describe('position recompute throttle', () => {
    it('recomputes on the first frame then skips while below the threshold', () => {
      const { mechanics, setDate, updateBody } = makeThrottleHarness(1000);

      // Premier frame : _lastPositionMs === null → recalcul obligatoire.
      setDate(0);
      mechanics.update(1);
      expect(updateBody).toHaveBeenCalledTimes(1);

      // Avancée simulée < seuil (1000 ms) → on saute le recalcul.
      setDate(400);
      mechanics.update(1);
      setDate(900);
      mechanics.update(1);
      expect(updateBody).toHaveBeenCalledTimes(1);
    });

    it('recomputes once the simulated advance reaches the threshold', () => {
      const { mechanics, setDate, updateBody } = makeThrottleHarness(1000);
      setDate(0);
      mechanics.update(1);
      updateBody.mockClear();

      setDate(1000); // exactement le seuil → recalcul
      mechanics.update(1);
      expect(updateBody).toHaveBeenCalledTimes(1);
    });

    it('recomputes every frame when each advance dwarfs the threshold (high speed)', () => {
      const { mechanics, setDate, updateBody } = makeThrottleHarness(1000);
      setDate(0);
      mechanics.update(1);
      updateBody.mockClear();

      // À vitesse extrême, un frame dépasse largement le seuil → recalcul continu.
      setDate(1_000_000);
      mechanics.update(1);
      setDate(2_000_000);
      mechanics.update(1);
      expect(updateBody).toHaveBeenCalledTimes(2);
    });

    it('forces a recompute on the frame after a time jump', () => {
      const { mechanics, setDate, updateBody } = makeThrottleHarness(1_000_000);
      setDate(0);
      mechanics.update(1);
      updateBody.mockClear();

      // Sans saut, une petite avancée reste sous le gros seuil → skip.
      setDate(500);
      mechanics.update(1);
      expect(updateBody).not.toHaveBeenCalled();

      // Saut temporel : _afterTimeTravel remet _lastPositionMs à null → recalcul forcé.
      mechanics.addTimeOffset(2);
      mechanics.update(1);
      expect(updateBody).toHaveBeenCalledTimes(1);
    });

    it('jumpToDate lands exactly on the target date and forces a recompute', () => {
      const { mechanics, setDate, updateBody } = makeThrottleHarness(1_000_000);
      setDate(0);
      mechanics.update(1);
      updateBody.mockClear();

      const target = new Date(7 * DAY_MS + 12 * 3_600_000);
      mechanics.jumpToDate(target);
      expect(mechanics.simulationDate.getTime()).toBe(target.getTime());

      mechanics.update(1);
      expect(updateBody).toHaveBeenCalledTimes(1);
    });
  });

  it('uses apparent sidereal time for Greenwich subsolar longitude', () => {
    const noon = new Date('2026-08-17T12:00:00Z');
    const nextNoon = new Date('2026-08-18T12:00:00Z');
    const noonLongitude = computeGreenwichSubsolarLongitude(noon);
    const nextNoonLongitude = computeGreenwichSubsolarLongitude(nextNoon);

    // On this date the equation of time puts the subsolar meridian just east
    // of Greenwich at 12:00 UTC.
    expect(noonLongitude).toBeCloseTo(0.017862, 5);
    // The Sun's apparent right ascension advances more slowly than GAST over a day.
    expect(nextNoonLongitude - noonLongitude).toBeCloseTo(-0.00094, 4);
  });
});
