/**
 * TOUTES LES VISITES, LUES D'UN COUP (GAL-TOUR-SCALE-001) : réservé au BUILD (pages d'activités,
 * `ssrLoadModule` de `vite.config.ts`) et aux TESTS scientifiques. Le navigateur ne doit jamais
 * l'importer : il matérialiserait toutes les fiches dans le démarrage, ce que ce lot supprime.
 * `src/config/tourScripts.test.ts` garde cette frontière sur le graphe de modules du démarrage.
 */
import type { TourScript } from '@/core/tourEngine';
import type { TourRecord } from '../schema/tour';
import { TOUR_ORDER, loadTours } from './index';

/** Toutes les fiches, sans `order.json`. */
export const TOUR_RECORDS: readonly TourRecord[] = Object.values(
  import.meta.glob(['./*.json', '!./order.json'], {
    eager: true,
    import: 'default',
  })
) as TourRecord[];

export const loadTourScripts = (): TourScript[] =>
  loadTours(TOUR_RECORDS, TOUR_ORDER);
