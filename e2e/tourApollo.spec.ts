import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { blockExternalNetwork } from './netBlock';

/**
 * « LA BASE DE LA TRANQUILLITÉ » AVEC LES CAPACITÉS INTÉGRÉES (GAL-TOUR-005, après #545 et #546).
 *
 * Rendu NATUREL, sans éclairage assisté. La visite est jouée en entier, dans les quatre langues :
 *  - la rotation lunaire datée met le Soleil au-dessus de l'horizon d'Apollo 11 : la scène du
 *    lieu n'est plus noire (sa luminance est mesurée, plancher contre l'écran noir d'avant) ;
 *  - le repère de plongée, posé sur le lieu, est dans la moitié centrale de l’écran ;
 *  - la légende est visible à chaque étape ; le crédit d'imagerie LRO est vérifié avec `APOLLO_LIVE=1` ;
 *  - fermer la visite restaure le mode de départ et retire le repère ;
 *  - aucun débordement horizontal, axe propre sur la carte de la visite.
 * Ne prouve PAS la fidélité de la pénombre (la hauteur solaire est celle du modèle, ≈ 10,7°).
 */
const LIVE = process.env['APOLLO_LIVE'] === '1';
const LOCALES = ['en', 'fr', 'es', 'pt-BR'] as const;

async function boot(page: Page, locale: string): Promise<void> {
  // Réseau réel seulement à la demande (`APOLLO_LIVE=1`) : le crédit d'imagerie vient des carreaux
  // LRO, distants ; la suite hors ligne ne peut pas le prouver.
  if (!LIVE) await blockExternalNetwork(page);
  await page.addInitScript((l) => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', l);
  }, locale);
  await page.goto('/?tour=moon-tranquillity');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('.stour-card')).toBeVisible({ timeout: 60_000 });
}

async function sceneStats(page: Page): Promise<{ mean: number; p99: number }> {
  const hide = await page.addStyleTag({
    content:
      '.surface, .dock, .stour-card, #formation-marker, .si-credit { visibility: hidden !important; }',
  });
  const png = await page.screenshot();
  await hide.evaluate((el) => (el as Element).remove());
  const { data } = await sharp(png)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ys: number[] = [];
  for (let i = 0; i < data.length; i += 3)
    ys.push(0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!);
  ys.sort((a, b) => a - b);
  return {
    mean: ys.reduce((a, b) => a + b, 0) / ys.length,
    p99: ys[Math.floor(0.99 * (ys.length - 1))]!,
  };
}

for (const locale of LOCALES) {
  test(`${locale} : la visite se joue en entier, lieu éclairé, repère centré, crédit, fermeture`, async ({
    page,
  }) => {
    await boot(page, locale);
    const next = page.locator('.stour-next');
    const caption = page.locator('.stour-caption');
    let captions = 0;
    let sawMarker = false;
    let litScene = false;
    for (let i = 0; i < 12; i += 1) {
      await expect(next).toBeEnabled({ timeout: 60_000 });
      await expect(caption).not.toBeEmpty();
      captions += 1;
      const marker = page.locator('#formation-marker');
      if (await marker.count()) {
        const name =
          (await marker.locator('.formation-marker-name').textContent()) ?? '';
        if (/Tranquillitatis/.test(name)) {
          sawMarker = true;
          const canvas = await page.locator('canvas').first().boundingBox();
          const pin = await marker
            .locator('.formation-marker-ring')
            .boundingBox();
          expect(canvas && pin).toBeTruthy();
          // Repère dans la moitié centrale de la scène, pas hors champ ni sous l'écran.
          expect(
            Math.abs(pin!.x + pin!.width / 2 - (canvas!.x + canvas!.width / 2))
          ).toBeLessThan(canvas!.width * 0.25);
          expect(pin!.y + pin!.height / 2).toBeGreaterThan(canvas!.y);
          expect(pin!.y + pin!.height / 2).toBeLessThan(
            canvas!.y + canvas!.height
          );
          const stats = await sceneStats(page);
          // Avant #545 la scène du lieu était noire (max 1-2/255) ; aujourd'hui le terrain est lu.
          test.info().annotations.push({
            type: 'luminance',
            description: `mean ${stats.mean.toFixed(1)} p99 ${stats.p99.toFixed(1)}`,
          });
          if (stats.p99 > 20) litScene = true;
          if (LIVE)
            await expect(page.locator('.si-credit').first()).toContainText(
              /LRO|Lunar Reconnaissance/i,
              { timeout: 60_000 }
            );
          const axe = await new AxeBuilder({ page })
            .include('.stour-card')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze();
          expect(axe.violations).toEqual([]);
        }
      }
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth
        )
      ).toBeLessThanOrEqual(0);
      if (!(await page.locator('.stour-card').isVisible())) break;
      await next.click();
      if (!(await page.locator('.stour-card').isVisible())) break;
    }
    expect(captions).toBeGreaterThanOrEqual(3);
    expect(sawMarker).toBe(true);
    expect(litScene).toBe(true);
    // Fin de visite (le mode de départ est Éducatif, l'Exploration n'est que celui de la visite) : carte fermée, repère retiré, mode de départ restauré.
    await expect(page.locator('.stour-card')).toBeHidden({ timeout: 30_000 });
    await expect(page.locator('#formation-marker')).toHaveCount(0);
    await expect(page.locator('#mode-controls .is-active')).toHaveAttribute(
      'data-mode',
      'educ'
    );
  });
}

test('fermer la visite en cours restaure le mode et retire le repère', async ({
  page,
}) => {
  await boot(page, 'en');
  const next = page.locator('.stour-next');
  await expect(next).toBeEnabled({ timeout: 60_000 });
  await next.click();
  await expect(page.locator('#formation-marker')).toHaveCount(1, {
    timeout: 60_000,
  });
  await page.locator('.stour-close').click();
  await expect(page.locator('.stour-card')).toBeHidden();
  await expect(page.locator('#formation-marker')).toHaveCount(0);
  await expect(page.locator('#mode-controls .is-active')).toHaveAttribute(
    'data-mode',
    'educ'
  );
});
