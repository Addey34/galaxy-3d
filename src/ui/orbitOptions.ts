import { flattenBodies } from '@/config/catalog';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { onLocaleChange, t } from '@/i18n';
import { bodyDisplayName } from '@/i18n/bodyText';
import type { SceneSystem } from '@/components/systems/SceneSystem';

function hexToRgbTriplet(hex: number): string {
  return `${(hex >> 16) & 0xff}, ${(hex >> 8) & 0xff}, ${hex & 0xff}`;
}

export function setupOrbitOptions(sceneSystem: SceneSystem): void {
  const panel = document.getElementById('orbit-options');
  if (!panel) return;

  const bodyEl = panel.querySelector<HTMLElement>('.oo-body');
  if (!bodyEl) return;

  const configs = flattenBodies(CELESTIAL_CONFIG);
  // Heliocentric orbit controls shown in this panel: planets and dwarf planets.
  // Other generated orbit lines, such as moons, asteroids and comets, stay hidden here.
  const PANEL_KINDS = new Set(['planet', 'dwarf']);
  const bodies = [...configs.entries()].filter(([, cfg]) =>
    PANEL_KINDS.has(cfg.kind)
  );

  // Initial state: planets visible, dwarf planets hidden to reduce visual clutter.
  const state = new Map<string, boolean>(
    bodies.map(([name, cfg]) => [name, cfg.kind === 'planet'])
  );
  for (const [name, visible] of state) {
    sceneSystem.setBodyOrbitVisible(name, visible);
  }

  const panelNames = new Set(state.keys());
  for (const name of sceneSystem.orbitBodyNames()) {
    if (!panelNames.has(name)) sceneSystem.setBodyOrbitVisible(name, false);
  }

  let masterCb: HTMLInputElement;
  const rowCbs = new Map<string, HTMLInputElement>();

  function syncMaster(): void {
    const vals = [...state.values()];
    const allOn = vals.every(Boolean);
    const noneOn = !vals.some(Boolean);
    masterCb.checked = allOn;
    masterCb.indeterminate = !allOn && !noneOn;
  }

  function setAll(on: boolean): void {
    for (const [name] of bodies) {
      state.set(name, on);
      sceneSystem.setBodyOrbitVisible(name, on);
      const cb = rowCbs.get(name);
      if (cb) cb.checked = on;
    }
  }

  function buildRows(): void {
    bodyEl!.innerHTML = '';
    rowCbs.clear();

    const masterRow = document.createElement('label');
    masterRow.className = 'oo-row oo-row--master';

    const masterName = document.createElement('span');
    masterName.className = 'oo-name';
    masterName.textContent = t('orbitOpts.all');

    masterCb = document.createElement('input');
    masterCb.type = 'checkbox';
    masterCb.className = 'oo-checkbox';
    masterCb.setAttribute('aria-label', t('orbitOpts.all'));
    masterCb.addEventListener('change', () => {
      const anyOn = [...state.values()].some(Boolean);
      setAll(!anyOn);
      syncMaster();
    });

    masterRow.append(masterName, masterCb);
    bodyEl!.append(masterRow);

    const sep = document.createElement('div');
    sep.className = 'oo-sep';
    bodyEl!.append(sep);

    for (const [name, cfg] of bodies) {
      const rgb = hexToRgbTriplet(cfg.orbitalColor);

      const row = document.createElement('label');
      row.className = 'oo-row';
      row.style.setProperty('--orbit-rgb', rgb);

      const dot = document.createElement('span');
      dot.className = 'oo-dot';

      const nameEl = document.createElement('span');
      nameEl.className = 'oo-name';
      nameEl.textContent = bodyDisplayName(name);

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'oo-checkbox';
      checkbox.checked = state.get(name) ?? false;
      checkbox.addEventListener('change', () => {
        state.set(name, checkbox.checked);
        sceneSystem.setBodyOrbitVisible(name, checkbox.checked);
        syncMaster();
      });

      rowCbs.set(name, checkbox);
      row.append(dot, nameEl, checkbox);
      bodyEl!.append(row);
    }

    syncMaster();
  }

  buildRows();
  onLocaleChange(buildRows);

  const toggleBtn = panel.querySelector<HTMLButtonElement>('.oo-toggle');
  if (toggleBtn) {
    let collapsed = false;
    const applyCollapsed = (): void => {
      panel.classList.toggle('is-collapsed', collapsed);
      toggleBtn.setAttribute('aria-expanded', String(!collapsed));
      toggleBtn.setAttribute(
        'aria-label',
        collapsed ? t('orbitOpts.expand') : t('orbitOpts.collapse')
      );
    };
    toggleBtn.addEventListener('click', () => {
      collapsed = !collapsed;
      applyCollapsed();
    });
    onLocaleChange(applyCollapsed);
    applyCollapsed();
  }

  panel.removeAttribute('hidden');
}
