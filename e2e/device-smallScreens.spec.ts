import { devices, expect, test, type Page } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

/**
 * PETIT TÉLÉPHONE ET PAYSAGE (GAL-MOBILE-EXCELLENCE-001), en plus des deux profils de `pnpm test:mobile` :
 *   - les titres dépliables de la fiche et le lien de source d'une découverte font au moins 24 px de haut
 *     sur écran tactile (WCAG 2.2, 2.5.8 ; mesurés 16 à 21 px avant) ;
 *   - dans le voisinage solaire, aucun nom d'étoile n'est posé sous un bouton, une note ou le volet
 *     (translucides : le nom se lisait à travers et brouillait leur texte sur iPhone SE) ;
 *   - les crédits de l'aide restent dans l'écran (l'adresse Gaia poussait la colonne hors d'un écran de 412 px).
 * Hors CI, comme les autres `device-*`.
 */
test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

async function openCard(page: Page, body: string): Promise<void> {
  await page.goto(`/?body=${body}`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 120_000 });
  if (!(await page.locator('#body-info').isVisible()))
    await page.locator('#info-trigger').tap();
  if (await page.locator('#body-info.is-compact').count())
    await page.locator('#body-info .bi-toggle').tap();
  await expect(page.locator('#body-info .bi-observe')).toBeVisible({
    timeout: 60_000,
  });
}

for (const [label, device] of [
  ['iPhone SE', devices['iPhone SE']],
  ['Pixel 7 paysage', devices['Pixel 7 landscape']],
] as const)
  test.describe(label, () => {
    test.use({
      viewport: device.viewport,
      deviceScaleFactor: device.deviceScaleFactor,
      isMobile: device.isMobile,
      hasTouch: true,
    });

    test('fiche : titres dépliables et lien de source à 24 px au moins', async ({
      page,
    }) => {
      test.setTimeout(240_000);
      await openCard(page, 'jupiter');
      const small = await page.evaluate(() =>
        [
          ...document.querySelectorAll(
            '#body-info summary, #body-info .bi-discovery-source'
          ),
        ]
          .map((el) => [el.className || el.tagName, el.getBoundingClientRect()])
          .filter(([, r]) => (r as DOMRect).height > 0)
          .filter(([, r]) => (r as DOMRect).height < 24)
          .map(
            ([name, r]) =>
              `${String(name)} ${Math.round((r as DOMRect).height)}px`
          )
      );
      expect(small).toEqual([]);
    });

    test('voisinage : aucun nom d’étoile sous un bouton, une note ou le volet', async ({
      page,
    }) => {
      test.setTimeout(240_000);
      await page.goto('/?view=neighbourhood');
      await expect(page.locator('#loader')).toBeHidden({ timeout: 120_000 });
      await expect(page.locator('#stellar-view')).toBeVisible({
        timeout: 60_000,
      });
      await page.waitForTimeout(2000);
      const overlaps = await page.evaluate(() => {
        const boxes = [
          ...document.querySelectorAll('.sv-head > *, .sv-help, .sv-side'),
        ]
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 0 && r.height > 0);
        return [...document.querySelectorAll('.sv-label')]
          .filter((el) => (el as HTMLElement).style.display !== 'none')
          .map((el) => ({
            text: el.textContent,
            r: el.getBoundingClientRect(),
          }))
          .filter(({ r }) =>
            boxes.some(
              (b) =>
                r.left < b.right &&
                r.right > b.left &&
                r.top < b.bottom &&
                r.bottom > b.top
            )
          )
          .map(({ text }) => text);
      });
      expect(overlaps).toEqual([]);
    });

    test('aide : les crédits restent dans l’écran', async ({ page }) => {
      test.setTimeout(240_000);
      await page.goto('/');
      await expect(page.locator('#loader')).toBeHidden({ timeout: 120_000 });
      await page.locator('#help-btn').tap();
      await expect(page.locator('#help-popover')).toBeVisible();
      const credits = page.locator('.credits-list');
      await credits.scrollIntoViewIfNeeded();
      const out = await page.evaluate(() => {
        const vw = window.innerWidth;
        return [...document.querySelectorAll('.credits-list dd')]
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.right > vw + 1 || r.left < -1).length;
      });
      expect(out).toBe(0);
    });
  });
