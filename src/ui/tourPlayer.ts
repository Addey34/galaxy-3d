/**
 * Tours guidés scénarisés — séquences caméra + temps + narration (« Naissance d'une éclipse »,
 * « La danse des Galiléennes », « Voyage aux confins »). Distinct du tour d'accueil
 * (`ui/guidedTour.ts`, tooltips DOM statiques sans caméra ni temps) : ce module pilote de
 * vraies étapes async via `core/tourEngine.ts`.
 *
 * Auto-attaché dans `#help-popover` comme `guidedTour.ts`, mais relançable en permanence
 * (pas de gate première-visite) et jamais un remplacement de la palette de sélection : tout vol
 * caméra passe par `PlanetNavigation.selectBody`, jamais par `CameraSystem` en direct, pour que
 * fiche d'info et permalien restent cohérents.
 */
import './tourPlayer.css';
import { onLocaleChange, t, getLocale } from '@/i18n';
import { bodyDisplayName } from '@/i18n/bodyText';
import type { CameraSystem } from '@/components/systems/CameraSystem';
import type { OrbitalMechanics } from '@/core/OrbitalMechanics';
import type { PlanetNavigation } from './planetNav';
import {
  runTour,
  type TourRuntimeHost,
  type TourScript,
  type TourSignal,
  type TourStep,
} from '@/core/tourEngine';
import { resolveEclipseDate } from '@/config/tourScripts';

export interface TourPlayer {
  dispose(): void;
}

/** Permalien : seules les méthodes réellement utilisées ici, pour un couplage minimal. */
export interface TourPlayerPermalink {
  setSuspended(suspended: boolean): void;
  sync(): void;
}

function localizedText(text: { en: string; fr: string }): string {
  return text[getLocale()] ?? text.en;
}

export function setupTourPlayer(
  camera: CameraSystem,
  om: OrbitalMechanics,
  navigation: PlanetNavigation,
  scripts: TourScript[],
  permalink: TourPlayerPermalink
): TourPlayer {
  const helpPopover = document.getElementById('help-popover');
  if (!helpPopover) return { dispose: () => {} };

  const startButton = document.createElement('button');
  startButton.type = 'button';
  startButton.className = 'stour-start';
  helpPopover.append(startButton);

  const picker = document.createElement('div');
  picker.className = 'stour-picker';
  picker.hidden = true;
  const pickerButtons = scripts.map((script) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'stour-picker-item';
    picker.append(btn);
    return { script, btn };
  });
  helpPopover.append(picker);

  const backdrop = document.createElement('div');
  backdrop.className = 'stour-backdrop';
  backdrop.hidden = true;
  backdrop.setAttribute('aria-hidden', 'true');

  const card = document.createElement('section');
  card.className = 'stour-card';
  card.hidden = true;
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-live', 'polite');

  const progress = document.createElement('p');
  progress.className = 'stour-progress';
  const caption = document.createElement('p');
  caption.className = 'stour-caption';
  const actions = document.createElement('div');
  actions.className = 'stour-actions';
  const pauseButton = document.createElement('button');
  pauseButton.type = 'button';
  pauseButton.className = 'stour-pause';
  const nextButton = document.createElement('button');
  nextButton.type = 'button';
  nextButton.className = 'stour-next';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'stour-close';
  actions.append(pauseButton, nextButton, closeButton);
  card.append(progress, caption, actions);
  document.body.append(backdrop, card);

  let active = false;
  let signal: TourSignal = { cancelled: false, paused: false };
  let speedChanged = false;
  let advanceResolve: (() => void) | null = null;
  let currentScript: TourScript | null = null;

  const waitForAdvance = (): Promise<void> =>
    new Promise((resolve) => {
      advanceResolve = resolve;
    });
  const triggerAdvance = (): void => {
    advanceResolve?.();
    advanceResolve = null;
  };

  const localize = (): void => {
    startButton.textContent = t('tours.start');
    startButton.setAttribute('aria-label', t('tours.start'));
    pauseButton.textContent = t(signal.paused ? 'tours.resume' : 'tours.pause');
    nextButton.textContent = t('tours.next');
    closeButton.textContent = t('tours.close');
    for (const { script, btn } of pickerButtons) {
      btn.textContent = localizedText(script.titleKey);
    }
    if (active && currentScript && currentStep) render(stepIndex, currentStep);
  };

  let stepIndex = 0;
  let currentStep: TourStep | null = null;
  let lastCaptionText = '';

  const render = (index: number, step: TourStep): void => {
    if (!currentScript) return;
    progress.textContent = t('tours.progress', {
      current: index + 1,
      total: currentScript.steps.length,
    });
    switch (step.kind) {
      case 'caption':
        lastCaptionText = localizedText(step.text);
        caption.textContent = lastCaptionText;
        nextButton.disabled = step.durationMs != null;
        break;
      case 'flyTo':
        caption.textContent = t('tours.status.flyingTo', {
          body: bodyDisplayName(step.body),
        });
        nextButton.disabled = true;
        break;
      case 'jumpToDate':
        caption.textContent = t('tours.status.jumping');
        nextButton.disabled = true;
        break;
      case 'setTimeScale':
        caption.textContent = t('tours.status.speeding');
        nextButton.disabled = true;
        break;
      case 'wait':
        caption.textContent = lastCaptionText;
        nextButton.disabled = true;
        break;
    }
  };

  const showOverlay = (): void => {
    backdrop.hidden = false;
    card.hidden = false;
    pauseButton.focus();
  };
  const hideOverlay = (): void => {
    backdrop.hidden = true;
    card.hidden = true;
    startButton.focus();
  };
  const closePicker = (): void => {
    picker.hidden = true;
  };

  const finish = (): void => {
    active = false;
    hideOverlay();
    if (speedChanged) om.setSimulationSpeed(1);
    navigation.selectBody('overview');
    permalink.setSuspended(false);
    permalink.sync();
  };

  const start = (id: string): void => {
    const script = scripts.find((s) => s.id === id);
    if (!script) return;
    closePicker();

    const steps =
      id === 'eclipse'
        ? [
            { kind: 'jumpToDate', date: resolveEclipseDate(om.simulationDate) } as TourStep,
            ...script.steps,
          ]
        : script.steps;
    currentScript = { ...script, steps };
    signal = { cancelled: false, paused: false };
    speedChanged = false;
    active = true;
    stepIndex = 0;
    currentStep = null;
    lastCaptionText = '';
    permalink.setSuspended(true);
    showOverlay();
    localize();

    const host: TourRuntimeHost = {
      flyTo: (body) => navigation.selectBody(body),
      isFlying: () => camera.isFlying,
      jumpToDate: (date) => om.jumpToDate(date),
      setTimeScale: (scale) => {
        speedChanged = true;
        om.setSimulationSpeed(scale);
      },
      waitForAdvance,
    };

    void runTour(
      currentScript,
      host,
      (index, step) => {
        stepIndex = index;
        currentStep = step;
        render(index, step);
      },
      signal
    ).then(finish);
  };

  const close = (): void => {
    if (!active) return;
    signal.cancelled = true;
    triggerAdvance();
  };

  startButton.addEventListener('click', () => {
    picker.hidden = !picker.hidden;
  });
  for (const { script, btn } of pickerButtons) {
    btn.addEventListener('click', () => start(script.id));
  }
  pauseButton.addEventListener('click', () => {
    if (!active) return;
    signal.paused = !signal.paused;
    pauseButton.textContent = t(signal.paused ? 'tours.resume' : 'tours.pause');
  });
  nextButton.addEventListener('click', () => triggerAdvance());
  closeButton.addEventListener('click', close);
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', (event) => {
    if (!active) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === ' ') {
      event.preventDefault();
      pauseButton.click();
    } else if (event.key === 'ArrowRight' && !nextButton.disabled) {
      triggerAdvance();
    }
  });
  onLocaleChange(localize);
  localize();

  return {
    dispose: () => {
      close();
      startButton.remove();
      picker.remove();
      backdrop.remove();
      card.remove();
    },
  };
}
