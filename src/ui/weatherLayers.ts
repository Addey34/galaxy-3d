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
import { dataStatusFor, dataStatusLabelKey } from '@/core/dataStatus';
import type { PublicAPI } from '@/SolarSystemApp';
import type { WeatherLayerHandle } from './earthLayer';
import type { OverlayCoordinator } from './overlayCoordinator';

/**
 * Parse la date RÉELLE d'un candidat vers un Date UTC. Les couches exposent soit une date jour
 * `YYYY-MM-DD` (nuages, température), soit un instant ISO complet (pluie IMERG). Une date jour
 * seule est interprétée à midi UTC (évite les bascules de jour dues au fuseau). Renvoie null si
 * illisible → statut `unavailable`.
 */
function parseRealDate(realDate: string): Date | null {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(realDate)
    ? `${realDate}T12:00:00Z`
    : realDate;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

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

  const hasActiveSibling = (layerId: string): boolean =>
    exclusiveGroups.some(
      (group) =>
        group.includes(layerId) &&
        group.some((otherId) => otherId !== layerId && state.get(otherId) === true)
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
    for (const group of exclusiveGroups) {
      if (!group.includes(activeId)) continue;
      for (const otherId of group) {
        if (otherId === activeId) continue;
        if (state.get(otherId)) {
          state.set(otherId, false);
          byId.get(otherId)?.setVisible(false);
        }
      }
    }
    buildRows();
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
      row.append(checkbox, nameEl);

      // Détail (légende + note) : visible seulement quand la couche est active.
      const detail = document.createElement('div');
      detail.className = 'wl-detail';

      if (layer.legendUrl) {
        // Fond clair : la légende SVG GIBS a un texte sombre (conçu pour fond blanc).
        const legend = document.createElement('img');
        legend.className = 'wl-legend';
        legend.src = layer.legendUrl;
        legend.alt = t(layer.labelKey);
        legend.loading = 'lazy';
        detail.append(legend);
      }
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
        lo.textContent = t(grad.loKey);
        const hi = document.createElement('span');
        hi.textContent = t(grad.hiKey);
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

      // Badge de traçabilité (étape B) : source réelle · date chargée · STATUT temporel honnête
      // (observé/analyse/prévision/…) · (approché). Mis à jour à chaque résolution du socle
      // (fallback en chaîne). Absent si la couche n'expose rien.
      if (layer.onResolved) {
        const badge = document.createElement('p');
        badge.className = 'wl-source';
        layer.onResolved((c) => {
          const status = t(dataStatusLabelKey(dataStatusFor(parseRealDate(c.realDate))));
          const approx = c.approx ? ` · ${t('weather.source.approx')}` : '';
          badge.textContent = `${t('weather.source.prefix')} ${c.label} · ${c.realDate.slice(0, 10)} · ${status}${approx}`;
          syncDetail();
        });
        detail.append(badge);
      }
      checkbox.addEventListener('change', () => {
        state.set(layer.id, checkbox.checked);
        // Exclusivité : activer une couche d'un groupe désactive les autres du même groupe.
        if (checkbox.checked) {
          applyExclusivity(layer.id);
          layer.setVisible(true);
        } else {
          layer.setVisible(false);
        }
        // L'activation de la température estompe nuages/pluie (et inversement).
        if (layer.id === 'thermal') applyThermalInteraction();
        syncDetail();
      });
      syncDetail();

      item.append(row, detail);
      bodyEl!.append(item);
    }
  }

  buildRows();
  onLocaleChange(buildRows);

  // Surface contextuelle (dock) : même choreographie que orbitOptions.
  const triggerBtn = document.querySelector<HTMLButtonElement>('#weather-trigger');
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
