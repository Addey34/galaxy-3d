import './astronomicalEvents.css';
import {
  findUpcomingAstronomicalEvents,
  type AstronomicalEvent,
} from '@/core/astronomicalEvents';
import type { OrbitalMechanics } from '@/core/OrbitalMechanics';
import { intlLocale, onLocaleChange, t } from '@/i18n';
import { bodyDisplayName } from '@/i18n/bodyText';
import type { OverlayCoordinator } from './overlayCoordinator';
import type { PlanetNavigation } from './planetNav';
import type { PlaybackControls } from './playback';

const MS_PER_DAY = 86_400_000;

function formatEventDate(date: Date): string {
  return new Intl.DateTimeFormat(intlLocale(), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(date);
}

const EVENT_KEYS: Record<AstronomicalEvent['kind'], string> = {
  'new-moon': 'events.newMoon',
  'first-quarter': 'events.firstQuarter',
  'full-moon': 'events.fullMoon',
  'third-quarter': 'events.thirdQuarter',
  'solar-eclipse': 'events.solarEclipse',
  'lunar-eclipse': 'events.lunarEclipse',
  'march-equinox': 'events.marchEquinox',
  'june-solstice': 'events.juneSolstice',
  'september-equinox': 'events.septemberEquinox',
  'december-solstice': 'events.decemberSolstice',
  perihelion: 'events.perihelion',
  aphelion: 'events.aphelion',
  opposition: 'events.opposition',
  conjunction: 'events.conjunction',
};

/**
 * Corps sur lequel recadrer la caméra pour chaque type d'événement.
 * Phases + éclipses lunaires → la Lune (l'astre observé) ; éclipses solaires,
 * saisons et apsides → la Terre (l'observateur / l'ombre au sol). Opposition/conjonction
 * n'ont pas d'entrée ici : le corps varie par événement, lu depuis `event.body` (cf.
 * `focusBody` ci-dessous).
 */
const FOCUS_BODY: Partial<Record<AstronomicalEvent['kind'], string>> = {
  'new-moon': 'moon',
  'first-quarter': 'moon',
  'full-moon': 'moon',
  'third-quarter': 'moon',
  'lunar-eclipse': 'moon',
  'solar-eclipse': 'earth',
  'march-equinox': 'earth',
  'june-solstice': 'earth',
  'september-equinox': 'earth',
  'december-solstice': 'earth',
  perihelion: 'earth',
  aphelion: 'earth',
};

/** Corps sur lequel recadrer la caméra : `event.body` (opposition/conjonction) sinon FOCUS_BODY. */
function focusBody(event: AstronomicalEvent): string {
  return event.body ?? FOCUS_BODY[event.kind] ?? 'earth';
}

function eventLabel(event: AstronomicalEvent): string {
  const label = t(EVENT_KEYS[event.kind]);
  if (event.body) {
    // Opposition/conjonction : « Mars · Opposition » — le nom de la planète prime, le
    // libellé générique précise le type d'alignement.
    return `${bodyDisplayName(event.body)} · ${label}`;
  }
  if (!event.eclipseKind) return label;
  // Éclipse : type (totale/partielle…) + ampleur obscurcie.
  const parts = [t(`events.kind.${event.eclipseKind}`)];
  if (event.obscuration !== undefined && event.obscuration > 0) {
    parts.push(`${Math.round(event.obscuration * 100)}%`);
  }
  return `${label} · ${parts.join(' · ')}`;
}

/** Infobulle au survol : détails (visibilité d'éclipse) + rappel « cliquer pour y aller ». */
function eventTooltip(event: AstronomicalEvent): string {
  const lines: string[] = [];
  if (
    event.kind === 'solar-eclipse' &&
    event.peakLatitude !== undefined &&
    event.peakLongitude !== undefined
  ) {
    const lat = event.peakLatitude;
    const lon = event.peakLongitude;
    const ns = lat >= 0 ? 'N' : 'S';
    const ew = lon >= 0 ? 'E' : 'W';
    lines.push(
      t('events.tip.peak', {
        lat: `${Math.abs(lat).toFixed(1)}°${ns}`,
        lon: `${Math.abs(lon).toFixed(1)}°${ew}`,
      })
    );
  }
  if (event.obscuration !== undefined && event.obscuration > 0) {
    lines.push(
      t('events.tip.obscuration', {
        percent: `${Math.round(event.obscuration * 100)}`,
      })
    );
  }
  lines.push(t('events.tip.goto'));
  return lines.join('\n');
}

export interface AstronomicalEventsPanel {
  refresh(): void;
  dispose(): void;
}

export interface AstronomicalEventsDeps {
  onDateChange?: () => void;
  coordinator?: OverlayCoordinator;
  /** Sélection partagée : recadre la caméra + ouvre la fiche du corps concerné. */
  navigation?: Pick<PlanetNavigation, 'selectBody'>;
  /** Contrôles de lecture : fige la simulation sur la date de l'événement. */
  playback?: Pick<PlaybackControls, 'pause'>;
}

export function setupAstronomicalEvents(
  om: OrbitalMechanics,
  deps: AstronomicalEventsDeps = {}
): AstronomicalEventsPanel {
  const { onDateChange, coordinator, navigation, playback } = deps;
  // Le déclencheur vit dans le dock (statique) ; le panneau est une surface contextuelle.
  const toggle = document.getElementById(
    'events-trigger'
  ) as HTMLButtonElement | null;

  const panel = document.createElement('aside');
  panel.id = 'astronomical-events';
  panel.className = 'surface surface--events';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-labelledby', 'astronomical-events-title');

  const header = document.createElement('header');
  header.className = 'surface-header';
  const title = document.createElement('h2');
  title.className = 'surface-title';
  title.id = 'astronomical-events-title';
  const close = document.createElement('button');
  close.className = 'events-close surface-close';
  close.type = 'button';
  close.setAttribute('aria-label', t('events.close'));
  close.innerHTML =
    '<svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  header.append(title, close);

  const body = document.createElement('div');
  body.className = 'surface-body';
  const list = document.createElement('div');
  list.className = 'events-list';
  body.append(list);
  panel.append(header, body);
  document.body.append(panel);

  const setOpen = (open: boolean): void => {
    if (open) coordinator?.requestOpen('events');
    panel.hidden = !open;
    toggle?.setAttribute('aria-expanded', String(open));
    if (open) {
      render();
      close.focus();
    } else if (document.activeElement === close) {
      toggle?.focus();
    }
  };
  coordinator?.register('events', () => setOpen(false));

  const render = (): void => {
    title.textContent = t('events.title');
    toggle?.setAttribute('aria-label', t('events.open'));
    close.setAttribute('aria-label', t('events.close'));
    list.replaceChildren();

    const events = findUpcomingAstronomicalEvents(om.simulationDate, {
      count: 8,
      horizonDays: 730,
    });
    if (events.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'events-empty';
      empty.textContent = t('events.empty');
      list.append(empty);
      return;
    }

    for (const event of events) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'event-row';
      row.dataset['eventDate'] = event.date.toISOString();
      row.title = eventTooltip(event);

      const label = document.createElement('span');
      label.className = 'event-row-label';
      label.textContent = eventLabel(event);
      const date = document.createElement('time');
      date.className = 'event-row-date';
      date.dateTime = event.date.toISOString();
      date.textContent = formatEventDate(event.date);
      const go = document.createElement('span');
      go.className = 'event-row-go';
      go.textContent = '›';
      row.append(label, date, go);

      row.addEventListener('click', () => {
        // 1. Fige la lecture pour rester sur l'instant précis de l'événement.
        playback?.pause();
        // 2. Voyage jusqu'à la date/heure exacte (fraction de jour préservée).
        const deltaDays =
          (event.date.getTime() - om.simulationDate.getTime()) / MS_PER_DAY;
        om.addTimeOffset(deltaDays);
        onDateChange?.();
        // 3. Recadre la caméra sur le corps observé (Lune, Terre…).
        navigation?.selectBody(focusBody(event));
        setOpen(false);
      });
      list.append(row);
    }
  };

  toggle?.addEventListener('click', () => setOpen(panel.hidden === true));
  close.addEventListener('click', () => {
    setOpen(false);
    toggle?.focus();
  });
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      toggle?.focus();
    }
  });
  onLocaleChange(render);
  render();

  return {
    refresh: render,
    dispose: () => {
      panel.remove();
    },
  };
}
