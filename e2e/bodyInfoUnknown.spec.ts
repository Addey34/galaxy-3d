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

  // Ganymède : masse et gravité connues (dérivées du GM publié par JPL), température non —
  // la NASA n'en publie qu'une plage.
  await page.goto('/?body=ganymede');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  const panel = page.locator('#body-info');
  await expect(panel).toBeVisible();

  const unknown = panel.locator('dd.is-unknown');
  await expect(unknown).toHaveCount(1);
  // Un tiret cadratin, pas un zéro ni une chaîne vide : les deux se liraient comme une mesure.
  await expect(unknown).toHaveText('\u2014');

  // La raison doit accompagner le tiret, sinon il n'informe de rien.
  const reason = await unknown.getAttribute('title');
  expect(reason).toContain('Donnée non publiée');
  expect(reason!.length).toBeGreaterThan(40);
  // Et elle doit être annoncée : un tiret seul ne dit rien à un lecteur d'écran.
  expect(await unknown.getAttribute('aria-label')).toBe(reason);

  // Les valeurs réellement connues restent affichées normalement, elles.
  await expect(panel.getByText('1,43 m/s²')).toBeVisible();
});
