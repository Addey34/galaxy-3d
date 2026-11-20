/**
 * Le BRANCHEMENT du repère de plongée (`ui/placeDive.ts`) sur le chemin PERSISTANT réel
 * (`diveUntilReached`), sans navigateur : caméra, scène et module du repère sont des doublures, le
 * chargement du module est une promesse que le test résout ou rejette lui-même, et le temps est
 * le temps simulé de vitest. Chaque scénario compte les relances EFFECTIVES (appels à
 * `applyViewAngles`, qui n'ont lieu que si la plongée est rejouée) : une garantie n'est démontrée
 * que si la relance a bien eu lieu.
 */
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Load {
  resolve: () => void;
  reject: () => void;
}
let loads: Load[] = [];
let shown = 0;
let markerInDom = false;
let keydown: ((event: { key: string }) => void) | null = null;

vi.mock('@/i18n', () => ({ t: (key: string) => key }));
vi.mock('@/i18n/bodyText', () => ({ bodyDisplayName: (n: string) => n }));
// Chaque tentative de pose attend `loadDeferredMessages()` en même temps que le module du repère :
// le test tient CETTE promesse (une par tentative, indépendante des autres), puisqu'un second
// `import()` du même module partage la requête du premier et ne se contrôle pas séparément.
vi.mock('@/i18n/deferredMessages', () => ({
  loadDeferredMessages: () =>
    new Promise<void>((resolve, reject) => {
      loads.push({
        resolve: () => resolve(),
        reject: () => reject(new Error('réseau coupé')),
      });
    }),
}));
vi.mock('./formationMarker', () => ({
  showFormationMarker: () => {
    shown += 1;
    markerInDom = true;
  },
}));
vi.mock('@/utils/reducedMotion', () => ({ prefersReducedMotion: () => true }));
vi.mock('./announcer', () => ({
  getAnnouncer: () => ({ announce: () => {} }),
}));

const place = {
  body: 'moon',
  name: 'Statio Tranquillitatis',
  lat: 0.67,
  lon: 23.47,
  diameterKm: 10,
};

async function build() {
  const { setupPlaceDive } = await import('./placeDive');
  let applied = 0;
  const target = {};
  const canvasHandlers = new Map<string, (() => void)[]>();
  const cameraSystem = {
    camera: { fov: 50, aspect: 1.6 },
    currentTarget: target as object | null,
    isFlying: false,
    renderer: {
      domElement: {
        dataset: {} as Record<string, string>,
        addEventListener: (type: string, fn: () => void) =>
          canvasHandlers.set(type, [...(canvasHandlers.get(type) ?? []), fn]),
      },
    },
    getViewAngles: () => ({ azimuthDeg: 0, polarDeg: 90, distance: 1e9 }),
    holdLevelView: () => {},
    applyViewAngles: () => {
      applied += 1;
    },
  };
  const object = {
    group: {
      userData: { radius: 1737 },
      getWorldPosition: (out: THREE.Vector3) => out.set(0, 0, 0),
    },
    surfacePointToWorld: () => new THREE.Vector3(1737, 0, 0),
  };
  const dive = setupPlaceDive(
    cameraSystem as never,
    { getBody: () => object } as never,
    () => 1737
  );
  return { dive, applied: () => applied, canvasHandlers };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 100; i += 1) await Promise.resolve();
};
const tick = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
  await flush();
};

beforeEach(() => {
  vi.useFakeTimers();
  loads = [];
  shown = 0;
  markerInDom = false;
  keydown = null;
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', {
    getElementById: () => (markerInDom ? {} : null),
    addEventListener: (type: string, fn: (e: { key: string }) => void) => {
      if (type === 'keydown') keydown = fn;
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('plongée persistante : le repère et ses abandons', () => {
  it('une relance pendant le chargement ne dédouble ni n’invalide la pose', async () => {
    const { dive, applied } = await build();
    dive.diveUntilReached(place);
    await flush();
    expect(loads).toHaveLength(1);
    const before = applied();
    await tick(2_100); // trois relances effectives, le module n'est pas arrivé
    expect(applied()).toBeGreaterThan(before + 2);
    expect(loads).toHaveLength(1); // aucune relance n'a rouvert un chargement
    loads[0]!.resolve();
    await flush();
    expect(shown).toBe(1);
  });

  it('Échap avant la réception du module : rien ne se pose, même après relance', async () => {
    const { dive, applied } = await build();
    dive.diveUntilReached(place);
    await flush();
    keydown?.({ key: 'Escape' });
    const before = applied();
    await tick(1_500);
    expect(applied()).toBeGreaterThan(before); // la plongée a bien été rejouée
    loads[0]!.resolve();
    await flush();
    expect(shown).toBe(0);
    expect(loads).toHaveLength(1);
  });

  it('Échap après la pose : la relance effective ne recrée pas le repère', async () => {
    const { dive, applied } = await build();
    dive.diveUntilReached(place);
    await flush();
    loads[0]!.resolve();
    await flush();
    expect(shown).toBe(1);
    keydown?.({ key: 'Escape' });
    markerInDom = false; // le repère se retire de lui-même sur Échap
    const before = applied();
    await tick(2_100);
    expect(applied()).toBeGreaterThan(before + 2);
    expect(shown).toBe(1);
    expect(loads).toHaveLength(1);
  });

  it('échec de chargement, Échap, relance effective, réseau rétabli : aucun repère', async () => {
    const { dive, applied } = await build();
    dive.diveUntilReached(place);
    await flush();
    loads[0]!.reject();
    await flush();
    keydown?.({ key: 'Escape' });
    const before = applied();
    await tick(2_100);
    expect(applied()).toBeGreaterThan(before + 2); // relances effectives
    expect(loads).toHaveLength(1); // aucune nouvelle tentative de chargement
    expect(shown).toBe(0);
  });

  it('un échec SANS abandon est retenté par la relance (le comportement voulu)', async () => {
    const { dive } = await build();
    dive.diveUntilReached(place);
    await flush();
    loads[0]!.reject();
    await flush();
    await tick(800);
    expect(loads).toHaveLength(2);
    loads[1]!.resolve();
    await flush();
    expect(shown).toBe(1);
  });

  it('une nouvelle demande explicite vers le même lieu, après Échap, repose le repère', async () => {
    const { dive } = await build();
    dive.diveUntilReached(place);
    await flush();
    loads[0]!.resolve();
    await flush();
    keydown?.({ key: 'Escape' });
    markerInDom = false;
    dive.diveUntilReached(place);
    await flush();
    expect(loads).toHaveLength(2);
    loads[1]!.resolve();
    await flush();
    expect(shown).toBe(2);
  });

  it('deux demandes effectives vers le même lieu : seule la dernière pose', async () => {
    const { dive } = await build();
    dive.dive(place);
    await flush();
    dive.dive(place);
    await flush();
    expect(loads).toHaveLength(2); // les deux demandes ont bien été émises
    loads[0]!.resolve();
    await flush();
    expect(shown).toBe(0); // l'ancienne est caduque
    loads[1]!.resolve();
    await flush();
    expect(shown).toBe(1);
  });

  it('le rejet de l’ANCIENNE demande ne réinitialise pas la plus récente', async () => {
    const { dive } = await build();
    dive.diveUntilReached(place);
    await flush();
    dive.diveUntilReached(place);
    await flush();
    expect(loads).toHaveLength(2);
    loads[0]!.reject();
    await flush();
    await tick(1_500); // la récente est en cours : une relance n'ouvre rien
    expect(loads).toHaveLength(2);
    loads[1]!.resolve();
    await flush();
    expect(shown).toBe(1);
  });

  it('un geste de la caméra abandonne comme Échap', async () => {
    const { dive, canvasHandlers } = await build();
    dive.diveUntilReached(place);
    await flush();
    canvasHandlers.get('pointerdown')?.forEach((fn) => fn());
    loads[0]!.resolve();
    await flush();
    expect(shown).toBe(0);
  });
});
