/**
 * Panneau d'options d'orbites (#orbit-options) — mode Éducatif uniquement.
 *
 * Header : bouton pill ON / OFF qui cache ou affiche TOUTES les orbites (planètes
 * et naines). Body : une case à cocher par planète naine pour le réglage fin.
 * Masqué automatiquement en Exploration via CSS (body.is-explo-mode).
 */
import { flattenBodies } from '@/config/catalog';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { onLocaleChange } from '@/i18n';
import { bodyDisplayName } from '@/i18n/bodyText';
import type { SceneSystem } from '@/components/systems/SceneSystem';

function hexToRgbTriplet(hex: number): string {
  return `${(hex >> 16) & 0xff}, ${(hex >> 8) & 0xff}, ${hex & 0xff}`;
}

export function setupOrbitOptions(sceneSystem: SceneSystem): void {
  const panel = document.getElementById('orbit-options');
  if (!panel) return;

  const masterBtn = panel.querySelector<HTMLButtonElement>('.oo-master-btn');
  const bodyEl = panel.querySelector<HTMLElement>('.oo-body');
  if (!masterBtn || !bodyEl) return;

  let masterOn = true;

  function applyMaster(on: boolean): void {
    masterOn = on;
    masterBtn!.textContent = on ? 'ON' : 'OFF';
    masterBtn!.setAttribute('aria-pressed', String(on));
    panel!.classList.toggle('is-all-off', !on);
    sceneSystem.setOrbitMasterEnabled(on);
  }

  masterBtn.addEventListener('click', () => applyMaster(!masterOn));

  const configs = flattenBodies(CELESTIAL_CONFIG);
  const dwarfs = [...configs.entries()].filter(([, cfg]) => cfg.kind === 'dwarf');
  const state = new Map<string, boolean>(dwarfs.map(([name]) => [name, true]));

  function buildRows(): void {
    bodyEl!.innerHTML = '';
    for (const [name, cfg] of dwarfs) {
      const rgb = hexToRgbTriplet(cfg.orbitalColor);

      const row = document.createElement('label');
      row.className = 'oo-row';

      const dot = document.createElement('span');
      dot.className = 'oo-dot';
      dot.style.background = `rgb(${rgb})`;
      dot.style.boxShadow = `0 0 6px rgba(${rgb}, 0.65)`;

      const nameEl = document.createElement('span');
      nameEl.className = 'oo-name';
      nameEl.textContent = bodyDisplayName(name);

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'oo-checkbox';
      checkbox.checked = state.get(name) ?? true;
      checkbox.addEventListener('change', () => {
        state.set(name, checkbox.checked);
        sceneSystem.setBodyOrbitVisible(name, checkbox.checked);
      });

      row.append(dot, nameEl, checkbox);
      bodyEl!.append(row);
    }
  }

  buildRows();
  onLocaleChange(buildRows);

  panel.removeAttribute('hidden');
}
