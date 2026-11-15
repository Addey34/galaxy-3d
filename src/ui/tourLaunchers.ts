/**
 * Visites guidées : LANCEURS. `ui/guidedTour.ts` (découverte de premier passage, bulles ancrées) et
 * `ui/tourPlayer.ts` (visites scénarisées, moteur, caméra) n'ont plus besoin d'être dans le démarrage :
 * ils ajoutent leurs boutons au popover d'aide, qu'un visiteur n'ouvre qu'à la demande.
 *
 * Quand sont-ils chargés ?
 *   - guidedTour : tout de suite pour un PREMIER passage (la découverte démarre, comme avant) ;
 *     sinon à la première ouverture de l'aide (le clic sur `#help-btn` lance le chargement) ;
 *   - tourPlayer : à la première ouverture de l'aide, ou tout de suite pour `?tour=` (`start`).
 * Un échec de chargement est DIT (annonceur, texte traduit) et le prochain clic réessaie ; une fois
 * chargé, l'écouteur est retiré : une initialisation, un écouteur. Les boutons de visite apparaissent
 * dans le popover une fraction de seconde après l'ouverture de l'aide, au premier clic seulement.
 */
import { STORAGE_KEYS } from '@/config/storageKeys';
import type { setupTourPlayer } from './tourPlayer';
import { announceLoadFailure } from './loadFailure';

/** Charge `load` une seule fois, au premier clic sur l'aide, ou tout de suite sur demande. */
function onDemandWithHelp<T>(load: () => Promise<T>): () => Promise<T | null> {
  const helpBtn = document.getElementById('help-btn');
  let pending: Promise<T | null> | null = null;
  const run = (): Promise<T | null> => {
    pending ??= load()
      .then((value) => {
        helpBtn?.removeEventListener('click', run);
        return value;
      })
      .catch(() => {
        pending = null; // le prochain clic réessaie
        announceLoadFailure('tours');
        return null;
      });
    return pending;
  };
  helpBtn?.addEventListener('click', run);
  return run;
}

/** Vrai si le visiteur n'a jamais vu la découverte (ou si le stockage est illisible, comme avant). */
function isFirstVisit(): boolean {
  try {
    return !localStorage.getItem(STORAGE_KEYS.guidedTour);
  } catch {
    return true;
  }
}

export interface GuidedTourLauncher {
  startIfFirstVisit(): void;
}

export function setupGuidedTourOnDemand(): GuidedTourLauncher {
  const load = onDemandWithHelp(() =>
    import('./guidedTour').then((m) => m.setupGuidedTour())
  );
  return {
    startIfFirstVisit: () => {
      if (isFirstVisit()) void load().then((tour) => tour?.startIfFirstVisit());
    },
  };
}

export interface TourPlayerLauncher {
  /** Lance une visite par son identifiant ; `false` si aucune ne le porte ou si le chargement échoue. */
  start(id: string): Promise<boolean>;
}

export function setupTourPlayerOnDemand(
  ...args: Parameters<typeof setupTourPlayer>
): TourPlayerLauncher {
  const load = onDemandWithHelp(() =>
    import('./tourPlayer').then((m) => m.setupTourPlayer(...args))
  );
  return {
    start: async (id) => (await load())?.start(id) ?? false,
  };
}
