import { flattenBodies } from '@/config/catalog';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { NAVIGABLE_TARGETS } from '@/config/navigable';
import { onLocaleChange, t } from '@/i18n';
import { bodyDisplayName } from '@/i18n/bodyText';
import type { SceneSystem } from '@/components/systems/SceneSystem';
import type { CelestialBodyConfig } from '@/types';
import type { ExploHud } from './exploHud';
import { BODY_GROUPS } from './bodyGroups';
import { defaultDisplay } from './defaultDisplay';
import { bodyAccentColor, hexToRgbTriplet, onAccentChange } from './bodyAccent';
import type { OverlayCoordinator } from './overlayCoordinator';

/** Les trois colonnes du tableau, dans l'ordre de l'en-tête. */
type Column = 'label' | 'object' | 'orbit';
const COLUMNS: readonly Column[] = ['label', 'object', 'orbit'];

interface Row {
  name: string;
  cfg: CelestialBodyConfig;
  /** Objet d'instrument (sonde, objet interstellaire) : peint par une couche 2D, sans mesh. */
  instrument: boolean;
  /**
   * Ce que la colonne « Orbite » règle pour cette ligne : une orbite fermée (corps du
   * catalogue), une trajectoire ouverte (objet interstellaire), ou rien (une sonde n'a pas
   * d'orbite fermée, et sa trajectoire n'est pas dessinée).
   */
  orbit: 'orbit' | 'trajectory' | null;
}

/**
 * Ce que le tableau pilote sur la couche instrument. Les deux overlays (sondes, objets
 * interstellaires) l'implémentent et ignorent chacun les noms qui ne sont pas les siens : le
 * tableau n'a donc pas à savoir à qui appartient une ligne.
 */
export interface InstrumentVisibility {
  setHiddenNames(names: ReadonlySet<string>): void;
  setHiddenLabelNames(names: ReadonlySet<string>): void;
  /** Trajectoires à tracer, pour une couche qui en dessine (objets interstellaires). */
  setTrajectoryNames?(names: ReadonlySet<string>): void;
}

/** Une <td> avec sa case à cocher : la brique répétée par ligne et par groupe. */
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

function emptyCell(): HTMLTableCellElement {
  const cell = document.createElement('td');
  cell.className = 'oo-td oo-td-toggle';
  return cell;
}

/**
 * Reflète l'état agrégé de plusieurs lignes sur une case « tout cocher » : cochée si toutes
 * le sont, vide si aucune, tiret entre les deux (sémantique standard d'un tableau).
 */
function reflect(
  box: HTMLInputElement,
  names: readonly string[],
  isOn: (name: string) => boolean
): void {
  const on = names.filter(isOn).length;
  box.checked = names.length > 0 && on === names.length;
  box.indeterminate = on > 0 && on < names.length;
}

export function setupOrbitOptions(
  sceneSystem: SceneSystem,
  exploHud: Pick<ExploHud, 'setHiddenNames'>,
  instrument: readonly InstrumentVisibility[] = [],
  coordinator?: OverlayCoordinator
): void {
  const panel = document.getElementById('orbit-options');
  if (!panel) return;

  const tableEl = panel.querySelector<HTMLTableElement>('#settings-table');
  const labelsToggle = panel.querySelector<HTMLInputElement>('#labels-visible');
  const bodiesToggle = panel.querySelector<HTMLInputElement>('#bodies-visible');
  const orbitsToggle = panel.querySelector<HTMLInputElement>('#orbits-visible');
  if (!tableEl || !labelsToggle || !bodiesToggle || !orbitsToggle) return;
  const headers: Record<Column, HTMLInputElement> = {
    label: labelsToggle,
    object: bodiesToggle,
    orbit: orbitsToggle,
  };

  // Une ligne par objet que la scène peut montrer : tout ce qui a une ligne d'orbite
  // (planètes, lunes, naines, petits corps du catalogue ; le Soleil reste toujours affiché, il
  // n'a pas de ligne), puis les objets d'instrument, qui étaient nommés à l'écran et réglables
  // nulle part.
  const configs = flattenBodies(CELESTIAL_CONFIG);
  const orbitNames = new Set(sceneSystem.orbitBodyNames());
  const rows: Row[] = [
    ...[...configs.entries()]
      .filter(
        ([name, cfg]) =>
          orbitNames.has(name) && cfg.kind !== 'skybox' && cfg.kind !== 'star'
      )
      .map(([name, cfg]): Row => ({
        name,
        cfg,
        instrument: false,
        orbit: 'orbit',
      })),
    ...[...NAVIGABLE_TARGETS.entries()].map(([name, cfg]): Row => ({
      name,
      cfg,
      instrument: true,
      orbit: cfg.kind === 'interstellar' ? 'trajectory' : null,
    })),
  ];
  const rowByName = new Map(rows.map((row) => [row.name, row]));
  // Les groupes de la palette de recherche, dans son ordre et sous ses noms.
  const groups = BODY_GROUPS.map((group) => ({
    key: group.key,
    rows: rows.filter((row) => group.kinds.has(row.cfg.kind)),
  })).filter((group) => group.rows.length > 0);

  // L'état de départ vient d'UNE règle (cf. `defaultDisplay.ts`) : Soleil, planètes et Lune
  // nommés, orbites des planètes seules, objets d'instrument en option.
  const state: Record<Column, Map<string, boolean>> = {
    label: new Map(),
    object: new Map(),
    orbit: new Map(),
  };
  for (const row of rows) {
    const defaults = defaultDisplay(row.name, row.cfg.kind);
    state.label.set(row.name, defaults.label);
    state.object.set(row.name, defaults.object);
    if (row.orbit) state.orbit.set(row.name, defaults.orbit);
  }
  const isOn =
    (column: Column) =>
    (name: string): boolean =>
      state[column].get(name) ?? false;
  /** Lignes de `list` qui ont une case dans cette colonne. */
  const namesOf = (column: Column, list: readonly Row[] = rows): string[] =>
    list.filter((row) => state[column].has(row.name)).map((row) => row.name);
  const hidden = (column: Column, onlyInstrument: boolean): Set<string> =>
    new Set(
      rows
        .filter(
          (row) =>
            (!onlyInstrument || row.instrument) &&
            state[column].has(row.name) &&
            !isOn(column)(row.name)
        )
        .map((row) => row.name)
    );

  // Chaque destinataire reçoit l'ensemble COMPLET et ignore les noms qui ne sont pas les
  // siens : le tableau n'a pas à savoir qui dessine quoi.
  const apply: Record<Column, (names: readonly string[]) => void> = {
    label: () => {
      const names = hidden('label', false);
      exploHud.setHiddenNames(names);
      for (const layer of instrument) layer.setHiddenLabelNames(names);
    },
    object: (names) => {
      for (const name of names)
        if (!rowByName.get(name)?.instrument)
          sceneSystem.setBodyVisible(name, isOn('object')(name));
      const hiddenMarkers = hidden('object', true);
      for (const layer of instrument) layer.setHiddenNames(hiddenMarkers);
    },
    orbit: (names) => {
      for (const name of names)
        if (rowByName.get(name)?.orbit === 'orbit')
          sceneSystem.setBodyOrbitVisible(name, isOn('orbit')(name));
      const trajectories = new Set(
        rows
          .filter(
            (row) => row.orbit === 'trajectory' && isOn('orbit')(row.name)
          )
          .map((row) => row.name)
      );
      for (const layer of instrument) layer.setTrajectoryNames?.(trajectories);
    },
  };
  for (const column of COLUMNS) apply[column](namesOf(column));
  // Une ligne d'orbite que le tableau ne liste pas (aucune aujourd'hui) reste éteinte.
  for (const name of sceneSystem.orbitBodyNames())
    if (!state.orbit.has(name)) sceneSystem.setBodyOrbitVisible(name, false);

  // Cases rendues, pour refléter un changement de groupe ou de colonne sans reconstruire le
  // tableau (ce qui perdrait le focus et le défilement).
  const rowBoxes = new Map<string, Partial<Record<Column, HTMLInputElement>>>();
  const groupBoxes = new Map<
    string,
    Partial<Record<Column, HTMLInputElement>>
  >();
  /** Groupes dépliés. Les planètes seules au départ : le tableau tient alors sur un écran. */
  const expanded = new Set<string>(['nav.group.planet']);

  function syncBoxes(): void {
    for (const [name, boxes] of rowBoxes)
      for (const column of COLUMNS)
        if (boxes[column]) boxes[column].checked = isOn(column)(name);
    for (const group of groups) {
      const boxes = groupBoxes.get(group.key);
      for (const column of COLUMNS)
        if (boxes?.[column])
          reflect(boxes[column], namesOf(column, group.rows), isOn(column));
    }
    for (const column of COLUMNS)
      reflect(headers[column], namesOf(column), isOn(column));
  }

  function setMany(
    column: Column,
    names: readonly string[],
    on: boolean
  ): void {
    for (const name of names) state[column].set(name, on);
    apply[column](names);
    syncBoxes();
  }

  for (const column of COLUMNS)
    headers[column].addEventListener('change', () =>
      setMany(column, namesOf(column), headers[column].checked)
    );

  const rowAria: Record<Column, string> = {
    label: 'settings.row.name.aria',
    object: 'settings.row.body.aria',
    orbit: 'settings.row.orbit.aria',
  };
  const groupAria: Record<Column, string> = {
    label: 'settings.group.name.aria',
    object: 'settings.group.body.aria',
    orbit: 'settings.group.orbit.aria',
  };

  function buildTable(): void {
    for (const old of [...tableEl!.tBodies]) old.remove();
    rowBoxes.clear();
    groupBoxes.clear();
    for (const group of groups) {
      const tbody = document.createElement('tbody');
      tbody.className = 'oo-group';
      tbody.dataset['group'] = group.key;
      const title = t(group.key);
      const open = expanded.has(group.key);

      // Ligne de groupe : son nom déplie ou replie le groupe, ses cases règlent tout le groupe.
      const head = document.createElement('tr');
      head.className = 'oo-group-row';
      const th = document.createElement('th');
      th.scope = 'rowgroup';
      th.className = 'oo-td oo-group-name';
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'oo-group-toggle';
      toggle.setAttribute('aria-expanded', String(open));
      const titleEl = document.createElement('span');
      titleEl.className = 'oo-group-title';
      titleEl.textContent = title;
      const count = document.createElement('span');
      count.className = 'oo-group-count';
      count.textContent = String(group.rows.length);
      toggle.append(titleEl, count);
      th.append(toggle);
      head.append(th);
      const boxes: Partial<Record<Column, HTMLInputElement>> = {};
      for (const column of COLUMNS) {
        const names = namesOf(column, group.rows);
        if (names.length === 0) {
          head.append(emptyCell());
          continue;
        }
        const { cell, checkbox } = buildToggleCell(
          false,
          t(groupAria[column], { group: title }),
          (checked) => setMany(column, names, checked)
        );
        boxes[column] = checkbox;
        head.append(cell);
      }
      groupBoxes.set(group.key, boxes);
      tbody.append(head);

      const members: HTMLTableRowElement[] = [];
      for (const row of group.rows) {
        const display = bodyDisplayName(row.name);
        const tr = document.createElement('tr');
        tr.className = 'oo-tr';
        tr.hidden = !open;

        const nameCell = document.createElement('td');
        nameCell.className = 'oo-td oo-td-name';
        const nameInner = document.createElement('span');
        nameInner.className = 'oo-td-name-inner';
        const dot = document.createElement('span');
        dot.className = 'oo-dot';
        dot.style.setProperty(
          '--orbit-rgb',
          hexToRgbTriplet(bodyAccentColor(row.cfg, row.name))
        );
        const nameEl = document.createElement('span');
        nameEl.className = 'oo-name';
        nameEl.textContent = display;
        nameInner.append(dot, nameEl);
        nameCell.append(nameInner);
        tr.append(nameCell);

        const cells: Partial<Record<Column, HTMLInputElement>> = {};
        for (const column of COLUMNS) {
          if (!state[column].has(row.name)) {
            // Une sonde n'a pas d'orbite fermée, et sa trajectoire n'est pas dessinée : la
            // cellule reste VIDE plutôt que de porter une case sans effet.
            tr.append(emptyCell());
            continue;
          }
          const key =
            column === 'orbit' && row.orbit === 'trajectory'
              ? 'settings.row.trajectory.aria'
              : rowAria[column];
          const { cell, checkbox } = buildToggleCell(
            isOn(column)(row.name),
            t(key, { name: display }),
            (checked) => setMany(column, [row.name], checked)
          );
          cells[column] = checkbox;
          tr.append(cell);
        }
        rowBoxes.set(row.name, cells);
        members.push(tr);
        tbody.append(tr);
      }

      toggle.addEventListener('click', () => {
        const next = !expanded.has(group.key);
        if (next) expanded.add(group.key);
        else expanded.delete(group.key);
        toggle.setAttribute('aria-expanded', String(next));
        for (const tr of members) tr.hidden = !next;
      });
      tableEl!.append(tbody);
    }
    syncBoxes();
  }
  buildTable();
  onLocaleChange(buildTable);
  // Mode daltonien basculé : recolore les pastilles déjà rendues.
  onAccentChange(buildTable);

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
