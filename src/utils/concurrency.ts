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
