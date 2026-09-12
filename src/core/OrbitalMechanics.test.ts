import { describe, expect, it, vi } from 'vitest';
import type { CelestialBodyConfig, CelestialConfig } from '@/types';
import {
  OrbitalMechanics,
  computeGreenwichSubsolarLongitude,
} from './OrbitalMechanics';
import { educationalParentOrbitScale } from './educationalScale';
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

  // La vraie horloge n'avance pas toute seule : `update()` échantillonne la date AVANT
  // d'appeler `syncToRealTime()`, et c'est cet écart qui donne le pas de simulation (son
  // SIGNE porte le sens du temps). Le faux doit donc reproduire ce décalage : `setDate`
  // arme la date suivante, `syncToRealTime` la publie. Un saut temporel (`addDays`), lui,
  // s'applique immédiatement dans les deux — comme `_jumpTo` qui resynchronise aussitôt.
  let committedMs = 0;
  let pendingMs = 0;
  const clock = {
    get date(): Date {
      return new Date(committedMs);
    },
    syncToRealTime: () => {
      committedMs = pendingMs;
    },
    setTimeScale: () => {},
    timeScale: 1,
    // Utilisé par _afterTimeTravel via addTimeOffset dans un test.
    addDays: (days: number) => {
      pendingMs += days * DAY_MS;
      committedMs = pendingMs;
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
      pendingMs = ms;
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
  it('derives the recompute threshold from the fastest orbital period', () => {
    // Le corps le plus rapide du catalogue (période la plus courte) fixe le seuil global :
    // fraction d'orbite (0,5°/360°) × période. On construit une vraie instance sur le vrai
    // catalogue (les dépendances de service ne sont pas touchées par le constructeur) et on
    // compare au minimum calculé indépendamment ici.
    let minPeriodDays = Infinity;
    const walk = (bodies: Record<string, CelestialBodyConfig>): void => {
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
      {
        getHeliocentricAU: () => null,
        getParentRelativeAU: () => null,
      } as never,
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

    /**
     * La timebar est bidirectionnelle : à gauche du centre, `timeScale` est négatif et la
     * date SIMULÉE RECULE. `simDeltaSeconds` est l'unique source du pas de rotation propre
     * (AnimationSystem → CelestialObject._advanceSpin, une intégrale) : s'il ne porte que la
     * magnitude, chaque planète continue de tourner vers l'AVANT pendant que le temps recule.
     * Défaut réellement livré, et invisible sur la Terre seule — sa phase est dérivée de la
     * date (syncEarthSurfaceRotation), donc elle repartait correctement à l'envers pendant
     * que toutes les autres tournaient à l'endroit.
     */
    it('reports a negative sim delta when the clock runs backwards', () => {
      const { mechanics, setDate } = makeThrottleHarness(1000);
      setDate(10_000);
      mechanics.update(1);

      setDate(6_000); // 4 s de simulation en ARRIÈRE
      mechanics.update(1);
      expect(mechanics.simDeltaSeconds).toBeCloseTo(-4, 6);

      setDate(9_000); // puis 3 s en avant : le signe suit le sens
      mechanics.update(1);
      expect(mechanics.simDeltaSeconds).toBeCloseTo(3, 6);
    });

    it('still recomputes positions when the clock runs backwards', () => {
      const { mechanics, setDate, updateBody } = makeThrottleHarness(1000);
      setDate(10_000);
      mechanics.update(1);
      updateBody.mockClear();

      setDate(9_600); // recul < seuil → skip
      mechanics.update(1);
      expect(updateBody).not.toHaveBeenCalled();

      setDate(8_600); // recul cumulé ≥ seuil → recalcul
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

describe('fin de transition éduc↔explo : ordre des rappels', () => {
  /**
   * CE QUI REND SÛR UN PARAMÈTRE DÉLIBÉRÉMENT IGNORÉ.
   *
   * `onMorphPhase` est typé `(active: boolean) => void`, et `SolarSystemApp` l'implémente en
   * IGNORANT ce paramètre : il masque les lignes d'orbite dans les deux cas. Lu seul, cela
   * ressemble à un oubli, et « corriger » l'implémentation pour réafficher en fin de morph
   * paraîtrait évident. Ce serait une régression : à cet instant les lignes décrivent encore
   * la géométrie de l'ANCIEN mode, et on les montrerait une frame aux positions du nouveau.
   *
   * Ce qui rend l'ensemble correct est un ORDRE, pas une valeur : `onMorphPhase(false)` masque,
   * puis `onOrbitsChanged` recalcule AVANT de réafficher. Inverser ces deux appels, ou rendre
   * `onOrbitsChanged` différé, ferait disparaître les lignes d'orbite pour de bon après un
   * changement de mode — une fonctionnalité entière perdue, sans erreur nulle part.
   *
   * Cet ordre n'était écrit nulle part et tenu par rien. Il l'est ici.
   */
  function makeMorphHarness(): {
    mechanics: OrbitalMechanics;
    calls: string[];
  } {
    const mechanics = Object.create(
      OrbitalMechanics.prototype
    ) as OrbitalMechanics;
    const internals = mechanics as unknown as {
      _morphActive: boolean;
      _morphFrom: number;
      _morphTo: number;
      _morphElapsed: number;
      _advanceMorph(realDelta: number): void;
    };
    internals._morphActive = true;
    internals._morphFrom = 0;
    internals._morphTo = 1;
    internals._morphElapsed = 0;

    const calls: string[] = [];
    mechanics.onScaleMorph = (p) => calls.push(`scale:${p}`);
    mechanics.onMorphPhase = (active) => calls.push(`phase:${active}`);
    mechanics.onOrbitsChanged = () => calls.push('orbits');
    return { mechanics, calls };
  }

  it('masque AVANT de recalculer, et ne recalcule qu’une fois arrivé', () => {
    const { mechanics, calls } = makeMorphHarness();
    const internals = mechanics as unknown as {
      _advanceMorph(realDelta: number): void;
    };

    // Une frame à mi-parcours : la taille bouge, mais rien ne conclut.
    internals._advanceMorph(0.6);
    expect(calls.filter((c) => c === 'orbits')).toHaveLength(0);
    expect(calls.filter((c) => c.startsWith('phase:'))).toHaveLength(0);

    calls.length = 0;
    // La frame qui franchit la durée totale.
    internals._advanceMorph(1.0);

    const phaseIndex = calls.indexOf('phase:false');
    const orbitsIndex = calls.indexOf('orbits');
    expect(phaseIndex, 'la fin de morph doit être annoncée').toBeGreaterThan(
      -1
    );
    expect(orbitsIndex, 'les orbites doivent être recalculées').toBeGreaterThan(
      -1
    );
    // L'ASSERTION qui porte tout : masquer précède recalculer-puis-réafficher.
    expect(phaseIndex).toBeLessThan(orbitsIndex);
  });

  it('cale exactement la taille sur le mode cible avant de conclure', () => {
    // Sans ce calage final, le morph s'arrête sur la valeur eased de la dernière frame —
    // proche de 1 mais pas 1, donc des tailles durablement fausses d'une fraction de pour cent.
    const { mechanics, calls } = makeMorphHarness();
    (mechanics as unknown as { _advanceMorph(d: number): void })._advanceMorph(
      99
    );
    expect(calls.at(-3)).toBe('scale:1');
    expect(calls.at(-2)).toBe('phase:false');
    expect(calls.at(-1)).toBe('orbits');
  });
});
