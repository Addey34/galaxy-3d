/**
 * REGISTRE DES VISITES DU VOISINAGE SOLAIRE (GAL-UNIVERSE-005) : une fiche JSON par visite, lue et
 * validée à l'import. Importé SEULEMENT par `ui/stellarVisit`, morceau chargé au premier usage d'une
 * visite : ni le démarrage ni la vue du voisinage ne portent ces textes avant qu'on les demande.
 * Ajouter une visite : une fiche de plus ici, aucun autre code.
 */
import { parseVisit, type Visit } from '@/core/stellarVisit';
import neighbours from './neighbours.json';

export const STELLAR_VISITS: readonly Visit[] = [parseVisit(neighbours)];

export function visitById(id: string): Visit | null {
  return STELLAR_VISITS.find((v) => v.id === id) ?? null;
}
