import { expect, test } from '@playwright/test';

// Déterminisme : pas de dépendance à l'API JPL SBDB live pendant les tests.
test.beforeEach(async ({ page }) => {
  await page.route('**/sbdb_query.api*', (route) => route.abort());
});

/**
 * Test de fumée : l'application démarre, initialise Three.js et masque l'écran de
 * chargement. Ne vérifie pas le rendu pixel par pixel — juste que le boot se termine
 * sans erreur fatale et que le canvas WebGL est monté.
 */
test('boots, mounts the WebGL canvas and dismisses the loader', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');

  // L'init (textures → scène → corps → caméra → astro → boucle) masque #loader en fin.
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  // Le renderer WebGL ajoute un <canvas> (marqué data-engine par three.js) non nul au body.
  // On le cible précisément : l'overlay des petits corps ajoute un second <canvas>.
  const canvas = page.locator('canvas[data-engine]');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(0);
  expect(box?.height ?? 0).toBeGreaterThan(0);

  // Les boutons de navigation sont générés depuis le catalogue (au-delà de « Globale »).
  const earthBtn = page.locator('#orbit-earth');
  await expect(earthBtn).toBeVisible();

  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
});

test('wires nav and playback controls (câblage ui/)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  // Navigation (ui/planetNav) : cliquer un corps le marque actif.
  const earthBtn = page.locator('#orbit-earth');
  await earthBtn.click();
  await expect(earthBtn).toHaveClass(/is-active/);

  // Lecture (ui/playback) : sélectionner une vitesse la marque active.
  const speed1h = page.locator('.speed-group .tp-speed').nth(1);
  await speed1h.click();
  await expect(speed1h).toHaveClass(/is-active/);

  // Reset date-heure (ui/timePanel → PlaybackControls) : revient à « Réel ».
  await page.locator('#time-today').click();
  await expect(page.locator('.speed-group .tp-speed').first()).toHaveClass(
    /is-active/
  );
});

test('opens the body info panel on selection and closes it on overview', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  const panel = page.locator('#body-info');
  await expect(panel).toBeHidden();

  // Sélectionner un corps ouvre sa fiche, remplie depuis le catalogue (ui/bodyInfo).
  await page.locator('#orbit-earth').click();
  await expect(panel).toBeVisible();
  await expect(panel.locator('.bi-name')).toHaveText('Earth');
  await expect(panel.locator('.bi-stats dt')).not.toHaveCount(0);

  // Retour Vue Globale : la fiche se referme.
  await page.locator('#orbit-overview').click();
  await expect(panel).toBeHidden();
});

test('selects a celestial body by clicking its 3D mesh', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  // Le Soleil est fixe à l'origine, donc au centre de la vue d'ensemble initiale.
  const canvas = page.locator('canvas[data-engine]');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  await canvas.click({
    position: {
      x: box!.width / 2,
      y: box!.height / 2,
    },
  });

  await expect(page.locator('#orbit-sun')).toHaveClass(/is-active/);
});
