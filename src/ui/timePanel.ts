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
import { intlLocale, onLocaleChange, t } from '@/i18n';
import { displayedDate, fromJulianDate } from '@/core/calendar';
import type { OrbitalMechanics } from '@/core/OrbitalMechanics';
import { LIVE_TOLERANCE_MS } from '@/core/positionProvenance';
import {
  dateFieldTarget,
  dateFieldValue,
  timeFieldTarget,
  timeFieldValue,
} from './dateField';
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
/**
 * AVANT LE 15 OCTOBRE 1582, le champ de date cède la place à ce groupe (ligne 22.10, années avant
 * J.-C., pas 2) : jour, mois, année et ère, dans le calendrier JULIEN que les historiens et
 * Horizons emploient pour ces dates. Le champ de date du navigateur est grégorien, et il ne sait
 * écrire ni une année négative ni le 29 février 1500 : il se viderait sans un mot, le défaut que
 * le lot 39 avait déjà fermé pour l'an 500. La conversion vit dans `core/calendar.ts`.
 */
const historic = document.getElementById('historic-date')!;
const histDay = document.getElementById('hist-day') as HTMLInputElement;
const histMonth = document.getElementById('hist-month') as HTMLSelectElement;
const histYear = document.getElementById('hist-year') as HTMLInputElement;
const histEra = document.getElementById('hist-era') as HTMLSelectElement;

// Même seuil que la catégorie « en direct » d'une position (core/positionProvenance.ts).
const LIVE_THRESHOLD_DAYS = LIVE_TOLERANCE_MS / 86_400_000;

let _prevTime = '';
let _prevDate = '';
let _prevClock = '';
let _editingInput: HTMLInputElement | null = null;
/** Vrai pendant qu'un champ du groupe julien a le focus : la barre n'écrase pas une saisie. */
let _editingHistoric = false;
let _prevHistoric = '';

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

historic.addEventListener('focusin', () => {
  _editingHistoric = true;
});
historic.addEventListener('focusout', (e) => {
  if (!historic.contains(e.relatedTarget as Node | null))
    _editingHistoric = false;
});

/** Les noms des mois et des ères dans la langue courante ; ce sont les mêmes en julien. */
function labelHistoricFields(): void {
  const month = new Intl.DateTimeFormat(intlLocale(), {
    month: 'long',
    timeZone: 'UTC',
  });
  const selected = histMonth.value;
  histMonth.replaceChildren(
    ...Array.from({ length: 12 }, (_, i) => {
      const option = document.createElement('option');
      option.value = String(i + 1);
      option.textContent = month.format(Date.UTC(2000, i, 1));
      return option;
    })
  );
  if (selected) histMonth.value = selected;
  histEra.options[0]!.textContent = t('time.eraAD');
  histEra.options[1]!.textContent = t('time.eraBC');
}

/**
 * Montre le champ de date OU le groupe julien selon la date de la scène, et remplit le groupe :
 * une année astronomique négative ou nulle s'écrit avant J.-C. (0 → 1 av. J.-C.).
 */
function refreshHistoric(ms: number): boolean {
  const shown = displayedDate(ms);
  const julian = shown.calendar === 'julian';
  // N'écrire l'attribut que s'il CHANGE : cette fonction tourne toutes les 250 ms, et réécrire
  // `hidden` à l'identique est quand même une mutation du DOM, qui peut invalider le style au
  // moment où le thread est déjà chargé (juste après un vol vers un corps).
  if (historic.hidden !== !julian) historic.hidden = !julian;
  if (dateInput.hidden !== julian) dateInput.hidden = julian;
  if (!julian || _editingHistoric) return julian;
  const key = `${shown.year}-${shown.month}-${shown.day}`;
  if (key === _prevHistoric) return julian;
  _prevHistoric = key;
  histDay.value = String(shown.day);
  histMonth.value = String(shown.month);
  histYear.value = String(shown.year >= 1 ? shown.year : 1 - shown.year);
  histEra.value = shown.year >= 1 ? 'ad' : 'bc';
  return julian;
}

/** L'instant que désigne le groupe julien, à l'heure du jour courante ; `null` s'il n'existe pas. */
function historicTarget(current: number): number | null {
  const year = Number(histYear.value);
  if (!Number.isInteger(year) || year < 1) return null;
  return fromJulianDate(
    {
      year: histEra.value === 'bc' ? 1 - year : year,
      month: Number(histMonth.value),
      day: Number(histDay.value),
    },
    current
  );
}

function flash(el: HTMLElement): void {
  el.classList.remove('is-ticking');
  void el.offsetWidth; // reflow pour réarmer l'animation CSS
  el.classList.add('is-ticking');
}

function refreshDisplay(om: OrbitalMechanics): void {
  const d = om.simulationDate;
  const time = timeFieldValue(d);

  // Horloge condensée (toujours visible).
  if (time !== _prevClock) {
    clockDisplay.textContent = time;
    _prevClock = time;
    // Le battement de seconde n'a de sens qu'à vitesse humaine : on compare la MAGNITUDE,
    // sinon la marche arrière (timeScale négatif) le réarmait à chaque tick, y compris à
    // 1 an/s où l'horloge défile trop vite pour qu'un flash veuille dire quoi que ce soit.
    if (Math.abs(om.simulationTimeScale) <= 1) flash(clockDisplay);
  }

  if (_editingInput !== timeInput && time !== _prevTime) {
    timeInput.value = time;
    _prevTime = time;
  }

  if (refreshHistoric(d.getTime())) {
    // Le groupe julien est affiché : le champ grégorien, masqué, n'a rien à montrer.
  } else if (_editingInput !== dateInput) {
    const dt = dateFieldValue(d);
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
  _prevHistoric = '';
  labelHistoricFields();
  onLocaleChange(() => {
    labelHistoricFields();
    _prevHistoric = '';
    refresh();
  });
  refresh();
  setInterval(refresh, 250);

  // Molette (desktop) : ±1 h / ±1 jour.
  addWheelAdjust(timeInput, (d) => om.addTimeOffsetHours(d), refresh, onChange);
  addWheelAdjust(dateInput, (d) => om.addTimeOffset(d), refresh, onChange);

  // Picker natif → change event.
  timeInput.addEventListener('change', () => {
    const cur = om.simulationDate;
    const target = timeFieldTarget(timeInput.value, cur);
    if (!target) return;
    om.addTimeOffset((target.getTime() - cur.getTime()) / 86_400_000);
    _prevTime = timeInput.value;
    flash(timeInput);
    refresh();
    onChange?.();
  });

  dateInput.addEventListener('change', () => {
    const cur = om.simulationDate;
    const target = dateFieldTarget(dateInput.value, cur);
    if (!target) return;
    om.addTimeOffset((target.getTime() - cur.getTime()) / 86_400_000);
    _prevDate = dateInput.value;
    flash(dateInput);
    refresh();
    onChange?.();
  });

  // Groupe julien : une date saisie qui existe dans ce calendrier déplace la scène ; une date qui
  // n'existe pas (un 29 février d'une année non bissextile) ne bouge rien, comme le champ grégorien.
  const applyHistoric = (): void => {
    const cur = om.simulationDate.getTime();
    const target = historicTarget(cur);
    if (target === null) return;
    om.addTimeOffset((target - cur) / 86_400_000);
    _prevHistoric = '';
    flash(histDay);
    refresh();
    onChange?.();
  };
  for (const field of [histDay, histMonth, histYear, histEra])
    field.addEventListener('change', applyHistoric);
  addWheelAdjust(
    histDay,
    (d) => om.addTimeOffset(d),
    () => {
      _prevHistoric = '';
      refresh();
    },
    onChange
  );

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
