import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';
import { clickWhenCalm } from './mainThread';

/**
 * LES RÉGLAGES TIENNENT DANS 390 PX, DANS CHAQUE LANGUE : le corps du panneau ne défile pas en
 * largeur. Le choix du fond de la Terre est un `<select>` dont la largeur propre est celle de son
 * option la plus longue (« Sentinel-2 sans nuages (2025) »), et un élément de flex ne rétrécit pas
 * sous sa largeur propre : le contenu faisait 376 px dans 260 et le panneau défilait de 103 px.
 *
 * Démarre à la taille mobile (une garde de mise en page qui redimensionne après coup ne voit pas
 * le défaut) et mesure le CONTENU du corps, pas la page : `.surface-body` est en `overflow: auto`,
 * donc `documentElement.scrollWidth` reste égal à la fenêtre pendant que le panneau déborde.
 */
test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

for (const locale of ['en', 'fr', 'es', 'pt-BR']) {
  test(`le corps des Réglages ne défile pas en largeur (${locale})`, async ({
    page,
  }) => {
    await blockExternalNetwork(page);
    await page.addInitScript((loc) => {
      localStorage.setItem('ssv-guided-tour-v1', '1');
      localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
      localStorage.setItem('ssv-locale', loc);
    }, locale);
    await page.goto('/');
    await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
    await clickWhenCalm(page, page.locator('#settings-trigger'));
    await expect(page.locator('#orbit-options')).toBeVisible();
    // La section du fond de la Terre n'existe qu'une fois `surfacePanel` monté.
    await expect(page.locator('#surface-earth-base-wrapper')).toBeAttached();

    const over = await page.evaluate(() => {
      const body = document.querySelector<HTMLElement>(
        '#orbit-options .surface-body'
      )!;
      return body.scrollWidth - body.clientWidth;
    });
    expect(over, 'le corps du panneau défile en largeur').toBeLessThanOrEqual(
      1
    );
  });
}
