import './guidedTour.css';
import { onLocaleChange, t } from '@/i18n';

const STORAGE_KEY = 'ssv-guided-tour-v1';

interface TourStep {
  target: string;
  title: string;
  text: string;
}

const STEPS: Array<
  Pick<TourStep, 'target'> & { titleKey: string; textKey: string }
> = [
  {
    target: '.dock--top-left',
    titleKey: 'tour.step.navigation.title',
    textKey: 'tour.step.navigation.text',
  },
  {
    target: '#mode-controls',
    titleKey: 'tour.step.mode.title',
    textKey: 'tour.step.mode.text',
  },
  {
    target: '#time-panel',
    titleKey: 'tour.step.time.title',
    textKey: 'tour.step.time.text',
  },
  {
    target: '#time-readout',
    titleKey: 'tour.step.expand.title',
    textKey: 'tour.step.expand.text',
  },
  {
    target: '#info-trigger',
    titleKey: 'tour.step.info.title',
    textKey: 'tour.step.info.text',
  },
  {
    target: '#settings-trigger',
    titleKey: 'tour.step.settings.title',
    textKey: 'tour.step.settings.text',
  },
  {
    target: '#weather-trigger',
    titleKey: 'tour.step.weather.title',
    textKey: 'tour.step.weather.text',
  },
  {
    target: '#events-trigger',
    titleKey: 'tour.step.events.title',
    textKey: 'tour.step.events.text',
  },
  {
    target: '#quality-btn',
    titleKey: 'tour.step.quality.title',
    textKey: 'tour.step.quality.text',
  },
  {
    target: '#help-btn',
    titleKey: 'tour.step.help.title',
    textKey: 'tour.step.help.text',
  },
];

export interface GuidedTour {
  start(): void;
  startIfFirstVisit(): void;
  dispose(): void;
}

export function setupGuidedTour(): GuidedTour {
  const helpPopover = document.getElementById('help-popover');
  if (!helpPopover)
    return { start: () => {}, startIfFirstVisit: () => {}, dispose: () => {} };

  const startButton = document.createElement('button');
  startButton.type = 'button';
  startButton.className = 'tour-start';
  helpPopover.append(startButton);

  const backdrop = document.createElement('div');
  backdrop.className = 'tour-backdrop';
  backdrop.hidden = true;
  backdrop.setAttribute('aria-hidden', 'true');

  const highlight = document.createElement('div');
  highlight.className = 'tour-highlight';
  highlight.hidden = true;
  highlight.setAttribute('aria-hidden', 'true');

  const dialog = document.createElement('section');
  dialog.className = 'tour-dialog';
  dialog.hidden = true;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-live', 'polite');

  const progress = document.createElement('p');
  progress.className = 'tour-progress';
  const title = document.createElement('h2');
  title.className = 'tour-title';
  const text = document.createElement('p');
  text.className = 'tour-text';
  const actions = document.createElement('div');
  actions.className = 'tour-actions';
  const previous = document.createElement('button');
  previous.type = 'button';
  previous.className = 'tour-previous';
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'tour-next';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'tour-close';
  actions.append(previous, next, close);
  dialog.append(progress, title, text, actions);
  document.body.append(backdrop, highlight, dialog);

  let active = false;
  let stepIndex = 0;

  const localize = (): void => {
    startButton.textContent = t('tour.start');
    startButton.setAttribute('aria-label', t('tour.start'));
    previous.textContent = t('tour.previous');
    next.textContent = t('tour.next');
    close.textContent = t('tour.close');
    if (active) render();
  };

  const position = (target: HTMLElement): void => {
    const rect = target.getBoundingClientRect();
    const margin = 12;
    highlight.style.left = `${rect.left - margin}px`;
    highlight.style.top = `${rect.top - margin}px`;
    highlight.style.width = `${rect.width + margin * 2}px`;
    highlight.style.height = `${rect.height + margin * 2}px`;

    const dialogWidth = Math.min(320, window.innerWidth - 24);
    const left = Math.max(
      12,
      Math.min(rect.left, window.innerWidth - dialogWidth - 12)
    );
    const below = rect.bottom + 16;
    const top =
      below + 150 <= window.innerHeight ? below : Math.max(12, rect.top - 170);
    dialog.style.left = `${left}px`;
    dialog.style.top = `${top}px`;
    dialog.style.width = `${dialogWidth}px`;
  };

  const render = (): void => {
    const config = STEPS[stepIndex];
    if (!config) return;
    const target = document.querySelector<HTMLElement>(config.target);
    const step: TourStep = {
      target: config.target,
      title: t(config.titleKey),
      text: t(config.textKey),
    };
    dialog.dataset['step'] = String(stepIndex + 1);
    progress.textContent = t('tour.progress', {
      current: stepIndex + 1,
      total: STEPS.length,
    });
    title.textContent = step.title;
    text.textContent = step.text;
    previous.disabled = stepIndex === 0;
    next.textContent =
      stepIndex === STEPS.length - 1 ? t('tour.finish') : t('tour.next');

    // Some controls, such as the target info button, are intentionally hidden until
    // the user selects a body. Keep their explanatory step visible without leaving a
    // stale highlight on the previous target.
    const targetRect = target?.getBoundingClientRect();
    const targetVisible =
      !!target &&
      !target.hidden &&
      !!targetRect &&
      targetRect.width > 0 &&
      targetRect.height > 0;
    if (!target || !targetVisible) {
      highlight.hidden = true;
      const dialogWidth = Math.min(320, window.innerWidth - 24);
      dialog.style.left = `${Math.max(12, (window.innerWidth - dialogWidth) / 2)}px`;
      dialog.style.top = '50%';
      dialog.style.width = `${dialogWidth}px`;
      dialog.style.transform = 'translateY(-50%)';
      return;
    }
    highlight.hidden = false;
    dialog.style.transform = 'none';
    position(target);
  };

  const stop = (restoreFocus = true): void => {
    if (!active) return;
    active = false;
    backdrop.hidden = true;
    highlight.hidden = true;
    dialog.hidden = true;
    if (restoreFocus) startButton.focus();
  };

  const start = (): void => {
    active = true;
    stepIndex = 0;
    backdrop.hidden = false;
    highlight.hidden = false;
    dialog.hidden = false;
    render();
    next.focus();
  };

  const startIfFirstVisit = (): void => {
    try {
      if (localStorage.getItem(STORAGE_KEY)) return;
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // Le tour reste disponible via l'aide si le stockage est indisponible.
    }
    start();
  };
  startButton.addEventListener('click', start);
  next.addEventListener('click', () => {
    if (stepIndex >= STEPS.length - 1) stop();
    else {
      stepIndex++;
      render();
    }
  });
  previous.addEventListener('click', () => {
    if (stepIndex > 0) {
      stepIndex--;
      render();
    }
  });
  close.addEventListener('click', () => stop());
  backdrop.addEventListener('click', () => stop());
  document.addEventListener('keydown', (event) => {
    if (active && event.key === 'Escape') {
      event.preventDefault();
      stop();
    }
  });
  window.addEventListener('resize', () => {
    if (active) render();
  });
  onLocaleChange(localize);
  localize();

  return {
    start,
    startIfFirstVisit,
    dispose: () => {
      stop(false);
      startButton.remove();
      backdrop.remove();
      highlight.remove();
      dialog.remove();
    },
  };
}
