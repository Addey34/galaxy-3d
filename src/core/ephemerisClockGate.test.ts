import { describe, expect, it, vi } from 'vitest';
import type { CelestialBodyConfig, CelestialConfig } from '@/types';
import { OrbitalMechanics, type EphemerisWindows } from './OrbitalMechanics';
import { readAheadDays } from './ephemerisWindow';

/**
 * L'HORLOGE N'AVANCE QUE SUR DES DONNÉES ARRIVÉES (lot 17, décision D3).
 *
 * Depuis la phase 17C le service ne tient qu'une fenêtre de chaque binaire. Une date qui en
 * sort n'est pas une date sans données : ce sont des données PAS ENCORE LÀ, et les afficher
 * par une source de repli en attendant serait « une position fausse en attendant », que le
 * lot 15 a mesurée à 2 600 km sur Mercure. Ces gardes tiennent les trois règles :
 *
 *   - la date se fige tant que les octets manquent, et elle est redemandée ;
 *   - un saut ne s'applique QUE quand sa fenêtre est là, et il s'applique alors EXACTEMENT ;
 *   - rien ne fige la scène pour toujours : quand la demande revient sans les octets, on
 *     avance quand même, et c'est le bandeau du lot 15 qui dit ce qui manque.
 */

const DAY_MS = 86_400_000;

interface Harness {
  mechanics: OrbitalMechanics;
  /** Arme la date que `syncToRealTime` publiera au prochain `update()`. */
  setDate: (ms: number) => void;
  dateMs: () => number;
  updateBody: ReturnType<typeof vi.fn>;
  orbitsChanged: ReturnType<typeof vi.fn>;
  /** Les demandes faites au service : date visée et avance réclamée. */
  asks: { dateMs: number; leadDays: number; lines: boolean }[];
  /** Ce que la fausse source déclare tenir. */
  setReady: (ready: (dateMs: number) => boolean) => void;
  /** Résout la demande en vol. */
  deliver: () => Promise<void>;
  setTimeScale: (scale: number) => void;
}

function makeGateHarness(): Harness {
  const mechanics = Object.create(
    OrbitalMechanics.prototype
  ) as OrbitalMechanics;

  let committedMs = 0;
  let pendingMs = 0;
  let timeScale = 1;
  const clock = {
    get date(): Date {
      return new Date(committedMs);
    },
    get timeScale(): number {
      return timeScale;
    },
    syncToRealTime: () => {
      committedMs = pendingMs;
    },
    setTimeScale: () => {},
    // `holdAt` fige la date SANS dette : la reprise repart d'ici (cf. SimulationClock).
    holdAt: (date: Date) => {
      committedMs = date.getTime();
      pendingMs = committedMs;
    },
    addDays: (days: number) => {
      pendingMs = committedMs + days * DAY_MS;
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

  const asks: Harness['asks'] = [];
  let ready: (dateMs: number) => boolean = () => true;
  let resolvePending: (() => void) | null = null;

  const windows: EphemerisWindows = {
    ready: (date) => ready(date.getTime()),
    ensure: (date, leadDays, lines) => {
      asks.push({ dateMs: date.getTime(), leadDays, lines });
      return new Promise<void>((resolve) => {
        resolvePending = resolve;
      });
    },
  };

  const updateBody = vi.fn();
  const orbitsChanged = vi.fn();
  for (const [key, value] of Object.entries({
    _lastPositionMs: null,
    _morphActive: false,
    _prevPaused: false,
    _windows: windows,
    _windowRequest: null,
    _pendingJump: null,
    _minRecomputeThresholdMs: 1,
    // `Object.create` n'exécute pas les initialiseurs de champs : la liste des écouteurs doit
    // être posée ici, sinon `onDateSettled` lit `undefined`.
    _dateSettledListeners: [],
  }))
    Object.defineProperty(mechanics, key, { value, writable: true });
  Object.defineProperty(mechanics, 'clock', { value: clock });
  Object.defineProperty(mechanics, 'config', { value: config });
  Object.defineProperty(mechanics, 'bodies', { value: {} });
  Object.defineProperty(mechanics, '_advanceMorph', { value: () => {} });
  Object.defineProperty(mechanics, 'syncAnglesFromEphemeris', {
    value: () => {},
  });
  Object.defineProperty(mechanics, 'syncAxesFromEphemeris', {
    value: () => {},
  });
  Object.defineProperty(mechanics, 'syncEarthSurfaceRotation', {
    value: () => {},
  });
  Object.defineProperty(mechanics, '_updateBody', { value: updateBody });
  mechanics.onOrbitsChanged = orbitsChanged;

  return {
    mechanics,
    setDate: (ms) => {
      pendingMs = ms;
    },
    dateMs: () => committedMs,
    updateBody,
    orbitsChanged,
    asks,
    setReady: (next) => {
      ready = next;
    },
    deliver: async () => {
      resolvePending?.();
      resolvePending = null;
      // Laisse le `finally` de la demande s'exécuter (il applique le saut en attente).
      await Promise.resolve();
      await Promise.resolve();
    },
    setTimeScale: (scale) => {
      timeScale = scale;
    },
  };
}

describe('l’avance de lecture', () => {
  it('est proportionnelle à la vitesse, et SIGNÉE comme elle', () => {
    // `MAX_SIMULATION_SCALE = 31 557 600` : un an simulé par seconde réelle. À quatre
    // secondes d'avance, cela fait quatre ans de grille, soit 2,34 Mbit/s sur les 64 corps.
    expect(readAheadDays(31_557_600, 4)).toBe(1461);
    expect(readAheadDays(1, 4)).toBeCloseTo(4 / 86_400, 12);
    // La timebar est bidirectionnelle : en marche arrière, l'avance est en arrière.
    expect(readAheadDays(-86_400, 4)).toBe(-4);
    expect(readAheadDays(0, 4)).toBe(0);
    expect(readAheadDays(Number.NaN, 4)).toBe(0);
  });
});

describe('l’horloge attend ses octets (D3)', () => {
  it('fige la date quand la fenêtre manque, et la redemande', () => {
    const h = makeGateHarness();
    h.setDate(0);
    h.mechanics.update(1);
    expect(h.dateMs()).toBe(0);

    h.setReady((ms) => ms <= 0);
    h.setDate(10 * DAY_MS);
    h.mechanics.update(1);

    // La date est revenue là où elle était : aucune position de repli n'est affichée.
    expect(h.dateMs()).toBe(0);
    expect(h.asks).toHaveLength(1);
    expect(h.asks[0].lines).toBe(false);
  });

  it('repart exactement d’où elle s’était arrêtée une fois les octets là', async () => {
    const h = makeGateHarness();
    h.setDate(0);
    h.mechanics.update(1);

    h.setReady((ms) => ms <= 0);
    h.setDate(10 * DAY_MS);
    h.mechanics.update(1);
    expect(h.dateMs()).toBe(0);

    h.setReady(() => true);
    await h.deliver();
    h.setDate(10 * DAY_MS);
    h.mechanics.update(1);
    expect(h.dateMs()).toBe(10 * DAY_MS);
  });

  it('prend de l’avance AVANT d’en avoir besoin, selon la vitesse', () => {
    const h = makeGateHarness();
    h.setTimeScale(86_400); // un jour simulé par seconde réelle
    h.setDate(0);
    h.mechanics.update(1);

    // Tout est là pour la date affichée, mais pas pour l'avance que la vitesse réclame.
    h.setReady(() => true);
    const windows = (h.mechanics as unknown as { _windows: EphemerisWindows })
      ._windows;
    let asked = 0;
    windows.ready = (_date, leadDays) => {
      if (leadDays !== 0) asked++;
      return leadDays === 0;
    };
    h.setDate(DAY_MS);
    h.mechanics.update(1);

    expect(asked).toBeGreaterThan(0);
    expect(h.dateMs()).toBe(DAY_MS); // l'avance ne fige RIEN : la date, elle, est servie
    expect(h.asks).toHaveLength(1);
    expect(h.asks[0].leadDays).toBe(4); // 4 s d'avance à un jour par seconde
  });

  it('finit par avancer quand les octets ne viennent jamais, sans redemander sans fin', async () => {
    const h = makeGateHarness();
    h.setDate(0);
    h.mechanics.update(1);

    // Le lien est mort : la demande revient sans rien. La scène ne doit pas être prise en
    // otage — les corps concernés repassent sur leur repli et le bandeau du lot 15 les nomme.
    h.setReady((ms) => ms <= 0);
    for (let frame = 1; frame <= 8; frame++) {
      h.setDate(frame * DAY_MS);
      h.mechanics.update(1);
      await h.deliver();
    }

    // La date avance : la scène n'est pas prise en otage par un lien mort.
    expect(h.dateMs()).toBeGreaterThan(0);
    // Et elle continue de DEMANDER, une requête à la fois : renoncer à attendre n'est pas
    // renoncer à charger, sinon une coupure passagère arrêterait tout pour la session.
    expect(h.asks.length).toBeGreaterThan(3);
    expect(h.asks.length).toBeLessThanOrEqual(8);
  });

  it('ne double pas les requêtes quand plusieurs images passent', () => {
    const h = makeGateHarness();
    h.setDate(0);
    h.mechanics.update(1);
    h.setReady((ms) => ms <= 0);

    for (let frame = 1; frame <= 5; frame++) {
      h.setDate(frame * DAY_MS);
      h.mechanics.update(1);
    }
    expect(h.asks).toHaveLength(1);
  });
});

describe('un saut n’a lieu que sur des données arrivées (D3)', () => {
  it('diffère le saut, puis atterrit EXACTEMENT sur la cible', async () => {
    const h = makeGateHarness();
    h.setDate(0);
    h.mechanics.update(1);
    h.orbitsChanged.mockClear();

    h.setReady((ms) => ms <= 0);
    const target = new Date(365 * DAY_MS);
    h.mechanics.jumpToDate(target);

    expect(h.dateMs()).toBe(0);
    expect(h.mechanics.pendingJumpDate?.getTime()).toBe(target.getTime());
    // Rien n'est redessiné tant que la scène n'a pas bougé.
    expect(h.orbitsChanged).not.toHaveBeenCalled();

    h.setReady(() => true);
    await h.deliver();

    expect(h.dateMs()).toBe(target.getTime());
    expect(h.mechanics.pendingJumpDate).toBeNull();
    expect(h.orbitsChanged).toHaveBeenCalled();
  });

  it('demande les LIGNES en même temps que les positions, en un seul aller-retour', () => {
    const h = makeGateHarness();
    h.setDate(0);
    h.mechanics.update(1);

    h.setReady((ms) => ms <= 0);
    h.mechanics.jumpToDate(new Date(365 * DAY_MS));

    // Un saut redessine toute la scène : demander d'abord les positions puis les lignes
    // coûterait deux attentes là où une seule demande suffit.
    expect(h.asks).toHaveLength(1);
    expect(h.asks[0].lines).toBe(true);
  });

  it('ne redessine les lignes qu’une fois leur PÉRIODE entière arrivée', async () => {
    const h = makeGateHarness();
    h.setDate(0);
    h.mechanics.update(1);
    h.orbitsChanged.mockClear();

    // Les positions sont là, les lignes non : c'est exactement ce qui arrive après une
    // lecture accélérée, qui ne demande que des positions. Une ligne tracée là-dessus
    // épisserait Horizons et astronomy-engine sur les huit planètes.
    const windows = (h.mechanics as unknown as { _windows: EphemerisWindows })
      ._windows;
    windows.ready = (_date, _leadDays, lines) => !lines;
    h.mechanics.refreshPositionSources();

    expect(h.orbitsChanged).not.toHaveBeenCalled();
    expect(h.asks.at(-1)?.lines).toBe(true);

    windows.ready = () => true;
    await h.deliver();
    expect(h.orbitsChanged).toHaveBeenCalledTimes(1);
  });

  it('prévient quand un saut DIFFÉRÉ a fini par s’appliquer', async () => {
    const h = makeGateHarness();
    h.setDate(0);
    h.mechanics.update(1);

    const settled: number[] = [];
    h.mechanics.onDateSettled(() => settled.push(h.dateMs()));

    h.setReady((ms) => ms <= 0);
    const target = new Date(365 * DAY_MS);
    h.mechanics.jumpToDate(target);
    expect(settled).toEqual([]);

    h.setReady(() => true);
    await h.deliver();

    // Sans ce signal, l'adresse reste sur la date du DÉMARRAGE pendant que la scène affiche
    // celle qui était demandée : le permalien se resynchronise juste après avoir demandé le
    // saut, donc avant qu'il ne s'applique (mesuré sur le build, `?date=2080-03-01`).
    expect(settled).toEqual([target.getTime()]);
  });

  it('compte un déplacement relatif depuis la cible EN ATTENTE, pas depuis l’écran', async () => {
    const h = makeGateHarness();
    h.setDate(0);
    h.mechanics.update(1);

    h.setReady((ms) => ms <= 0);
    h.mechanics.addTimeOffset(10);
    h.mechanics.addTimeOffset(10);
    // Deux clics sur « +10 jours » pendant le chargement valent vingt jours, pas dix.
    expect(h.mechanics.pendingJumpDate?.getTime()).toBe(20 * DAY_MS);

    h.setReady(() => true);
    await h.deliver();
    expect(h.dateMs()).toBe(20 * DAY_MS);
  });

  it('avance quand même si les octets ne viennent pas : rien ne fige la scène pour toujours', async () => {
    const h = makeGateHarness();
    h.setDate(0);
    h.mechanics.update(1);

    // La demande revient SANS les octets : c'est ce que fait le service quand il a essayé et
    // échoué (cf. `hasCoverageFor`), et le bandeau du lot 15 nomme alors ce qui manque.
    h.setReady((ms) => ms <= 0);
    h.mechanics.jumpToDate(new Date(50 * DAY_MS));
    await h.deliver();
    await h.deliver();

    // Une demande de plus, au plus, puis le saut s'applique : la scène n'est pas prise en
    // otage par un lien mort.
    expect(h.asks.length).toBeLessThanOrEqual(3);
    expect(h.dateMs()).toBe(50 * DAY_MS);
    expect(h.mechanics.pendingJumpDate).toBeNull();
  });
});
