/**
 * Point d'entrée de l'application et couche UI.
 *
 * Démarre `SolarSystemApp`, affiche la progression de chargement, puis câble tous les
 * contrôles du DOM sur la `PublicAPI` : boutons de navigation entre planètes, lecture /
 * pause et vitesse, panneau date-heure (voyage temporel) et bascule Éducatif ↔ Exploration.
 */
import { SolarSystemApp } from './SolarSystemApp';
import { CELESTIAL_CONFIG } from './config/settings';
import Logger from './utils/Logger';
import type { AnimationSystem } from './components/systems/AnimationSystem';
import type { CameraSystem } from './components/systems/CameraSystem';
import type { OrbitalMechanics } from './core/OrbitalMechanics';

// ============================================================================
// DOM — references
// ============================================================================

const fullscreenBtn  = document.getElementById('fullscreen-btn')!;
const progressBar    = document.getElementById('load-progress')!;
const loadStatus     = document.getElementById('load-status')!;
const loader         = document.getElementById('loader')!;

const playPauseBtn   = document.getElementById('play-pause-btn')!;
const timeTodayBtn   = document.getElementById('time-today')!;

const datetimePanel  = document.getElementById('datetime-panel')!;
const liveDot        = document.getElementById('live-dot')!;
const timeInput      = document.getElementById('time-input') as HTMLInputElement;
const dateInput      = document.getElementById('date-input') as HTMLInputElement;

const speedBtns = Array.from(
  document.querySelectorAll<HTMLButtonElement>('.speed-group .tp-speed')
);

// Réel = 1:1, 1h/s = 3600, 3h/s = 10 800, 6h/s = 21 600
const SIMU_SCALES = [1, 3_600, 10_800, 21_600] as const;

// ============================================================================
// FULLSCREEN
// ============================================================================

fullscreenBtn.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen()
      .catch((err) => Logger.error('Fullscreen error', err));
  } else {
    document.exitFullscreen()
      .catch((err) => Logger.error('Fullscreen exit error', err));
  }
});

// ============================================================================
// LOADING
// ============================================================================

function updateProgress(percent: number, message: string): void {
  progressBar.style.width = `${percent}%`;
  loadStatus.textContent  = message;
}

function hideLoader(): void {
  loader.style.opacity = '0';
  setTimeout(() => (loader.style.display = 'none'), 500);
}

// ============================================================================
// PLANET CONTROLS
// ============================================================================

// Accent doré dédié au Soleil (son orbitalColor vaut 0x000000, inutilisable ici).
const SUN_ACCENT = 0xffcc33;

/** Convertit une couleur hexadécimale (0xRRGGBB) en triplet CSS « r, g, b ». */
function hexToRgbTriplet(hex: number): string {
  return `${(hex >> 16) & 0xff}, ${(hex >> 8) & 0xff}, ${hex & 0xff}`;
}

/**
 * Pose sur chaque bouton planète la variable CSS `--planet-rgb` = couleur de l'orbite du
 * corps (source unique : CELESTIAL_CONFIG). Le CSS s'en sert pour le survol et l'état actif,
 * si bien que chaque bouton se teinte de la couleur de SA planète. La Vue Globale garde
 * l'accent bleu défini en CSS.
 */
function applyPlanetButtonColors(): void {
  const setVar = (id: string, hex: number): void => {
    document.getElementById(id)?.style.setProperty('--planet-rgb', hexToRgbTriplet(hex));
  };

  setVar('orbit-sun', SUN_ACCENT);
  for (const [name, cfg] of Object.entries(CELESTIAL_CONFIG.bodies)) {
    if (name === 'stars' || name === 'sun') continue;
    setVar(`orbit-${name}`, cfg.orbitalColor);
    if (cfg.satellites) {
      for (const [satName, satCfg] of Object.entries(cfg.satellites)) {
        setVar(`orbit-${satName}`, satCfg.orbitalColor);
      }
    }
  }
}

function setupPlanetControls(camera: CameraSystem): void {
  applyPlanetButtonColors();
  const btns = document.querySelectorAll<HTMLButtonElement>('.controls button');
  btns.forEach((btn) => {
    btn.addEventListener('click', () => {
      btns.forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      const bodyName = btn.id.replace('orbit-', '');
      if (bodyName === 'overview') {
        camera.goToOverview();
      } else {
        camera.setTarget(bodyName);
      }
    });
  });
}

// ============================================================================
// PLAYBACK — play/pause + vitesse
//
// Toujours en mode Kepler/temps-réel :
//   om.setSimulationSpeed(scale) → scale = ratio vs temps réel
//   1 = temps réel, 3 600 = 1h/s, 10 800 = 3h/s, 21 600 = 6h/s
// ============================================================================

const SVG_PAUSE = `<svg width="11" height="13" viewBox="0 0 11 13" fill="currentColor">
  <rect x="0"   y="0" width="3.8" height="13" rx="1.4"/>
  <rect x="7.2" y="0" width="3.8" height="13" rx="1.4"/>
</svg>`;

const SVG_PLAY = `<svg width="11" height="13" viewBox="0 0 11 13" fill="currentColor">
  <path d="M1 0.8L10.5 6.5L1 12.2V0.8Z"/>
</svg>`;

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

function setupPlayback(anim: AnimationSystem, om: OrbitalMechanics): void {
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
}

// ============================================================================
// AFFICHAGE — horloge et date
// ============================================================================

const LIVE_THRESHOLD_DAYS = 5 / (24 * 60); // ±5 min

let _prevTime       = '';
let _prevDate       = '';
let _editingInput: HTMLInputElement | null = null;

timeInput.addEventListener('focus', () => { _editingInput = timeInput; });
timeInput.addEventListener('blur',  () => { if (_editingInput === timeInput) _editingInput = null; });
dateInput.addEventListener('focus', () => { _editingInput = dateInput; });
dateInput.addEventListener('blur',  () => { if (_editingInput === dateInput) _editingInput = null; });

function flash(el: HTMLElement): void {
  el.classList.remove('is-ticking');
  void el.offsetWidth; // force un reflow DOM pour réinitialiser l'animation CSS (sans ça, remove+add sur la même frame ne déclenche rien)
  el.classList.add('is-ticking');
}

function refreshDisplay(om: OrbitalMechanics): void {
  const d = om.simulationDate;

  if (_editingInput !== timeInput) {
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = String(d.getUTCSeconds()).padStart(2, '0');
    const t  = `${hh}:${mm}:${ss}`;
    if (t !== _prevTime) { timeInput.value = t; _prevTime = t; }
  }

  if (_editingInput !== dateInput) {
    const y  = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dy = String(d.getUTCDate()).padStart(2, '0');
    const dt = `${y}-${mo}-${dy}`;
    if (dt !== _prevDate) { dateInput.value = dt; _prevDate = dt; }
  }

  const isLive = om.simulationTimeScale === 1
              && Math.abs(om.offsetDays) < LIVE_THRESHOLD_DAYS;
  liveDot.classList.toggle('is-live',     isLive);
  liveDot.classList.toggle('is-off-time', !isLive);
}

// ============================================================================
// SCROLL MOLETTE SUR LES INPUTS
// ============================================================================

function addWheelAdjust(
  el: HTMLInputElement,
  onDelta: (n: number) => void,
  refresh: () => void
): void {
  el.addEventListener('wheel', (e) => {
    if (_editingInput === el) return;
    e.preventDefault(); // passive: false obligatoire pour pouvoir appeler preventDefault() et bloquer le scroll de page
    onDelta(e.deltaY > 0 ? 1 : -1);
    refresh();
    flash(el);
  }, { passive: false });
}

// ============================================================================
// DATETIME PANEL — toujours visible (mode Kepler/temps-réel par défaut)
// ============================================================================

function setupDatetimePanel(om: OrbitalMechanics): void {
  const refresh = () => refreshDisplay(om);

  // Ouvrir le panneau immédiatement
  datetimePanel.classList.add('is-open');
  _prevTime = '';
  _prevDate = '';
  refresh();
  setInterval(refresh, 250);

  // Scroll rapide (desktop)
  addWheelAdjust(timeInput, (d) => om.addTimeOffsetHours(d), refresh);
  addWheelAdjust(dateInput, (d) => om.addTimeOffset(d),      refresh);

  // Picker natif → change event
  timeInput.addEventListener('change', () => {
    if (!timeInput.value) return;
    const [h = 0, m = 0, s = 0] = timeInput.value.split(':').map(Number);
    const cur    = om.simulationDate;
    const target = new Date(cur.getTime());
    target.setUTCHours(h, m, s, 0);
    om.addTimeOffset((target.getTime() - cur.getTime()) / 86_400_000);
    _prevTime = timeInput.value;
    flash(timeInput);
    refresh();
  });

  dateInput.addEventListener('change', () => {
    if (!dateInput.value) return;
    const [y = 0, mo = 0, d = 0] = dateInput.value.split('-').map(Number);
    const cur    = om.simulationDate;
    const target = new Date(cur.getTime());
    target.setUTCFullYear(y, mo - 1, d);
    om.addTimeOffset((target.getTime() - cur.getTime()) / 86_400_000);
    _prevDate = dateInput.value;
    flash(dateInput);
    refresh();
  });

  // Bouton reset → retour au présent + vitesse temps réel
  timeTodayBtn.addEventListener('click', () => {
    om.resetTimeOffset();
    const first = speedBtns[0];
    if (first) applySpeed(first, om);
    _prevTime = '';
    _prevDate = '';
    refresh();
    flash(timeInput);
    flash(dateInput);
  });
}

// ============================================================================
// MODE SWITCHER — Éducatif ↔ Explo (vraie échelle)
// ============================================================================

function setupModeSwitcher(om: OrbitalMechanics, camera: CameraSystem): void {
  const modeBtns = Array.from(
    document.querySelectorAll<HTMLButtonElement>('#mode-controls .mode-btn')
  );
  const planetBtns = document.querySelectorAll<HTMLButtonElement>('.controls button');
  const overviewBtn = document.getElementById('orbit-overview');
  const earthBtn    = document.getElementById('orbit-earth');

  modeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled || btn.classList.contains('is-active')) return;
      const isExplo = btn.dataset['mode'] === 'exploration';
      modeBtns.forEach((b) => b.classList.toggle('is-active', b === btn));
      document.body.classList.toggle('is-explo-mode', isExplo);
      om.setMode(isExplo ? 'explo' : 'educ');
      camera.setScaleMode(isExplo ? 'explo' : 'educ');

      planetBtns.forEach((b) => b.classList.remove('is-active'));
      if (isExplo) {
        earthBtn?.classList.add('is-active');
      } else {
        overviewBtn?.classList.add('is-active');
      }
    });
  });
}

// ============================================================================
// ERROR
// ============================================================================

function showError(error: Error): void {
  Logger.error('Application Error:', error);
  loader.innerHTML = `
    <div style="text-align:center">
      <h2 style="color:red">Application Error</h2>
      <p>${error.message}</p>
      <button onclick="window.location.reload()"
              style="padding:10px 20px;margin-top:20px">Retry</button>
    </div>`;
}

// ============================================================================
// BOOT
// ============================================================================

(async function loadApp(): Promise<void> {
  try {
    updateProgress(10, 'Loading core components...');

    const app = new SolarSystemApp();
    const { cameraSystem, animationSystem, orbitalMechanics } =
      await app.init(updateProgress);

    setupPlanetControls(cameraSystem);
    setupPlayback(animationSystem, orbitalMechanics);
    setupDatetimePanel(orbitalMechanics);
    setupModeSwitcher(orbitalMechanics, cameraSystem);

    hideLoader();
  } catch (err) {
    showError(err instanceof Error ? err : new Error(String(err)));
  }
})();
