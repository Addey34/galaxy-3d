/**
 * Exécute une liste de tâches asynchrones par vagues bornées, au lieu de toutes les lancer
 * d'un coup. Module PUR (aucun DOM, aucun réseau, aucune horloge) : testable seul.
 *
 * POURQUOI, et ce n'est pas une préférence de style. Les 64 binaires d'éphémérides étaient
 * demandés par un seul `Promise.all`, donc 64 requêtes ouvertes en même temps. Sur HTTP/2 elles
 * se partagent une connexion et la bande passante : chaque requête reste ouverte aussi longtemps
 * que le TOTAL, et aucune ne reçoit d'octets pendant de longs moments. Mesuré en production le
 * 2026-09-22 sur un lien à 24 ko/s : 25 requêtes sur 64 aboutissent, 39 meurent en
 * « TypeError: Failed to fetch » après 706 s.
 *
 * Avec une limite, le temps TOTAL ne change pas (il est borné par la bande passante), mais la
 * durée de CHAQUE requête s'effondre : les fichiers arrivent les uns après les autres au lieu
 * de traîner ensemble, et aucun ne reste inactif assez longtemps pour être coupé.
 *
 * La tâche passée ne doit pas rejeter : elle rend son échec comme VALEUR (cf.
 * `HorizonsEphemerisService`). Sinon les tâches déjà lancées continueraient après le rejet.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await task(items[index], index);
    }
  };
  const workers = Math.max(1, Math.min(Math.floor(limit), items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

/** Ce qui borne `mapWithByteBudget`. */
export interface ByteBudget<T> {
  /** Tâches TOUJOURS permises en même temps, quel que soit le débit : la borne mesurée ci-dessus. */
  readonly floor: number;
  /** Jamais plus de tâches en même temps que ceci. */
  readonly ceiling: number;
  /** Octets qu'une tâche fera transiter (une estimation par excès suffit). */
  readonly cost: (item: T) => number;
  /**
   * Octets qu'on peut avoir en vol AU-DELÀ du plancher, relu à chaque lancement : `null` tant
   * que le débit n'est pas mesuré, et le pool se comporte alors exactement comme
   * `mapWithConcurrency(items, floor, …)`.
   */
  readonly allowance: () => number | null;
  /**
   * Frein : tant qu'une tâche en vol a dépassé cet âge, on n'élargit plus. Le débit relu par
   * `allowance` a une MÉMOIRE (celle du démarrage, souvent) ; une requête lente, elle, dit le
   * lien d'AUJOURD'HUI. Mesuré le 2026-10-09 : bridé à 24 ko/s après un démarrage rapide, le
   * pool montait à 64 en vol sans ce frein.
   */
  readonly maxAgeMs?: number;
  /** Horloge monotone en millisecondes, injectable pour les tests. */
  readonly now?: () => number;
}

/**
 * Comme `mapWithConcurrency`, mais au-delà du plancher une tâche ne part que si les octets en
 * vol, elle comprise, tiennent dans ce que le lien MESURÉ livre (ligne 45.5, 2026-10-09).
 *
 * POURQUOI. Sur une machine lente, une vague de requêtes ne coûte presque rien au réseau
 * (10 ms) mais deux images au thread principal (`fetch`, puis `arrayBuffer`) : 64 fenêtres par
 * vagues de 6 prenaient 16 s sous frein CPU ×20, contre 8 s à 24 en vol et 6 s à 64. Mais
 * lever la borne sans condition rouvrirait la panne mesurée plus haut, sur lien pauvre. Le
 * budget d'octets garde les deux : un lien lent ou inconnu reste au plancher, un lien rapide
 * reçoit tout ce qu'il peut livrer.
 */
export async function mapWithByteBudget<T, R>(
  items: readonly T[],
  budget: ByteBudget<T>,
  task: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const floor = Math.max(1, Math.floor(budget.floor));
  const ceiling = Math.max(floor, Math.floor(budget.ceiling));
  const now = budget.now ?? (() => performance.now());
  const started = new Map<number, number>();
  let next = 0;
  let active = 0;
  let inFlightBytes = 0;
  return new Promise<R[]>((resolve) => {
    const stalled = (): boolean => {
      const maxAge = budget.maxAgeMs;
      if (maxAge === undefined) return false;
      const at = now();
      for (const since of started.values())
        if (at - since > maxAge) return true;
      return false;
    };
    const admits = (cost: number): boolean => {
      if (active >= ceiling) return false;
      if (active < floor) return true;
      if (stalled()) return false;
      const allowance = budget.allowance();
      return allowance !== null && inFlightBytes + cost <= allowance;
    };
    const launch = (): void => {
      while (next < items.length) {
        const index = next;
        const cost = Math.max(0, budget.cost(items[index]!));
        if (!admits(cost)) break;
        next++;
        active++;
        inFlightBytes += cost;
        started.set(index, now());
        void task(items[index]!, index).then((result) => {
          results[index] = result;
          started.delete(index);
          active--;
          inFlightBytes -= cost;
          if (next >= items.length && active === 0) resolve(results);
          else launch();
        });
      }
      if (items.length === 0) resolve(results);
    };
    launch();
  });
}
