import { flattenBodies } from '@/config/catalog';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { onLocaleChange, t } from '@/i18n';
import { bodyDisplayName } from '@/i18n/bodyText';
import type { SceneSystem } from '@/components/systems/SceneSystem';
import type { ExploHud } from './exploHud';
import { hexToRgbTriplet } from './bodyAccent';
import type { OverlayCoordinator } from './overlayCoordinator';

/** Une <td> avec sa case à cocher — la brique répétée trois fois par ligne du tableau. */
function buildToggleCell(
  checked: boolean,
  ariaLabel: string,
  onChange: (checked: boolean) => void
): HTMLTableCellElement {
  const cell = document.createElement('td');
  cell.className = 'oo-td oo-td-toggle';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'oo-checkbox';
  checkbox.checked = checked;
  checkbox.setAttribute('aria-label', ariaLabel);
  checkbox.addEventListener('change', () => onChange(checkbox.checked));

  cell.append(checkbox);
  return cell;
}

export function setupOrbitOptions(
  sceneSystem: SceneSystem,
  exploHud: Pick<ExploHud, 'setLabelsVisible' | 'setHiddenNames'>,
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

  // ── Colonne « Nom » : bascule maître + état individuel ──────────────────
  const hiddenLabelNames = new Set<string>();
  const applyHiddenLabelNames = (): void =>
    exploHud.setHiddenNames(new Set(hiddenLabelNames));
  labelsToggle.addEventListener('change', () => {
    exploHud.setLabelsVisible(labelsToggle.checked);
  });
  exploHud.setLabelsVisible(labelsToggle.checked);
  applyHiddenLabelNames();

  // ── Colonne « Corps » : bascule maître + état individuel ─────────────────
  const hiddenBodyNames = new Set<string>();
  bodiesToggle.addEventListener('change', () => {
    sceneSystem.setBodyMasterEnabled(bodiesToggle.checked);
  });
  sceneSystem.setBodyMasterEnabled(bodiesToggle.checked);

  // ── Colonne « Orbite » : bascule maître + état individuel ────────────────
  // Le picker expose toutes les orbites générées. Seules les planètes majeures sont
  // visibles au départ ; lunes, naines, astéroïdes et comètes restent en opt-in
  // (comportement historique inchangé).
  orbitsToggle.addEventListener('change', () => {
    sceneSystem.setOrbitMasterEnabled(orbitsToggle.checked);
  });
  sceneSystem.setOrbitMasterEnabled(orbitsToggle.checked);

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

  function buildTableRows(): void {
    tableBodyEl!.replaceChildren();
    for (const [name, cfg] of bodies) {
      const display = bodyDisplayName(name);
      const row = document.createElement('tr');
      row.className = 'oo-tr';

      const nameCell = document.createElement('td');
      nameCell.className = 'oo-td oo-td-name';
      const nameInner = document.createElement('span');
      nameInner.className = 'oo-td-name-inner';
      const rgb = hexToRgbTriplet(cfg.orbitalColor);
      const dot = document.createElement('span');
      dot.className = 'oo-dot';
      dot.style.setProperty('--orbit-rgb', rgb);
      const nameEl = document.createElement('span');
      nameEl.className = 'oo-name';
      nameEl.textContent = display;
      nameInner.append(dot, nameEl);
      nameCell.append(nameInner);

      const labelCell = buildToggleCell(
        !hiddenLabelNames.has(name),
        t('settings.row.name.aria', { name: display }),
        (checked) => {
          if (checked) hiddenLabelNames.delete(name);
          else hiddenLabelNames.add(name);
          applyHiddenLabelNames();
        }
      );

      const bodyCell = buildToggleCell(
        !hiddenBodyNames.has(name),
        t('settings.row.body.aria', { name: display }),
        (checked) => {
          if (checked) hiddenBodyNames.delete(name);
          else hiddenBodyNames.add(name);
          sceneSystem.setBodyVisible(name, checked);
        }
      );

      const orbitCell = buildToggleCell(
        orbitState.get(name) ?? false,
        t('settings.row.orbit.aria', { name: display }),
        (checked) => {
          orbitState.set(name, checked);
          sceneSystem.setBodyOrbitVisible(name, checked);
        }
      );

      row.append(nameCell, labelCell, bodyCell, orbitCell);
      tableBodyEl!.append(row);
    }
  }
  buildTableRows();
  onLocaleChange(buildTableRows);

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
