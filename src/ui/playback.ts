/**
 * Contrôles de lecture : play/pause et vitesse de simulation (#play-pause-btn, #speed-range).
 *
 * Toujours en mode Kepler/temps-réel :
 *   om.setSimulationSpeed(scale) → scale = ratio vs temps réel
 *   1 = temps réel, 3 600 = 1h/s, 10 800 = 3h/s, 21 600 = 6h/s
 */
import type { AnimationSystem } from '@/components/systems/AnimationSystem';
import type { OrbitalMechanics } from '@/core/OrbitalMechanics';
import { getLocale, onLocaleChange, t } from '@/i18n';

// Réel = 1:1, 1h/s = 3600, 3h/s = 10 800, 6h/s = 21 600
export const MAX_SIMULATION_SCALE = 31_557_600;

const SPEED_SLIDER_MAX = 100;
const SPEED_UNITS = [
  { scale: 31_557_600, fr: 'an', en: 'y' },
  { scale: 2_592_000, fr: 'mois', en: 'mo' },
  { scale: 604_800, fr: 'sem', en: 'wk' },
  { scale: 86_400, fr: 'j', en: 'd' },
  { scale: 3_600, fr: 'h', en: 'h' },
  { scale: 60, fr: 'min', en: 'min' },
] as const;

const SVG_NS = 'http://www.w3.org/2000/svg';

function createPlaybackIcon(paused: boolean): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '11');
  svg.setAttribute('height', '13');
  svg.setAttribute('viewBox', '0 0 11 13');
  svg.setAttribute('fill', 'currentColor');

  if (paused) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M1 0.8L10.5 6.5L1 12.2V0.8Z');
    svg.append(path);
  } else {
    for (const x of ['0', '7.2']) {
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', x);
      rect.setAttribute('y', '0');
      rect.setAttribute('width', '3.8');
      rect.setAttribute('height', '13');
      rect.setAttribute('rx', '1.4');
      svg.append(rect);
    }
  }

  return svg;
}

/** Poignée exposée au panneau date-heure pour revenir au temps réel (bouton reset). */
export interface PlaybackControls {
  selectRealtime(): void;
}

const playPauseBtn = document.getElementById('play-pause-btn')!;
const speedRange = document.getElementById('speed-range') as HTMLInputElement;
const speedValue = document.getElementById('speed-value')!;
function scaleFromSlider(value: number): number {
  const normalized = Math.max(0, Math.min(SPEED_SLIDER_MAX, value));
  if (normalized === 0) return 1;
  return Math.max(
    1,
    Math.round(
      Math.exp((normalized / SPEED_SLIDER_MAX) * Math.log(MAX_SIMULATION_SCALE))
    )
  );
}

function formatQuantity(value: number): string {
  if (value < 10) return value.toFixed(1).replace(/\.0$/, '');
  if (value < 100) return String(Math.round(value));
  return String(Math.round(value / 10) * 10);
}

function speedLabel(scale: number): string {
  if (scale === 1)
    return getLocale() === 'fr'
      ? '1:1 · Échelle réelle Terre'
      : '1:1 · Earth real time';

  const unit = SPEED_UNITS.find((candidate) => scale >= candidate.scale);
  if (!unit) return `× ${formatQuantity(scale)}`;
  return `${formatQuantity(scale / unit.scale)} ${
    getLocale() === 'fr' ? unit.fr : unit.en
  }/s`;
}

function applySpeed(sliderValue: number, om: OrbitalMechanics): void {
  const safeValue = Math.max(0, Math.min(SPEED_SLIDER_MAX, sliderValue));
  const scale = scaleFromSlider(safeValue);
  const label = speedLabel(scale);
  om.setSimulationSpeed(scale);
  speedRange.value = String(safeValue);
  speedRange.setAttribute('aria-valuetext', label);
  speedValue.textContent = label;
}

export function setupPlayback(
  anim: AnimationSystem,
  om: OrbitalMechanics
): PlaybackControls {
  playPauseBtn.addEventListener('click', () => {
    const paused = anim.togglePause();
    playPauseBtn.replaceChildren(createPlaybackIcon(paused));
    playPauseBtn.classList.toggle('is-paused', paused);
    playPauseBtn.setAttribute('aria-pressed', String(paused));
    playPauseBtn.setAttribute(
      'aria-label',
      t(paused ? 'playback.play' : 'playback.pause')
    );
  });

  speedRange.addEventListener('input', () => {
    applySpeed(Number(speedRange.value), om);
  });

  // Activer le premier bouton (Réel) au démarrage
  applySpeed(0, om);
  playPauseBtn.setAttribute('aria-label', t('playback.pause'));
  onLocaleChange(() => {
    applySpeed(Number(speedRange.value), om);
    playPauseBtn.setAttribute(
      'aria-label',
      playPauseBtn.classList.contains('is-paused')
        ? t('playback.play')
        : t('playback.pause')
    );
  });

  return {
    selectRealtime: () => applySpeed(0, om),
  };
}
