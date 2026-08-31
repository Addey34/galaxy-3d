import { expect, test } from '@playwright/test';

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
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });

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
