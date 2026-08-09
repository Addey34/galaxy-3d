import {
  NextGlobalSolarEclipse,
  NextLunarEclipse,
  NextMoonQuarter,
  SearchGlobalSolarEclipse,
  SearchLunarEclipse,
  SearchMoonQuarter,
  type EclipseKind,
} from 'astronomy-engine';

export type AstronomicalEventKind =
  | 'new-moon'
  | 'first-quarter'
  | 'full-moon'
  | 'third-quarter'
  | 'solar-eclipse'
  | 'lunar-eclipse';

export interface AstronomicalEvent {
  kind: AstronomicalEventKind;
  date: Date;
  eclipseKind?: EclipseKind;
}

export interface AstronomicalEventOptions {
  count?: number;
  horizonDays?: number;
}

const DEFAULT_COUNT = 8;
const DEFAULT_HORIZON_DAYS = 730;
const QUARTER_KINDS: AstronomicalEventKind[] = [
  'new-moon',
  'first-quarter',
  'full-moon',
  'third-quarter',
];
const DAY_MS = 86_400_000;

function addMoonQuarters(
  events: AstronomicalEvent[],
  start: Date,
  end: Date
): void {
  let quarter = SearchMoonQuarter(start);
  while (quarter.time.date <= end) {
    if (quarter.time.date > start) {
      events.push({
        kind: QUARTER_KINDS[quarter.quarter] ?? 'new-moon',
        date: new Date(quarter.time.date),
      });
    }
    quarter = NextMoonQuarter(quarter);
  }
}

function addSolarEclipses(
  events: AstronomicalEvent[],
  start: Date,
  end: Date
): void {
  let eclipse = SearchGlobalSolarEclipse(start);
  while (eclipse.peak.date <= end) {
    if (eclipse.peak.date > start) {
      events.push({
        kind: 'solar-eclipse',
        date: new Date(eclipse.peak.date),
        eclipseKind: eclipse.kind,
      });
    }
    eclipse = NextGlobalSolarEclipse(eclipse.peak);
  }
}

function addLunarEclipses(
  events: AstronomicalEvent[],
  start: Date,
  end: Date
): void {
  let eclipse = SearchLunarEclipse(start);
  while (eclipse.peak.date <= end) {
    if (eclipse.peak.date > start) {
      events.push({
        kind: 'lunar-eclipse',
        date: new Date(eclipse.peak.date),
        eclipseKind: eclipse.kind,
      });
    }
    eclipse = NextLunarEclipse(eclipse.peak);
  }
}

/** Retourne les prochains événements célestes dans une fenêtre déterministe. */
export function findUpcomingAstronomicalEvents(
  startDate: Date,
  options: AstronomicalEventOptions = {}
): AstronomicalEvent[] {
  const count = Math.max(1, Math.floor(options.count ?? DEFAULT_COUNT));
  const horizonDays = Math.max(1, options.horizonDays ?? DEFAULT_HORIZON_DAYS);
  const start = new Date(startDate.getTime());
  const end = new Date(start.getTime() + horizonDays * DAY_MS);
  const events: AstronomicalEvent[] = [];

  addMoonQuarters(events, start, end);
  addSolarEclipses(events, start, end);
  addLunarEclipses(events, start, end);

  return events
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, count);
}
