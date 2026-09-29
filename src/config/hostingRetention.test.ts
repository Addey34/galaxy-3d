import { describe, expect, it } from 'vitest';

import {
  KEEP_PER_SITE,
  versionsToDelete,
} from '../../scripts/prune-hosting-versions.mjs';

/**
 * L'ÉLAGUEUR DES VERSIONS D'HÉBERGEMENT, CONFRONTÉ À CE QU'IL PEUT DÉTRUIRE.
 *
 * Firebase Hosting n'a aucune rétention automatique : chaque déploiement empile une version de
 * plus, pour toujours, et le quota du projet finit par sauter. La purge se faisait À LA MAIN
 * dans la console — une trentaine de minutes tous les quatre jours, sur une centaine de
 * versions, et sur SEPT sites qui partagent le même quota. C'est cette corvée que le script
 * supprime.
 *
 * Mais il SUPPRIME chez un hébergeur de production, donc la seule partie qui décide — laquelle
 * part — est pure, et elle est éprouvée ici sur les cas qui coûteraient cher :
 *
 *   - supprimer la version SERVIE mettrait le site hors ligne ;
 *   - supprimer une version `CREATED` casserait un déploiement EN VOL ;
 *   - se fier à l'ordre de pagination plutôt qu'à `createTime` supprimerait les mauvaises.
 */

const version = (over: Record<string, unknown> = {}) => ({
  name: 'sites/s/versions/v',
  status: 'FINALIZED',
  createTime: '2026-01-01T00:00:00Z',
  versionBytes: '1000',
  ...over,
});

const series = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    version({
      name: `sites/s/versions/v${i}`,
      // i croissant = plus RÉCENT, pour que l'ordre du tableau ne coïncide pas avec l'ordre
      // chronologique : un tri qui s'appuierait sur la position se trahirait ici.
      createTime: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
    })
  );

describe('versionsToDelete', () => {
  it('ne touche JAMAIS la version servie, même si elle est la plus ancienne', () => {
    const versions = series(20);
    const live = 'sites/s/versions/v0';
    const doomed = versionsToDelete(versions, live, 3);
    expect(doomed.map((v) => v.name)).not.toContain(live);
    // Et elle ne consomme pas non plus l'un des 3 gardés : ils s'ajoutent à elle.
    expect(doomed).toHaveLength(20 - 1 - 3);
  });

  it('épargne un déploiement EN VOL', () => {
    // `CREATED` est une version en cours de mise en ligne. La supprimer casserait le
    // déploiement qui l'a créée — y compris celui qui vient de lancer cet élagage.
    const versions = [
      ...series(10),
      version({
        name: 'sites/s/versions/enVol',
        status: 'CREATED',
        createTime: '2020-01-01T00:00:00Z',
      }),
    ];
    const doomed = versionsToDelete(versions, null, 2);
    expect(doomed.map((v) => v.name)).not.toContain('sites/s/versions/enVol');
  });

  it('garde les plus RÉCENTES, pas les premières rendues par l’API', () => {
    // L'ordre de pagination n'est pas un contrat. Le tableau est ici MÉLANGÉ, et c'est
    // délibéré : une première version de ce test le donnait simplement inversé, or l'inverse
    // de la chronologie EST l'ordre que le tri produit — le test passait donc avec le tri
    // retiré, et ne prouvait rien. Un témoin doit contenir ce qu'on prétend mesurer.
    const shuffled = [3, 7, 0, 5, 1, 6, 2, 4];
    const all = series(8);
    const versions = shuffled.map((i) => all[i]!);
    const doomed = versionsToDelete(versions, null, 3);
    const kept = series(8)
      .map((v) => v.name)
      .filter((n) => !doomed.some((d) => d.name === n));
    expect(kept.sort()).toEqual(
      [
        'sites/s/versions/v5',
        'sites/s/versions/v6',
        'sites/s/versions/v7',
      ].sort()
    );
  });

  it('rend les condamnées de la plus ANCIENNE à la plus récente', () => {
    // On supprime du plus vieux au plus jeune : si l'exécution est coupée en chemin, ce qui
    // reste est l'état le plus récent, jamais un trou au milieu.
    const doomed = versionsToDelete(series(9), null, 2);
    const dates = doomed.map((v) => v.createTime!);
    expect([...dates].sort()).toEqual(dates);
  });

  it('ne supprime RIEN quand il n’y a pas plus que ce qu’on garde', () => {
    expect(versionsToDelete(series(5), null, 5)).toEqual([]);
    expect(versionsToDelete(series(3), null, 5)).toEqual([]);
    expect(versionsToDelete([], null, 5)).toEqual([]);
  });

  it('refuse une entrée qu’il ne comprend pas, au lieu de deviner', () => {
    // « Je n'ai pas compris » ne doit jamais se confondre avec « il n'y avait rien à garder » :
    // c'est la différence entre lever une erreur et vider un site.
    expect(() => versionsToDelete(null as never, null, 5)).toThrow(TypeError);
    expect(() => versionsToDelete(series(3), null, 0)).toThrow(RangeError);
    expect(() => versionsToDelete(series(3), null, -1)).toThrow(RangeError);
    // Une entrée sans `name` ne peut pas être supprimée : on l'ignore plutôt que d'émettre
    // une adresse `undefined` à l'API.
    expect(
      versionsToDelete(
        [{ status: 'FINALIZED' } as never, ...series(9)],
        null,
        2
      )
    ).toHaveLength(7);
  });

  it('déclare une rétention qui a un sens', () => {
    expect(KEEP_PER_SITE).toBeGreaterThanOrEqual(3);
    expect(KEEP_PER_SITE).toBeLessThanOrEqual(20);
  });
});
