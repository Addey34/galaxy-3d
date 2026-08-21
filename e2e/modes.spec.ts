import { expect, test, type Page } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
  });
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

  // Le label est un vrai <button> ; on active son gestionnaire directement. Un clic par
  // coordonnées serait fragile ici : Deimos orbite Mars, donc leurs labels sont adjacents
  // et peuvent se chevaucher à certaines dates d'éphéméride (le hit-test tomberait sur
  // l'un ou l'autre). On teste ainsi le CÂBLAGE (label → selectBody), pas la topologie.
  await marsLabel.evaluate((el) => (el as HTMLButtonElement).click());
  await expect(page.locator('#orbit-mars')).toHaveClass(/is-active/);
  await expect(page.locator('#body-info')).toBeVisible();
  await expect(page.locator('#body-info .bi-name')).toHaveText('Mars');
});

test('selection, information panel and target semantics survive both mode switches', async ({
  page,
}) => {
  await boot(page);
  await page.locator('#body-search-trigger').click();
  await page.locator('#orbit-earth').click();
  const info = page.locator('#body-info');
  await expect(info).toBeVisible();

  await page.locator('.mode-btn[data-mode="explo"]').click();
  await expect(page.locator('body')).toHaveClass(/is-explo-mode/);
  await expect(info).toBeVisible();
  await expect(info.locator('.bi-name')).toHaveText('Earth');
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
});

test('quality control uses a gear icon and closes outside', async ({
  page,
}) => {
  await boot(page);
  const quality = page.locator('#quality-btn');
  const menu = page.locator('#quality-menu');

  await expect(quality.locator('svg path')).toHaveAttribute('d', /M6\.35/);
  await quality.click();
  await expect(menu).toBeVisible();

  // Opening another contextual surface closes the quality menu too.
  await page.locator('#settings-trigger').click();
  await expect(menu).toBeHidden();
  await expect(page.locator('#orbit-options')).toBeVisible();

  // Opening quality settings closes the other contextual surface in return.
  await quality.click();
  await expect(menu).toBeVisible();
  await expect(page.locator('#orbit-options')).toBeHidden();
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

  // La surface de réglages démarre masquée ; le déclencheur du dock l'ouvre.
  await expect(settings).toBeHidden();
  await page.locator('#settings-trigger').click();
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

test('mobile mode control stays clear of other controls and remains clickable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  // Aucune surface ouverte au démarrage.
  await expect(page.locator('#orbit-options')).toBeHidden();

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

test('mobile contextual surfaces are mutually exclusive and keep the time bar', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);

  const info = page.locator('#body-info');
  const settings = page.locator('#orbit-options');

  // Sélectionner un corps ouvre directement sa fiche (feuille en bas) — feedback immédiat.
  await page.locator('#body-search-trigger').click();
  await page.locator('#orbit-sun').click();
  await expect(info).toBeVisible();
  // La barre temps reste toujours présente et essentielle (play + vitesse).
  await expect(page.locator('#play-pause-btn')).toBeVisible();
  await expect(page.locator('#speed-value')).toBeVisible();

  // Ouvrir les réglages ferme la fiche : une seule surface à la fois.
  await page.locator('#settings-trigger').click();
  await expect(settings).toBeVisible();
  await expect(info).toBeHidden();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const trigger = document
          .querySelector('#settings-trigger')!
          .getBoundingClientRect();
        const panel = document
          .querySelector('#orbit-options')!
          .getBoundingClientRect();
        return Math.abs(panel.top - trigger.top);
      })
    )
    .toBeLessThan(0.5);

  const anchoredSurface = await page.evaluate(() => {
    const trigger = document
      .querySelector('#settings-trigger')!
      .getBoundingClientRect();
    const panel = document
      .querySelector('#orbit-options')!
      .getBoundingClientRect();
    return {
      triggerTop: trigger.top,
      triggerLeft: trigger.left,
      panelTop: panel.top,
      panelRight: panel.right,
    };
  });
  expect(anchoredSurface.panelTop).toBeCloseTo(anchoredSurface.triggerTop, 0);
  expect(anchoredSurface.panelRight).toBeLessThan(anchoredSurface.triggerLeft);
  const expectSingleScrollOwner = async (
    panelSelector: string,
    nestedSelector: string
  ): Promise<void> => {
    const metrics = await page.evaluate(
      ({ panelSelector: panelId, nestedSelector: nestedId }) => {
        const panel = document.querySelector(panelId)!;
        const outer = panel.querySelector('.surface-body')!;
        const nested = panel.querySelector(nestedId);
        return {
          outerCanScroll: outer.scrollHeight > outer.clientHeight,
          nestedCanScroll: nested
            ? nested.scrollHeight > nested.clientHeight
            : false,
        };
      },
      { panelSelector, nestedSelector }
    );
    expect(metrics.outerCanScroll && metrics.nestedCanScroll).toBe(false);
  };

  await page.locator('#weather-trigger').click();
  await expect(page.locator('#weather-layers')).toBeVisible();
  await expectSingleScrollOwner('#weather-layers', '.wl-body');

  await page.locator('#events-trigger').click();
  await expect(page.locator('#astronomical-events')).toBeVisible();
  await expectSingleScrollOwner('#astronomical-events', '.events-list');
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

test('keeps untextured catalog bodies available in both modes', async ({
  page,
}) => {
  await boot(page);
  const pallas = page.locator('.explo-label[aria-label="Pallas"]');
  const halley = page.locator('.explo-label[aria-label="Halley"]');
  await expect(pallas).toHaveCount(1);
  await expect(halley).toHaveCount(1);

  await page.locator('.mode-btn[data-mode="explo"]').click();
  await expect(page.locator('body')).toHaveClass(/is-explo-mode/);
  await expect(pallas).toHaveCount(1);
  await expect(halley).toHaveCount(1);
});

test('Galilean moons stay available around Jupiter in both display modes', async ({
  page,
}) => {
  await boot(page);
  await page.locator('#body-search-trigger').click();
  await page.locator('#orbit-jupiter').click();
  await expect(page.locator('#body-info .bi-name')).toHaveText('Jupiter');

  const target = page.locator('.explo-label.is-target');
  await expect(target).toHaveAttribute('aria-label', 'Jupiter');

  const moonNames = ['io', 'europa', 'ganymede', 'callisto'];
  for (const name of moonNames) {
    await expect(
      page.locator('#explo-labels .explo-label[data-body-name="' + name + '"]')
    ).toHaveCount(1);
  }

  const targetPosition = async (): Promise<{ x: number; y: number }> =>
    target.evaluate((element) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
      return { x: matrix.m41, y: matrix.m42 };
    });

  const waitForStableTarget = async (): Promise<void> => {
    await expect
      .poll(
        async () => {
          const first = await targetPosition();
          await page.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() => resolve())
              )
          );
          const second = await targetPosition();
          return Math.hypot(second.x - first.x, second.y - first.y);
        },
        { timeout: 15_000 }
      )
      .toBeLessThan(0.5);
  };
  await waitForStableTarget();
  const before = await targetPosition();

  await page.locator('.mode-btn[data-mode="explo"]').click();
  await expect(page.locator('body')).toHaveClass(/is-explo-mode/);
  await expect(target).toHaveAttribute('aria-label', 'Jupiter');
  await expect
    .poll(
      async () => {
        const position = await targetPosition();
        return Math.hypot(position.x - before.x, position.y - before.y);
      },
      { timeout: 15_000 }
    )
    .toBeLessThan(1);

  await page.locator('.mode-btn[data-mode="educ"]').click();
  await expect(page.locator('body')).not.toHaveClass(/is-explo-mode/);
  await expect(target).toHaveAttribute('aria-label', 'Jupiter');
  await expect
    .poll(
      async () => {
        const position = await targetPosition();
        return Math.hypot(position.x - before.x, position.y - before.y);
      },
      { timeout: 15_000 }
    )
    .toBeLessThan(1);
});
