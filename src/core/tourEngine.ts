import type { LocalizedText } from '@/types';
import type { AstronomicalEventKind } from './astronomicalEvents';

/**
 * Une étape d'un tour scénarisé. Pur (aucun DOM, aucun Three.js) — orchestrée par un
 * `TourRuntimeHost` fourni par la couche UI (`src/ui/tourPlayer.ts`).
 *
 * Ce vocabulaire est FERMÉ, et c'est ce qui permet à une visite d'être une fiche JSON
 * (`src/registry/tours/`, lot 21) plutôt que du TypeScript : le schéma
 * `src/registry/schema/tour.ts` ne décrit rien d'autre que ces formes.
 */
import type { ScaleMode } from './ScaleService';

export type TourStep =
  | { kind: 'flyTo'; body: string }
  | { kind: 'jumpToDate'; date: Date }
  /**
   * La prochaine occurrence RÉELLE d'un événement, depuis la date courante de la scène. Le moteur
   * ne la calcule pas lui-même — il reste sans astronomie — c'est l'hôte qui résout. `body` n'a de
   * sens que pour une opposition ou une conjonction, où l'événement dépend d'une planète.
   */
  | { kind: 'jumpToEvent'; event: AstronomicalEventKind; body?: string }
  | { kind: 'setTimeScale'; scale: number }
  /**
   * Le MODE d'échelle, `'educ'` ou `'explo'`.
   *
   * Une visite pouvait tout changer sauf cela, alors que le permalien le porte depuis toujours
   * et que c'est le réglage qui décide de ce qu'on VOIT : la ceinture de Kuiper racontée en
   * Éduc est une file de points bien rangés, et la même en Explo est le vide qu'elle est
   * vraiment. Une visite qui parle de distances devait donc demander à l'utilisateur de changer
   * de mode lui-même, au milieu de son récit.
   */
  | { kind: 'setMode'; mode: ScaleMode }
  // Sans `durationMs` : la légende attend un geste utilisateur (host.waitForAdvance()).
  | { kind: 'caption'; text: LocalizedText; durationMs?: number }
  | { kind: 'wait'; ms: number };

export interface TourScript {
  id: string;
  /** Le titre affiché dans le sélecteur — un texte, pas une clé de dictionnaire. */
  title: LocalizedText;
  steps: TourStep[];
}

/** Adapte le moteur pur aux vrais systèmes (caméra, horloge, sélection partagée). */
export interface TourRuntimeHost {
  flyTo(body: string): void;
  isFlying(): boolean;
  jumpToDate(date: Date): void;
  /** Résout l'événement à cet instant, puis saute : cf. l'étape `jumpToEvent`. */
  jumpToEvent(event: AstronomicalEventKind, body?: string): void;
  setTimeScale(scale: number): void;
  setMode(mode: ScaleMode): void;
  /**
   * Vrai tant que les corps glissent d'une échelle à l'autre. Même patron que `isFlying` : le
   * moteur ne connaît AUCUNE durée, il attend un fait. Une légende enchaînée sans cette attente
   * s'afficherait sur une scène en plein morphing, c'est-à-dire sur aucune des deux échelles.
   */
  isMorphing(): boolean;
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
      case 'jumpToEvent':
        host.jumpToEvent(step.event, step.body);
        break;
      case 'setTimeScale':
        host.setTimeScale(step.scale);
        break;
      case 'setMode':
        host.setMode(step.mode);
        await waitUntil(() => !host.isMorphing(), signal);
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
