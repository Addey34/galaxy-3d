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

    const overflow = () =>
      page.evaluate(() => {
        const body = document.querySelector<HTMLElement>(
          '#orbit-options .surface-body'
        )!;
        return body.scrollWidth - body.clientWidth;
      });
    expect(
      await overflow(),
      'le corps du panneau défile en largeur'
    ).toBeLessThanOrEqual(1);

    // La MÊME mesure sous une police plus large. Le coureur Linux sert une police de repli plus
    // large que Segoe UI et a fait déborder de 33 px un tableau qui tenait ici sans une marge :
    // une garde mesurée sur une seule police ne le voit pas. Un espacement de lettres
    // fractionnaire reproduit cet écart sur n'importe quelle machine.
    await page.addStyleTag({
      content: '#orbit-options * { letter-spacing: 1.2px !important; }',
    });
    expect(
      await overflow(),
      'le corps du panneau défile en largeur sous une police plus large'
    ).toBeLessThanOrEqual(1);
  });
}

/**
 * LES RÉGLAGES RESTENT DANS L'ÉCRAN, en portrait comme en paysage. En paysage (844 × 390) la règle
 * `max-height: 460px` annulait la borne des surfaces ancrées sous la rangée de boutons : le
 * panneau finissait 32 px sous le bord bas, son dernier réglage hors d'atteinte. En portrait il
 * prend 68 vh au plus (l'onglet Image montre alors aussi la luminosité).
 */
for (const viewport of [
  { width: 390, height: 844 },
  { width: 360, height: 640 },
  { width: 844, height: 390 },
]) {
  test.describe(`${viewport.width} x ${viewport.height}`, () => {
    test.use({ viewport });
    test('le panneau des Réglages tient dans la fenêtre', async ({ page }) => {
      await blockExternalNetwork(page);
      await page.addInitScript(() => {
        localStorage.setItem('ssv-guided-tour-v1', '1');
        localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
      });
      await page.goto('/');
      await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
      await clickWhenCalm(page, page.locator('#settings-trigger'));
      await expect(page.locator('#orbit-options')).toBeVisible();
      const box = await page.evaluate(() => {
        const r = document
          .querySelector<HTMLElement>('#orbit-options')!
          .getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, height: innerHeight };
      });
      expect(box.top, 'le haut sort de la fenêtre').toBeGreaterThanOrEqual(0);
      expect(
        box.bottom,
        'le bas du panneau sort de la fenêtre'
      ).toBeLessThanOrEqual(box.height + 1);
    });
  });
}
