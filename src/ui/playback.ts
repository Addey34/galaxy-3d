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
// Slider BIDIRECTIONNEL : centre = temps réel 1:1, droite = futur accéléré, gauche = passé
// accéléré (le moteur d'horloge accepte un timeScale négatif → le temps recule). La demi-course
// de chaque côté est mappée exponentiellement de ±1 (au centre) à ±MAX_SIMULATION_SCALE (au bord).
const SPEED_SLIDER_CENTER = 50;
// Petite zone morte autour du centre : facilite le retour exact au 1:1 sans viser au pixel.
const SPEED_CENTER_DEADZONE = 2;
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
  /** Met la simulation en pause et synchronise le bouton lecture/pause. */
  pause(): void;
}

const playPauseBtn = document.getElementById('play-pause-btn')!;
const speedRange = document.getElementById('speed-range') as HTMLInputElement;
const speedValue = document.getElementById('speed-value')!;
/**
 * Slider → vitesse SIGNÉE. Centre (50) = +1 (temps réel). Écart au centre normalisé dans
 * [0, 1] → magnitude exponentielle de 1 à MAX_SIMULATION_SCALE. Le SIGNE suit le côté :
 * droite du centre = futur (+), gauche = passé (−). Zone morte centrale → exactement +1.
 */
function scaleFromSlider(value: number): number {
  const clamped = Math.max(0, Math.min(SPEED_SLIDER_MAX, value));
  const offset = clamped - SPEED_SLIDER_CENTER; // <0 passé, >0 futur
  if (Math.abs(offset) <= SPEED_CENTER_DEADZONE) return 1;
  const halfCourse = SPEED_SLIDER_MAX - SPEED_SLIDER_CENTER; // 50
  const magnitudeNorm = (Math.abs(offset) - SPEED_CENTER_DEADZONE) /
    (halfCourse - SPEED_CENTER_DEADZONE);
  const magnitude = Math.max(
    1,
    Math.round(Math.exp(magnitudeNorm * Math.log(MAX_SIMULATION_SCALE)))
  );
  return offset < 0 ? -magnitude : magnitude;
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

  // Vitesse signée : magnitude commune, préfixe directionnel pour le passé (temps qui recule).
  const magnitude = Math.abs(scale);
  const reversed = scale < 0;
  const unit = SPEED_UNITS.find((candidate) => magnitude >= candidate.scale);
  const body = unit
    ? `${formatQuantity(magnitude / unit.scale)} ${
        getLocale() === 'fr' ? unit.fr : unit.en
      }/s`
    : `× ${formatQuantity(magnitude)}`;
  if (!reversed) return body;
  // Préfixe « ◀ » + mention passé : on remonte le temps.
  return getLocale() === 'fr' ? `◀ ${body} (passé)` : `◀ ${body} (past)`;
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
  // Synchronise l'icône, les classes et l'ARIA du bouton sur l'état de pause donné.
  const syncPauseButton = (paused: boolean): void => {
    playPauseBtn.replaceChildren(createPlaybackIcon(paused));
    playPauseBtn.classList.toggle('is-paused', paused);
    playPauseBtn.setAttribute('aria-pressed', String(paused));
    playPauseBtn.setAttribute(
      'aria-label',
      t(paused ? 'playback.play' : 'playback.pause')
    );
  };

  playPauseBtn.addEventListener('click', () => {
    syncPauseButton(anim.togglePause());
  });

  speedRange.addEventListener('input', () => {
    applySpeed(Number(speedRange.value), om);
  });

  // Démarrage au CENTRE = temps réel 1:1.
  applySpeed(SPEED_SLIDER_CENTER, om);
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
    selectRealtime: () => applySpeed(SPEED_SLIDER_CENTER, om),
    pause: () => {
      anim.setPaused(true);
      syncPauseButton(true);
    },
  };
}
