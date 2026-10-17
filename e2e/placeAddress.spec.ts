import { expect, test } from '@playwright/test';
import { MOON_SCENE_DATE } from './moonScene';
import { blockExternalNetwork } from './netBlock';

/**
 * L'ADRESSE D'UN GRAND LIEU (lot 55) : `/moon/?place=Mare%20Imbrium`, celle qu'ouvre le lien
 * « Le voir dans Galaxy » des pages `/places/`. La caméra doit se tourner vers la formation
 * (publiée sur le canevas par `ui/lookAtFormation.ts`, comme pour la recherche), et l'adresse
 * réécrite ne doit plus porter `place` : c'est une ouverture, pas un état.
 *
 * Démarrage lunaire DATÉ (`e2e/moonScene.ts`), comme l'exige la garde des scènes lunaires.
 */
test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

test('a place address opens the body facing the named formation', async ({
  page,
}) => {
  await page.goto(`/moon/?place=Mare%20Imbrium&date=${MOON_SCENE_DATE}`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  const canvas = page.locator('canvas').first();
  await expect(canvas).toHaveAttribute('data-search-focus', /^Mare Imbrium\|/, {
    timeout: 60_000,
  });
  const [, offset, side] = (
    (await canvas.getAttribute('data-search-focus')) ?? ''
  ).split('|');
  expect(side).toBe('front');
  expect(Number(offset)).toBeLessThan(0.05);
  await expect(page).not.toHaveURL(/place=/);
});
