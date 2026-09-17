/**
 * ROUTAGE DU SERVICE WORKER POUR LES PAGES D'ATTERRISSAGE — build uniquement, lu par la
 * configuration VitePWA de `vite.config.ts`.
 *
 * Deux règles, et chacune a déjà été fausse une fois pour la même raison : écrite pour la
 * forme `/jupiter/` (UN segment), elle ne voyait pas `/eclipse/2026-08-12/` (DEUX). Rien ne
 * cassait — ni test, ni e2e, ni build — et l'effet ne se voit que chez un visiteur revenu :
 *
 *   - `LANDING_PAGE_GLOB_IGNORES` : ces pages sont des quasi-copies d'`index.html`. Les
 *     précacher gonflait l'installation hors ligne de 1,1 à 3,1 Mio (mesuré : 27 → 80
 *     entrées) pour un contenu que l'app shell couvre déjà.
 *   - `NAVIGATE_FALLBACK_DENYLIST` : ce sont de VRAIS fichiers. Sans exclusion, un visiteur
 *     qui a déjà le service worker reçoit l'`index.html` en cache, donc les balises de tête
 *     de l'accueil, au lieu de la page demandée. L'application ouvre quand même la bonne
 *     vue (le chemin suffit), mais le document servi est le mauvais.
 *
 * `pwaRouting.test.ts` confronte les deux listes à TOUTES les pages que le build produit.
 * Pas d'import ici : `vite.config.ts` le charge avant que l'alias `@/` n'existe.
 */

/** Segment des pages d'éclipse — le même que `core/eclipsePages.ts::ECLIPSE_PATH_SEGMENT`. */
const ECLIPSE_SEGMENT = 'eclipse';

/** Préfixe des pages documentaires françaises (`/fr/methodology/`), cf. `documentPage.ts`. */
const FRENCH_SEGMENT = 'fr';

/** Fichiers générés à NE PAS précacher (motifs glob, relatifs à `dist/`). */
export const LANDING_PAGE_GLOB_IGNORES: string[] = [
  '*/index.html',
  `${ECLIPSE_SEGMENT}/*/index.html`,
  `${FRENCH_SEGMENT}/*/index.html`,
];

/** Navigations à NE PAS remplacer par l'app shell en cache. */
export const NAVIGATE_FALLBACK_DENYLIST: RegExp[] = [
  /^\/privacy\.html$/,
  // Un segment unique sans point : les pages de corps, sans toucher `/`, `/assets/…` ni les
  // fichiers.
  /^\/[^/.]+\/?$/,
  new RegExp(`^\\/${ECLIPSE_SEGMENT}\\/[^/.]+\\/?$`),
  // Les pages documentaires anglaises (`/methodology/`) tombent déjà sous la règle à un segment.
  new RegExp(`^\\/${FRENCH_SEGMENT}\\/[^/.]+\\/?$`),
];

export const ECLIPSE_SEGMENT_FOR_TESTS = ECLIPSE_SEGMENT;
