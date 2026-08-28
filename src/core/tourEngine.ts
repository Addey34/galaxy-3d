import type { LocalizedText } from '@/types';

/**
 * Une étape d'un tour scénarisé. Pur (aucun DOM, aucun Three.js) — orchestrée par un
 * `TourRuntimeHost` fourni par la couche UI (`src/ui/tourPlayer.ts`).
 */
export type TourStep =
  | { kind: 'flyTo'; body: string }
  | { kind: 'jumpToDate'; date: Date }
  | { kind: 'setTimeScale'; scale: number }
  // Sans `durationMs` : la légende attend un geste utilisateur (host.waitForAdvance()).
  | { kind: 'caption'; text: LocalizedText; durationMs?: number }
  | { kind: 'wait'; ms: number };

export interface TourScript {
  id: string;
  titleKey: LocalizedText;
  steps: TourStep[];
}

/** Adapte le moteur pur aux vrais systèmes (caméra, horloge, sélection partagée). */
export interface TourRuntimeHost {
  flyTo(body: string): void;
  isFlying(): boolean;
  jumpToDate(date: Date): void;
  setTimeScale(scale: number): void;
  /** Résout quand l'utilisateur avance manuellement une légende sans durée, ou ferme le tour. */
  waitForAdvance(): Promise<void>;
}

export interface TourSignal {
  cancelled: boolean;
  paused: boolean;
}

const POLL_MS = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(
  predicate: () => boolean,
  signal: TourSignal
): Promise<void> {
  while (!predicate() && !signal.cancelled) {
    await sleep(POLL_MS);
  }
}

/** Délai interruptible par annulation, et suspendu (pas annulé) pendant une pause. */
async function delay(ms: number, signal: TourSignal): Promise<void> {
  let elapsed = 0;
  while (elapsed < ms && !signal.cancelled) {
    await sleep(POLL_MS);
    if (!signal.paused) elapsed += POLL_MS;
  }
}

/**
 * Exécute un script de tour étape par étape. `onStepChange` est appelé au début de chaque étape
 * (pour que la couche UI affiche la légende/progression). Coopératif : `signal.cancelled` arrête
 * la séquence à la prochaine étape ou à la prochaine boucle d'attente ; `signal.paused` suspend
 * l'avancement (n'annule jamais un vol caméra déjà lancé).
 */
export async function runTour(
  script: TourScript,
  host: TourRuntimeHost,
  onStepChange: (index: number, step: TourStep) => void,
  signal: TourSignal
): Promise<void> {
  for (let i = 0; i < script.steps.length; i++) {
    if (signal.cancelled) return;
    while (signal.paused && !signal.cancelled) {
      await sleep(POLL_MS);
    }
    if (signal.cancelled) return;

    const step = script.steps[i];
    onStepChange(i, step);

    switch (step.kind) {
      case 'flyTo':
        host.flyTo(step.body);
        await waitUntil(() => !host.isFlying(), signal);
        break;
      case 'jumpToDate':
        host.jumpToDate(step.date);
        break;
      case 'setTimeScale':
        host.setTimeScale(step.scale);
        break;
      case 'wait':
        await delay(step.ms, signal);
        break;
      case 'caption':
        if (step.durationMs != null) {
          await delay(step.durationMs, signal);
        } else {
          await host.waitForAdvance();
        }
        break;
    }
  }
}
