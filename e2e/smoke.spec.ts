import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

// Déterminisme : pas de dépendance à l'API JPL SBDB live pendant les tests.
// La visite guidée du premier lancement est neutralisée (son backdrop plein écran
// bloquerait sinon les clics sur le canvas et les contrôles).
test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
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

  // La navigation vit dans la palette (ouverte depuis le dock) : les entrées sont
  // générées depuis le catalogue et gardent leurs id `#orbit-{name}` historiques.
  await page.locator('#body-search-trigger').click();
  await expect(page.locator('#body-palette')).toBeVisible();
  await expect(page.locator('#orbit-earth')).toBeVisible();

  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
});

test('wires nav and playback controls (câblage ui/)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  // Navigation (ui/planetNav → palette) : cliquer un corps le marque actif.
  await page.locator('#body-search-trigger').click();
  const earthBtn = page.locator('#orbit-earth');
  await earthBtn.click();
  await expect(earthBtn).toHaveClass(/is-active/);

  // Lecture (ui/playback) : la barre temps s'étend pour révéler le slider de vitesse.
  await page.locator('#time-readout').click();
  const speedRange = page.locator('#speed-range');
  await speedRange.press('End');
  // Vitesse max → libellé « N unité/s » (langue courante : "y/s" en anglais, "an/s" en français).
  await expect(page.locator('#speed-value')).toHaveText(/\d+\s*(y|an)\/s/);

  // Retour au présent (ui/timePanel → PlaybackControls) : revient à « Réel » = CENTRE du
  // slider bidirectionnel (50 = 1:1 ; gauche = passé, droite = futur).
  await page.locator('#time-today').click();
  await expect(speedRange).toHaveValue('50');
  await expect(page.locator('#speed-value')).toContainText('1:1');
});

/**
 * Marche arrière de la timebar : à gauche du centre, la date simulée doit RECULER.
 * Le slider est le seul contrôle de sens de l'application, et la moitié gauche de sa course
 * ne se distingue de la droite par aucun état visible — seule la date le prouve.
 *
 * `Home` (= buttée gauche) plutôt qu'un drag à la souris : le drag s'est montré instable, la
 * boîte du slider étant mesurée pendant que le panneau finit de se déplier, si bien que le
 * mouse-down tombait parfois à côté de la poignée et le slider ne bougeait pas du tout.
 * C'est aussi l'idiome déjà utilisé plus haut dans ce fichier pour la buttée droite.
 */
test('rewinds the simulated date when the speed slider goes left of centre', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  await page.locator('#time-readout').click();
  const speedRange = page.locator('#speed-range');
  const dateInput = page.locator('#date-input');

  await speedRange.press('Home');
  await expect(speedRange).toHaveValue('0');
  // Libellé signé : le « ◀ » est le seul indice à l'écran que le temps recule.
  await expect(page.locator('#speed-value')).toContainText('◀');

  const start = new Date(await dateInput.inputValue()).getTime();
  await expect
    .poll(async () => new Date(await dateInput.inputValue()).getTime(), {
      timeout: 10_000,
    })
    .toBeLessThan(start - 86_400_000);
});

test('opens the body info panel on selection and closes it on overview', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  const panel = page.locator('#body-info');
  await expect(panel).toBeHidden();

  // Sélectionner un corps ouvre sa fiche, remplie depuis le catalogue (ui/bodyInfo).
  await page.locator('#body-search-trigger').click();
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

  // Les labels éducatifs sont volontairement cliquables et peuvent recouvrir le point
  // central. Force le hit-test du canvas pour tester exclusivement le picker 3D.
  await canvas.click({
    force: true,
    position: {
      x: box!.width / 2,
      y: box!.height / 2,
    },
  });

  await expect(page.locator('#orbit-sun')).toHaveClass(/is-active/);
});
