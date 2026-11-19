/**
 * FAÇADE EXHAUSTIVE DES VISITES GUIDÉES : BUILD ET TESTS SEULEMENT (lot 21, GAL-TOUR-SCALE-001).
 *
 * Même rôle que `config/surfaceTilesets.ts` vis-à-vis de `registry/products/tilesets/` : le
 * registre `src/registry/tours/` est de la DONNÉE, ce module en matérialise TOUTES les fiches. Il
 * sert aux pages d'activités générées (`vite.config.ts`) et aux tests scientifiques. Le navigateur
 * ne l'importe plus : il lit un catalogue léger (`virtual:tour-catalogue`) et télécharge UNE fiche
 * à l'ouverture (`registry/tours/lazy.ts`). Ajouter une visite reste une fiche JSON de plus et une
 * ligne dans `order.json` — aucune ligne de TypeScript.
 *
 * Le texte des visites ne passe plus par la carte de traduction du catalogue : la fiche porte ses
 * quatre langues et voyage dans son propre morceau (`docs/ARCHITECTURE.md` § « Les visites à la
 * demande »).
 */
import type { TourScript } from '@/core/tourEngine';
import { loadTourScripts } from '@/registry/tours/all';

export { resolveEventDate } from './tourEvents';

export const TOUR_SCRIPTS: TourScript[] = loadTourScripts();
