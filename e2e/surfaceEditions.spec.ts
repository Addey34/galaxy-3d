import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { blockExternalNetwork } from './netBlock';

/**
 * LES OBSERVATIONS DE L'ATMOSPHÈRE (GAL-ATMOSPHERES-001) : choisir une observation datée depuis la fiche,
 * comparer deux millésimes, au clavier ; un choix rapide jette le chargement abandonné ; une ressource
 * absente le dit et garde la carte affichée ; quitter la fiche rend l'édition par défaut ; la scène ne bouge
 * pas (cadrage intact).
 */
// Le service worker servirait les textures et contournerait l'interception (retards, refus) : bloqué.
test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
});

async function boot(page: Page, body: string, lang = 'en'): Promise<string[]> {
  const requested: string[] = [];
  page.on('request', (r) => {
    if (/\/textures\/[a-z]+\/[a-z]+_surface/.test(r.url()))
      requested.push(r.url().split('/').pop()!);
  });
  await page.addInitScript((l) => localStorage.setItem('ssv-locale', l), lang);
  await page.goto(`/?body=${body}&date=2030-06-01T00:00:00Z`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  await expect(page.locator('#surface-editions')).toBeVisible({
    timeout: 60_000,
  });
  return requested;
}

const box = (page: Page) => page.locator('#surface-editions');
const option = (page: Page, edition: string) =>
  page.locator(`#surface-editions [role="radio"][data-edition="${edition}"]`);

test('Jupiter : choisir 2015, la carte de cette édition, la fiche la dit, la scène ne bouge pas', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const requested = await boot(page, 'jupiter');
  await expect(page.locator('#surface-editions [role="radio"]')).toHaveCount(3);
  await expect(option(page, 'opal_2025a')).toHaveAttribute(
    'aria-checked',
    'true'
  );
  await expect(box(page)).toContainText('Scene date: June 1, 2030');
  await expect(box(page)).toContainText('Nothing is interpolated');
  await expect(box(page)).toContainText('rotation phase is not dated');
  const url = page.url();

  await option(page, 'opal_2015a').click();
  await expect(box(page)).toHaveAttribute(
    'data-applied-edition',
    'opal_2015a',
    { timeout: 30_000 }
  );
  expect(requested.some((f) => f.includes('__opal_2015a_'))).toBe(true);
  await expect(box(page)).toHaveAttribute('data-scene-edition', 'opal_2015a');
  await expect(page.locator('#body-info .bi-color-nature')).toHaveText(
    'Colour: enhanced colour, January 19, 2015'
  );
  await expect(page.locator('#body-info .bi-surface-note')).toContainText(
    'observed on January 19, 2015'
  );
  await expect(box(page)).toContainText('3600 px');
  // Le cadrage : ni l'adresse ni l'état de mouvement de la scène ne changent.
  expect(page.url()).toBe(url);
  await expect(page.locator('canvas').first()).not.toHaveAttribute(
    'data-scene-moving',
    '1'
  );

  // Comparer : retour à 2025, puis le bouton propose 2015.
  const compare = page.locator('#surface-editions-compare');
  await expect(compare).toHaveText('Compare with December 11, 2025');
  await compare.click();
  await expect(box(page)).toHaveAttribute(
    'data-applied-edition',
    'opal_2025a',
    { timeout: 30_000 }
  );
  await expect(compare).toHaveText('Compare with January 19, 2015');

  // Au clavier : les flèches choisissent l'observation voisine.
  await option(page, 'opal_2025a').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(box(page)).toHaveAttribute(
    'data-applied-edition',
    'opal_2020a',
    { timeout: 30_000 }
  );
  await expect(option(page, 'opal_2020a')).toBeFocused();
});

test('un choix rapide jette le chargement abandonné, même arrivé après', async ({
  page,
}) => {
  test.setTimeout(180_000);
  // L'édition 2015 arrive avec 3 s de retard : choisie puis abandonnée, elle ne doit jamais s'afficher.
  await page.route('**/jupiter_surface__opal_2015a_*', async (route) => {
    await new Promise((r) => setTimeout(r, 3000));
    await route.continue();
  });
  await boot(page, 'jupiter');
  // Scène IMMOBILE d'abord : en vol, le LOD recharge l'édition courante et masquerait un défaut.
  await expect(
    page.locator('canvas[data-scene-moving]').first()
  ).toHaveAttribute('data-scene-moving', '0', { timeout: 60_000 });
  await page.waitForTimeout(1500);
  // Chaque édition que la scène a MONTRÉE, même une seule image.
  await page.evaluate(() => {
    const box = document.getElementById('surface-editions')!;
    const seen: string[] = [];
    (window as unknown as { __sceneEditions: string[] }).__sceneEditions = seen;
    new MutationObserver(() => {
      seen.push(box.dataset['sceneEdition'] ?? '');
    }).observe(box, {
      attributes: true,
      attributeFilter: ['data-scene-edition'],
    });
  });
  await option(page, 'opal_2015a').click();
  await option(page, 'opal_2020a').click();
  await expect(box(page)).toHaveAttribute(
    'data-applied-edition',
    'opal_2020a',
    { timeout: 30_000 }
  );
  await page.waitForTimeout(4000);
  await expect(box(page)).toHaveAttribute('data-applied-edition', 'opal_2020a');
  // Ce que la SCÈNE montre : la carte posée sur la planète est celle de 2020, pas l'arrivée tardive de 2015.
  await expect(box(page)).toHaveAttribute('data-scene-edition', 'opal_2020a');
  const seen = await page.evaluate(
    () => (window as unknown as { __sceneEditions: string[] }).__sceneEditions
  );
  expect(seen).not.toContain('opal_2015a');
  await expect(option(page, 'opal_2020a')).toHaveAttribute(
    'aria-checked',
    'true'
  );
});

test('une observation indisponible le dit et garde la carte affichée', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.route('**/neptune_surface__opal_2015a_*', (route) =>
    route.abort()
  );
  await boot(page, 'neptune');
  await option(page, 'opal_2015a').click();
  await expect(
    page.locator('#surface-editions .bi-editions-status')
  ).toContainText('could not be loaded', { timeout: 30_000 });
  await expect(box(page)).toHaveAttribute('data-applied-edition', 'opal_2026a');
  await expect(box(page)).toHaveAttribute('data-scene-edition', 'opal_2026a');
  await expect(option(page, 'opal_2026a')).toHaveAttribute(
    'aria-checked',
    'true'
  );
});

test("quitter la fiche rend l'édition par défaut ; Uranus charge sa carte native de 720 px", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const requested = await boot(page, 'uranus');
  expect(requested).toContain('uranus_surface__opal_2026a_1k.jpg');
  await option(page, 'opal_2015a').click();
  await expect(box(page)).toHaveAttribute(
    'data-applied-edition',
    'opal_2015a',
    { timeout: 30_000 }
  );
  await page.locator('#orbit-overview').click();
  await expect(page.locator('#body-info')).toBeHidden();
  await page.locator('#body-search-trigger').click();
  await page.locator('#orbit-uranus').click();
  await expect(box(page)).toBeVisible({ timeout: 30_000 });
  await expect(option(page, 'opal_2026a')).toHaveAttribute(
    'aria-checked',
    'true'
  );
  await expect(box(page)).toHaveAttribute('data-applied-edition', 'opal_2026a');
});

for (const [lang, title] of [
  ['fr', 'Observations de l’atmosphère'],
  ['es', 'Observaciones de la atmósfera'],
  ['pt-BR', 'Observações da atmosfera'],
] as const)
  test(`quatre langues : ${lang}`, async ({ page }) => {
    test.setTimeout(150_000);
    await boot(page, 'saturn', lang);
    await expect(page.locator('#surface-editions-title')).toHaveText(title);
  });

test('axe et 390 px sans débordement', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((l) => localStorage.setItem('ssv-locale', l), 'en');
  await page.goto('/?body=saturn');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  if (await page.locator('#body-info.is-compact').count())
    await page.locator('#body-info .bi-toggle').click();
  await expect(box(page)).toBeVisible({ timeout: 60_000 });
  const results = await new AxeBuilder({ page })
    .include('#surface-editions')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
  await page.addStyleTag({ content: '* { letter-spacing: 1px !important; }' });
  const over = await page.evaluate(() =>
    [...document.querySelectorAll('#surface-editions *')]
      .filter((el) => el.scrollWidth - el.clientWidth > 1)
      .map((el) => el.className)
  );
  expect(over).toEqual([]);
});
