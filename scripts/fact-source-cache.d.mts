/**
 * Déclarations de `fact-source-cache.mjs`, pour que `src/config/factSourceDates.test.ts` le
 * confronte SOUS TYPES plutôt qu'en `any`.
 *
 * Même raison que `check-ci-health.d.mts` : le relevé des faits tourne avec un `node` nu, appelé
 * par `pnpm facts:snapshot`, sans serveur Vite pour charger du TypeScript. Le module ne peut donc
 * pas vivre dans `src/`, et c'est cette déclaration écrite à la main qui rend ses fonctions
 * vérifiables. Une déclaration qui dériverait de l'implémentation ferait rougir la garde : le
 * test appelle ces fonctions sur un vrai cache et compare leurs résultats.
 */

/** `.cache/fact-sources`, le dossier des réponses relevées. Ignoré par git, délibérément. */
export const CACHE_DIR: string;

/** Le JOUR d'un instant, en UTC. Une date de lecture est un jour, jamais une heure. */
export function day(at: Date | string | number): string;

/** Clé de cache d'une URL, inchangée depuis le lot 4 : rien ne se réinvalide. */
export function cacheKey(url: string): string;

/**
 * La date de lecture d'une réponse DÉJÀ en cache : son horodatage voisin, ou, pour une entrée
 * héritée, la date d'écriture de son fichier, fixée au passage. Ne demande jamais l'heure.
 */
export function stampOf(path: string): string;

/** Horodate une réponse qui ARRIVE : à cet instant seul, l'heure courante est sa date. */
export function stampNow(path: string, at?: Date): string;

/** Les dates de lecture d'une section, distinctes et triées, DÉDUITES de ses réponses. */
export function sectionDates(section: unknown): string[];

/** Refuse un relevé où un objet cite une `url` sans dire quand elle a été lue. */
export function assertEveryUrlDated<T>(snapshot: T): T;
