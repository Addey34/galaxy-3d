import type { Page } from '@playwright/test';

/**
 * Sur téléphone la fiche du corps s'ouvre REPLIÉE (en-tête et distance, `ui/bodyInfo.ts`). Un test
 * qui lit son contenu (faits, découverte, missions…) la déplie d'abord ; sur grand écran elle est
 * entière et le bouton est masqué, donc l'appel ne fait rien.
 */
export async function unfoldBodyCard(page: Page): Promise<void> {
  await page
    .locator('#body-info')
    .waitFor({ state: 'visible', timeout: 15_000 });
  const toggle = page.locator('#body-info .bi-toggle');
  if (
    (await toggle.isVisible()) &&
    (await toggle.getAttribute('aria-expanded')) === 'false'
  )
    await toggle.click();
}
