import { expect, test, type Page } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

/**
 * UNE SURFACE OUVERTE NE SE FERME PAS SUR UN GESTE DANS LA SCÈNE.
 *
 * Décidé le 2026-10-30 : on ferme par la croix, par l'ouverture d'une autre surface ou par
 * Échap, jamais par un clic, un glisser ou un tap sur le canvas. Le scrim mobile n'est qu'un
 * voile (`pointer-events: none`) : mesuré le même jour, son ancien écouteur `click` ne se
 * déclenchait jamais, donc le tap hors feuille ne fermait déjà rien depuis #385. La garde
 * tient ce comportement sur les deux géométries (bureau, téléphone tactile).
 */

const SURFACES = [
  { name: 'settings', trigger: '#settings-trigger', panel: '#orbit-options' },
  { name: 'body card', trigger: '#info-trigger', panel: '#body-info' },
] as const;

async function bootWithBody(page: Page): Promise<void> {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
  await page.goto('/?body=earth');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
}

for (const [label, viewport, hasTouch] of [
  ['desktop', { width: 1280, height: 800 }, false],
  ['phone', { width: 390, height: 844 }, true],
] as const) {
  test.describe(label, () => {
    test.use({ viewport, hasTouch });

    for (const surface of SURFACES) {
      test(`${surface.name} stays open on a click, a drag and a tap in the scene`, async ({
        page,
      }) => {
        await bootWithBody(page);
        const panel = page.locator(surface.panel);
        if (!(await panel.isVisible())) {
          await page.locator(surface.trigger).click();
        }
        await expect(panel).toBeVisible();

        // Un point du canvas hors de toute surface : le bord gauche, à mi-hauteur.
        const y = Math.round(viewport.height / 2);
        const x = 4;
        expect(
          await page.evaluate(
            ([px, py]) => document.elementFromPoint(px, py)?.tagName,
            [x, y]
          ),
          'le point visé est bien le canvas'
        ).toBe('CANVAS');

        await page.mouse.click(x, y);
        await page.waitForTimeout(400);
        await expect(panel, 'après un clic').toBeVisible();

        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + 80, y + 40, { steps: 6 });
        await page.mouse.up();
        await page.waitForTimeout(400);
        await expect(panel, 'après un glisser').toBeVisible();

        if (hasTouch) {
          await page.touchscreen.tap(x, y);
          await page.waitForTimeout(400);
          await expect(panel, 'après un tap').toBeVisible();
        }

        // Échap ferme quand le focus est dans la surface (écouteur posé sur le panneau).
        await panel.locator('button').first().focus();
        await page.keyboard.press('Escape');
        await expect(panel, 'Échap ferme toujours').toBeHidden();
      });
    }
  });
}
