/**
 * Déclarations de `prune-hosting-versions.mjs`, pour que
 * `src/config/hostingRetention.test.ts` le confronte SOUS TYPES plutôt qu'en `any`.
 *
 * Écrit à la main, comme `check-ci-health.d.mts` et pour la même raison : le script doit
 * tourner avec un `node` nu dans la CI, juste après le déploiement, sans dépendance ni serveur
 * Vite. Il ne peut donc pas vivre en TypeScript dans `src/`.
 *
 * Seule la partie PURE est déclarée : c'est la seule qui décide quoi que ce soit, donc la seule
 * qu'on puisse éprouver sans réseau — et la seule qui peut effacer un site si elle se trompe.
 */

/** Une version d'hébergement, réduite à ce dont la décision dépend. */
export interface HostingVersion {
  /** Nom complet de la ressource, `sites/{site}/versions/{id}`. */
  readonly name: string;
  /** `FINALIZED` (déployée), `CREATED` (déploiement EN VOL), `DELETED`… */
  readonly status?: string;
  readonly createTime?: string;
  /** Octets, rendus par l'API en CHAÎNE (entier 64 bits en JSON). */
  readonly versionBytes?: string;
}

/** Versions conservées par site, EN PLUS de celle qui est servie. */
export const KEEP_PER_SITE: number;

/**
 * Les versions à supprimer, de la plus ANCIENNE à la plus récente.
 *
 * Lève plutôt que de deviner : `TypeError` sur une entrée qui n'est pas un tableau,
 * `RangeError` sur une rétention qui n'est pas un entier positif.
 */
export function versionsToDelete(
  versions: readonly HostingVersion[],
  liveVersionName: string | null,
  keep?: number
): HostingVersion[];
