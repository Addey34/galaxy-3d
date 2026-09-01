import { flattenBodies } from '@/config/catalog';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { onLocaleChange, t } from '@/i18n';
import { bodyDisplayName } from '@/i18n/bodyText';
import type { SceneSystem } from '@/components/systems/SceneSystem';
import type { ExploHud } from './exploHud';
import { bodyAccentColor, hexToRgbTriplet, onAccentChange } from './bodyAccent';
import type { OverlayCoordinator } from './overlayCoordinator';

interface RowCheckboxes {
  label: HTMLInputElement;
  body: HTMLInputElement;
  orbit: HTMLInputElement;
}

/** Une <td> avec sa case à cocher — la brique répétée trois fois par ligne du tableau. */
function buildToggleCell(
  checked: boolean,
  ariaLabel: string,
  onChange: (checked: boolean) => void
): { cell: HTMLTableCellElement; checkbox: HTMLInputElement } {
  const cell = document.createElement('td');
  cell.className = 'oo-td oo-td-toggle';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'oo-checkbox';
  checkbox.checked = checked;
  checkbox.setAttribute('aria-label', ariaLabel);
  checkbox.addEventListener('change', () => onChange(checkbox.checked));

  cell.append(checkbox);
  return { cell, checkbox };
}

export function setupOrbitOptions(
  sceneSystem: SceneSystem,
  exploHud: Pick<ExploHud, 'setHiddenNames'>,
  coordinator?: OverlayCoordinator
): void {
  const panel = document.getElementById('orbit-options');
  if (!panel) return;

  const tableBodyEl = panel.querySelector<HTMLElement>('#settings-table-body');
  const labelsToggle = panel.querySelector<HTMLInputElement>('#labels-visible');
  const bodiesToggle = panel.querySelector<HTMLInputElement>('#bodies-visible');
  const orbitsToggle = panel.querySelector<HTMLInputElement>('#orbits-visible');
  if (!tableBodyEl || !labelsToggle || !bodiesToggle || !orbitsToggle) return;

  // Une seule liste de corps pour les trois colonnes (tout ce qui a une ligne d'orbite —
  // planètes, lunes, naines texturées, petits corps du catalogue — hors étoile/skybox ;
  // le Soleil reste toujours affiché, pas de ligne pour lui).
  const configs = flattenBodies(CELESTIAL_CONFIG);
  const orbitNames = new Set(sceneSystem.orbitBodyNames());
  const bodies = [...configs.entries()].filter(
    ([name, cfg]) =>
      orbitNames.has(name) && cfg.kind !== 'skybox' && cfg.kind !== 'star'
  );

  const hiddenLabelNames = new Set<string>();
  const hiddenBodyNames = new Set<string>();
  // Seules les planètes majeures ont leur orbite visible au départ ; lunes, naines,
  // astéroïdes et comètes restent en opt-in (comportement historique inchangé).
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

  const isLabelVisible = (name: string): boolean => !hiddenLabelNames.has(name);
  const isBodyVisible = (name: string): boolean => !hiddenBodyNames.has(name);
  const isOrbitVisible = (name: string): boolean => orbitState.get(name) ?? false;

  const applyHiddenLabelNames = (): void =>
    exploHud.setHiddenNames(new Set(hiddenLabelNames));

  // Références aux cases de chaque ligne — permet à l'en-tête de colonne (tout cocher/décocher)
  // de mettre à jour les cases déjà rendues sans reconstruire tout le tableau (perd le focus/
  // le défilement sinon), et à une case individuelle de resynchroniser l'en-tête en retour.
  const rows = new Map<string, RowCheckboxes>();

  /**
   * Reflète l'état agrégé d'une colonne sur son en-tête : cochée si TOUS les corps sont
   * cochés, décochée si AUCUN ne l'est, indéterminée (tiret) sinon — sémantique standard
   * d'une case « tout cocher » de tableau.
   */
  function syncHeader(
    header: HTMLInputElement,
    isChecked: (name: string) => boolean
  ): void {
    const total = bodies.length;
    const checkedCount = bodies.filter(([name]) => isChecked(name)).length;
    header.checked = checkedCount === total;
    header.indeterminate = checkedCount > 0 && checkedCount < total;
  }

  // ── En-tête « Nom » : coche/décoche tous les corps, jamais un simple interrupteur caché ──
  labelsToggle.addEventListener('change', () => {
    const checked = labelsToggle.checked;
    for (const [name] of bodies) {
      if (checked) hiddenLabelNames.delete(name);
      else hiddenLabelNames.add(name);
      const row = rows.get(name);
      if (row) row.label.checked = checked;
    }
    applyHiddenLabelNames();
    labelsToggle.indeterminate = false;
  });

  // ── En-tête « Corps » ─────────────────────────────────────────────────────
  bodiesToggle.addEventListener('change', () => {
    const checked = bodiesToggle.checked;
    for (const [name] of bodies) {
      if (checked) hiddenBodyNames.delete(name);
      else hiddenBodyNames.add(name);
      sceneSystem.setBodyVisible(name, checked);
      const row = rows.get(name);
      if (row) row.body.checked = checked;
    }
    bodiesToggle.indeterminate = false;
  });

  // ── En-tête « Orbite » ────────────────────────────────────────────────────
  orbitsToggle.addEventListener('change', () => {
    const checked = orbitsToggle.checked;
    for (const [name] of bodies) {
      orbitState.set(name, checked);
      sceneSystem.setBodyOrbitVisible(name, checked);
      const row = rows.get(name);
      if (row) row.orbit.checked = checked;
    }
    orbitsToggle.indeterminate = false;
  });

  applyHiddenLabelNames();

  function buildTableRows(): void {
    tableBodyEl!.replaceChildren();
    rows.clear();
    for (const [name, cfg] of bodies) {
      const display = bodyDisplayName(name);
      const row = document.createElement('tr');
      row.className = 'oo-tr';

      const nameCell = document.createElement('td');
      nameCell.className = 'oo-td oo-td-name';
      const nameInner = document.createElement('span');
      nameInner.className = 'oo-td-name-inner';
      const rgb = hexToRgbTriplet(bodyAccentColor(cfg, name));
      const dot = document.createElement('span');
      dot.className = 'oo-dot';
      dot.style.setProperty('--orbit-rgb', rgb);
      const nameEl = document.createElement('span');
      nameEl.className = 'oo-name';
      nameEl.textContent = display;
      nameInner.append(dot, nameEl);
      nameCell.append(nameInner);

      const { cell: labelCell, checkbox: labelCheckbox } = buildToggleCell(
        isLabelVisible(name),
        t('settings.row.name.aria', { name: display }),
        (checked) => {
          if (checked) hiddenLabelNames.delete(name);
          else hiddenLabelNames.add(name);
          applyHiddenLabelNames();
          syncHeader(labelsToggle!, isLabelVisible);
        }
      );

      const { cell: bodyCell, checkbox: bodyCheckbox } = buildToggleCell(
        isBodyVisible(name),
        t('settings.row.body.aria', { name: display }),
        (checked) => {
          if (checked) hiddenBodyNames.delete(name);
          else hiddenBodyNames.add(name);
          sceneSystem.setBodyVisible(name, checked);
          syncHeader(bodiesToggle!, isBodyVisible);
        }
      );

      const { cell: orbitCell, checkbox: orbitCheckbox } = buildToggleCell(
        isOrbitVisible(name),
        t('settings.row.orbit.aria', { name: display }),
        (checked) => {
          orbitState.set(name, checked);
          sceneSystem.setBodyOrbitVisible(name, checked);
          syncHeader(orbitsToggle!, isOrbitVisible);
        }
      );

      rows.set(name, {
        label: labelCheckbox,
        body: bodyCheckbox,
        orbit: orbitCheckbox,
      });

      row.append(nameCell, labelCell, bodyCell, orbitCell);
      tableBodyEl!.append(row);
    }
    syncHeader(labelsToggle!, isLabelVisible);
    syncHeader(bodiesToggle!, isBodyVisible);
    syncHeader(orbitsToggle!, isOrbitVisible);
  }
  buildTableRows();
  onLocaleChange(buildTableRows);
  // Mode daltonien basculé : recolore les pastilles d'orbite déjà rendues.
  onAccentChange(buildTableRows);

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
