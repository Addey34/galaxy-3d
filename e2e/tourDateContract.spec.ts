import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { clickWhenCalm, waitForCalmMainThread } from './mainThread';
import { blockExternalNetwork } from './netBlock';

/**
 * LA DATE QU'UNE VISITE ATTEINT RESTE LA DATE DE LA SIMULATION (décision CTO, GAL-PRODUCT-012).
 *
 * Contrat écrit dans `docs/ARCHITECTURE.md`, § « Ce qu'une visite rend, et ce qu'elle laisse » :
 * une visite EMPRUNTE des réglages (mode, fond d'imagerie, fiche) et les rend à la fin ; la DATE
 * n'est pas un réglage emprunté, c'est l'état de la simulation. Le visiteur qui vient de voir
 * l'éclipse peut donc continuer à l'explorer à sa date, son lien la porte, et le bouton « retour
 * au présent » l'en ramène. Mesuré sur la production le 2026-11-12 (GAL-PRODUCT-011) : les dix
 * scénarios (fin normale, Fermer, Échap, desktop et mobile) laissent la date atteinte.
 *
 * La visite de l'éclipse sert de témoin : un seul saut de date, vers une éclipse à venir, et un
 * changement de mode que la visite rend (donc un contraste net entre ce qui est rendu et ce qui
 * ne l'est pas).
 */
const TOURS = resolve(import.meta.dirname, '../src/registry/tours');
const ORDER = (
  JSON.parse(readFileSync(resolve(TOURS, 'order.json'), 'utf-8')) as {
    order: string[];
  }
).order;
const ECLIPSE = ORDER.indexOf('eclipse');

/** Le délai d'un saut de date : l'horloge est retenue jusqu'à l'arrivée des éphémérides. */
const JUMP_TIMEOUT = 90_000;

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
});

/** Les réglages qu'une visite emprunte, lus tels que le visiteur les voit. */
async function borrowed(page: Page): Promise<{ mode: string; speed: string }> {
  return {
    // Le bouton actif, et non `?mode=` : le lien n'écrit `mode` qu'une fois la scène réglée.
    mode:
      (await page
        .locator('#mode-controls [data-mode].is-active')
        .getAttribute('data-mode')) ?? '',
    speed: (await page.locator('#speed-value').textContent()) ?? '',
  };
}

/** La date du lien (`?date=`), jusqu'à la seconde. */
const permalinkDate = (page: Page): string | null =>
  new URL(page.url()).searchParams.get('date');

async function startEclipse(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  await waitForCalmMainThread(page);
  await page.locator('#help-btn').click();
  await page.locator('.stour-start').click();
  await page.locator('.stour-picker-item').nth(ECLIPSE).click();
  await expect(page.locator('.stour-card')).toBeVisible();
}

async function advanceToEnd(page: Page): Promise<void> {
  const card = page.locator('.stour-card');
  const next = page.locator('.stour-next');
  for (let i = 0; i < 20; i++) {
    if (!(await card.isVisible())) return;
    if (!(await next.isDisabled())) await clickWhenCalm(page, next);
    else await page.waitForTimeout(200);
  }
  await expect(card).toBeHidden({ timeout: 20_000 });
}

test.describe('la date après une visite', () => {
  test.setTimeout(240_000);

  test('la fin normale garde la date atteinte, le lien la porte, le retour au présent la quitte', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
    await waitForCalmMainThread(page);
    const dateInput = page.locator('#date-input');
    const today = await dateInput.inputValue();
    const before = await borrowed(page);

    await startEclipse(page);
    await expect(dateInput).not.toHaveValue(today, { timeout: JUMP_TIMEOUT });
    const reached = await dateInput.inputValue();
    await advanceToEnd(page);
    await expect(page.locator('.stour-card')).toBeHidden();

    // 1. La date finale est celle que la visite a atteinte, pas celle du départ.
    await expect(dateInput).toHaveValue(reached);
    expect(reached).not.toBe(today);

    // 2. Le lien la porte : `date=` est rendu à la fin de la visite (`permalink.sync`) et son
    //    jour est celui du champ de date.
    await expect.poll(() => permalinkDate(page)?.slice(0, 10)).toBe(reached);
    const linked = permalinkDate(page)!;

    // Le mode de départ est rendu. La vitesse n'est comparée que parce que CE scénario part de
    // 1:1 et que la visite de l'éclipse ne la change pas : l'égalité n'atteste PAS une
    // restauration générale de la vitesse de départ. `finish()` remet aujourd'hui 1:1 en dur quand
    // une visite a changé la vitesse, ce que ce test ne couvre pas (anomalie UX identifiée, à
    // traiter séparément).
    expect(await borrowed(page)).toEqual(before);

    // 2 bis. Ouvrir le lien retrouve la même date (ce que reçoit quelqu'un à qui on le passe).
    await page.goto(page.url());
    await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
    await expect(dateInput).toHaveValue(reached, { timeout: JUMP_TIMEOUT });
    expect(permalinkDate(page)?.slice(0, 10)).toBe(linked.slice(0, 10));

    // 3. Le retour au présent ramène la simulation à aujourd'hui, et le lien le suit.
    await page.locator('#time-today').click();
    const now = new Date().toISOString().slice(0, 10);
    await expect(dateInput).toHaveValue(new RegExp(`^(${today}|${now})$`), {
      timeout: JUMP_TIMEOUT,
    });
    await expect
      .poll(() => permalinkDate(page)?.slice(0, 10))
      .toMatch(new RegExp(`^(${today}|${now})$`));
  });

  test('fermer la visite après le saut garde aussi la date atteinte', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
    const dateInput = page.locator('#date-input');
    const today = await dateInput.inputValue();
    await startEclipse(page);
    await expect(dateInput).not.toHaveValue(today, { timeout: JUMP_TIMEOUT });
    const reached = await dateInput.inputValue();
    await waitForCalmMainThread(page);
    await clickWhenCalm(page, page.locator('.stour-close'));
    await expect(page.locator('.stour-card')).toBeHidden({ timeout: 20_000 });

    await expect(dateInput).toHaveValue(reached);
    await expect.poll(() => permalinkDate(page)?.slice(0, 10)).toBe(reached);
  });
});
