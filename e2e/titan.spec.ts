import { expect, test } from '@playwright/test';

import { bootAndSettle } from './mainThread';

test.beforeEach(async ({ page }) => {
  await page.route('**/sbdb_query.api*', (route) => route.abort());
  // Ce test navigue entre lunes : il ne dépend pas des données météo Terre. On coupe les
  // appels réseau externes (SBDB, Open-Meteo) pour le rendre DÉTERMINISTE — sinon, sous
  // quota Open-Meteo épuisé (429), la rafale de retries pendant les 8 navigations peut
  // déstabiliser la page WebGL. Les couches météo dégradent proprement sans réseau.
  await page.route('**open-meteo.com/**', (route) => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

test('Planetary moons are navigable in both display modes with live information cards', async ({
  page,
}) => {
  /*
   * LE BUDGET DE CE TEST EST ÉCRIT, AVEC SA MESURE (lot 24).
   *
   * Ce scénario a rougi sur `main` à la fusion de la PR #42, TROIS tentatives sur trois, sur
   * `Test timeout of 120000ms exceeded` au clic du mode Explo. Il ne s'agissait ni d'une entrée
   * de palette inerte ni d'une fenêtre d'éphémérides en retard — l'hypothèse est falsifiée par
   * la mesure : sous frein CPU × 8, les huit lunes rendent `aria-disabled=false`, à chaque fois.
   *
   * Ce qui est vrai est plus simple, et se compte. Sous ce même frein, le 2026-09-28 :
   * démarrage **19,4 s**, apaisement du thread **3,3 s**, les huit navigations **66,5 s**
   * (de 4,3 à 13,2 s chacune, le coût étant celui des textures de la lune choisie), le passage
   * en Explo **8,7 s**. Soit **98 s** avant les dernières assertions, pour un budget de 120 s.
   * Le run VERT de `main` du lot 23 mettait 72 s : le test vivait donc à 60 % de son budget, et
   * la variation de machine déjà mesurée sur ce dépôt (59,5 min contre 35,8 min pour la même
   * suite, soit 1,66 ×) suffit à le faire déborder.
   *
   * 240 s, donc : 2,4 × le pire coût mesuré. Ce n'est pas une marge de précaution, c'est le
   * coût réel du travail demandé — huit corps à charger, plus un morphe d'échelle — écrit au
   * lieu d'être laissé au défaut. Un vrai bug échoue quand même : il échouerait aux trois
   * tentatives, et sur une assertion, pas sur la montre.
   */
  test.setTimeout(240_000);
  // Le chargeur masqué ne veut pas dire « cliquable » : cf. `e2e/mainThread.ts`, où la mesure
  // est écrite.
  await bootAndSettle(page);

  const info = page.locator('#body-info');
  const moons = [
    ['enceladus', 'Enceladus'],
    ['rhea', 'Rhea'],
    ['iapetus', 'Iapetus'],
    ['titan', 'Titan'],
    ['phobos', 'Phobos'],
    ['deimos', 'Deimos'],
    ['triton', 'Triton'],
    ['charon', 'Charon'],
  ] as const;

  // NAVIGATION — vérifiée sur TOUTES les lunes (opération légère : recherche + sélection +
  // fiche). Confirme que chaque lune est navigable et que sa fiche s'ouvre.
  for (const [id, name] of moons) {
    await page.locator('#body-search-trigger').click();
    await page.locator('#palette-input').fill(name);
    const moonButton = page.locator(`#orbit-${id}`);
    await expect(moonButton).toBeVisible();
    await moonButton.click();
    await expect(moonButton).toHaveClass(/is-active/);
    await expect(info).toBeVisible();
    await expect(info.locator('.bi-name')).toHaveText(name);
  }

  // SWITCH DE MODE — vérifié une seule fois (sur la lune sélectionnée en dernier). Le morph
  // educ↔explo est l'opération la plus lourde (recalcul positions/tailles + tweens) : la tester
  // sur les 8 lunes était redondant (même code) et saturait le GPU logiciel du runner CI. La
  // couverture reste complète : navigation × 8 + morph × 1 dans les deux sens.
  const [, lastName] = moons[moons.length - 1];
  await page.locator('.mode-btn[data-mode="explo"]').click();
  await expect(page.locator('body')).toHaveClass(/is-explo-mode/);
  await expect(info.locator('.bi-name')).toHaveText(lastName);
  await expect(info.locator('.bi-live-dist')).toContainText('AU');
  await expect(
    page.locator(`.explo-label[aria-label="${lastName}"]`)
  ).toBeVisible();

  await page.locator('.mode-btn[data-mode="educ"]').click();
  await expect(page.locator('body')).not.toHaveClass(/is-explo-mode/);
  await expect(info.locator('.bi-name')).toHaveText(lastName);
});
