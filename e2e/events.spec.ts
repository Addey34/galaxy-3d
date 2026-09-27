import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
});

test('opens upcoming astronomical events and jumps the simulation to one', async ({
  page,
}) => {
  // Le budget par défaut est de 120 s, et l'attente ci-dessous en réclame 90 à elle seule,
  // après un démarrage qui peut en prendre 30. On laisse donc de la place au lieu de faire
  // tomber le test sur son propre plafond.
  test.setTimeout(180_000);
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  const toggle = page.locator('#events-trigger');
  await expect(toggle).toBeVisible();
  await toggle.click();

  const panel = page.locator('#astronomical-events');
  await expect(panel).toBeVisible();

  const panelsDoNotOverlap = await page.evaluate(() => {
    const settings = document
      .querySelector('#orbit-options')
      ?.getBoundingClientRect();
    const events = document
      .querySelector('#astronomical-events')
      ?.getBoundingClientRect();
    if (!settings || !events) return false;
    return !(
      settings.left < events.right &&
      settings.right > events.left &&
      settings.top < events.bottom &&
      settings.bottom > events.top
    );
  });
  expect(panelsDoNotOverlap).toBe(true);

  const firstEvent = panel.locator('.event-row').first();
  await expect(firstEvent).toBeVisible();

  const eventDate = await firstEvent.getAttribute('data-event-date');
  expect(eventDate).not.toBeNull();
  const expectedDate = new Date(eventDate!);
  const expectedDateInput = expectedDate.toISOString().slice(0, 10);

  await firstEvent.click();
  await expect(panel).toBeHidden();
  // CE SEUL PAS ATTEND LONGTEMPS, ET C'EST LE PRODUIT QUI LE VEUT.
  //
  // Depuis le lot 17C, l'horloge est RETENUE jusqu'à l'arrivée des octets d'éphémérides de la
  // nouvelle date, plutôt que d'afficher une position de repli sans le dire. Le champ de date,
  // qui lit l'horloge, ne bouge donc qu'une fois la fenêtre chargée.
  //
  // Mesuré le 2026-09-27 sur une machine rapide, six sauts d'environ six jours :
  // 1 295, 12 545, 13 614, 12 726, 12 240 et 12 345 ms. La médiane est donc à ~12 s, et le
  // délai d'attente par défaut de 30 s ne laissait que 2,5 fois cette médiane : un coureur de
  // CI deux fois plus lent le dépasse, ce qu'il a fait trois fois de suite. On attend ici
  // explicitement, avec la raison écrite à côté, plutôt que de laisser ce test tomber au
  // hasard de la machine.
  //
  // Ce délai n'excuse rien : ~12 s pour un saut de six jours est loin des 1,2 à 3,2 s que le
  // lot 17D a publiés, et cet écart mérite d'être regardé par le lot qui possède les
  // éphémérides. Il n'est PAS imputable au lot 19 : mesuré avec et sans ses ajouts sur ce
  // chemin, six échantillons chacun, les deux séries se recouvrent entièrement.
  await expect(page.locator('#date-input')).toHaveValue(expectedDateInput, {
    timeout: 90_000,
  });

  const url = new URL(page.url());
  expect(url.searchParams.get('date')).toContain(
    expectedDate.toISOString().slice(0, 19)
  );

  // La lecture doit être figée sur l'instant de l'événement…
  await expect(page.locator('#play-pause-btn')).toHaveClass(/is-paused/);
  // …et un corps observé doit être sélectionné : Lune/Terre pour les phases, éclipses,
  // saisons et apsides, ou la planète elle-même pour une opposition/conjonction.
  //
  // Le corps se lit dans le CHEMIN et non plus dans la query : l'adresse d'un corps regardé
  // est désormais sa page indexable. `?body=` y serait une redite, et vaut donc `null`.
  expect(url.pathname).toMatch(
    /^\/(moon|earth|mercury|venus|mars|jupiter|saturn|uranus|neptune)\/$/
  );
  expect(url.searchParams.get('body')).toBeNull();
});
