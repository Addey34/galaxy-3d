/**
 * UNE VISITE À LA DEMANDE (GAL-TOUR-SCALE-001) : le contenu d'exécution d'une fiche (étapes,
 * légendes dans les quatre langues) est un morceau à part par visite, téléchargé à l'ouverture de
 * cette visite et d'aucune autre. Le glob n'est PAS `eager` : Vite émet un `import()` par fiche,
 * nommé `tour-<id>` (`chunkFileNames` de `vite.config.ts`), classé par famille dans
 * `core/startupBudget.ts`.
 *
 * Les quatre langues voyagent DANS la fiche : changer de langue pendant une visite ne télécharge
 * rien et ne peut donc pas rendre un état obsolète après une résolution tardive.
 *
 * Un identifiant inconnu rend `null` (le lien `?tour=` d'une visite retirée retombe sur la
 * découverte) ; un échec de téléchargement REJETTE, et l'appelant décide de le dire et de réessayer.
 */
import type { TourScript } from '@/core/tourEngine';
import type { TourRecord } from '../schema/tour';
import { TOUR_ORDER, toTourScript } from './index';

const LOADERS = import.meta.glob(['./*.json', '!./order.json'], {
  import: 'default',
}) as Record<string, () => Promise<TourRecord>>;

/** Les identifiants que ce chargeur sait servir : les fiches présentes, dans l'ordre déclaré. */
export const lazyTourIds = (): string[] =>
  TOUR_ORDER.filter((id) => Object.hasOwn(LOADERS, `./${id}.json`));

export async function loadTourScript(id: string): Promise<TourScript | null> {
  const key = `./${id}.json`;
  if (!TOUR_ORDER.includes(id) || !Object.hasOwn(LOADERS, key)) return null;
  const record = await LOADERS[key]!();
  if (record.id !== id)
    throw new Error(`visite ${id} : la fiche porte l'identifiant ${record.id}`);
  return toTourScript(record);
}
