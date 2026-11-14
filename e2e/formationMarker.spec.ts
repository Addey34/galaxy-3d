import { expect, test, type Locator, type Page } from '@playwright/test';
import { waitForCalmMainThread } from './mainThread';
import { MOON_SCENE_DATE } from './moonScene';
import { blockExternalNetwork } from './netBlock';

/**
 * LE REPÈRE APRÈS UNE RECHERCHE DE FORMATION (GAL-PRODUCT-014). La caméra se tourne vers la
 * formation choisie mais garde sa distance : à ~9 rayons le gazetteer n'écrit aucun nom, donc
 * rien à l'écran ne disait ce qui avait été sélectionné. Le repère est un élément DOM éphémère,
 * posé sur le point projeté de la formation, qui la nomme avec son corps.
 */
test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

const marker = (page: Page): Locator => page.locator('#formation-marker');

async function openPalette(page: Page): Promise<void> {
  await page.goto(`/?date=${MOON_SCENE_DATE}`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  await waitForCalmMainThread(page);
  await page.locator('#body-search-trigger').click();
  await expect(page.locator('#palette-input')).toBeFocused();
}

async function searchPlace(
  page: Page,
  query: string,
  label: string
): Promise<void> {
  const input = page.locator('#palette-input');
  await input.fill('');
  await input.pressSequentially(query);
  const hit = page.locator('.palette-hit[data-kind="place"]', {
    hasText: label,
  });
  await expect(hit.first()).toBeVisible();
  await hit.first().click();
}

test('after choosing a formation a visible marker names it and its body', async ({
  page,
}) => {
  await openPalette(page);
  await searchPlace(page, 'Tycho', 'Tycho');
  const canvas = page.locator('canvas').first();
  await expect(canvas).toHaveAttribute('data-search-focus', /^Tycho\|/, {
    timeout: 60_000,
  });
  await expect(marker(page)).toBeVisible();
  await expect(marker(page)).toContainText('Tycho');
  await expect(marker(page)).toContainText('Moon');
  // Il pose le repère sur le point visé : au centre de l'image, puisque le cadrage l'y amène.
  const box = await marker(page)
    .locator('.formation-marker-ring')
    .boundingBox();
  const view = page.viewportSize();
  expect(box).not.toBeNull();
  if (box && view) {
    expect(Math.abs(box.x + box.width / 2 - view.width / 2)).toBeLessThan(
      view.width * 0.1
    );
    expect(Math.abs(box.y + box.height / 2 - view.height / 2)).toBeLessThan(
      view.height * 0.15
    );
  }
});

test('the marker is announced once, with the formation and its body', async ({
  page,
}) => {
  await openPalette(page);
  await searchPlace(page, 'Tycho', 'Tycho');
  await expect(
    page.locator('[role="status"][aria-live="polite"]').filter({
      hasText: /Tycho.*Moon|Moon.*Tycho/,
    })
  ).toHaveCount(1, { timeout: 60_000 });
});

test('Escape removes the marker and leaves nothing running', async ({
  page,
}) => {
  await openPalette(page);
  await searchPlace(page, 'Tycho', 'Tycho');
  await expect(marker(page)).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press('Escape');
  await expect(marker(page)).toHaveCount(0);
});

test('going back to the global view removes the marker', async ({ page }) => {
  await openPalette(page);
  await searchPlace(page, 'Tycho', 'Tycho');
  await expect(marker(page)).toBeVisible({ timeout: 60_000 });
  await page.locator('#orbit-overview').click();
  await expect(marker(page)).toHaveCount(0);
});

test('a place address shows the same marker and keeps its contract', async ({
  page,
}) => {
  await page.goto(`/moon/?place=Mare%20Imbrium&date=${MOON_SCENE_DATE}`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  await expect(marker(page)).toBeVisible({ timeout: 60_000 });
  await expect(marker(page)).toContainText('Mare Imbrium');
  await expect(page).not.toHaveURL(/place=/);
});

test('two quick choices leave only the last formation marked', async ({
  page,
}) => {
  await openPalette(page);
  await searchPlace(page, 'Tycho', 'Tycho');
  await page.locator('#body-search-trigger').click();
  await expect(page.locator('#palette-input')).toBeFocused();
  await searchPlace(page, 'Copernicus', 'Copernicus');
  const canvas = page.locator('canvas').first();
  await expect(canvas).toHaveAttribute('data-search-focus', /^Copernicus\|/, {
    timeout: 60_000,
  });
  await expect(marker(page)).toContainText('Copernicus');
  await expect(marker(page)).not.toContainText('Tycho');
  await page.waitForTimeout(1500);
  await expect(canvas).toHaveAttribute('data-search-focus', /^Copernicus\|/);
  await expect(marker(page)).toHaveCount(1);
});

test('a choice overtaken by the global view neither turns the camera nor marks', async ({
  page,
}) => {
  await openPalette(page);
  const input = page.locator('#palette-input');
  await input.pressSequentially('Tycho');
  const hit = page.locator('.palette-hit[data-kind="place"]', {
    hasText: 'Tycho',
  });
  await expect(hit.first()).toBeVisible();
  // Dans le même tick : la formation se charge encore (`loadFormations`) quand la vue globale
  // reprend la main, donc la réponse qui arrive ensuite est périmée. Les vols sont instantanés
  // sous `prefers-reduced-motion`, c'est cette attente-là qui est la fenêtre de la course.
  await hit.first().evaluate((el) => {
    (el as HTMLElement).click();
    (document.querySelector('#orbit-overview') as HTMLElement).click();
  });
  const canvas = page.locator('canvas').first();
  await page.waitForTimeout(4000);
  await expect(marker(page)).toHaveCount(0);
  await expect(canvas).not.toHaveAttribute('data-search-focus', /.+/);
});

test('the marker never takes focus nor adds a tab stop', async ({ page }) => {
  await openPalette(page);
  await searchPlace(page, 'Tycho', 'Tycho');
  await expect(marker(page)).toBeVisible({ timeout: 60_000 });
  const before = await page.evaluate(
    () => document.activeElement?.id ?? document.activeElement?.tagName
  );
  await page.waitForTimeout(500);
  const after = await page.evaluate(
    () => document.activeElement?.id ?? document.activeElement?.tagName
  );
  expect(after).toBe(before);
  await expect(marker(page)).toHaveAttribute('aria-hidden', 'true');
  expect(
    await marker(page).locator('a, button, input, [tabindex]').count()
  ).toBe(0);
});
