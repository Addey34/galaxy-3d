import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

/**
 * Une donnée sans valeur publiée doit se VOIR, pas disparaître.
 *
 * Avant, un champ absent faisait simplement disparaître sa ligne de la fiche : l'utilisateur
 * ne pouvait pas distinguer « la science ne donne pas ce chiffre » de « le catalogue l'a
 * oublié ». Les deux se ressemblent exactement à l'écran, et c'est le mode de défaut habituel
 * de ce projet — rien ne casse, une information manque.
 *
 * Le catalogue déclare donc ces cas (`realData.unknown`), et la fiche les rend explicites.
 * Ce scénario vérifie la chaîne complète : catalogue → i18n → DOM → accessibilité.
 */
test('la fiche affiche une donnée non publiée au lieu de masquer la ligne', async ({
  page,
}) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'fr');
  });

  // Ganymède : masse et gravité connues (dérivées du GM publié par JPL), température non :
  // la NASA n'en publie qu'une plage.
  await page.goto('/?body=ganymede');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  const panel = page.locator('#body-info');
  await expect(panel).toBeVisible();

  // Deux lignes non affichées sur Ganymède, pour deux raisons que la fiche DISTINGUE : la
  // température n'a pas de valeur publiée unique ; l'obliquité n'est pas encore rattachée à une
  // source primaire (la scène utilise 0°, qui n'est pas une mesure).
  await expect(panel.locator('dd.is-unknown')).toHaveCount(2);
  const unknown = panel.locator('dd.is-unknown[title^="Donnée non publiée"]');
  await expect(unknown).toHaveCount(1);
  await expect(
    panel.locator('dd.is-unknown[title^="Pas encore sourcée"]')
  ).toHaveCount(1);
  // Une marque traduite (« n.d. »), pas un zéro ni une chaîne vide : les deux se liraient comme
  // une mesure. Plus de tiret cadratin : aucun texte affiché n'en emploie
  // (`src/seo/publishedText.test.ts`).
  await expect(unknown).toHaveText('n.d.');

  // La raison doit accompagner la marque, sinon elle n'informe de rien.
  const reason = await unknown.getAttribute('title');
  expect(reason).toContain('Donnée non publiée');
  expect(reason!.length).toBeGreaterThan(40);
  // Et elle doit être annoncée : une abréviation seule ne dit rien à un lecteur d'écran.
  expect(await unknown.getAttribute('aria-label')).toBe(reason);

  // Les valeurs réellement connues restent affichées normalement, avec leur renvoi de source.
  const gravity = panel.locator('dd', { hasText: '1,43 m/s²' });
  await expect(gravity).toBeVisible();
  await expect(gravity.locator('sup.bi-ref')).toHaveText(/^\d+$/);
  expect(await gravity.getAttribute('title')).toContain('valeur dérivée');

  // La liste des sources nomme la table JPL d'où viennent GM et rayon.
  const sources = panel.locator('.bi-sources');
  await expect(sources).toBeVisible();
  await sources.locator('summary').click();
  await expect(
    sources.getByRole('link', {
      name: /Planetary Satellite Physical Parameters/,
    })
  ).toHaveAttribute('href', 'https://ssd.jpl.nasa.gov/sats/phys_par/');
});

test('la marque de donnée non publiée suit la langue', async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
  await page.goto('/?body=ganymede');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  const unknown = page.locator(
    '#body-info dd.is-unknown[title^="No published value"]'
  );
  await expect(unknown).toHaveText('n/a');
  await expect(
    page.locator('#body-info dd.is-unknown[title^="Not yet sourced"]')
  ).toHaveText('n/a');
});
