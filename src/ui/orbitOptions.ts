import { flattenBodies } from '@/config/catalog';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { onLocaleChange, t } from '@/i18n';
import { bodyDisplayName } from '@/i18n/bodyText';
import type { SceneSystem } from '@/components/systems/SceneSystem';
import { hexToRgbTriplet } from './bodyAccent';
import { setupOverlayDisclosure } from './sceneOverlay';

export function setupOrbitOptions(
  sceneSystem: SceneSystem,
  onLabelsVisibleChange?: (visible: boolean) => void
): void {
  const panel = document.getElementById('orbit-options');
  if (!panel) return;

  const bodyEl = panel.querySelector<HTMLElement>('.oo-body');
  if (!bodyEl) return;

  const labelsToggle = panel.querySelector<HTMLInputElement>('#labels-visible');
  labelsToggle?.addEventListener('change', () => {
    onLabelsVisibleChange?.(labelsToggle.checked);
  });
  onLabelsVisibleChange?.(labelsToggle?.checked ?? true);

  const orbitsToggle = panel.querySelector<HTMLInputElement>('#orbits-visible');
  orbitsToggle?.addEventListener('change', () => {
    sceneSystem.setOrbitMasterEnabled(orbitsToggle.checked);
  });
  sceneSystem.setOrbitMasterEnabled(orbitsToggle?.checked ?? true);

  const configs = flattenBodies(CELESTIAL_CONFIG);
  // The compact picker exposes every generated orbit. Only major planets are visible
  // initially; moons, dwarf planets, asteroids and comets remain opt-in to reduce clutter.
  const orbitNames = new Set(sceneSystem.orbitBodyNames());
  const bodies = [...configs.entries()].filter(
    ([name, cfg]) =>
      orbitNames.has(name) && cfg.kind !== 'skybox' && cfg.kind !== 'star'
  );

  // Initial state: major planets visible, every other orbit hidden until selected.
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

  const rowCbs = new Map<string, HTMLInputElement>();

  function buildRows(): void {
    bodyEl!.replaceChildren();
    rowCbs.clear();

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
      });

      rowCbs.set(name, checkbox);
      row.append(dot, nameEl, checkbox);
      bodyEl!.append(row);
    }
  }

  buildRows();
  onLocaleChange(buildRows);

  const toggleBtn = panel.querySelector<HTMLButtonElement>('.oo-toggle');
  if (toggleBtn) {
    setupOverlayDisclosure({
      container: panel,
      toggle: toggleBtn,
      initialCollapsed: window.innerWidth <= 640,
      labels: {
        expand: () => t('orbitOpts.expand'),
        collapse: () => t('orbitOpts.collapse'),
      },
    });
  }

  panel.removeAttribute('hidden');
}
