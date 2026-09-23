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

/**
 * Attend la fin des animations d'OUVERTURE avant de mesurer.
 *
 * Les surfaces s'ouvrent par `animation: surface-in 0.16s` de `opacity: 0` à `1`
 * (`src/styles.css`), et `toBeVisible()` est satisfait dès le premier pixel : axe pouvait donc
 * échantillonner EN COURS de fondu et lire des couleurs délavées. Mesuré le 2026-09-23 sur les
 * en-têtes du tableau de réglages : contraste 3,14 au lieu des 4,5 exigés, avec un alpha de
 * 0,40 là où le CSS déclare 0,62 (`--ink-dim`), soit un parent à environ 64,5 % d'opacité.
 * Ce n'était donc PAS un défaut d'accessibilité mais un défaut de MESURE, et il rendait la
 * porte non reproductible : la même page passait ou échouait selon la charge de la machine.
 *
 * Les animations INFINIES sont exclues (`tb-pulse`, `loader-orbit`, `context-recovery-spin`…) :
 * les attendre ne finirait jamais. Et l'attente est bornée, pour qu'une animation pathologique
 * fasse au pire une mesure imparfaite, jamais une suite suspendue.
 */
async function settleAnimations(
  page: import('@playwright/test').Page
): Promise<void> {
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter((animation) => {
      const iterations = animation.effect?.getTiming().iterations;
      return iterations !== Infinity;
    });
    await Promise.race([
      Promise.all(finite.map((a) => a.finished.catch(() => undefined))),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  });
}

async function runAxe(page: import('@playwright/test').Page) {
  await settleAnimations(page);
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

test('display settings, every group unfolded, has no automatically detectable a11y violations', async ({
  page,
}) => {
  // Tous les groupes dépliés : les lignes de groupe (un bouton dans un <th scope=rowgroup>,
  // trois cases) et les lignes repliées au départ passent aussi à axe. La section du champ
  // d'astéroïdes porte depuis le lot 8b une mention de provenance datée.
  await boot(page);
  await page.locator('#settings-trigger').click();
  const toggles = page.locator('#settings-table .oo-group-toggle');
  for (const toggle of await toggles.all())
    if ((await toggle.getAttribute('aria-expanded')) === 'false')
      await toggle.click();
  await expect(page.locator('#settings-table .oo-tr:visible')).toHaveCount(
    await page.locator('#settings-table .oo-tr').count()
  );
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
