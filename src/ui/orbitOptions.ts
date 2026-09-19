import { flattenBodies } from '@/config/catalog';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { NAVIGABLE_TARGETS } from '@/config/navigable';
import { onLocaleChange, t } from '@/i18n';
import { bodyDisplayName } from '@/i18n/bodyText';
import type { SceneSystem } from '@/components/systems/SceneSystem';
import { MAJOR_BODIES, type ExploHud } from './exploHud';
import { bodyAccentColor, hexToRgbTriplet, onAccentChange } from './bodyAccent';
import type { OverlayCoordinator } from './overlayCoordinator';

interface RowCheckboxes {
  label: HTMLInputElement;
  body: HTMLInputElement;
  /** Absente pour un objet d'instrument : une sonde n'a pas d'orbite fermée à tracer. */
  orbit?: HTMLInputElement;
}

/**
 * Ce que le tableau pilote sur la couche instrument. Les deux overlays (sondes, objets
 * interstellaires) l'implémentent et ignorent chacun les noms qui ne sont pas les siens : le
 * tableau n'a donc pas à savoir à qui appartient une ligne.
 */
export interface InstrumentVisibility {
  setHiddenNames(names: ReadonlySet<string>): void;
  setHiddenLabelNames(names: ReadonlySet<string>): void;
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
  instrument: readonly InstrumentVisibility[] = [],
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
  // Objets de la couche instrument : deux colonnes sur trois. Ils étaient nommés à l'écran
  // et réglables nulle part, seule surface où le panneau ne disait pas tout ce qui s'affiche.
  const instrumentRows = [...NAVIGABLE_TARGETS.entries()];
  /** Toutes les lignes du tableau : ce qui a un libellé et un marqueur ou un mesh. */
  const visualRows = [...bodies, ...instrumentRows];

  // Libellés : même retenue de départ que les orbites juste en dessous, et pour la même
  // raison. Tout afficher empilait vingt-quatre étiquettes sur la vue initiale. Cf.
  // MAJOR_BODIES (ui/exploHud), qui porte déjà cette liste pour la vue d'ensemble Explo.
  const hiddenLabelNames = new Set<string>(
    bodies.filter(([name]) => !MAJOR_BODIES.has(name)).map(([name]) => name)
  );
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
  const isOrbitVisible = (name: string): boolean =>
    orbitState.get(name) ?? false;

  // Les deux destinataires reçoivent le MÊME ensemble : chacun ignore les noms qui ne le
  // concernent pas. C'est ce qui évite au tableau d'avoir à savoir qui dessine quoi.
  const applyHiddenLabelNames = (): void => {
    const names = new Set(hiddenLabelNames);
    exploHud.setHiddenNames(names);
    for (const layer of instrument) layer.setHiddenLabelNames(names);
  };
  const applyHiddenBodyNames = (): void => {
    const names = new Set(hiddenBodyNames);
    for (const layer of instrument) layer.setHiddenNames(names);
  };

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
    isChecked: (name: string) => boolean,
    list: readonly (readonly [string, unknown])[] = visualRows
  ): void {
    const total = list.length;
    const checkedCount = list.filter(([name]) => isChecked(name)).length;
    header.checked = checkedCount === total;
    header.indeterminate = checkedCount > 0 && checkedCount < total;
  }

  // ── En-tête « Nom » : coche/décoche tous les corps, jamais un simple interrupteur caché ──
  labelsToggle.addEventListener('change', () => {
    const checked = labelsToggle.checked;
    for (const [name] of visualRows) {
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
    for (const [name] of visualRows) {
      if (checked) hiddenBodyNames.delete(name);
      else hiddenBodyNames.add(name);
      if (!NAVIGABLE_TARGETS.has(name))
        sceneSystem.setBodyVisible(name, checked);
      const row = rows.get(name);
      if (row) row.body.checked = checked;
    }
    applyHiddenBodyNames();
    bodiesToggle.indeterminate = false;
  });

  // ── En-tête « Orbite » ────────────────────────────────────────────────────
  orbitsToggle.addEventListener('change', () => {
    const checked = orbitsToggle.checked;
    for (const [name] of bodies) {
      orbitState.set(name, checked);
      sceneSystem.setBodyOrbitVisible(name, checked);
      const row = rows.get(name);
      if (row?.orbit) row.orbit.checked = checked;
    }
    orbitsToggle.indeterminate = false;
  });

  applyHiddenLabelNames();
  applyHiddenBodyNames();

  function buildTableRows(): void {
    tableBodyEl!.replaceChildren();
    rows.clear();
    for (const [name, cfg] of visualRows) {
      const isInstrument = NAVIGABLE_TARGETS.has(name);
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
          if (isInstrument) applyHiddenBodyNames();
          else sceneSystem.setBodyVisible(name, checked);
          syncHeader(bodiesToggle!, isBodyVisible);
        }
      );

      // Une sonde n'a pas d'orbite fermée (assistances gravitationnelles, halo L2) et une
      // trajectoire interstellaire ne se referme jamais : la cellule reste VIDE plutôt que
      // de porter une case sans effet. Les trois trajectoires hyperboliques ont leur propre
      // réglage dans ce même panneau.
      let orbitCell: HTMLTableCellElement;
      let orbitCheckbox: HTMLInputElement | undefined;
      if (isInstrument) {
        orbitCell = document.createElement('td');
        orbitCell.className = 'oo-td oo-td-toggle';
      } else {
        const built = buildToggleCell(
          isOrbitVisible(name),
          t('settings.row.orbit.aria', { name: display }),
          (checked) => {
            orbitState.set(name, checked);
            sceneSystem.setBodyOrbitVisible(name, checked);
            syncHeader(orbitsToggle!, isOrbitVisible, bodies);
          }
        );
        orbitCell = built.cell;
        orbitCheckbox = built.checkbox;
      }

      rows.set(name, {
        label: labelCheckbox,
        body: bodyCheckbox,
        ...(orbitCheckbox ? { orbit: orbitCheckbox } : {}),
      });

      row.append(nameCell, labelCell, bodyCell, orbitCell);
      tableBodyEl!.append(row);
    }
    syncHeader(labelsToggle!, isLabelVisible);
    syncHeader(bodiesToggle!, isBodyVisible);
    syncHeader(orbitsToggle!, isOrbitVisible, bodies);
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
