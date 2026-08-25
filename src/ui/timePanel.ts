/**
 * Barre de temps (#time-panel) — surface unique, style lecteur multimédia.
 *
 * État compact : lecture/pause + horloge + vitesse + retour au présent. Un clic sur la
 * zone d'horloge (#time-readout) l'étend EN PLACE pour révéler le slider de vitesse et
 * l'édition date/heure — aucune taille ne saute pendant le drag. Les entrées date/heure :
 *   - molette → ±1 h / ±1 jour ;
 *   - picker natif (clic) → saut à l'heure/date choisie ;
 *   - bouton présent → retour au temps réel (via `PlaybackControls`).
 */
import { t } from '@/i18n';
import type { OrbitalMechanics } from '@/core/OrbitalMechanics';
import type { PlaybackControls } from './playback';
import type { OverlayCoordinator } from './overlayCoordinator';

const timePanel = document.getElementById('time-panel')!;
const readoutBtn = document.getElementById('time-readout')!;
const advanced = document.getElementById('time-advanced')!;
const clockDisplay = document.getElementById('clock-display')!;
const liveDot = document.getElementById('live-dot')!;
const timeTodayBtn = document.getElementById('time-today')!;
const timeInput = document.getElementById('time-input') as HTMLInputElement;
const dateInput = document.getElementById('date-input') as HTMLInputElement;

const LIVE_THRESHOLD_DAYS = 5 / (24 * 60); // ±5 min

let _prevTime = '';
let _prevDate = '';
let _prevClock = '';
let _editingInput: HTMLInputElement | null = null;

timeInput.addEventListener('focus', () => {
  _editingInput = timeInput;
});
timeInput.addEventListener('blur', () => {
  if (_editingInput === timeInput) _editingInput = null;
});
dateInput.addEventListener('focus', () => {
  _editingInput = dateInput;
});
dateInput.addEventListener('blur', () => {
  if (_editingInput === dateInput) _editingInput = null;
});

function flash(el: HTMLElement): void {
  el.classList.remove('is-ticking');
  void el.offsetWidth; // reflow pour réarmer l'animation CSS
  el.classList.add('is-ticking');
}

function refreshDisplay(om: OrbitalMechanics): void {
  const d = om.simulationDate;
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  const time = `${hh}:${mm}:${ss}`;

  // Horloge condensée (toujours visible).
  if (time !== _prevClock) {
    clockDisplay.textContent = time;
    _prevClock = time;
    if (om.simulationTimeScale <= 1) flash(clockDisplay);
  }

  if (_editingInput !== timeInput && time !== _prevTime) {
    timeInput.value = time;
    _prevTime = time;
  }

  if (_editingInput !== dateInput) {
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dy = String(d.getUTCDate()).padStart(2, '0');
    const dt = `${y}-${mo}-${dy}`;
    if (dt !== _prevDate) {
      dateInput.value = dt;
      _prevDate = dt;
    }
  }

  const isLive =
    om.simulationTimeScale === 1 &&
    Math.abs(om.offsetDays) < LIVE_THRESHOLD_DAYS;
  liveDot.classList.toggle('is-live', isLive);
  liveDot.classList.toggle('is-off-time', !isLive);
}

function addWheelAdjust(
  el: HTMLInputElement,
  onDelta: (n: number) => void,
  refresh: () => void,
  onChange?: () => void
): void {
  el.addEventListener(
    'wheel',
    (e) => {
      if (_editingInput === el) return;
      e.preventDefault();
      onDelta(e.deltaY > 0 ? 1 : -1);
      refresh();
      flash(el);
      onChange?.();
    },
    { passive: false }
  );
}

export function setupTimePanel(
  om: OrbitalMechanics,
  playback: PlaybackControls,
  onChange?: () => void,
  coordinator?: OverlayCoordinator
): void {
  const refresh = () => refreshDisplay(om);

  // ── Expansion en place (compact ↔ étendu) ──
  let expanded = false;
  const setExpanded = (next: boolean): void => {
    expanded = next;
    timePanel.classList.toggle('is-expanded', expanded);
    readoutBtn.setAttribute('aria-expanded', String(expanded));
    advanced.setAttribute('aria-hidden', String(!expanded));
    // `aria-hidden` seul masque le contenu aux lecteurs d'écran mais ne retire pas les
    // champs (vitesse, date, heure) de l'ordre de tabulation — un clavier pouvait tabuler
    // dans un panneau visuellement/sémantiquement caché (trouvé par un audit axe-core).
    // `inert` couvre les deux : hors tabulation ET hors arbre d'accessibilité.
    if (expanded) advanced.removeAttribute('inert');
    else advanced.setAttribute('inert', '');
  };
  setExpanded(false);
  readoutBtn.addEventListener('click', () => setExpanded(!expanded));

  // Sur mobile, la barre temps reste toujours accessible : quand une surface
  // contextuelle s'ouvre (feuille en bas), on replie la partie avancée pour
  // dégager la scène et éviter le chevauchement.
  coordinator?.onOpen((id) => {
    if (id && expanded && window.matchMedia('(max-width: 640px)').matches) {
      setExpanded(false);
    }
  });

  _prevTime = '';
  _prevDate = '';
  _prevClock = '';
  refresh();
  setInterval(refresh, 250);

  // Molette (desktop) : ±1 h / ±1 jour.
  addWheelAdjust(timeInput, (d) => om.addTimeOffsetHours(d), refresh, onChange);
  addWheelAdjust(dateInput, (d) => om.addTimeOffset(d), refresh, onChange);

  // Picker natif → change event.
  timeInput.addEventListener('change', () => {
    if (!timeInput.value) return;
    const [h = 0, m = 0, s = 0] = timeInput.value.split(':').map(Number);
    const cur = om.simulationDate;
    const target = new Date(cur.getTime());
    target.setUTCHours(h, m, s, 0);
    om.addTimeOffset((target.getTime() - cur.getTime()) / 86_400_000);
    _prevTime = timeInput.value;
    flash(timeInput);
    refresh();
    onChange?.();
  });

  dateInput.addEventListener('change', () => {
    if (!dateInput.value) return;
    const [y = 0, mo = 0, d = 0] = dateInput.value.split('-').map(Number);
    const cur = om.simulationDate;
    const target = new Date(cur.getTime());
    target.setUTCFullYear(y, mo - 1, d);
    om.addTimeOffset((target.getTime() - cur.getTime()) / 86_400_000);
    _prevDate = dateInput.value;
    flash(dateInput);
    refresh();
    onChange?.();
  });

  // Retour au présent → temps réel.
  timeTodayBtn.addEventListener('click', () => {
    om.resetTimeOffset();
    playback.selectRealtime();
    _prevTime = '';
    _prevDate = '';
    _prevClock = '';
    refresh();
    flash(timeInput);
    flash(dateInput);
    onChange?.();
  });
  timeTodayBtn.setAttribute('aria-label', t('time.today'));
}
