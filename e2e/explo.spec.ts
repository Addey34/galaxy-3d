import { expect, test } from '@playwright/test';

/**
 * Mode Exploration + HUD « Voyage spatial » : basculer en explo affiche le HUD cible
 * (distance réelle) et les marqueurs de corps ; revenir en éducatif les masque.
 */
test('explo mode shows the voyage HUD and hides it on return', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  const hud = page.locator('#explo-hud');
  await expect(hud).not.toHaveClass(/is-visible/);

  // Basculer en Exploration.
  await page.locator('.mode-btn[data-mode="explo"]').click();
  await expect(page.locator('body')).toHaveClass(/is-explo-mode/);

  // HUD visible, cible = Terre (setScaleMode explo cible la Terre), distance renseignée.
  await expect(hud).toHaveClass(/is-visible/);
  await expect(page.locator('.explo-hud-target')).toHaveText('Earth');
  await expect(page.locator('.explo-hud-line').first()).toContainText('UA');

  // Au moins un marqueur de corps projeté est affiché.
  await expect(page.locator('.explo-label').first()).toBeVisible();

  // Retour en Éducatif : HUD masqué.
  await page.locator('.mode-btn[data-mode="educ"]').click();
  await expect(hud).not.toHaveClass(/is-visible/);

  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
});

test('keeps the followed body projected at the screen center', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  await page.locator('.mode-btn[data-mode=explo]').click();
  await page.locator('#orbit-neptune').click();
  await expect(page.locator('.explo-hud-target')).toHaveText('Neptune');

  // Laisse le tween de vol (1,2 s) se terminer avant de mesurer le suivi.
  await page.waitForTimeout(1_400);

  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const centerX = viewport!.width / 2;
  const centerY = viewport!.height / 2;
  const targetLabel = page.locator('.explo-label.is-target');

  const sampleDeviation = async (): Promise<number> => {
    const point = await targetLabel.evaluate((el) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      return { x: matrix.m41, y: matrix.m42 };
    });
    return Math.hypot(point.x - centerX, point.y - centerY);
  };

  // Réel puis 6 h/s : la cible doit rester centrée même quand son orbite avance vite.
  const deviations: number[] = [];
  for (let i = 0; i < 6; i++) {
    deviations.push(await sampleDeviation());
    await page.waitForTimeout(40);
  }
  await page.locator('.speed-group .tp-speed').last().click();
  for (let i = 0; i < 6; i++) {
    deviations.push(await sampleDeviation());
    await page.waitForTimeout(40);
  }
  expect(Math.max(...deviations)).toBeLessThan(0.25);
});

/**
 * Régression : les labels cliquables ne doivent pas bloquer la caméra. Le label de la cible
 * suivie est toujours au centre de l'écran ; une molette pile dessus doit malgré tout zoomer
 * (les labels réémettent le geste vers OrbitControls). On l'observe via la distance du HUD.
 */
test('mouse wheel over the centered target label still zooms the camera', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  await page.locator('.mode-btn[data-mode=explo]').click();
  await page.locator('#orbit-mars').click();
  await expect(page.locator('.explo-hud-target')).toHaveText('Mars');
  await page.waitForTimeout(1_600); // fin du vol : Mars centré, label is-target au centre

  const distanceLine = page.locator('.explo-hud-line').first();
  const before = await distanceLine.textContent();

  // Molette au centre exact de l'écran, donc sur le label de la cible.
  const viewport = page.viewportSize()!;
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(30);
  }

  // Le zoom a rapproché la caméra → la distance affichée a changé.
  await expect(distanceLine).not.toHaveText(before ?? '');
});

/**
 * Labels projetés cliquables : en mode Explo, cliquer le label d'un corps le cible dans le
 * HUD, active son bouton de navigation, termine le vol caméra et le maintient centré, sans
 * erreur de page. On vole d'abord vers Mars via la barre : son label devient alors la cible
 * centrée (donc visible de façon déterministe, indépendamment de la date d'éphéméride).
 */
test('clicking a projected label selects and centers the body', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  await page.locator('.mode-btn[data-mode=explo]').click();
  await expect(page.locator('body')).toHaveClass(/is-explo-mode/);

  // Amène Mars au centre (son label est alors visible et marqué is-target).
  await page.locator('#orbit-mars').click();
  await page.waitForTimeout(1_400);
  const marsLabel = page.locator('.explo-label.is-target');
  await expect(marsLabel).toBeVisible();
  await expect(marsLabel).toContainText('Mars');

  // Le label est un bouton accessible cliquable.
  await expect(marsLabel).toHaveJSProperty('tagName', 'BUTTON');
  await expect(marsLabel).toHaveAttribute('aria-label', 'Mars');
  await marsLabel.click();

  // Clic → cible Mars dans le HUD + bouton de nav actif.
  await expect(page.locator('.explo-hud-target')).toHaveText('Mars');
  await expect(page.locator('#orbit-mars')).toHaveClass(/is-active/);

  // Le vol se termine et Mars reste centré.
  await page.waitForTimeout(1_400);
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const point = await marsLabel.evaluate((el) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return { x: matrix.m41, y: matrix.m42 };
  });
  const deviation = Math.hypot(
    point.x - viewport!.width / 2,
    point.y - viewport!.height / 2
  );
  expect(deviation).toBeLessThan(0.25);

  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
});
