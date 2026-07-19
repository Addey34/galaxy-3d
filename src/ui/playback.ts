/**
 * Contrôles de lecture : play/pause et vitesse de simulation (#play-pause-btn, .tp-speed).
 *
 * Toujours en mode Kepler/temps-réel :
 *   om.setSimulationSpeed(scale) → scale = ratio vs temps réel
 *   1 = temps réel, 3 600 = 1h/s, 10 800 = 3h/s, 21 600 = 6h/s
 */
import type { AnimationSystem } from '@/components/systems/AnimationSystem';
import type { OrbitalMechanics } from '@/core/OrbitalMechanics';

// Réel = 1:1, 1h/s = 3600, 3h/s = 10 800, 6h/s = 21 600
export const SIMU_SCALES = [1, 3_600, 10_800, 21_600] as const;

const SVG_PAUSE = `<svg width="11" height="13" viewBox="0 0 11 13" fill="currentColor">
  <rect x="0"   y="0" width="3.8" height="13" rx="1.4"/>
  <rect x="7.2" y="0" width="3.8" height="13" rx="1.4"/>
</svg>`;

const SVG_PLAY = `<svg width="11" height="13" viewBox="0 0 11 13" fill="currentColor">
  <path d="M1 0.8L10.5 6.5L1 12.2V0.8Z"/>
</svg>`;

/** Poignée exposée au panneau date-heure pour revenir au temps réel (bouton reset). */
export interface PlaybackControls {
  selectRealtime(): void;
}

const playPauseBtn = document.getElementById('play-pause-btn')!;
const speedBtns = Array.from(
  document.querySelectorAll<HTMLButtonElement>('.speed-group .tp-speed')
);

function setSpeedActive(activeBtn: HTMLButtonElement): void {
  speedBtns.forEach((b, i) => {
    b.classList.toggle('is-active', b === activeBtn);
    // Teinture verte sur "Réel" (index 0) quand actif — indique le temps réel
    b.classList.toggle('is-simutime', i === 0 && b === activeBtn);
  });
}

function applySpeed(btn: HTMLButtonElement, om: OrbitalMechanics): void {
  const i = speedBtns.indexOf(btn);
  om.setSimulationSpeed(SIMU_SCALES[i] ?? 1);
  setSpeedActive(btn);
}

export function setupPlayback(
  anim: AnimationSystem,
  om: OrbitalMechanics
): PlaybackControls {
  playPauseBtn.addEventListener('click', () => {
    const paused = anim.togglePause();
    playPauseBtn.innerHTML = paused ? SVG_PLAY : SVG_PAUSE;
    playPauseBtn.classList.toggle('is-paused', paused);
  });

  speedBtns.forEach((btn) => {
    btn.addEventListener('click', () => applySpeed(btn, om));
  });

  // Activer le premier bouton (Réel) au démarrage
  const first = speedBtns[0];
  if (first) setSpeedActive(first);

  return {
    selectRealtime: () => {
      const realtime = speedBtns[0];
      if (realtime) applySpeed(realtime, om);
    },
  };
}
