import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { blockExternalNetwork } from './netBlock';

/**
 * Audit d'accessibilité automatisé (axe-core) — pas un remplacement d'un vrai passage au
 * lecteur d'écran (NVDA/VoiceOver), mais le meilleur proxy qu'on puisse faire tourner en CI :
 * détecte ~30-50 % des problèmes WCAG réels (contraste, labels manquants, rôles ARIA mal
 * formés, structure de landmarks). Un audit manuel avec un vrai lecteur d'écran reste
 * recommandé avant de clore le point « accessibilité » du roadmap.
 */

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
});

async function boot(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
}

async function runAxe(page: import('@playwright/test').Page) {
  return (
    new AxeBuilder({ page })
      // wcag2a/wcag2aa/wcag21aa : le socle normatif standard. Pas de disable de règle — si axe
      // trouve quelque chose, c'est traité comme un vrai finding, pas filtré par défaut.
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze()
  );
}

test('overview screen has no automatically detectable a11y violations', async ({
  page,
}) => {
  await boot(page);
  const results = await runAxe(page);
  expect(
    results.violations,
    JSON.stringify(results.violations, null, 2)
  ).toEqual([]);
});

test('body info panel has no automatically detectable a11y violations', async ({
  page,
}) => {
  await boot(page);
  await page.locator('#body-search-trigger').click();
  await page.locator('#orbit-earth').click();
  await expect(page.locator('#body-info')).toBeVisible();
  const results = await runAxe(page);
  expect(
    results.violations,
    JSON.stringify(results.violations, null, 2)
  ).toEqual([]);
});

test('body search palette has no automatically detectable a11y violations', async ({
  page,
}) => {
  await boot(page);
  await page.locator('#body-search-trigger').click();
  await expect(page.locator('#body-palette')).toBeVisible();
  const results = await runAxe(page);
  expect(
    results.violations,
    JSON.stringify(results.violations, null, 2)
  ).toEqual([]);
});

test('display settings panel has no automatically detectable a11y violations', async ({
  page,
}) => {
  await boot(page);
  await page.locator('#settings-trigger').click();
  await expect(page.locator('#orbit-options')).toBeVisible();
  await expect(page.locator('#quality-group')).toBeVisible();
  const results = await runAxe(page);
  expect(
    results.violations,
    JSON.stringify(results.violations, null, 2)
  ).toEqual([]);
});

test('weather layers panel has no automatically detectable a11y violations', async ({
  page,
}) => {
  await boot(page);
  await page.locator('#weather-trigger').click();
  await expect(page.locator('#weather-layers')).toBeVisible();
  const results = await runAxe(page);
  expect(
    results.violations,
    JSON.stringify(results.violations, null, 2)
  ).toEqual([]);
});

test('small-body panel has no automatically detectable a11y violations', async ({
  page,
}) => {
  // Le déclencheur n'existe qu'en Explo, et le panneau porte depuis le lot 8b une mention de
  // provenance datée : un texte publié de plus à passer à axe.
  await boot(page);
  await page.locator('.mode-btn[data-mode=explo]').click();
  await page.locator('#smallbody-filters-trigger').click();
  await expect(page.locator('#smallbody-filters')).toBeVisible();
  await expect(page.locator('#smallbody-filters .sb-source')).toBeVisible();
  const results = await runAxe(page);
  expect(
    results.violations,
    JSON.stringify(results.violations, null, 2)
  ).toEqual([]);
});

test('earth events panel has no automatically detectable a11y violations', async ({
  page,
}) => {
  await boot(page);
  await page.locator('#earth-events-trigger').click();
  await expect(page.locator('#earth-events')).toBeVisible();
  // Les deux couches allumées : la liste des événements, le badge et la note sont alors
  // rendus. Le réseau est coupé par `blockExternalNetwork`, donc les listes restent vides et
  // le panneau montre son état « aucun événement », qui doit lui aussi être lisible.
  const rows = page.locator('#earth-events .ee-item');
  await rows.nth(0).locator('input').check();
  await rows.nth(1).locator('input').check();
  const results = await runAxe(page);
  expect(
    results.violations,
    JSON.stringify(results.violations, null, 2)
  ).toEqual([]);
});

test('astronomical events panel has no automatically detectable a11y violations', async ({
  page,
}) => {
  await boot(page);
  await page.locator('#events-trigger').click();
  await expect(page.locator('#astronomical-events')).toBeVisible();
  const results = await runAxe(page);
  expect(
    results.violations,
    JSON.stringify(results.violations, null, 2)
  ).toEqual([]);
});

test('help popover has no automatically detectable a11y violations', async ({
  page,
}) => {
  await boot(page);
  await page.locator('#help-btn').click();
  await expect(page.locator('#help-popover')).toBeVisible();
  const results = await runAxe(page);
  expect(
    results.violations,
    JSON.stringify(results.violations, null, 2)
  ).toEqual([]);
});

test('explo mode overview has no automatically detectable a11y violations', async ({
  page,
}) => {
  await page.goto('/?mode=explo');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  const results = await runAxe(page);
  expect(
    results.violations,
    JSON.stringify(results.violations, null, 2)
  ).toEqual([]);
});

test.describe('mobile viewport', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('mobile overview has no automatically detectable a11y violations', async ({
    page,
  }) => {
    await boot(page);
    const results = await runAxe(page);
    expect(
      results.violations,
      JSON.stringify(results.violations, null, 2)
    ).toEqual([]);
  });
});
