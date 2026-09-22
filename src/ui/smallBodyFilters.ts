/**
 * Filtres du champ d'astéroïdes et de comètes : ceinture principale, géocroiseurs (NEO),
 * comètes, objets transneptuniens (TNO). Une SECTION de la surface Réglages d'affichage
 * (`#smallbody-filters`), avec les mêmes lignes que le tableau des corps (pastille, nom, case) :
 * le champ avait son propre bouton dans le dock, qui n'apparaissait qu'en Exploration et
 * faisait donc changer la rangée de boutons d'un mode à l'autre. La section reste visible dans
 * les deux modes et dit que le champ ne se dessine qu'en Exploration.
 *
 * Ne pilote que la VISIBILITÉ : les données des 4 catégories sont chargées une fois pour
 * toutes par `loadSmallBodies` ; décocher une catégorie ne refait aucune requête,
 * `SmallBodyOverlay.setVisibleCategories` filtre au dessin.
 *
 * La section porte aussi la PROVENANCE de ces corps : depuis le lot 8b la donnée n'est plus un
 * flux mais un instantané daté, livré avec le build (`core/sbdb.ts` dit pourquoi). Une donnée
 * figée qui se présenterait comme vivante serait le défaut que ce lot corrige, pas sa solution.
 */
import { t, intlLocale, onLocaleChange } from '@/i18n';
import { isSnapshotStale, snapshotAgeMonths } from '@/core/snapshotAge';
import type { SmallBodyCategory } from '@/core/sbdb';
import {
  SMALL_BODY_MARKER_RGB,
  type SmallBodyOverlay,
} from './smallBodyOverlay';

const CATEGORIES: { id: SmallBodyCategory; labelKey: string }[] = [
  { id: 'main-belt', labelKey: 'smallBodies.mainBelt' },
  { id: 'neo', labelKey: 'smallBodies.neo' },
  { id: 'comet', labelKey: 'smallBodies.comet' },
  { id: 'tno', labelKey: 'smallBodies.tno' },
];

export interface SmallBodyFiltersPanel {
  /**
   * Date du relevé et nombre de corps chargés. `null` tant que rien n'est chargé, et si le
   * chargement échoue : la section n'annonce alors AUCUNE date plutôt qu'une date fausse.
   */
  setDataset(retrieved: string | null, count: number): void;
}

export function setupSmallBodyFilters(
  overlay: SmallBodyOverlay
): SmallBodyFiltersPanel {
  const panel = document.getElementById('smallbody-filters');
  const noop = { setDataset: () => {} };
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

      // La même pastille que le tableau des corps, de la couleur des points du champ.
      const dot = document.createElement('span');
      dot.className = 'oo-dot';
      dot.style.setProperty('--orbit-rgb', SMALL_BODY_MARKER_RGB);

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

      row.append(dot, nameEl, checkbox);
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
    // Au-delà de l'âge déclaré (`core/snapshotAge.ts`), la phrase le DIT : un relevé périmé
    // ne doit pas se lire comme un relevé du jour. C'est l'horloge du visiteur qui compte, pas
    // la date de la scène : l'âge est celui du relevé, pas celui des positions affichées.
    const now = new Date();
    const months = snapshotAgeMonths(dataset.retrieved, now);
    const stale = months !== null && isSnapshotStale(dataset.retrieved, now);
    noteEl.textContent = t(
      stale ? 'smallBodies.sourceStale' : 'smallBodies.source',
      {
        count: String(dataset.count),
        months: String(months),
        date: new Date(Date.UTC(year!, month! - 1, day!)).toLocaleDateString(
          intlLocale(),
          { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }
        ),
      }
    );
    noteEl.hidden = false;
  }
  renderNote();

  onLocaleChange(() => {
    buildRows();
    renderNote();
  });

  return {
    setDataset: (retrieved: string | null, count: number) => {
      dataset = { retrieved, count };
      renderNote();
    },
  };
}
