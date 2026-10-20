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
  /**
   * `from` : une fois arrivé, regarder la cible depuis ce corps (cf. `TourRuntimeHost.viewFrom`).
   * `side` : la regarder de profil par rapport à ce corps (`TourRuntimeHost.viewBeside`, lot 58).
   * Les deux s'excluent, et le schéma le refuse.
   */
  | { kind: 'flyTo'; body: string; from?: string; side?: string }
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
  /**
   * Plonger sur un lieu NOMMÉ du corps suivi (lot 63, pas A, rendu commandable). `frameKm` est la
   * taille que le cadrage doit embrasser : absent, celle qu'on connaît au nom (la Terre n'en a pas
   * et la visite doit donc la dire). Le moteur attend la fin du vol, puis que les carreaux
   * demandés par l'approche soient posés (cf. `TourRuntimeHost.isSurfaceBusy`).
   */
  | { kind: 'diveTo'; place: string; frameKm?: number }
  /**
   * Choisit le fond d'imagerie du sol (Sentinel-2, mosaïque…). Une visite emprunte ce réglage
   * comme elle emprunte le mode : l'hôte rend le fond de DÉPART à la fin.
   */
  | { kind: 'setSurface'; base: string }
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
  /**
   * Replace la caméra, sans l'animer, du côté de `body` en gardant la cible. Appelé seulement
   * APRÈS le vol : plus tôt, l'arrivée du vol écraserait la pose.
   */
  viewFrom(body: string): void;
  /** Même moment que `viewFrom`, mais de profil : la cible à angle droit de la direction de `body`. */
  viewBeside(body: string): void;
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
  /**
   * Lance la plongée sur ce lieu du corps suivi ; résout `true` une fois l'animation partie,
   * `false` si le lieu est introuvable ou si la caméra ne peut pas plonger (l'étape est alors
   * sautée, une visite ne reste jamais bloquée sur un nom).
   */
  diveTo(place: string, frameKm?: number): Promise<boolean>;
  /** Vrai tant que l'animation d'approche court. Même patron que `isFlying`. */
  isDiving(): boolean;
  /** La caméra a-t-elle atteint la distance de la dernière plongée (ses bornes suivent l'imagerie) ? */
  diveReached(): boolean;
  /** Vrai tant que des carreaux de surface sont en vol, en file ou en fondu (`data-surface-busy`). */
  isSurfaceBusy(): boolean;
  /** Choisit le fond d'imagerie ; `false` si le panneau ne le propose pas. */
  setSurface(base: string): boolean;
  /** Résout quand l'utilisateur avance manuellement une légende sans durée, ou ferme le tour. */
  waitForAdvance(): Promise<void>;
}

export interface TourSignal {
  cancelled: boolean;
  paused: boolean;
}

const POLL_MS = 50;

/**
 * Plafond de l'attente d'une surface calme. Une visite ne doit JAMAIS rester suspendue au réseau :
 * sans imagerie (hors ligne, service lent) la légende paraît quand même, et le bandeau de
 * provenance dit ce qui est réellement affiché.
 */
export const SURFACE_SETTLE_TIMEOUT_MS = 25_000;

/**
 * Délai laissé à la surface pour NOTICER un changement (date, fond, cible) avant qu'on lise son
 * compte de carreaux en vol : elle ne réévalue son jeu de carreaux qu'à l'image suivante, et un
 * compte lu avant vaut zéro sans que rien soit arrivé.
 */
export const SURFACE_NOTICE_MS = 500;

/**
 * Plongées successives pour atteindre le cadrage voulu. La caméra ne descend que jusqu'où
 * l'imagerie déjà servie le permet, et celle-ci ne s'affine qu'en approchant : chaque essai gagne
 * un niveau. Borné, pour qu'une imagerie qui n'arrive pas ne bloque pas la visite.
 */
export const DIVE_ATTEMPTS = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(
  predicate: () => boolean,
  signal: TourSignal,
  timeoutMs = Infinity
): Promise<void> {
  let waited = 0;
  while (!predicate() && !signal.cancelled && waited < timeoutMs) {
    await sleep(POLL_MS);
    if (!signal.paused) waited += POLL_MS;
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
  /** Vrai dès que la visite a touché à la surface : ses sauts de date en attendent alors l'imagerie. */
  let surfaceInUse = false;
  const settleSurface = async (): Promise<void> => {
    await delay(SURFACE_NOTICE_MS, signal);
    await waitUntil(
      () => !host.isSurfaceBusy(),
      signal,
      SURFACE_SETTLE_TIMEOUT_MS
    );
  };

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
        if (signal.cancelled) break;
        if (step.from !== undefined) host.viewFrom(step.from);
        else if (step.side !== undefined) host.viewBeside(step.side);
        break;
      case 'jumpToDate':
        host.jumpToDate(step.date);
        if (surfaceInUse) await settleSurface();
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
      case 'diveTo':
        surfaceInUse = true;
        for (let attempt = 0; attempt < DIVE_ATTEMPTS; attempt++) {
          if (
            signal.cancelled ||
            !(await host.diveTo(step.place, step.frameKm))
          )
            break;
          await waitUntil(() => !host.isDiving(), signal);
          await settleSurface();
          if (host.diveReached()) break;
        }
        break;
      case 'setSurface':
        surfaceInUse = true;
        if (host.setSurface(step.base)) await settleSurface();
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
