import { describe, expect, it, vi } from 'vitest';
import {
  DATE_SETTLE_TIMEOUT_MS,
  DIVE_ATTEMPTS,
  SURFACE_SETTLE_TIMEOUT_MS,
  runTour,
  type TourRuntimeHost,
  type TourScript,
  type TourSignal,
} from './tourEngine';

function makeHost(overrides: Partial<TourRuntimeHost> = {}): TourRuntimeHost {
  return {
    flyTo: vi.fn(),
    isFlying: vi.fn(() => false),
    viewFrom: vi.fn(),
    viewBeside: vi.fn(),
    jumpToDate: vi.fn(),
    jumpToEvent: vi.fn(),
    setTimeScale: vi.fn(),
    setMode: vi.fn(),
    isMorphing: vi.fn(() => false),
    diveTo: vi.fn(() => Promise.resolve(true)),
    isDiving: vi.fn(() => false),
    diveReached: vi.fn(() => true),
    isSurfaceBusy: vi.fn(() => false),
    isDatePending: vi.fn(() => false),
    setSurface: vi.fn(() => true),
    waitForAdvance: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

function makeSignal(): TourSignal {
  return { cancelled: false, paused: false };
}

const text = {
  en: 'Caption',
  fr: 'Légende',
  es: 'Leyenda',
  'pt-BR': 'Legenda',
};

describe('runTour', () => {
  it('runs every step in order and reports progress via onStepChange', async () => {
    vi.useFakeTimers();
    const host = makeHost();
    const script: TourScript = {
      id: 'demo',
      title: text,
      steps: [
        { kind: 'flyTo', body: 'earth' },
        { kind: 'jumpToDate', date: new Date('2030-01-01T00:00:00Z') },
        { kind: 'setTimeScale', scale: 1000 },
      ],
    };
    const seen: number[] = [];
    const promise = runTour(script, host, (i) => seen.push(i), makeSignal());
    await vi.runAllTimersAsync();
    await promise;

    expect(seen).toEqual([0, 1, 2]);
    expect(host.flyTo).toHaveBeenCalledWith('earth');
    expect(host.jumpToDate).toHaveBeenCalledWith(
      new Date('2030-01-01T00:00:00Z')
    );
    expect(host.setTimeScale).toHaveBeenCalledWith(1000);
    vi.useRealTimers();
  });

  /**
   * L'étape qui a fait disparaître l'exception `id === 'eclipse'` de `ui/tourPlayer.ts` (lot 21).
   * Le moteur ne résout AUCUNE date : il passe la forme et le corps à l'hôte, qui sait.
   */
  it('hands a jumpToEvent step to the host, with its body when it has one', async () => {
    vi.useFakeTimers();
    const host = makeHost();
    const script: TourScript = {
      id: 'demo',
      title: text,
      steps: [
        { kind: 'jumpToEvent', event: 'solar-eclipse' },
        { kind: 'jumpToEvent', event: 'opposition', body: 'mars' },
      ],
    };
    const promise = runTour(script, host, () => {}, makeSignal());
    await vi.runAllTimersAsync();
    await promise;

    expect(host.jumpToEvent).toHaveBeenNthCalledWith(1, 'solar-eclipse', undefined); // prettier-ignore
    expect(host.jumpToEvent).toHaveBeenNthCalledWith(2, 'opposition', 'mars');
    expect(host.jumpToDate).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('waits for isFlying() to become false before advancing past a flyTo step', async () => {
    vi.useFakeTimers();
    let flying = true;
    const host = makeHost({ isFlying: () => flying });
    const script: TourScript = {
      id: 'demo',
      title: text,
      steps: [
        { kind: 'flyTo', body: 'moon' },
        { kind: 'setTimeScale', scale: 1 },
      ],
    };
    const seen: number[] = [];
    const promise = runTour(script, host, (i) => seen.push(i), makeSignal());

    await vi.advanceTimersByTimeAsync(200);
    expect(seen).toEqual([0]); // toujours bloqué sur le vol

    flying = false;
    await vi.advanceTimersByTimeAsync(200);
    await promise;
    expect(seen).toEqual([0, 1]);
    vi.useRealTimers();
  });

  it('ne pose la vue `from` qu’APRÈS le vol, sinon l’arrivée l’écraserait', async () => {
    vi.useFakeTimers();
    let flying = true;
    const host = makeHost({ isFlying: () => flying });
    const script: TourScript = {
      id: 'demo',
      title: text,
      steps: [{ kind: 'flyTo', body: 'earth', from: 'moon' }],
    };
    const promise = runTour(script, host, () => {}, makeSignal());

    await vi.advanceTimersByTimeAsync(200);
    expect(host.flyTo).toHaveBeenCalledWith('earth');
    expect(host.viewFrom).not.toHaveBeenCalled();

    flying = false;
    await vi.advanceTimersByTimeAsync(200);
    await promise;
    expect(host.viewFrom).toHaveBeenCalledWith('moon');
    vi.useRealTimers();
  });

  it('pose le profil `side` APRÈS le vol, et lui seul', async () => {
    vi.useFakeTimers();
    let flying = true;
    const host = makeHost({ isFlying: () => flying });
    const promise = runTour(
      {
        id: 'demo',
        title: text,
        steps: [{ kind: 'flyTo', body: 'earth', side: 'sun' }],
      },
      host,
      () => {},
      makeSignal()
    );
    await vi.advanceTimersByTimeAsync(200);
    expect(host.viewBeside).not.toHaveBeenCalled();
    flying = false;
    await vi.advanceTimersByTimeAsync(200);
    await promise;
    expect(host.viewBeside).toHaveBeenCalledWith('sun');
    expect(host.viewFrom).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('un flyTo sans `from` garde la vue du vol', async () => {
    const host = makeHost();
    await runTour(
      { id: 'demo', title: text, steps: [{ kind: 'flyTo', body: 'earth' }] },
      host,
      () => {},
      makeSignal()
    );
    expect(host.viewFrom).not.toHaveBeenCalled();
    expect(host.viewBeside).not.toHaveBeenCalled();
  });

  it('stops advancing once cancelled', async () => {
    vi.useFakeTimers();
    const host = makeHost({ isFlying: () => true });
    const script: TourScript = {
      id: 'demo',
      title: text,
      steps: [
        { kind: 'flyTo', body: 'jupiter' },
        { kind: 'setTimeScale', scale: 1 },
      ],
    };
    const signal = makeSignal();
    const seen: number[] = [];
    const promise = runTour(script, host, (i) => seen.push(i), signal);

    await vi.advanceTimersByTimeAsync(200);
    signal.cancelled = true;
    await vi.runAllTimersAsync();
    await promise;

    expect(seen).toEqual([0]);
    expect(host.setTimeScale).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('suspends progress while paused without cancelling an in-flight arrival wait', async () => {
    vi.useFakeTimers();
    let flying = true;
    const host = makeHost({ isFlying: () => flying });
    const script: TourScript = {
      id: 'demo',
      title: text,
      steps: [
        { kind: 'flyTo', body: 'saturn' },
        { kind: 'setTimeScale', scale: 1 },
      ],
    };
    const signal = makeSignal();
    signal.paused = true;
    const seen: number[] = [];
    const promise = runTour(script, host, (i) => seen.push(i), signal);

    // En pause avant même la première étape : rien ne démarre.
    await vi.advanceTimersByTimeAsync(200);
    expect(seen).toEqual([]);

    signal.paused = false;
    await vi.advanceTimersByTimeAsync(50);
    expect(seen).toEqual([0]);

    flying = false;
    await vi.advanceTimersByTimeAsync(200);
    await promise;
    expect(seen).toEqual([0, 1]);
    vi.useRealTimers();
  });

  it('waits on host.waitForAdvance() for a caption without durationMs', async () => {
    let resolveAdvance: () => void = () => {};
    const advance = new Promise<void>((resolve) => {
      resolveAdvance = resolve;
    });
    const host = makeHost({ waitForAdvance: () => advance });
    const script: TourScript = {
      id: 'demo',
      title: text,
      steps: [{ kind: 'caption', text }],
    };
    let done = false;
    const promise = runTour(script, host, () => {}, makeSignal()).then(() => {
      done = true;
    });

    await Promise.resolve();
    expect(done).toBe(false);
    resolveAdvance();
    await promise;
    expect(done).toBe(true);
  });

  it('auto-advances a timed caption after durationMs', async () => {
    vi.useFakeTimers();
    const host = makeHost();
    const script: TourScript = {
      id: 'demo',
      title: text,
      steps: [
        { kind: 'caption', text, durationMs: 500 },
        { kind: 'setTimeScale', scale: 42 },
      ],
    };
    const promise = runTour(script, host, () => {}, makeSignal());
    await vi.advanceTimersByTimeAsync(500);
    await promise;
    expect(host.setTimeScale).toHaveBeenCalledWith(42);
    vi.useRealTimers();
  });
});

/**
 * LE MODE D'ÉCHELLE EST DEVENU UNE ÉTAPE (lot 35, ligne 22.8 d).
 *
 * Le patron est celui de `flyTo`, délibérément : l'hôte agit, puis le moteur ATTEND un fait.
 * Aucune durée n'est recopiée ici — `MORPH_DURATION_S` vit dans `OrbitalMechanics` et pourrait
 * changer demain, ce qui rendrait une attente fixe silencieusement trop courte : la légende
 * suivante s'afficherait alors sur une scène à mi-chemin, c'est-à-dire sur aucune des deux
 * échelles.
 */
describe('setMode', () => {
  it('bascule, puis attend la FIN du morph avant l’étape suivante', async () => {
    let morphing = true;
    const setMode = vi.fn(() => {
      morphing = true;
    });
    const caption = vi.fn();
    const host = makeHost({
      setMode,
      isMorphing: () => morphing,
      waitForAdvance: vi.fn(() => {
        caption();
        return Promise.resolve();
      }),
    });
    const script: TourScript = {
      id: 't',
      title: text,
      steps: [
        { kind: 'setMode', mode: 'explo' },
        { kind: 'caption', text },
      ],
    };
    const signal = makeSignal();
    const run = runTour(script, host, () => {}, signal);

    // Tant que la scène morphe, la légende n'est PAS encore demandée.
    await new Promise((r) => setTimeout(r, 120));
    expect(setMode).toHaveBeenCalledWith('explo');
    expect(caption, 'légende affichée pendant le morph').not.toHaveBeenCalled();

    morphing = false;
    await run;
    expect(caption).toHaveBeenCalledTimes(1);
  });

  it('s’interrompt si la visite est fermée pendant le morph', async () => {
    // Sans cela, fermer une visite pendant la transition laisserait le moteur tourner.
    const host = makeHost({ isMorphing: () => true });
    const script: TourScript = {
      id: 't',
      title: text,
      steps: [
        { kind: 'setMode', mode: 'explo' },
        { kind: 'caption', text },
      ],
    };
    const signal = makeSignal();
    const run = runTour(script, host, () => {}, signal);
    await new Promise((r) => setTimeout(r, 80));
    signal.cancelled = true;
    await expect(run).resolves.toBeUndefined();
    expect(host.waitForAdvance).not.toHaveBeenCalled();
  });
});

describe('runTour : la surface (diveTo, setSurface)', () => {
  const caption = { kind: 'caption', text, durationMs: 1 } as const;

  it('attend la fin de la plongée PUIS la surface calme avant la légende', async () => {
    vi.useFakeTimers();
    let diving = true;
    let busy = true;
    const order: string[] = [];
    const host = makeHost({
      diveTo: vi.fn(() => {
        order.push('dive');
        return Promise.resolve(true);
      }),
      isDiving: () => diving,
      isSurfaceBusy: () => busy,
    });
    const script: TourScript = {
      id: 't',
      title: text,
      steps: [{ kind: 'diveTo', place: 'Nile Delta', frameKm: 150 }, caption],
    };
    const run = runTour(
      script,
      host,
      (_, step) => order.push(step.kind),
      makeSignal()
    );
    await vi.advanceTimersByTimeAsync(2000);
    expect(order, 'la légende attend la plongée').toEqual(['diveTo', 'dive']);
    diving = false;
    await vi.advanceTimersByTimeAsync(2000);
    expect(order, 'la légende attend les carreaux').toEqual(['diveTo', 'dive']);
    busy = false;
    await vi.advanceTimersByTimeAsync(2000);
    await run;
    expect(order).toEqual(['diveTo', 'dive', 'caption']);
    expect(host.diveTo).toHaveBeenCalledWith('Nile Delta', 150);
    vi.useRealTimers();
  });

  it('ne reste JAMAIS suspendue au réseau : la surface occupée est bornée dans le temps', async () => {
    vi.useFakeTimers();
    const host = makeHost({ isSurfaceBusy: () => true });
    const script: TourScript = {
      id: 't',
      title: text,
      steps: [{ kind: 'diveTo', place: 'Nile Delta' }, caption],
    };
    let reached = false;
    const run = runTour(
      script,
      host,
      (_, step) => {
        if (step.kind === 'caption') reached = true;
      },
      makeSignal()
    );
    await vi.advanceTimersByTimeAsync(SURFACE_SETTLE_TIMEOUT_MS / 2);
    expect(reached).toBe(false);
    await vi.advanceTimersByTimeAsync(SURFACE_SETTLE_TIMEOUT_MS);
    await run;
    expect(reached).toBe(true);
    vi.useRealTimers();
  });

  it('saute une plongée refusée au lieu de s’y bloquer', async () => {
    vi.useFakeTimers();
    const host = makeHost({
      diveTo: vi.fn(() => Promise.resolve(false)),
      isDiving: () => true,
      isSurfaceBusy: () => true,
    });
    const script: TourScript = {
      id: 't',
      title: text,
      steps: [{ kind: 'diveTo', place: 'Nulle part' }, caption],
    };
    const run = runTour(script, host, () => {}, makeSignal());
    await vi.advanceTimersByTimeAsync(500);
    await run;
    vi.useRealTimers();
  });

  it('un saut de date n’attend la surface QUE si la visite y a touché', async () => {
    vi.useFakeTimers();
    const busy = vi.fn(() => true);
    const jump = {
      kind: 'jumpToDate',
      date: new Date('2025-07-01T10:00:00Z'),
    } as const;
    const without = makeHost({ isSurfaceBusy: busy });
    await runTour(
      { id: 't', title: text, steps: [jump] },
      without,
      () => {},
      makeSignal()
    );
    expect(
      busy,
      'les autres visites ne ralentissent pas'
    ).not.toHaveBeenCalled();

    const withSurface = makeHost({ isSurfaceBusy: () => false });
    const run = runTour(
      {
        id: 't',
        title: text,
        steps: [{ kind: 'setSurface', base: 'sentinel-2' }, jump],
      },
      withSurface,
      () => {},
      makeSignal()
    );
    await vi.advanceTimersByTimeAsync(3000);
    await run;
    expect(withSurface.setSurface).toHaveBeenCalledWith('sentinel-2');
    vi.useRealTimers();
  });
});

describe('runTour : un saut de date attend d’être appliqué', () => {
  const jump = {
    kind: 'jumpToDate',
    date: new Date('2016-07-01T10:00:00Z'),
  } as const;
  const dive = { kind: 'diveTo', place: 'Nile Delta' } as const;

  it('ne plonge pas tant que la date demandée attend ses octets', async () => {
    vi.useFakeTimers();
    let pending = true;
    const order: string[] = [];
    const host = makeHost({
      isDatePending: () => pending,
      diveTo: vi.fn(() => {
        order.push(pending ? 'plonge AVANT la date' : 'plonge après la date');
        return Promise.resolve(true);
      }),
    });
    const run = runTour(
      { id: 't', title: text, steps: [jump, dive] },
      host,
      () => {},
      makeSignal()
    );
    await vi.advanceTimersByTimeAsync(2000);
    expect(host.diveTo, 'la plongée attend la date').not.toHaveBeenCalled();
    pending = false;
    await vi.advanceTimersByTimeAsync(2000);
    await run;
    expect(order).toEqual(['plonge après la date']);
    vi.useRealTimers();
  });

  it('se débloque sans réseau, après son plafond', async () => {
    vi.useFakeTimers();
    const host = makeHost({ isDatePending: () => true });
    const run = runTour(
      { id: 't', title: text, steps: [jump, dive] },
      host,
      () => {},
      makeSignal()
    );
    await vi.advanceTimersByTimeAsync(DATE_SETTLE_TIMEOUT_MS + 2000);
    await run;
    expect(host.diveTo).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('runTour : la plongée est rejouée jusqu’à son cadrage', () => {
  const text4 = { en: 'c', fr: 'c', es: 'c', 'pt-BR': 'c' };
  const script: TourScript = {
    id: 't',
    title: text4,
    steps: [{ kind: 'diveTo', place: 'Cairo', frameKm: 40 }],
  };

  it('plonge de nouveau tant que la caméra n’est pas arrivée, puis s’arrête', async () => {
    vi.useFakeTimers();
    let arrivals = 0;
    const host = makeHost({
      // Les bornes d'approche suivent l'imagerie servie : la caméra n'arrive qu'au 3e essai.
      diveReached: () => ++arrivals >= 3,
    });
    const run = runTour(script, host, () => {}, makeSignal());
    await vi.advanceTimersByTimeAsync(10_000);
    await run;
    expect(host.diveTo).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('s’arrête après un nombre borné d’essais si l’imagerie n’arrive jamais', async () => {
    vi.useFakeTimers();
    const host = makeHost({ diveReached: () => false });
    const run = runTour(script, host, () => {}, makeSignal());
    await vi.advanceTimersByTimeAsync(60_000);
    await run;
    expect(host.diveTo).toHaveBeenCalledTimes(DIVE_ATTEMPTS);
    vi.useRealTimers();
  });
});
