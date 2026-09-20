/**
 * Panneau de filtres du champ de petits corps — ceinture principale, géocroiseurs (NEO),
 * comètes, objets transneptuniens (TNO). Calqué sur `orbitOptions.ts` (même structure de
 * surface contextuelle, mêmes classes CSS `.oo-body`/`.oo-row`/`.oo-name`/`.oo-checkbox`,
 * déjà génériques — aucun nouveau style nécessaire). Ne pilote que la VISIBILITÉ : les données
 * des 4 catégories sont chargées une fois pour toutes par `loadSmallBodies` ; décocher une
 * catégorie ne refait aucune requête, `SmallBodyOverlay.setVisibleCategories` filtre au dessin.
 *
 * Le panneau porte aussi la PROVENANCE de ces corps : depuis le lot 8b la donnée n'est plus un
 * flux mais un instantané daté, livré avec le build (`core/sbdb.ts` dit pourquoi). Une donnée
 * figée qui se présenterait comme vivante serait le défaut que ce lot corrige, pas sa solution.
 */
import { t, intlLocale, onLocaleChange } from '@/i18n';
import type { SmallBodyCategory } from '@/core/sbdb';
import type { SmallBodyOverlay } from './smallBodyOverlay';
import type { OverlayCoordinator } from './overlayCoordinator';

const CATEGORIES: { id: SmallBodyCategory; labelKey: string }[] = [
  { id: 'main-belt', labelKey: 'smallBodies.mainBelt' },
  { id: 'neo', labelKey: 'smallBodies.neo' },
  { id: 'comet', labelKey: 'smallBodies.comet' },
  { id: 'tno', labelKey: 'smallBodies.tno' },
];

export interface SmallBodyFiltersPanel {
  /** Affiche/masque le bouton déclencheur (l'overlay qu'il pilote n'a de sens qu'en Explo). */
  setTriggerVisible(visible: boolean): void;
  /**
   * Date du relevé et nombre de corps chargés. `null` tant que rien n'est chargé, et si le
   * chargement échoue : le panneau n'annonce alors AUCUNE date plutôt qu'une date fausse.
   */
  setDataset(retrieved: string | null, count: number): void;
}

export function setupSmallBodyFilters(
  overlay: SmallBodyOverlay,
  coordinator?: OverlayCoordinator
): SmallBodyFiltersPanel {
  const panel = document.getElementById('smallbody-filters');
  const noop = { setTriggerVisible: () => {}, setDataset: () => {} };
  if (!panel) return noop;
  const bodyEl = panel.querySelector<HTMLElement>('.oo-body');
  if (!bodyEl) return noop;
  const noteEl = panel.querySelector<HTMLElement>('.sb-source');

  const state = new Set<SmallBodyCategory>(CATEGORIES.map((c) => c.id));
  const applyState = (): void => overlay.setVisibleCategories(new Set(state));
  applyState();

  function buildRows(): void {
    bodyEl!.replaceChildren();
    for (const cat of CATEGORIES) {
      const row = document.createElement('label');
      row.className = 'oo-row';

      const nameEl = document.createElement('span');
      nameEl.className = 'oo-name';
      nameEl.textContent = t(cat.labelKey);

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'oo-checkbox';
      checkbox.checked = state.has(cat.id);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) state.add(cat.id);
        else state.delete(cat.id);
        applyState();
      });

      row.append(nameEl, checkbox);
      bodyEl!.append(row);
    }
  }
  buildRows();

  // Provenance affichée : « 6965 objets, JPL Small-Body Database, relevé du 20 septembre
  // 2026 ». Le compte est celui des orbites EXPLOITABLES, pas des lignes du fichier.
  let dataset: { retrieved: string | null; count: number } = {
    retrieved: null,
    count: 0,
  };
  function renderNote(): void {
    if (!noteEl) return;
    if (!dataset.retrieved || dataset.count === 0) {
      noteEl.textContent = '';
      noteEl.hidden = true;
      return;
    }
    const [year, month, day] = dataset.retrieved.split('-').map(Number);
    noteEl.textContent = t('smallBodies.source', {
      count: String(dataset.count),
      date: new Date(Date.UTC(year!, month! - 1, day!)).toLocaleDateString(
        intlLocale(),
        { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }
      ),
    });
    noteEl.hidden = false;
  }
  renderNote();

  onLocaleChange(() => {
    buildRows();
    renderNote();
  });

  // Surface contextuelle : ouverte par le déclencheur du dock, fermée par sa croix, le scrim
  // ou une autre surface (coordinateur). Démarre masquée.
  const triggerBtn = document.querySelector<HTMLButtonElement>(
    '#smallbody-filters-trigger'
  );
  const closeBtn = panel.querySelector<HTMLButtonElement>('.surface-close');
  let open = false;

  const setOpen = (next: boolean): void => {
    open = next;
    if (open) coordinator?.requestOpen('small-body-filters');
    panel.hidden = !open;
    triggerBtn?.setAttribute('aria-expanded', String(open));
  };
  coordinator?.register('small-body-filters', () => setOpen(false));

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

  return {
    setTriggerVisible: (visible: boolean) => {
      if (triggerBtn) triggerBtn.hidden = !visible;
      if (!visible) setOpen(false);
    },
    setDataset: (retrieved: string | null, count: number) => {
      dataset = { retrieved, count };
      renderNote();
    },
  };
}
