import { flattenBodies } from '@/config/catalog';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { onLocaleChange } from '@/i18n';
import { bodyDisplayName } from '@/i18n/bodyText';
import type { SceneSystem } from '@/components/systems/SceneSystem';
import type { ExploHud } from './exploHud';
import { hexToRgbTriplet } from './bodyAccent';
import type { OverlayCoordinator } from './overlayCoordinator';

/** Construit les lignes d'un dépliant « Choisir… » : une case à cocher par corps. */
function buildPickerRows(
  container: HTMLElement,
  bodies: readonly [string, { orbitalColor: number }][],
  isVisible: (name: string) => boolean,
  onChange: (name: string, visible: boolean) => void,
  withDot: boolean
): void {
  container.replaceChildren();
  for (const [name, cfg] of bodies) {
    const row = document.createElement('label');
    row.className = 'oo-row';

    if (withDot) {
      const rgb = hexToRgbTriplet(cfg.orbitalColor);
      row.style.setProperty('--orbit-rgb', rgb);
      const dot = document.createElement('span');
      dot.className = 'oo-dot';
      row.append(dot);
    }

    const nameEl = document.createElement('span');
    nameEl.className = 'oo-name';
    nameEl.textContent = bodyDisplayName(name);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'oo-checkbox';
    checkbox.checked = isVisible(name);
    checkbox.addEventListener('change', () => {
      onChange(name, checkbox.checked);
    });

    row.append(nameEl, checkbox);
    container.append(row);
  }
}

export function setupOrbitOptions(
  sceneSystem: SceneSystem,
  exploHud: Pick<ExploHud, 'setLabelsVisible' | 'setHiddenNames'>,
  coordinator?: OverlayCoordinator
): void {
  const panel = document.getElementById('orbit-options');
  if (!panel) return;

  const labelsBodyEl = panel.querySelector<HTMLElement>('#labels-picker-body');
  const bodiesBodyEl = panel.querySelector<HTMLElement>('#bodies-picker-body');
  const orbitsBodyEl = panel.querySelector<HTMLElement>('#orbits-picker-body');
  if (!labelsBodyEl || !bodiesBodyEl || !orbitsBodyEl) return;

  // Même liste de corps pour les trois dépliants : tout ce qui a une ligne d'orbite
  // (planètes, lunes, naines texturées, petits corps du catalogue) hors étoile/skybox —
  // le Soleil reste toujours affiché, pas de case à cocher pour lui.
  const configs = flattenBodies(CELESTIAL_CONFIG);
  const orbitNames = new Set(sceneSystem.orbitBodyNames());
  const bodies = [...configs.entries()].filter(
    ([name, cfg]) =>
      orbitNames.has(name) && cfg.kind !== 'skybox' && cfg.kind !== 'star'
  );

  // ── Bascule + dépliant « Noms & marqueurs » ──────────────────────────────
  const labelsToggle = panel.querySelector<HTMLInputElement>('#labels-visible');
  const hiddenLabelNames = new Set<string>();
  const applyHiddenLabelNames = (): void =>
    exploHud.setHiddenNames(new Set(hiddenLabelNames));
  labelsToggle?.addEventListener('change', () => {
    exploHud.setLabelsVisible(labelsToggle.checked);
  });
  exploHud.setLabelsVisible(labelsToggle?.checked ?? true);
  applyHiddenLabelNames();

  function buildLabelRows(): void {
    buildPickerRows(
      labelsBodyEl!,
      bodies,
      (name) => !hiddenLabelNames.has(name),
      (name, visible) => {
        if (visible) hiddenLabelNames.delete(name);
        else hiddenLabelNames.add(name);
        applyHiddenLabelNames();
      },
      false
    );
  }

  // ── Bascule + dépliant « Corps » ─────────────────────────────────────────
  const bodiesToggle = panel.querySelector<HTMLInputElement>('#bodies-visible');
  bodiesToggle?.addEventListener('change', () => {
    sceneSystem.setBodyMasterEnabled(bodiesToggle.checked);
  });
  sceneSystem.setBodyMasterEnabled(bodiesToggle?.checked ?? true);

  function buildBodyRows(): void {
    buildPickerRows(
      bodiesBodyEl!,
      bodies,
      () => true, // tous visibles par défaut ; l'état vit dans SceneSystem, pas ici.
      (name, visible) => sceneSystem.setBodyVisible(name, visible),
      false
    );
  }

  // ── Bascule + dépliant « Orbites » (comportement historique inchangé) ───
  const orbitsToggle = panel.querySelector<HTMLInputElement>('#orbits-visible');
  orbitsToggle?.addEventListener('change', () => {
    sceneSystem.setOrbitMasterEnabled(orbitsToggle.checked);
  });
  sceneSystem.setOrbitMasterEnabled(orbitsToggle?.checked ?? true);

  // Le picker compact expose toutes les orbites générées. Seules les planètes majeures
  // sont visibles au départ ; lunes, naines, astéroïdes et comètes restent en opt-in.
  const orbitState = new Map<string, boolean>(
    bodies.map(([name, cfg]) => [name, cfg.kind === 'planet'])
  );
  for (const [name, visible] of orbitState) {
    sceneSystem.setBodyOrbitVisible(name, visible);
  }
  const panelNames = new Set(orbitState.keys());
  for (const name of sceneSystem.orbitBodyNames()) {
    if (!panelNames.has(name)) sceneSystem.setBodyOrbitVisible(name, false);
  }

  function buildOrbitRows(): void {
    buildPickerRows(
      orbitsBodyEl!,
      bodies,
      (name) => orbitState.get(name) ?? false,
      (name, visible) => {
        orbitState.set(name, visible);
        sceneSystem.setBodyOrbitVisible(name, visible);
      },
      true
    );
  }

  function buildAllRows(): void {
    buildLabelRows();
    buildBodyRows();
    buildOrbitRows();
  }
  buildAllRows();
  onLocaleChange(buildAllRows);

  // Surface contextuelle : ouverte par le déclencheur du dock, fermée par sa croix,
  // le scrim ou une autre surface (coordinateur). Démarre masquée.
  const triggerBtn =
    document.querySelector<HTMLButtonElement>('#settings-trigger');
  const closeBtn = panel.querySelector<HTMLButtonElement>('.surface-close');
  let open = false;

  const setOpen = (next: boolean): void => {
    open = next;
    if (open) coordinator?.requestOpen('orbit-options');
    panel.hidden = !open;
    triggerBtn?.setAttribute('aria-expanded', String(open));
  };
  coordinator?.register('orbit-options', () => setOpen(false));

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
