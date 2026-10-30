import type { Page } from '@playwright/test';

/**
 * Ouvre un onglet de la surface Réglages (scène, image, lecture, données). Les sections
 * restent dans le DOM mais celles des autres onglets sont masquées : un contrôle d'un autre
 * onglet n'est ni visible ni cliquable tant que son onglet n'est pas choisi.
 */
export async function openSettingsTab(
  page: Page,
  tab: 'scene' | 'image' | 'reading' | 'data'
): Promise<void> {
  await page.locator(`#settings-tab-${tab}`).click();
}
