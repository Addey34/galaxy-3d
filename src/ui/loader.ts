/**
 * Loading and error screen.
 *
 * The visual percentage eases toward verified application progress. When the app is ready
 * early, the loader still completes the visible sequence before fading out.
 */
import Logger from '@/utils/Logger';
import { t } from '@/i18n';
import { getAnnouncer } from './announcer';

const loadPercent = document.getElementById('load-percent');
const progressFill = document.getElementById('load-progress-fill');
const loadStatus = document.getElementById('load-status')!;
const loadStep = document.getElementById('load-step');
const loader = document.getElementById('loader')!;
const progressBar = document.querySelector<HTMLElement>('.loader-bar');
const stageEls = [
  ...document.querySelectorAll<HTMLElement>('[data-loader-stage]'),
];

let verifiedPercent = 0;
let displayedPercent = 0;
let animationFrame = 0;
let hideRequested = false;
let hideScheduled = false;
let announcedStart = false;

const loaderStartedAt = performance.now();
const MIN_LOADER_MS = 1600;

const LOADING_STAGES = [
  { id: 'core', at: 0 },
  { id: 'data', at: 8 },
  { id: 'scene', at: 45 },
  { id: 'bodies', at: 65 },
  { id: 'orbit', at: 84 },
  { id: 'ready', at: 98 },
] as const;

function updateStageState(percent: number): void {
  let activeIndex = 0;
  for (let index = 0; index < LOADING_STAGES.length; index++) {
    if (percent >= LOADING_STAGES[index].at) activeIndex = index;
  }

  stageEls.forEach((el, index) => {
    el.classList.toggle('is-complete', index < activeIndex);
    el.classList.toggle('is-active', index === activeIndex);
  });

  if (loadStep) {
    const step = Math.min(LOADING_STAGES.length, Math.max(1, activeIndex + 1));
    loadStep.textContent = `${String(step).padStart(2, '0')} / ${String(
      LOADING_STAGES.length
    ).padStart(2, '0')}`;
  }
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return verifiedPercent;
  return Math.min(100, Math.max(0, value));
}

function renderProgress(value: number): void {
  const rounded = Math.floor(value);
  const width = `${value.toFixed(2)}%`;
  progressFill?.style.setProperty('width', width);
  // La valeur va sur la BARRE, désormais seule progression exposée : le rail d'étapes est
  // décoratif (`aria-hidden`), et la barre portait un `role="progressbar"` sans valeur.
  progressBar?.setAttribute('aria-valuenow', String(rounded));
  if (loadPercent) loadPercent.textContent = `${rounded}%`;
  updateStageState(value);
}

function finishLoaderWhenReady(): void {
  if (!hideRequested || hideScheduled || displayedPercent < 99.9) return;

  hideScheduled = true;
  loadStatus.textContent = t('loader.ready');
  const remaining = Math.max(
    0,
    MIN_LOADER_MS - (performance.now() - loaderStartedAt)
  );
  window.setTimeout(() => {
    window.requestAnimationFrame(() => {
      loader.style.opacity = '0';
      window.setTimeout(() => {
        loader.style.display = 'none';
        // LE MOMENT QUI MANQUAIT. La passe lecteur d'écran du lot 19 a écouté 2 500 ms juste
        // après la disparition du chargeur : RIEN n'était annoncé, au bout d'une dizaine de
        // secondes d'attente muette (défaut D6). L'annonce est faite ICI, une fois le chargeur
        // retiré, pour ne pas concurrencer ce qu'il affichait encore.
        getAnnouncer().announce(t('a11y.ready'));
      }, 500);
    });
  }, remaining);
}

function animateProgress(): void {
  const delta = verifiedPercent - displayedPercent;
  if (Math.abs(delta) < 0.08) {
    displayedPercent = verifiedPercent;
    renderProgress(displayedPercent);
    animationFrame = 0;
    finishLoaderWhenReady();
    return;
  }

  displayedPercent += delta * 0.12;
  renderProgress(displayedPercent);
  animationFrame = window.requestAnimationFrame(animateProgress);
}

/** Progress callback passed to `SolarSystemApp.init`. */
export function updateProgress(percent: number, message: string): void {
  if (hideRequested) return;
  // Une seule fois, au tout début : dire QUE ça charge. Les six étapes suivantes ne sont pas
  // annoncées, délibérément — une région live sur `#load-status` les énoncerait l'une après
  // l'autre et rendrait le reste inaudible, exactement le raisonnement déjà tenu dans
  // `ui/offlineData` pour les 64 pas d'un téléchargement.
  if (!announcedStart) {
    announcedStart = true;
    getAnnouncer().announce(t('a11y.loading'));
  }
  verifiedPercent = Math.max(verifiedPercent, clampPercent(percent));
  loadStatus.textContent = message;
  if (!animationFrame) {
    animationFrame = window.requestAnimationFrame(animateProgress);
  }
}

/** Complete the visible loading sequence, then fade the loader out. */
export function hideLoader(): void {
  hideRequested = true;
  verifiedPercent = 100;
  // La fermeture ne doit pas dependre d'un dernier tick RAF : les mobiles peuvent
  // suspendre ou ralentir cette boucle lorsque le contexte WebGL vient de demarrer.
  displayedPercent = 100;
  renderProgress(displayedPercent);
  loadStatus.textContent = t('loader.starting');
  animationFrame = 0;
  finishLoaderWhenReady();
}

/** Replace the loading screen with a reloadable error message. */
export function showError(error: Error): void {
  Logger.error('Application Error:', error);
  getAnnouncer().announce(t('a11y.loadFailed'));
  loader.replaceChildren();

  const content = document.createElement('div');
  content.className = 'loader-error';
  const title = document.createElement('h2');
  title.textContent = t('error.title');
  const message = document.createElement('p');
  message.textContent = error.message;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'loader-error-retry';
  retry.textContent = t('error.retry');
  retry.addEventListener('click', () => window.location.reload());
  content.append(title, message, retry);
  loader.append(content);
}
