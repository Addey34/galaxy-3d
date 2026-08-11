import './astronomicalEvents.css';
import {
  findUpcomingAstronomicalEvents,
  type AstronomicalEvent,
} from '@/core/astronomicalEvents';
import type { OrbitalMechanics } from '@/core/OrbitalMechanics';
import { intlLocale, onLocaleChange, t } from '@/i18n';
import type { OverlayCoordinator } from './overlayCoordinator';

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

function eventLabel(event: AstronomicalEvent): string {
  const key: Record<AstronomicalEvent['kind'], string> = {
    'new-moon': 'events.newMoon',
    'first-quarter': 'events.firstQuarter',
    'full-moon': 'events.fullMoon',
    'third-quarter': 'events.thirdQuarter',
    'solar-eclipse': 'events.solarEclipse',
    'lunar-eclipse': 'events.lunarEclipse',
  };
  const label = t(key[event.kind]);
  if (!event.eclipseKind) return label;
  return `${label} · ${t(`events.kind.${event.eclipseKind}`)}`;
}

export interface AstronomicalEventsPanel {
  refresh(): void;
  dispose(): void;
}

export function setupAstronomicalEvents(
  om: OrbitalMechanics,
  onDateChange?: () => void,
  coordinator?: OverlayCoordinator
): AstronomicalEventsPanel {
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
        const deltaDays =
          (event.date.getTime() - om.simulationDate.getTime()) / MS_PER_DAY;
        om.addTimeOffset(deltaDays);
        onDateChange?.();
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
