/**
 * LA FICHE D'UN SATELLITE (GAL-SATELLITE-SELECTION-001) : ce que disent les éléments de CelesTrak d'un
 * objet en orbite, et ce que SGP4 en tire à la date de la scène. Dans le morceau de la couche des
 * satellites : elle n'existe pas avant que la couche soit allumée.
 *
 * Honnêteté, dite sur la fiche : les éléments sont une orbite moyenne à UNE époque, propagée par SGP4,
 * valable sept jours de chaque côté (au-delà l'objet n'est pas dessiné) ; l'altitude, la vitesse et le
 * point survolé sont CALCULÉS par SGP4, pas mesurés. Un objet sans modèle 3D (tous, sauf l'ISS) n'en
 * reçoit pas d'inventé : la fiche le dit. Pour l'ISS, un bouton ouvre l'inspection 3D.
 */
import { loadDeferredMessages } from '@/i18n/deferredMessages';
import { getLocale, onLocaleChange, t } from '@/i18n';
import {
  orbitSummary,
  validityWindow,
  type OrbitSummary,
  type SatelliteElements,
} from '@/core/satellites';
import { getAnnouncer } from './announcer';
import type { CraftOpener } from './craftAccess';
import type { OverlayCoordinator } from './overlayCoordinator';
import { syncSurfaceFocus } from './surfaceFocus';

/** Le numéro NORAD de l'ISS : le seul objet de la couche qui a un modèle 3D. */
export const ISS_NORAD_ID = 25544;

/** Ce que la fiche sait d'un objet à une date : les éléments, et la propagation quand ils valent. */
export interface SatelliteInfo {
  elements: SatelliteElements;
  epochMs: number;
  /** Les éléments valent à la date de la scène. */
  valid: boolean;
  /** Altitude, vitesse et point survolé calculés par SGP4 ; absents hors validité ou sans solution. */
  now: {
    altitudeKm: number;
    speedKmS: number;
    latitudeDeg: number;
    longitudeDeg: number;
  } | null;
  /** Instant où le service de données a lu CelesTrak, ISO 8601 UTC. */
  fetchedAt: string;
}

export interface SatelliteCard {
  open(id: number, opener?: HTMLElement | null): void;
  close(): void;
  /** À appeler à chaque image : met à jour les valeurs vivantes, deux fois par seconde au plus. */
  tick(): void;
  readonly selected: number | null;
}

interface Options {
  coordinator: OverlayCoordinator;
  canvas: HTMLElement;
  /** Lit ce que la couche sait de cet objet à la date de la scène, ou `null` s'il n'existe pas. */
  info: (id: number) => SatelliteInfo | null;
  /** La sélection a changé (pour peindre l'anneau). */
  onSelect: (id: number | null) => void;
  openCraft?: CraftOpener;
}

function format(value: number, digits: number): string {
  return new Intl.NumberFormat(getLocale(), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function day(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function instant(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}

function fact(label: string, value: string): HTMLElement[] {
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = value;
  return [dt, dd];
}

function degrees(value: number, positive: string, negative: string): string {
  return `${format(Math.abs(value), 2)}° ${value >= 0 ? positive : negative}`;
}

export async function setupSatelliteCard(
  options: Options
): Promise<SatelliteCard> {
  const { coordinator, canvas, info, onSelect, openCraft } = options;
  // Les phrases de la fiche sont hors démarrage : `t()` rendrait les clés brutes sans elles.
  await loadDeferredMessages();

  let current: number | null = null;
  let opener: HTMLElement | null = null;
  let renderedKey = '';

  const card = document.createElement('aside');
  card.id = 'satellite-card';
  card.className = 'surface surface--info surface--exoplanet';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-labelledby', 'satellite-card-name');
  card.hidden = true;

  const header = document.createElement('header');
  header.className = 'bi-header';
  const heading = document.createElement('div');
  heading.className = 'bi-heading';
  const name = document.createElement('h2');
  name.className = 'bi-name';
  name.id = 'satellite-card-name';
  const subtitle = document.createElement('p');
  subtitle.className = 'bi-subtitle';
  heading.append(name, subtitle);
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'bi-close surface-close';
  closeButton.innerHTML =
    '<svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  header.append(heading, closeButton);

  const body = document.createElement('div');
  body.className = 'surface-body exo-body';
  // Une zone qui défile doit s'atteindre au clavier (axe : scrollable-region-focusable), et se nommer.
  body.tabIndex = 0;
  body.setAttribute('role', 'region');
  body.setAttribute('aria-labelledby', 'satellite-card-name');
  const status = document.createElement('p');
  status.className = 'exo-source sat-status';
  status.setAttribute('role', 'status');
  const live = document.createElement('dl');
  live.className = 'exo-facts sat-live';
  const facts = document.createElement('dl');
  facts.className = 'exo-facts';
  const inspect = document.createElement('button');
  inspect.type = 'button';
  inspect.className = 'settings-button';
  inspect.id = 'satellite-card-inspect';
  const model = document.createElement('p');
  model.className = 'exo-source';
  const source = document.createElement('p');
  source.className = 'exo-source';
  body.append(status, live, facts, inspect, model, source);
  card.append(header, body);
  document.body.append(card);

  /** Les lignes qui ne changent que d'objet ou de langue : identité, orbite, validité. */
  function renderStatic(data: SatelliteInfo): void {
    const e = data.elements;
    const s: OrbitSummary = orbitSummary(e);
    const unknown = t('sat.unknown');
    const window_ = validityWindow(data.epochMs);
    name.textContent = e.name;
    subtitle.textContent = [
      t('sat.kind'),
      e.group ? t(`sat.group.${e.group}`) : null,
    ]
      .filter(Boolean)
      .join(' · ');
    closeButton.setAttribute('aria-label', t('surface.close'));
    facts.replaceChildren(
      ...fact(t('sat.norad'), String(e.id)),
      ...fact(t('sat.designator'), e.designator ?? unknown),
      ...fact(
        t('sat.period'),
        t('sat.minutes', { n: format(s.periodMinutes, 2) })
      ),
      ...fact(
        t('sat.altitudes'),
        t('sat.altitudesValue', {
          perigee: format(s.perigeeKm, 0),
          apogee: format(s.apogeeKm, 0),
        })
      ),
      ...fact(t('sat.inclination'), `${format(s.inclinationDeg, 2)}°`),
      ...fact(t('sat.eccentricity'), format(s.eccentricity, 5)),
      ...fact(
        t('sat.epoch'),
        `${instant(new Date(data.epochMs).toISOString())} UTC`
      ),
      ...fact(
        t('sat.validity'),
        t('sat.validityValue', {
          from: day(window_.fromMs),
          to: day(window_.toMs),
        })
      )
    );
    const isIss = e.id === ISS_NORAD_ID && !!openCraft;
    inspect.hidden = !isIss;
    inspect.textContent = t('craft.button');
    model.textContent = isIss ? t('sat.model.iss') : t('sat.model.none');
    source.textContent = t('sat.source', { date: instant(data.fetchedAt) });
  }

  /** Les lignes vivantes : altitude, vitesse, point survolé, et l'état à la date de la scène. */
  function renderLive(data: SatelliteInfo): void {
    const n = data.now;
    status.textContent = data.valid ? '' : t('sat.outside');
    status.hidden = data.valid;
    live.replaceChildren(
      ...(n
        ? [
            ...fact(
              t('sat.altitude'),
              t('sat.km', { n: format(n.altitudeKm, 0) })
            ),
            ...fact(
              t('sat.speed'),
              t('sat.kmPerS', { n: format(n.speedKmS, 2) })
            ),
            ...fact(
              t('sat.over'),
              `${degrees(n.latitudeDeg, 'N', 'S')}, ${degrees(n.longitudeDeg, 'E', 'W')}`
            ),
          ]
        : [])
    );
    live.hidden = !n;
  }

  function render(): void {
    if (current === null) return;
    const data = info(current);
    if (!data) {
      close();
      return;
    }
    renderedKey = `${current}:${getLocale()}`;
    renderStatic(data);
    renderLive(data);
  }

  function close(): void {
    if (card.hidden) return;
    card.hidden = true;
    current = null;
    renderedKey = '';
    onSelect(null);
    syncSurfaceFocus(false, card, opener);
    opener = null;
  }

  function open(id: number, openerHint?: HTMLElement | null): void {
    if (!card.hidden && current === id) return;
    opener =
      openerHint ??
      (document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
        ? document.activeElement
        : canvas);
    current = id;
    onSelect(id);
    render();
    if (current === null) return;
    coordinator.requestOpen('satellite-card');
    card.hidden = false;
    syncSurfaceFocus(true, card, opener);
    const data = info(id);
    if (data)
      getAnnouncer().announce(t('sat.opened', { name: data.elements.name }));
  }

  coordinator.register('satellite-card', () => {
    if (!card.hidden) {
      card.hidden = true;
      current = null;
      renderedKey = '';
      opener = null;
      onSelect(null);
    }
  });
  closeButton.addEventListener('click', close);
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  });
  inspect.addEventListener('click', () => {
    if (current === ISS_NORAD_ID) openCraft?.('iss-b', inspect);
  });
  onLocaleChange(() => {
    void loadDeferredMessages().then(() => {
      renderedKey = '';
      render();
    });
  });

  let last = 0;
  return {
    open,
    close,
    tick() {
      if (card.hidden || current === null) return;
      const at = performance.now();
      if (at - last < 500) return;
      last = at;
      const data = info(current);
      if (!data) return close();
      if (renderedKey !== `${current}:${getLocale()}`) renderStatic(data);
      renderLive(data);
    },
    get selected(): number | null {
      return current;
    },
  };
}
