import { expect, test } from '@playwright/test';

// Déterminisme : on ne dépend pas de l'API JPL SBDB live (réseau) pendant les tests.
// L'overlay des petits corps dégrade proprement en champ vide — suffisant pour ces scénarios.
test.beforeEach(async ({ page }) => {
  await page.route('**/sbdb_query.api*', (route) => route.abort());
});

/**
 * Mode Exploration : basculer en explo affiche la couche de labels projetés ; cliquer un
 * corps ouvre sa fiche unique avec la distance réelle live (fusionnée depuis l'ancien HUD).
 * Revenir en éducatif masque les labels.
 */
test('explo mode shows projected labels and the live distance in the info card', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  const labels = page.locator('#explo-labels');
  await expect(labels).not.toHaveClass(/is-visible/);

  // Basculer en Exploration : la couche de labels s'affiche.
  await page.locator('.mode-btn[data-mode="explo"]').click();
  await expect(page.locator('body')).toHaveClass(/is-explo-mode/);
  await expect(labels).toHaveClass(/is-visible/);

  // Cliquer un corps lance le voyage rapproché : la fiche unique s'ouvre avec la cible et sa
  // distance réelle live (bloc .bi-live fusionné depuis l'ancien HUD « TARGET »).
  await page.locator('#orbit-earth').click();
  const info = page.locator('#body-info');
  await expect(info).toBeVisible();
  await expect(info.locator('.bi-name')).toHaveText('Earth');
  await expect(info.locator('.bi-live-dist')).toContainText('AU');

  // Au moins un marqueur de corps projeté est affiché.
  await expect(page.locator('.explo-label').first()).toBeVisible();

  // Retour en Éducatif : labels masqués.
  await page.locator('.mode-btn[data-mode="educ"]').click();
  await expect(labels).not.toHaveClass(/is-visible/);

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
  await expect(page.locator('#body-info .bi-name')).toHaveText('Neptune');

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
 * Petits corps (astéroïdes / comètes / planètes naines) : positionnés par éléments orbitaux
 * képlériens, ils apparaissent comme labels Explo (instrument de navigation) mais restent
 * hors de la barre de navigation principale. Vérifie aussi que leur présence ne provoque
 * aucune erreur de boot.
 */
test('small bodies appear as explo labels but not in the nav bar', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  // Cérès n'a pas de bouton de navigation (petit corps).
  await expect(page.locator('#orbit-ceres')).toHaveCount(0);

  await page.locator('.mode-btn[data-mode=explo]').click();
  await expect(page.locator('body')).toHaveClass(/is-explo-mode/);

  // Mais un label Cérès est bien projeté (créé au premier frame du HUD).
  await expect(page.locator('.explo-label', { hasText: 'Ceres' })).toHaveCount(
    1
  );

  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
});

/**
 * Champ de masse des petits corps (SBDB) : la couche instrument 2D est présente, s'affiche en
 * Exploration et reste non bloquante (les gestes caméra la traversent). Le chargement SBDB est
 * en tâche de fond et dégrade proprement — le boot reste sans erreur même hors ligne.
 */
test('small-body field overlay is present, shown in explo and non-blocking', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  const overlay = page.locator('#smallbody-overlay');
  await expect(overlay).toHaveCount(1);
  await expect(overlay).not.toHaveClass(/is-visible/);

  await page.locator('.mode-btn[data-mode=explo]').click();
  await expect(overlay).toHaveClass(/is-visible/);

  // Non bloquant : la couche laisse passer les événements pointeur vers la caméra.
  await expect(overlay).toHaveCSS('pointer-events', 'none');

  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
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
  await expect(page.locator('#body-info .bi-name')).toHaveText('Mars');
  await page.waitForTimeout(1_600); // fin du vol : Mars centré, label is-target au centre

  const distanceLine = page.locator('#body-info .bi-live-dist');
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

  // Clic → cible Mars dans la fiche + bouton de nav actif.
  await expect(page.locator('#body-info .bi-name')).toHaveText('Mars');
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
