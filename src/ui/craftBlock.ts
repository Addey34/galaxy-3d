/**
 * LE BLOC « INSPECTER EN 3D » DE LA FICHE D'UNE SONDE (GAL-OBJECT-IMMERSION-001). Dans le morceau des
 * blocs de fiche : il n'agit pas avant qu'une fiche existe.
 *
 * Une sonde qui a un modèle montre le bouton ; une sonde qui n'en a pas le DIT (« aucun modèle fiable »)
 * au lieu de proposer une forme inventée. Un corps qui n'est pas une sonde ne montre rien.
 */
import { craftModelFor } from '@/config/craftModels';
import { SPACECRAFT_MISSIONS } from '@/config/spacecraft';
import { onLocaleChange, t } from '@/i18n';
import type { PublicAPI } from '@/SolarSystemApp';
import type { BodyInfoPanel } from './bodyInfo';
import type { CraftOpener } from './craftAccess';

const PROBES: ReadonlySet<string> = new Set(
  SPACECRAFT_MISSIONS.map((m) => m.name)
);

export function setupCraftBlock(
  api: PublicAPI,
  bodyInfo: BodyInfoPanel,
  openCraft: CraftOpener
): void {
  const panel = document.getElementById('body-info');
  const anchor = panel?.querySelector('.bi-instruments');
  if (!panel || !anchor) return;
  const box = document.createElement('div');
  box.className = 'bi-craft';
  box.hidden = true;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'bi-craft-button';
  button.id = 'craft-inspect';
  const note = document.createElement('p');
  note.className = 'bi-craft-note';
  box.append(button, note);
  anchor.before(box);

  let shown: string | null = null;
  let model: ReturnType<typeof craftModelFor> = null;
  const render = (current: string | null): void => {
    shown = current;
    if (!current || !PROBES.has(current)) {
      box.hidden = true;
      return;
    }
    model = craftModelFor(current);
    button.hidden = !model;
    button.textContent = t('craft.button');
    note.hidden = !!model;
    note.textContent = model ? '' : t('craft.noModel');
    box.hidden = false;
  };
  button.addEventListener('click', () => {
    if (model) openCraft(model.id, button);
  });

  let last = 0;
  api.animationSystem.onFrame(() => {
    const at = performance.now();
    if (at - last < 500) return;
    last = at;
    const current = bodyInfo.currentBody();
    if (current !== shown) render(current);
  });
  onLocaleChange(() => render(shown));
}
