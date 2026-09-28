import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';
import {
  EPHEMERIS_STARTUP_BUDGET_BYTES,
  FIRST_VIEW_TEXTURE_REFINEMENTS,
  MODEL_FLOOR_QUALITY,
  TEXTURE_FLOOR_TIER,
  classifyStartupUrl,
} from '../src/core/startupBudget';

/**
 * CE QUE LE DÉMARRAGE DEMANDE VRAIMENT, DANS UN VRAI NAVIGATEUR (lot 17, phase 17F).
 *
 * `src/config/startupBudget.test.ts` DÉRIVE ce que le démarrage doit demander, depuis le
 * catalogue et les deux règles de palier. Ce scénario-ci vérifie que la dérivation dit la vérité :
 * c'est la doctrine du lot 17D — un modèle vérifié, pas un modèle plausible. Sans lui, la garde
 * unitaire resterait verte pour un démarrage qui aurait changé de comportement sous elle.
 *
 * Le piège 2 du plan s'applique : Playwright compte un élément ABSENT comme masqué, donc on
 * attend `#loader` VISIBLE avant de l'attendre masqué. Sans cette première attente, la mesure
 * rend la main avant que l'application existe (0,4 s et 13 requêtes au lieu de 15,3 s et 159).
 *
 * La famille JavaScript n'est PAS vérifiable ici : le serveur de dev sert des modules
 * (`/src/...`), pas les morceaux hachés de `dist/`. Elle est tenue par
 * `scripts/check-startup-budget.mjs` après le build, et mesurée en production par
 * `scripts/measure-startup-bytes.mjs`.
 */

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

/** `/assets/textures/venus/venus_clouds_1k.jpg` -> `venus/clouds` + `1k`. */
function textureTier(path: string): { key: string; tier: string } | null {
  const match = /\/assets\/textures\/([^/]+)\/\1_(.+)_(1k|2k|4k|8k)\.\w+$/.exec(
    path
  );
  if (!match) return null;
  return { key: `${match[1]}/${match[2]}`, tier: match[3]! };
}

test('le démarrage ne demande que les paliers planchers, et sa fenêtre tient dans son budget', async ({
  page,
}) => {
  test.setTimeout(240_000);

  const textures: { key: string; tier: string }[] = [];
  const models: string[] = [];
  let ephemerisBytes = 0;

  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    switch (classifyStartupUrl(request.url())) {
      case 'textures': {
        const parsed = textureTier(path);
        if (parsed) textures.push(parsed);
        break;
      }
      case 'models': {
        const match = /_shape_(1k|2k|4k)\.glb$/.exec(path);
        if (match) models.push(match[1]!);
        break;
      }
      case 'ephemerides': {
        const range = /^bytes=(\d+)-(\d+)$/.exec(
          request.headers()['range'] ?? ''
        );
        if (range) ephemerisBytes += Number(range[2]) - Number(range[1]) + 1;
        break;
      }
      default:
        break;
    }
  });

  await page.goto('/');
  await expect(page.locator('#loader')).toBeVisible();
  await expect(page.locator('#loader')).toBeHidden({ timeout: 180_000 });

  // (1) La dérivation a vu quelque chose. Sans cette borne, un sélecteur cassé rendrait des
  // listes vides, donc trois assertions vertes qui ne mesurent rien.
  expect(textures.length).toBeGreaterThan(40);
  expect(models.length).toBeGreaterThan(10);
  expect(ephemerisBytes).toBeGreaterThan(0);

  // (2) Aucun palier au-dessus du plancher, sauf les raffinements de première vue NOMMÉS.
  const allowed = new Set(
    FIRST_VIEW_TEXTURE_REFINEMENTS.map(
      (refinement) =>
        `${refinement.body}/${refinement.layer}@${refinement.tier}`
    )
  );
  const unexpected = textures.filter(
    ({ key, tier }) =>
      tier !== TEXTURE_FLOOR_TIER && !allowed.has(`${key}@${tier}`)
  );
  expect(
    [...new Set(unexpected.map((t) => `${t.key}@${t.tier}`))],
    `ces textures partent au démarrage au-dessus du plancher « ${TEXTURE_FLOOR_TIER} » sans être ` +
      `déclarées dans FIRST_VIEW_TEXTURE_REFINEMENTS. Soit la première vue s'est mise à charger ` +
      `un palier fin, soit c'est légitime et il faut l'écrire avec sa raison.`
  ).toEqual([]);

  // (2 bis) ET la liste des raffinements n'est pas décorative : CHACUN est réellement demandé au
  // démarrage. Sans cette ligne, l'assertion précédente resterait verte pour une liste vide ou
  // pour une entrée devenue obsolète, qui autoriserait alors un palier fin que plus rien ne
  // charge — la tautologie payée DEUX fois au lot 17E.
  //
  // ON ATTEND CE RAFFINEMENT, ON NE LE SURPREND PAS (lot 24). Cette assertion était jouée à
  // l'instant où le chargeur se masque, alors qu'un raffinement peut légitimement partir juste
  // après : sur les huit derniers runs de `main`, ce test est passé QUATRE fois au réessai, et
  // la dernière fois il manquait exactement `sun/surface@2k`. C'est le même défaut que celui
  // corrigé sur `e2e/events.spec.ts` — une attente de test plus courte que celle du produit.
  //
  // La force de l'affirmation est intacte : une déclaration devenue obsolète n'arrive JAMAIS,
  // donc le sondage expire et le message est le même.
  await expect
    .poll(
      () => {
        const observed = new Set(
          textures.map(({ key, tier }) => `${key}@${tier}`)
        );
        return [...allowed].filter((declared) => !observed.has(declared));
      },
      {
        timeout: 30_000,
        intervals: [500],
        message:
          `ces raffinements sont déclarés dans FIRST_VIEW_TEXTURE_REFINEMENTS mais le démarrage ne les ` +
          `demande pas : soit la première vue a changé, soit la déclaration ne décrit plus rien.`,
      }
    )
    .toEqual([]);

  // (3) Les maillages : le plus léger, jamais mieux. Le LOD monte à l'approche, pas au boot.
  expect(
    [...new Set(models)].filter((quality) => quality !== MODEL_FLOOR_QUALITY),
    `le démarrage doit charger « ${MODEL_FLOOR_QUALITY} » pour chaque corps modélisé`
  ).toEqual([]);

  // (4) La fenêtre d'éphémérides, confrontée au MÊME plafond que la garde unitaire.
  expect(ephemerisBytes).toBeLessThanOrEqual(EPHEMERIS_STARTUP_BUDGET_BYTES);
});
