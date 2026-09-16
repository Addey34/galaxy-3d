import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

/**
 * LES COUCHES CANVAS COUVRENT LA FENÊTRE, À TOUTE DENSITÉ DE PIXELS.
 *
 * Un <canvas> est un élément remplacé : `position: fixed; inset: 0` ne l'étire pas, il garde la
 * taille de son tampon (fenêtre × densité). À 125 % — un réglage d'affichage Windows courant —
 * les couches sondes et objets interstellaires s'affichaient 1,25 fois trop grandes : marqueurs,
 * noms et trajectoires glissaient loin du coin haut-gauche et ne tombaient plus sur les corps
 * 3D. Invisible à la densité 1, qui est celle de toute la suite e2e par défaut — d'où ce fichier.
 */
test.use({ deviceScaleFactor: 1.25 });

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
});

test('instrument canvases match the viewport at 125 % pixel density', async ({
  page,
}) => {
  await page.goto('/?mode=explo');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  const sizes = await page.evaluate(() =>
    ['interstellar-overlay', 'spacecraft-overlay', 'smallbody-overlay']
      .map((id) => document.getElementById(id) as HTMLCanvasElement | null)
      .filter((canvas): canvas is HTMLCanvasElement => canvas !== null)
      .map((canvas) => {
        const rect = canvas.getBoundingClientRect();
        return {
          id: canvas.id,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          bufferWidth: canvas.width,
        };
      })
  );
  const viewport = page.viewportSize()!;

  // Sans cette borne, une page où aucune couche n'existe passerait à vide.
  expect(sizes.length).toBeGreaterThanOrEqual(2);
  for (const size of sizes) {
    expect(size.width, `${size.id} largeur CSS`).toBe(viewport.width);
    expect(size.height, `${size.id} hauteur CSS`).toBe(viewport.height);
    // Et le tampon reste à pleine densité : le dessin est net, pas étiré.
    expect(size.bufferWidth, `${size.id} tampon`).toBe(
      Math.round(viewport.width * 1.25)
    );
  }
});
