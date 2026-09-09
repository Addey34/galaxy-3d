import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';
import { findControl, readAXControls } from './axTree';

/**
 * NOMS ACCESSIBLES ET ÉTATS — ce qu'un lecteur d'écran lit vraiment.
 *
 * Complément de `a11y-audit.spec.ts` (axe-core), pas un doublon : axe vérifie des RÈGLES sur
 * neuf panneaux et passerait sans broncher sur un bouton nommé « Button », une boîte de
 * dialogue anonyme ou un interrupteur dont l'état n'est jamais exposé. Ici on lit les VALEURS
 * dans l'arbre d'accessibilité calculé par Chromium.
 *
 * Ce fichier ne prétend pas remplacer un passage NVDA/VoiceOver : l'ordre d'annonce, le
 * ressenti du parcours au clavier et la verbosité ne se mesurent pas ici. Il verrouille ce qui
 * EST mesurable — et qui casse silencieusement dès qu'on remplace un libellé par une icône.
 */

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 40_000 });
});

test('every interactive control carries a real accessible name', async ({
  page,
  context,
}) => {
  const controls = await readAXControls(page, context);
  // Le dock, la barre de navigation, les modes et la lecture : au moins une trentaine.
  expect(controls.length).toBeGreaterThan(25);

  // Un nom vide, ou générique, ne dit rien à qui n'a que lui. C'est le mode de régression
  // typique : quelqu'un remplace un libellé par une icône et l'`aria-label` disparaît.
  const generic = /^(button|link|icon|image|click here|ok|\.\.\.|…)$/i;
  const unnamed = controls.filter(
    (control) =>
      control.name.trim().length < 2 || generic.test(control.name.trim())
  );
  expect(
    unnamed.map((control) => `${control.role} "${control.name}"`),
    'contrôles sans nom accessible utilisable'
  ).toEqual([]);
});

test('a panel announces that it opened, and the panel itself has a name', async ({
  page,
  context,
}) => {
  // `aria-expanded` est un ÉTAT : axe vérifie qu'il est valide s'il existe, jamais qu'il suit
  // l'ouverture réelle. Sans lui, rien n'annonce que le panneau vient de s'ouvrir.
  const before = findControl(
    await readAXControls(page, context),
    'Weather layers'
  );
  expect(before?.states['expanded']).toBe(false);

  await page.locator('#weather-trigger').click();
  await expect(page.locator('#weather-layers')).toBeVisible();

  const controls = await readAXControls(page, context);
  const trigger = controls.find(
    (control) => control.role === 'button' && control.name === 'Weather layers'
  );
  expect(trigger?.states['expanded']).toBe(true);
  // Et le panneau ouvert est lui-même nommé : une boîte de dialogue anonyme est annoncée
  // « dialogue », sans dire lequel.
  expect(
    controls.some(
      (control) =>
        control.role === 'dialog' && control.name === 'Weather layers'
    )
  ).toBe(true);
});

test('play/pause says which action it offers, and exposes its state', async ({
  page,
  context,
}) => {
  const toggle = page.locator('#play-pause-btn');
  const initial = findControl(
    await readAXControls(page, context),
    /simulation$/
  );
  expect(initial?.name).toBe('Pause simulation');

  await toggle.click();
  const paused = findControl(
    await readAXControls(page, context),
    /simulation$/
  );
  // Le nom doit décrire l'ACTION offerte, et l'état doit être exposé à part : un bouton dont
  // le nom ne change pas laisse l'utilisateur sans moyen de savoir si la simulation tourne.
  expect(paused?.name).toBe('Resume simulation');
  expect(paused?.states['pressed']).toBe(true);
});

test('the scale mode exposes which of the two is active', async ({
  page,
  context,
}) => {
  const modes = (controls: Awaited<ReturnType<typeof readAXControls>>) =>
    controls.filter((control) => /^(Educ\.|Explo\.)$/.test(control.name));

  const before = modes(await readAXControls(page, context));
  expect(before).toHaveLength(2);
  expect(before.filter((mode) => mode.states['pressed'] === true)).toHaveLength(
    1
  );
  expect(findControl(before, 'Educ.')?.states['pressed']).toBe(true);

  await page.locator('.mode-btn[data-mode="explo"]').click();
  await page.waitForTimeout(1500);

  const after = modes(await readAXControls(page, context));
  expect(findControl(after, 'Explo.')?.states['pressed']).toBe(true);
  expect(findControl(after, 'Educ.')?.states['pressed']).toBe(false);
});
