/**
 * Panneau date-heure (#datetime-panel) — voyage temporel.
 *
 * Affiche l'horloge/la date de simulation en UTC et permet de les modifier :
 *   - molette sur les inputs → ±1 h / ±1 jour ;
 *   - picker natif (clic) → saut à l'heure/date choisie ;
 *   - bouton reset → retour au présent + vitesse temps réel (via `PlaybackControls`).
 * Toujours visible (mode Kepler/temps-réel par défaut).
 */
import type { OrbitalMechanics } from '../core/OrbitalMechanics';
import type { PlaybackControls } from './playback';

const datetimePanel = document.getElementById('datetime-panel')!;
const liveDot       = document.getElementById('live-dot')!;
const timeTodayBtn  = document.getElementById('time-today')!;
const timeInput     = document.getElementById('time-input') as HTMLInputElement;
const dateInput     = document.getElementById('date-input') as HTMLInputElement;

const LIVE_THRESHOLD_DAYS = 5 / (24 * 60); // ±5 min

let _prevTime = '';
let _prevDate = '';
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

export function setupTimePanel(om: OrbitalMechanics, playback: PlaybackControls): void {
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
    playback.selectRealtime();
    _prevTime = '';
    _prevDate = '';
    refresh();
    flash(timeInput);
    flash(dateInput);
  });
}
