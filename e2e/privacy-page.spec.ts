import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { blockExternalNetwork } from './netBlock';

/**
 * LA PAGE DE CONFIDENTIALITÉ, DANS UN VRAI NAVIGATEUR.
 *
 * Elle n'en avait AUCUN jusqu'au lot 35, alors qu'elle est la seule page du site qui porte son
 * propre sélecteur de langue, son propre script et sa propre feuille de style — c'est-à-dire
 * trois choses que rien dans l'application ne couvre. Elle est aussi la page qu'un visiteur
 * consulte pour savoir ce qu'on fait de lui : une page cassée y coûte plus cher qu'ailleurs.
 *
 * Le lot 35 lui a ajouté deux langues, donc DEUX boutons de plus dans une barre qui n'a aucune
 * requête de média. C'est exactement le genre de changement qui déborde sur un téléphone sans
 * que personne le voie, et la garde de largeur ci-dessous démarre à la taille mobile — la
 * redimensionner après coup laisserait la barre dans un état qu'un vrai téléphone n'a jamais.
 */

const LOCALES = ['en', 'fr', 'es', 'pt-BR'] as const;

/** Le titre de la section des préférences, dans chaque langue. Il PROUVE qu'on lit la bonne. */
const HEADING: Record<(typeof LOCALES)[number], string> = {
  en: 'Preferences stored on your device',
  fr: 'Préférences enregistrées sur votre appareil',
  es: 'Preferencias guardadas en su dispositivo',
  'pt-BR': 'Preferências guardadas no seu dispositivo',
};

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
});

test('sert les quatre langues, et une seule à la fois', async ({ page }) => {
  await page.goto('/privacy.html');
  for (const locale of LOCALES) {
    await page.locator(`.lang-btn[data-locale="${locale}"]`).click();
    // Le document DÉCLARE la langue qu'il montre : sans cela un lecteur d'écran prononcerait
    // l'espagnol avec la phonétique française.
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(
      page.locator(`.lang-btn[data-locale="${locale}"]`)
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(
      page.getByRole('heading', { name: HEADING[locale], exact: true })
    ).toBeVisible();
    const visible = await page
      .locator('main > div[data-lang]:not([hidden])')
      .count();
    expect(visible, `${locale} : une seule langue visible`).toBe(1);
  }
});

test('reprend la langue que l’application a enregistrée', async ({ page }) => {
  // LE DÉFAUT DU LOT 35, EN UN TEST : la page lisait `ssv-locale` puis la JETAIT si elle ne
  // valait ni `fr` ni `en`, si bien qu'un visiteur hispanophone lisait cette page en anglais.
  await page.addInitScript(() => localStorage.setItem('ssv-locale', 'es'));
  await page.goto('/privacy.html');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(
    page.getByRole('heading', { name: HEADING.es, exact: true })
  ).toBeVisible();
});

test('tient dans 390 px sans débordement horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/privacy.html');
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
  );
  expect(overflow, 'débordement horizontal en px').toBeLessThanOrEqual(0);
  // Les quatre boutons doivent rester DANS la barre, pas seulement dans la page.
  const header = await page.locator('.page-header').boundingBox();
  for (const locale of LOCALES) {
    const box = await page
      .locator(`.lang-btn[data-locale="${locale}"]`)
      .boundingBox();
    expect(box, locale).not.toBeNull();
    expect(
      box!.x + box!.width,
      `${locale} déborde de la barre`
    ).toBeLessThanOrEqual(header!.x + header!.width + 1);
  }
});

test('n’a aucune violation d’accessibilité détectable, dans les quatre langues', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/privacy.html');
  for (const locale of LOCALES) {
    await page.locator(`.lang-btn[data-locale="${locale}"]`).click();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(
      results.violations.map((v) => `${locale} ${v.id}: ${v.help}`),
      `violations en ${locale}`
    ).toEqual([]);
  }
});
