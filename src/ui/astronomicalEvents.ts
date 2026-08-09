import './astronomicalEvents.css';
import {
  findUpcomingAstronomicalEvents,
  type AstronomicalEvent,
} from '@/core/astronomicalEvents';
import type { OrbitalMechanics } from '@/core/OrbitalMechanics';
import { getLocale, intlLocale, onLocaleChange, t } from '@/i18n';

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

function createButtonLabel(): string {
  return getLocale() === 'fr' ? 'Événements' : 'Events';
}

export interface AstronomicalEventsPanel {
  refresh(): void;
  dispose(): void;
}

export function setupAstronomicalEvents(
  om: OrbitalMechanics,
  onDateChange?: () => void
): AstronomicalEventsPanel {
  const toggle = document.createElement('button');
  toggle.id = 'events-toggle';
  toggle.className = 'events-toggle scene-panel scene-panel--compact';
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-haspopup', 'dialog');

  const panel = document.createElement('aside');
  panel.id = 'astronomical-events';
  panel.className = 'events-panel scene-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-labelledby', 'astronomical-events-title');

  const header = document.createElement('header');
  header.className = 'events-header';
  const title = document.createElement('h2');
  title.className = 'events-title';
  title.id = 'astronomical-events-title';
  const close = document.createElement('button');
  close.className = 'events-close';
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', t('events.close'));
  header.append(title, close);

  const list = document.createElement('div');
  list.className = 'events-list';
  panel.append(header, list);
  const host = document.getElementById('bottom-controls') ?? document.body;
  host.append(toggle, panel);

  const setOpen = (open: boolean): void => {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) {
      render();
      close.focus();
    } else if (document.activeElement === close) {
      toggle.focus();
    }
  };

  const render = (): void => {
    title.textContent = t('events.title');
    toggle.textContent = createButtonLabel();
    toggle.setAttribute('aria-label', t('events.open'));
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

  toggle.addEventListener('click', () => setOpen(panel.hidden === true));
  close.addEventListener('click', () => setOpen(false));
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  });
  onLocaleChange(render);
  render();

  return {
    refresh: render,
    dispose: () => {
      toggle.remove();
      panel.remove();
    },
  };
}
