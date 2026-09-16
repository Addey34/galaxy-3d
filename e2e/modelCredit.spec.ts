import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

/**
 * LE CRÉDIT D'UN MODÈLE DE FORME SE VOIT DANS L'APPLICATION.
 *
 * Il vivait dans la configuration et dans le fichier glTF — nulle part où un visiteur le lit.
 * Pour Ryugu, ce n'est pas une politesse : la politique de données ISAS/JAXA autorise l'usage à
 * condition de citer la source ET de déclarer les modifications. Ce scénario tient la chaîne
 * catalogue → fiche, et vérifie qu'un corps SANS modèle n'affiche pas de crédit fantôme.
 */
test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'fr');
  });
});

test('la fiche d’un corps modélisé cite la source et les modifications de son modèle', async ({
  page,
}) => {
  await page.goto('/?body=ryugu');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  const credit = page.locator('#body-info .bi-credit');
  await expect(credit).toBeVisible();
  await expect(credit).toContainText('ISAS/JAXA');
  await expect(credit).toContainText('modifiées');
});

test('un corps sans modèle n’affiche aucun crédit de modèle', async ({
  page,
}) => {
  await page.goto('/?body=mars');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#body-info')).toBeVisible();
  await expect(page.locator('#body-info .bi-credit')).toBeHidden();
});
