import { expect, test } from '@playwright/test';
import { waitForCalmMainThread } from './mainThread';
import { MOON_SCENE_DATE } from './moonScene';
import { blockExternalNetwork } from './netBlock';

/**
 * LE REPÈRE D'UNE FORMATION, au doigt et à la taille d'un téléphone (GAL-PRODUCT-014), dans les
 * quatre langues : la légende reste dans l'écran, rien ne déborde latéralement, et le repère
 * nomme la formation et son corps. Pixel 7 et iPhone 15 émulés (`pnpm test:mobile`), jamais un
 * vrai téléphone. Les captures vont dans `P014_SHOTS` quand la variable est posée.
 */
const LOCALES = ['en', 'fr', 'es', 'pt-BR'] as const;

for (const locale of LOCALES) {
  test(`${locale}: le repère de Tycho tient dans l'écran`, async ({
    page,
  }, info) => {
    await blockExternalNetwork(page);
    await page.addInitScript((l) => {
      localStorage.setItem('ssv-guided-tour-v1', '1');
      localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
      localStorage.setItem('ssv-locale', l);
    }, locale);
    await page.goto(`/?date=${MOON_SCENE_DATE}`);
    await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
    await waitForCalmMainThread(page);
    await page.locator('#body-search-trigger').tap();
    const input = page.locator('#palette-input');
    await expect(input).toBeFocused();
    await input.pressSequentially('Tycho');
    const hit = page.locator('.palette-hit[data-kind="place"]', {
      hasText: 'Tycho',
    });
    await expect(hit.first()).toBeVisible();
    await hit.first().tap();
    const marker = page.locator('#formation-marker');
    await expect(marker).toBeVisible({ timeout: 60_000 });
    await expect(marker).toContainText('Tycho');

    const view = page.viewportSize();
    const caption = await marker
      .locator('.formation-marker-caption')
      .boundingBox();
    expect(caption).not.toBeNull();
    if (caption && view) {
      expect(caption.x).toBeGreaterThanOrEqual(0);
      expect(caption.x + caption.width).toBeLessThanOrEqual(view.width);
    }
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);

    const dir = process.env['P014_SHOTS'];
    if (dir)
      await page.screenshot({
        path: `${dir}/${info.project.name}-${locale}.png`,
      });
  });
}
