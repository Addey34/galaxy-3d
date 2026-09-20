/**
 * Panneau des ÉVÉNEMENTS TERRESTRES (`#earth-events`) : un interrupteur par couche
 * (séismes USGS, événements naturels NASA EONET), son badge de traçabilité et la liste des
 * événements réellement peints.
 *
 * Calqué sur `weatherLayers.ts` — surface contextuelle du dock, rangées construites en JS,
 * re-traduites au changement de langue — avec UNE différence assumée : ici, une couche éteinte
 * ne demande RIEN. Le socle daté (`createDatedDataLayer`) n'est créé qu'à la première
 * activation et détruit à l'extinction. Le panneau météo, lui, garde ses couches vivantes en
 * fond ; ce n'est pas le même marché avec la source, et un service public interrogé pour un
 * affichage que personne n'a demandé n'est pas un bon voisin. `e2e/earthEvents.spec.ts` mesure
 * qu'aucune requête ne part au démarrage.
 *
 * La LISTE n'est pas décorative : elle est le seul endroit où deux informations deviennent
 * visibles. La catégorie temporelle de CHAQUE événement (une mesure sismologique est
 * « observée », un événement EONET est « rapporté » — jamais la même chose), et le fait qu'un
 * événement rapporté n'ait pas de fin déclarée, qui s'écrit « en cours » plutôt que de se
 * combler par une date inventée.
 */
import { t, onLocaleChange, getLocale } from '@/i18n';
import { classifyTemporal, UNAVAILABLE_STAMP } from '@/core/temporal';
import { temporalCategoryLabelKey } from '@/core/temporal';
import type { SourceCandidate } from '@/core/layerSource';
import {
  topEvents,
  type EarthEvent,
  type EarthEventLayer,
  type EarthEventLayerId,
} from '@/core/earthEvents';
import { createDatedDataLayer } from './datedDataLayer';
import { sourceBadgeText } from './sourceBadge';
import type { EarthEventsOverlay } from './earthEventsOverlay';
import type { OverlayCoordinator } from './overlayCoordinator';
import type { PublicAPI } from '@/SolarSystemApp';

/** Nombre d'événements détaillés sous l'interrupteur. */
const LISTED_EVENTS = 5;

export function setupEarthEvents(
  api: PublicAPI,
  layers: readonly EarthEventLayer[],
  overlay: EarthEventsOverlay,
  coordinator?: OverlayCoordinator
): void {
  const panel = document.getElementById('earth-events');
  const triggerBtn = document.querySelector<HTMLButtonElement>(
    '#earth-events-trigger'
  );
  const bodyEl = panel?.querySelector<HTMLElement>('.ee-body') ?? null;

  const state = new Map<EarthEventLayerId, boolean>(
    layers.map((layer) => [layer.id, false])
  );
  const loaded = new Map<EarthEventLayerId, EarthEvent[]>();
  const candidates = new Map<EarthEventLayerId, SourceCandidate | null>();
  const loading = new Set<EarthEventLayerId>();
  /** Socle daté vivant d'une couche allumée — absent tant qu'elle ne l'a jamais été. */
  const running = new Map<EarthEventLayerId, () => void>();

  const start = (layer: EarthEventLayer): void => {
    if (running.has(layer.id)) return;
    // La date qui a PRODUIT la clé, et non celle de l'horloge au moment du chargement : entre
    // les deux, un voyage temporel rapide peut avoir changé de journée, et le lot serait alors
    // rangé sous une clé qu'il ne décrit pas.
    let keyDate = api.orbitalMechanics.simulationDate;
    const dispose = createDatedDataLayer(api, {
      name: `earth-events:${layer.id}`,
      enabled: true,
      keyForDate: (date) => {
        keyDate = date;
        return layer.keyForDate(date, new Date());
      },
      fetchForKey: (_key, signal) => layer.fetch(keyDate, new Date(), signal),
      apply: (batch) => {
        loaded.set(layer.id, batch.events);
        candidates.set(layer.id, batch.candidate);
        overlay.setEvents(layer.id, batch.events);
        syncAll();
      },
      onStateChange: (phase) => {
        if (phase === 'loading') loading.add(layer.id);
        else loading.delete(layer.id);
        syncAll();
      },
      // Les deux sources changent au plus une fois par jour simulé : inutile de réévaluer
      // la date plus souvent que le voyage temporel ne la déplace.
      checkIntervalMs: 2000,
    });
    running.set(layer.id, dispose);
  };

  const stop = (layerId: EarthEventLayerId): void => {
    running.get(layerId)?.();
    running.delete(layerId);
    loading.delete(layerId);
    // Et on OUBLIE le lot. Le garder ferait réapparaître, à la réactivation, les événements
    // d'une autre date si l'horloge a bougé entre-temps — pendant la seconde que met le
    // rechargement, la couche affirmerait quelque chose de faux.
    loaded.delete(layerId);
    candidates.delete(layerId);
    overlay.setEvents(layerId, []);
  };

  const formatDate = (ms: number): string =>
    new Date(ms).toISOString().slice(0, 10);

  /** Ligne de détail d'un événement : nom, date, catégorie temporelle, « en cours ». */
  const describe = (event: EarthEvent): string => {
    const stamp = classifyTemporal(
      event.product,
      api.orbitalMechanics.simulationDate,
      new Date()
    );
    const parts = [
      event.label,
      formatDate(event.product.validTime.from),
      t(temporalCategoryLabelKey(stamp.category)),
    ];
    if (stamp.ongoing) parts.push(t('earthEvents.ongoing'));
    return parts.join(' · ');
  };

  /**
   * Éléments d'une rangée, gardés pour les METTRE À JOUR plutôt que de reconstruire le
   * panneau. Reconstruire à chaque arrivée de données volerait le focus du clavier à qui
   * vient de cocher la case — la raison est d'accessibilité, pas de performance.
   */
  interface Row {
    detail: HTMLElement;
    busy: HTMLElement;
    badge: HTMLElement;
    list: HTMLElement;
    empty: HTMLElement;
  }
  const rows = new Map<EarthEventLayerId, Row>();

  function syncRow(layer: EarthEventLayer): void {
    const row = rows.get(layer.id);
    if (!row) return;
    row.detail.hidden = state.get(layer.id) !== true;
    row.busy.hidden = !loading.has(layer.id);

    const candidate = candidates.get(layer.id) ?? null;
    row.badge.textContent = candidate
      ? sourceBadgeText(
          candidate,
          api.orbitalMechanics.simulationDate,
          new Date(),
          t
        )
      : `${t('weather.source.prefix')} ${t(
          temporalCategoryLabelKey(UNAVAILABLE_STAMP.category)
        )}`;

    const events = loaded.get(layer.id) ?? [];
    row.empty.hidden = events.length > 0;
    row.list.replaceChildren();
    for (const event of topEvents(events, LISTED_EVENTS)) {
      const entry = document.createElement('li');
      entry.textContent = describe(event);
      row.list.append(entry);
    }
  }

  const syncAll = (): void => {
    for (const layer of layers) syncRow(layer);
  };

  function build(): void {
    if (!bodyEl) return;
    rows.clear();
    bodyEl.replaceChildren();
    for (const layer of layers) {
      const item = document.createElement('div');
      item.className = 'ee-item';

      const row = document.createElement('label');
      row.className = 'ee-row settings-switch';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'oo-checkbox settings-checkbox';
      checkbox.checked = state.get(layer.id) === true;

      const name = document.createElement('span');
      name.className = 'settings-switch-label';
      name.textContent = t(layer.labelKey);

      const busy = document.createElement('span');
      busy.className = 'ee-loading';
      busy.textContent = t('earthEvents.loading');
      busy.setAttribute('aria-live', 'polite');

      row.append(checkbox, name, busy);

      const detail = document.createElement('div');
      detail.className = 'ee-detail';

      const note = document.createElement('p');
      note.className = 'ee-note';
      note.textContent = t(layer.noteKey, layer.noteVars);

      const badge = document.createElement('p');
      badge.className = 'ee-source';

      const empty = document.createElement('p');
      empty.className = 'ee-note ee-empty';
      empty.textContent = t('earthEvents.empty');

      const list = document.createElement('ul');
      list.className = 'ee-list';

      detail.append(note, badge, empty, list);

      checkbox.addEventListener('change', () => {
        const on = checkbox.checked;
        state.set(layer.id, on);
        overlay.setLayerVisible(layer.id, on);
        if (on) start(layer);
        else stop(layer.id);
        syncRow(layer);
      });

      item.append(row, detail);
      bodyEl.append(item);
      rows.set(layer.id, { detail, busy, badge, list, empty });
      syncRow(layer);
    }
  }

  build();
  onLocaleChange(build);

  // La catégorie temporelle et l'écart à la scène dépendent de la DATE de la scène : un lot
  // inchangé change d'étiquette dès qu'on voyage dans le temps.
  let lastRender = 0;
  let lastDateKey = '';
  api.animationSystem.onFrame(() => {
    const at = performance.now();
    if (at - lastRender < 500) return;
    lastRender = at;
    const key = `${formatDate(
      api.orbitalMechanics.simulationDate.getTime()
    )}|${getLocale()}`;
    if (key === lastDateKey) return;
    lastDateKey = key;
    syncAll();
  });

  let open = false;
  const setOpen = (next: boolean): void => {
    open = next;
    if (open) coordinator?.requestOpen('earth-events');
    if (panel) panel.hidden = !open;
    triggerBtn?.setAttribute('aria-expanded', String(open));
  };
  coordinator?.register('earth-events', () => setOpen(false));
  triggerBtn?.addEventListener('click', () => setOpen(!open));
  panel
    ?.querySelector<HTMLButtonElement>('.surface-close')
    ?.addEventListener('click', () => setOpen(false));
  panel?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      triggerBtn?.focus();
    }
  });
  setOpen(false);
}
