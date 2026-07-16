import { expect, test } from '@playwright/test';

/**
 * Test de fumée : l'application démarre, initialise Three.js et masque l'écran de
 * chargement. Ne vérifie pas le rendu pixel par pixel — juste que le boot se termine
 * sans erreur fatale et que le canvas WebGL est monté.
 */
test('boots, mounts the WebGL canvas and dismisses the loader', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');

  // L'init (textures → scène → corps → caméra → astro → boucle) masque #loader en fin.
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  // Le renderer WebGL ajoute un <canvas> non nul au body.
  const canvas = page.locator('canvas');
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
  await expect(page.locator('.speed-group .tp-speed').first()).toHaveClass(/is-active/);
});
