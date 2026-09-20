/**
 * Panneau des COUCHES MÉTÉO de la Terre : un toggle ON/OFF par couche visible depuis
 * l'espace (nuages GIBS, pluie/orages IMERG, vent Open-Meteo, température de surface MERRA-2).
 * Calqué sur `orbitOptions` : surface contextuelle du dock (ouverte par son déclencheur,
 * fermée par la croix / le scrim / Échap via le coordinateur), rangées construites en JS,
 * re-traduites sur changement de locale.
 *
 * Le panneau est PILOTÉ PAR LES DONNÉES : il itère sur les `WeatherLayerHandle` que le
 * registre lui passe (libellé/note/légende/visibilité viennent de chaque couche). Ajouter
 * une couche ne touche plus ce fichier. Chaque toggle ne fait que MONTRER/MASQUER une couche
 * déjà chargée — la donnée continue de se rafraîchir en fond quel que soit l'état du toggle.
 */
import { t, onLocaleChange } from '@/i18n';
import type { SourceCandidate } from '@/core/layerSource';
import type { MeteoLayerDiagnostics } from '@/core/meteoDiagnostics';
import type { PublicAPI } from '@/SolarSystemApp';
import type { WeatherLayerHandle } from './earthLayer';
import type { OverlayCoordinator } from './overlayCoordinator';
import { sourceBadgeText } from './sourceBadge';

export interface WeatherLayersDeps {
  /** Couches à exposer, dans l'ordre d'affichage (voir le registre dans MainSolarSystemApp). */
  layers: WeatherLayerHandle[];
  /**
   * Groupes de couches MUTUELLEMENT EXCLUSIVES (par `id`) : activer l'une désactive les autres du
   * même groupe. Ex. nuages satellite ↔ modèle qui partagent le mesh nuages.
   */
  exclusiveGroups?: string[][];
}

export function setupWeatherLayers(
  api: PublicAPI,
  deps: WeatherLayersDeps,
  coordinator?: OverlayCoordinator
): void {
  const panel = document.getElementById('weather-layers');
  if (!panel) return;
  const bodyEl = panel.querySelector<HTMLElement>('.wl-body');
  if (!bodyEl) return;

  const layers = deps.layers;
  const byId = new Map(layers.map((l) => [l.id, l]));
  const exclusiveGroups = deps.exclusiveGroups ?? [];
  const state = new Map<string, boolean>(layers.map((l) => [l.id, l.initial]));
  const loadState = new Map<string, MeteoLayerDiagnostics['phase']>(
    layers.map((l) => [l.id, 'idle'])
  );
  // Badge de traçabilité par couche : la dernière source résolue et l'élément qui l'affiche.
  // La catégorie temporelle et l'écart à la scène dépendent de la date de la SCÈNE : une tuile
  // J-2 est « observée » et sans écart au présent, mais décalée pour une scène en 2030 sans
  // qu'aucune nouvelle source ne soit résolue (le jour servi reste le même).
  const badges = new Map<
    string,
    { el: HTMLElement | null; candidate: SourceCandidate | null }
  >();
  const renderBadge = (layerId: string): void => {
    const badge = badges.get(layerId);
    if (!badge?.el || !badge.candidate) return;
    const text = sourceBadgeText(
      badge.candidate,
      api.orbitalMechanics.simulationDate,
      new Date(),
      t
    );
    if (badge.el.textContent !== text) badge.el.textContent = text;
  };
  let lastBadgeCheck = 0;
  api.animationSystem.onFrame(() => {
    const at = performance.now();
    if (at - lastBadgeCheck < 500) return;
    lastBadgeCheck = at;
    for (const layerId of badges.keys()) renderBadge(layerId);
  });

  const controls = new Map<
    string,
    { checkbox: HTMLInputElement; loading: HTMLElement }
  >();

  const syncLoading = (layerId: string): void => {
    const control = controls.get(layerId);
    if (!control) return;
    const isLoading = loadState.get(layerId) === 'loading';
    control.checkbox.disabled = isLoading;
    control.checkbox.setAttribute('aria-busy', String(isLoading));
    control.loading.hidden = !isLoading;
  };

  for (const layer of layers) {
    layer.onLoadStateChange?.((phase) => {
      loadState.set(layer.id, phase);
      syncLoading(layer.id);
    });
  }

  const hasActiveSibling = (layerId: string): boolean =>
    exclusiveGroups.some(
      (group) =>
        group.includes(layerId) &&
        group.some(
          (otherId) => otherId !== layerId && state.get(otherId) === true
        )
    );

  // Active d'abord les couches initiales. Une couche inactive qui partage un mesh avec une couche
  // active ne doit pas masquer ce mesh pendant l'initialisation.
  for (const layer of layers) {
    if (layer.initial) layer.setVisible(true);
  }
  for (const layer of layers) {
    if (!layer.initial && !hasActiveSibling(layer.id)) layer.setVisible(false);
  }

  /**
   * Désactive (état + couche) les AUTRES couches des groupes exclusifs contenant `activeId`.
   * Les rangées visibles sont resynchronisées par un `buildRows()` de l'appelant si nécessaire.
   */
  const applyExclusivity = (activeId: string): void => {
    let changed = false;
    for (const group of exclusiveGroups) {
      if (!group.includes(activeId)) continue;
      for (const otherId of group) {
        if (otherId === activeId) continue;
        if (state.get(otherId)) {
          state.set(otherId, false);
          byId.get(otherId)?.setVisible(false);
          changed = true;
        }
      }
    }
    if (changed) buildRows();
  };

  // Interaction entre couches : quand l'overlay TEMPÉRATURE est actif, on estompe nuages et
  // pluie (facteur DIM) pour que la donnée thermique reste lisible ; sinon on les restaure.
  // Piloté ici (le panneau connaît l'état de tous les toggles). No-op si la Terre est absente
  // ou si la couche pluie/nuages n'existe pas.
  const earth = api.sceneSystem.getBody('earth');
  const DIM = 0.35;
  const applyThermalInteraction = (): void => {
    if (!earth) return;
    const dim = state.get('thermal') ? DIM : 1;
    earth.setLayerOpacityScale('clouds', dim);
    earth.setLayerOpacityScale('precip', dim);
  };
  applyThermalInteraction();

  function buildRows(): void {
    controls.clear();
    bodyEl!.replaceChildren();
    for (const layer of layers) {
      // Conteneur : la ligne (switch) + un détail (légende/texte) replié sous elle.
      const item = document.createElement('div');
      item.className = 'wl-item';

      const row = document.createElement('label');
      row.className = 'wl-row settings-switch';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'oo-checkbox settings-checkbox';
      checkbox.checked = state.get(layer.id) ?? layer.initial;

      const nameEl = document.createElement('span');
      nameEl.className = 'settings-switch-label';
      nameEl.textContent = t(layer.labelKey);
      const loading = document.createElement('span');
      loading.className = 'wl-loading';
      loading.textContent = t('weather.loading');
      loading.hidden = true;
      loading.setAttribute('aria-live', 'polite');
      row.append(checkbox, nameEl, loading);
      controls.set(layer.id, { checkbox, loading });

      // Détail (légende + note) : visible seulement quand la couche est active.
      const detail = document.createElement('div');
      detail.className = 'wl-detail';

      if (layer.legendGradient) {
        // Barre de dégradé CSS (couche dont on maîtrise la palette) + libellés min/max.
        const grad = layer.legendGradient;
        const wrap = document.createElement('div');
        wrap.className = 'wl-legend-grad';
        const bar = document.createElement('div');
        bar.className = 'wl-legend-bar';
        bar.style.background = grad.css;
        const labels = document.createElement('div');
        labels.className = 'wl-legend-labels';
        const lo = document.createElement('span');
        // Une borne DÉRIVÉE d'une donnée (barème GIBS) arrive en texte déjà rendu ; une borne
        // rédigée vit dans le dictionnaire. Jamais les deux pour la même légende.
        lo.textContent = grad.loText ?? (grad.loKey ? t(grad.loKey) : '');
        const hi = document.createElement('span');
        hi.textContent = grad.hiText ?? (grad.hiKey ? t(grad.hiKey) : '');
        labels.append(lo, hi);
        wrap.append(bar, labels);
        detail.append(wrap);
      }
      if (layer.noteKey) {
        const note = document.createElement('p');
        note.className = 'wl-note';
        note.textContent = t(layer.noteKey);
        detail.append(note);
      }

      const syncDetail = (): void => {
        detail.hidden = !checkbox.checked || detail.childElementCount === 0;
      };

      // Badge de traçabilité : source réelle · date chargée · catégorie temporelle · écart à la
      // scène · (approché). Mis à jour à chaque résolution du socle (fallback en chaîne) ET quand
      // la scène change de date (`renderBadge`). Absent si la couche n'expose rien.
      if (layer.onResolved) {
        const badge = document.createElement('p');
        badge.className = 'wl-source';
        const entry = badges.get(layer.id) ?? { el: null, candidate: null };
        entry.el = badge;
        badges.set(layer.id, entry);
        renderBadge(layer.id);
        layer.onResolved((c) => {
          entry.candidate = c;
          renderBadge(layer.id);
          syncDetail();
        });
        detail.append(badge);
      }
      checkbox.addEventListener('change', () => {
        state.set(layer.id, checkbox.checked);
        // Exclusivité : activer une couche d'un groupe désactive les autres du même groupe.
        if (checkbox.checked) {
          layer.setVisible(true);
          applyExclusivity(layer.id);
        } else {
          layer.setVisible(false);
        }
        // L'activation de la température estompe nuages/pluie (et inversement).
        if (layer.id === 'thermal') applyThermalInteraction();
        syncDetail();
      });
      syncDetail();
      syncLoading(layer.id);

      item.append(row, detail);
      bodyEl!.append(item);
    }
  }

  buildRows();
  onLocaleChange(buildRows);

  // Surface contextuelle (dock) : même choreographie que orbitOptions.
  const triggerBtn =
    document.querySelector<HTMLButtonElement>('#weather-trigger');
  const closeBtn = panel.querySelector<HTMLButtonElement>('.surface-close');
  let open = false;

  const setOpen = (next: boolean): void => {
    open = next;
    if (open) coordinator?.requestOpen('weather-layers');
    panel.hidden = !open;
    triggerBtn?.setAttribute('aria-expanded', String(open));
  };
  coordinator?.register('weather-layers', () => setOpen(false));

  triggerBtn?.addEventListener('click', () => setOpen(!open));
  closeBtn?.addEventListener('click', () => setOpen(false));
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      triggerBtn?.focus();
    }
  });

  setOpen(false);
}
