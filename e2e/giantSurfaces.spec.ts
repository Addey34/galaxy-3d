import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { blockExternalNetwork } from './netBlock';

/**
 * JUPITER ET SATURNE OBSERVÉS (GAL-CATALOG-EXCELLENCE-001) : la fiche dit la NATURE de l'image (couleur
 * accentuée) et sa DATE d'observation, en clair, indépendante de la date de la scène, et que des latitudes
 * sont complétées ; le client demande le fichier de l'ÉDITION (`__opal_2025a`), jamais l'ancien nom.
 */
test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
});

async function openCard(
  page: Page,
  body: string,
  lang = 'en',
  date = '2030-06-01T00:00:00Z'
): Promise<string[]> {
  const textures: string[] = [];
  page.on('request', (r) => {
    if (/\/textures\/(jupiter|saturn)\/.*surface/.test(r.url()))
      textures.push(r.url().split('/').pop()!);
  });
  await page.addInitScript((l) => localStorage.setItem('ssv-locale', l), lang);
  await page.goto(`/?body=${body}&date=${date}`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  await expect(page.locator('#body-info .bi-surface-note')).toBeVisible({
    timeout: 60_000,
  });
  return textures;
}

for (const [body, day] of [
  ['jupiter', 'December 11, 2025'],
  ['saturn', 'August 29, 2025'],
] as const)
  test(`${body} : nature, date de l'observation, latitudes complétées, fichier de l'édition`, async ({
    page,
  }) => {
    test.setTimeout(150_000);
    // Une date de scène LOIN de l'observation : la fiche doit dire que la carte n'est pas celle de ce jour.
    const textures = await openCard(page, body);
    const badge = page.locator('#body-info .bi-color-nature');
    await expect(badge).toHaveText(`Colour: enhanced colour, ${day}`);
    await expect(badge).toHaveAttribute('title', /not what the eye would see/);
    const note = page.locator('#body-info .bi-surface-note');
    await expect(note).toContainText(`observed on ${day}`);
    await expect(note).toContainText('not the date of the scene');
    await expect(note).toContainText('measured mean colour of their edges');
    await expect
      .poll(() => textures.filter((f) => f.includes('__opal_2025a_')).length, {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);
    expect(textures.filter((f) => !f.includes('__opal_2025a_'))).toEqual([]);
  });

test('en français, et axe sur la fiche à 390 px sans débordement', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((l) => localStorage.setItem('ssv-locale', l), 'fr');
  await page.goto('/?body=jupiter');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  if (!(await page.locator('#body-info').isVisible()))
    await page.locator('#info-trigger').click();
  if (await page.locator('#body-info.is-compact').count())
    await page.locator('#body-info .bi-toggle').click();
  const note = page.locator('#body-info .bi-surface-note');
  await expect(note).toBeVisible({ timeout: 60_000 });
  await expect(note).toContainText('observée le 11 décembre 2025');
  await expect(page.locator('#body-info .bi-color-nature')).toHaveText(
    'Couleur : couleur accentuée, 11 décembre 2025'
  );
  // Le socle de `a11y-audit.spec.ts` : WCAG 2.0/2.1 A et AA, sans règle désactivée.
  const results = await new AxeBuilder({ page })
    .include('#body-info')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
  await page.addStyleTag({ content: '* { letter-spacing: 1px !important; }' });
  const over = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '#body-info .bi-surface-note, #body-info .bi-color-nature'
      ),
    ]
      .filter((el) => el.scrollWidth - el.clientWidth > 1)
      .map((el) => el.className)
  );
  expect(over).toEqual([]);
});
