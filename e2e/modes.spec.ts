import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/sbdb_query.api*', (route) => route.abort());
});

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
}

test('educational projected names are pointer-clickable and select a new body', async ({
  page,
}) => {
  await boot(page);
  const marsLabel = page.locator('.explo-label[aria-label="Mars"]');
  await expect(marsLabel).toBeVisible();
  await expect(marsLabel).toHaveCSS('pointer-events', 'auto');
  await expect(marsLabel).toHaveCSS('--label-rgb', '232, 93, 63');

  await marsLabel.click();
  await expect(page.locator('#orbit-mars')).toHaveClass(/is-active/);
  await expect(page.locator('#body-info')).toBeVisible();
  await expect(page.locator('#body-info .bi-name')).toHaveText('Mars');
});

test('selection, information panel and target semantics survive both mode switches', async ({
  page,
}) => {
  await boot(page);
  await page.locator('#orbit-earth').click();
  const info = page.locator('#body-info');
  await expect(info).toBeVisible();

  await page.locator('.mode-btn[data-mode="explo"]').click();
  await expect(page.locator('body')).toHaveClass(/is-explo-mode/);
  await expect(info).toBeVisible();
  await expect(info.locator('.bi-name')).toHaveText('Earth');
  await expect(page.locator('#scale-disclaimer')).toContainText(
    'Linear distances'
  );

  const target = page.locator('.explo-label.is-target');
  await expect(target).toHaveAttribute('aria-label', 'Earth');
  await expect(target.locator('.explo-label-text')).toBeHidden();
  await expect(target.locator('.explo-label-dot')).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)'
  );

  await page.locator('.mode-btn[data-mode="educ"]').click();
  await expect(page.locator('#explo-labels')).toHaveClass(/is-educ-mode/);
  await expect(info).toBeVisible();
  await expect(target.locator('.explo-label-text')).toBeHidden();
  await expect(target.locator('.explo-label-dot')).toBeVisible();
  await expect(page.locator('#scale-disclaimer')).toContainText(
    'Compressed distances'
  );
});

test('settings stay available in both modes and control label density', async ({
  page,
}) => {
  await boot(page);
  const settings = page.locator('#orbit-options');
  const labelTexts = page.locator('.explo-label-text');
  const hasVisibleLabel = () =>
    labelTexts.evaluateAll((labels) =>
      labels.some((label) => getComputedStyle(label).display !== 'none')
    );

  await expect(settings).toBeVisible();
  await expect(page.locator('#labels-visible')).toBeChecked();
  await expect(page.locator('#orbits-visible')).toBeChecked();
  await expect(page.locator('.orbit-picker')).not.toHaveAttribute('open', '');
  await page.locator('.orbit-picker-summary').click();
  await expect(page.locator('.orbit-picker')).toHaveAttribute('open', '');
  await expect(page.locator('.orbit-picker .oo-row').first()).toBeVisible();
  expect(await hasVisibleLabel()).toBe(true);

  await page.locator('#labels-visible').uncheck();
  expect(await hasVisibleLabel()).toBe(false);
  await expect(
    page.locator('.explo-label:not(.is-target) .explo-label-dot').first()
  ).toBeHidden();

  await page.locator('.mode-btn[data-mode="explo"]').click();
  await expect(page.locator('body')).toHaveClass(/is-explo-mode/);
  await expect(settings).toBeVisible();
  await expect(page.locator('#orbit-overview')).toBeVisible();

  await page.locator('#labels-visible').check();
  expect(await hasVisibleLabel()).toBe(true);
});

test('visible projected annotations do not overlap each other', async ({
  page,
}) => {
  await boot(page);
  const overlaps = await page
    .locator('.explo-label-text')
    .evaluateAll((labels) => {
      const visible = labels
        .map((label) => ({
          name: label.parentElement?.getAttribute('aria-label'),
          rect: label.getBoundingClientRect(),
        }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0);
      const collisions: string[] = [];
      for (let i = 0; i < visible.length; i++) {
        for (let j = i + 1; j < visible.length; j++) {
          const a = visible[i];
          const b = visible[j];
          const overlapX =
            Math.min(a.rect.right, b.rect.right) -
            Math.max(a.rect.left, b.rect.left);
          const overlapY =
            Math.min(a.rect.bottom, b.rect.bottom) -
            Math.max(a.rect.top, b.rect.top);
          if (overlapX > 2 && overlapY > 2)
            collisions.push(a.name + '/' + b.name);
        }
      }
      return collisions;
    });
  expect(overlaps).toEqual([]);
});

test('mobile mode control stays above time controls and remains clickable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  await expect(page.locator('#orbit-options')).toHaveClass(/is-collapsed/);

  const exploButton = page.locator('.mode-btn[data-mode="explo"]');
  const unobstructed = await exploButton.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    return (
      document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2
      ) === button
    );
  });
  expect(unobstructed).toBe(true);
  await exploButton.click();
  await expect(page.locator('body')).toHaveClass(/is-explo-mode/);
});

test('initial boot avoids blocking on highest-resolution planet textures', async ({
  page,
}) => {
  const loaded8k: string[] = [];
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (path.includes('/textures/') && path.endsWith('_8k.jpg'))
      loaded8k.push(path);
  });
  await boot(page);
  expect(loaded8k.filter((path) => !path.includes('/stars/'))).toEqual([]);
});

test('projected marker dots stay on their exact body anchors after labels spread out', async ({
  page,
}) => {
  await boot(page);
  await page.locator('.mode-btn[data-mode="explo"]').click();

  const deviations = await page.locator('.explo-label').evaluateAll((labels) =>
    labels
      .filter((label) => getComputedStyle(label).display !== 'none')
      .map((label) => {
        const transform = new DOMMatrixReadOnly(
          getComputedStyle(label).transform
        );
        const dot = label.querySelector('.explo-label-dot');
        if (!dot) return Number.POSITIVE_INFINITY;
        const rect = dot.getBoundingClientRect();
        return Math.hypot(
          rect.left + rect.width / 2 - transform.m41,
          rect.top + rect.height / 2 - transform.m42
        );
      })
  );

  expect(deviations.length).toBeGreaterThan(0);
  expect(Math.max(...deviations)).toBeLessThan(0.25);
  await expect(page.locator('#orbit-overview')).toBeVisible();
});
