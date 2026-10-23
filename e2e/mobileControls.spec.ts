import { expect, test, type Page } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';
import { waitForCalmMainThread } from './mainThread';

/**
 * LES COMMANDES DU TÉLÉPHONE ET DU CLAVIER (signalé le 2026-10-23) :
 *  - aucun champ n'est sous 16 px sur un pointeur grossier (Safari iOS zoome sinon, et le zoom ne
 *    se défait pas) et la page refuse le double tap (`touch-action: manipulation`) ;
 *  - la barre du temps ne change NI de hauteur NI de largeur quand le curseur de vitesse passe
 *    sur toute sa course (le libellé passait à deux lignes au centre, la barre sautait de 22 px) ;
 *  - Espace met en pause et relance le temps, et se tait dans un champ de saisie.
 */

async function boot(page: Page): Promise<void> {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  await waitForCalmMainThread(page);
}

test.describe('téléphone étroit', () => {
  test.use({
    viewport: { width: 320, height: 658 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    locale: 'es-ES',
  });

  test('aucun champ sous 16 px et pas de double tap', async ({ page }) => {
    await boot(page);
    await page.locator('#time-readout').tap();
    await page.locator('.chip--search').tap();
    const small = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          'input:not([type=range]):not([type=checkbox]):not([type=radio]), select, textarea'
        ),
      ]
        .filter((e) => e.getBoundingClientRect().width > 0)
        .map((e) => ({
          id: e.id || e.tagName,
          px: parseFloat(getComputedStyle(e).fontSize),
        }))
        .filter((f) => f.px < 16)
    );
    expect(small, 'champs sous 16 px').toEqual([]);
    const touchAction = await page.evaluate(
      () => getComputedStyle(document.body).touchAction
    );
    expect(touchAction).toBe('manipulation');
  });

  test('la recherche s’ouvre sans clavier virtuel, et le toucher le rend', async ({
    page,
  }) => {
    await boot(page);
    await page.locator('.chip--search').tap();
    const input = page.locator('#palette-input');
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute('inputmode', 'none');
    await input.tap();
    await expect(input).toHaveAttribute('inputmode', 'text');
    await expect(input).toBeFocused();
  });

  test('la barre du temps garde sa taille sur toute la course du curseur', async ({
    page,
  }) => {
    await boot(page);
    await page.locator('#time-readout').tap();
    await page.waitForTimeout(600);
    const seen = new Set<string>();
    for (let v = 0; v <= 100; v += 2) {
      seen.add(
        await page.evaluate((value) => {
          const range = document.getElementById(
            'speed-range'
          ) as HTMLInputElement;
          range.value = String(value);
          range.dispatchEvent(new Event('input', { bubbles: true }));
          const r = document
            .getElementById('time-panel')!
            .getBoundingClientRect();
          return `${r.x.toFixed(1)}|${r.y.toFixed(1)}|${r.width.toFixed(1)}|${r.height.toFixed(1)}`;
        }, v)
      );
    }
    expect([...seen], 'géométries de la barre').toHaveLength(1);
  });
});

test.describe('clavier', () => {
  test('Espace met en pause et relance, et se tait dans un champ', async ({
    page,
  }) => {
    await boot(page);
    const play = page.locator('#play-pause-btn');
    await expect(play).not.toHaveClass(/is-paused/);
    await page.keyboard.press('Space');
    await expect(play).toHaveClass(/is-paused/);
    await page.keyboard.press('Space');
    await expect(play).not.toHaveClass(/is-paused/);
    // dans le champ de recherche, Espace s'écrit
    await page.keyboard.press('/');
    await expect(page.locator('#body-palette')).toBeVisible();
    await page.keyboard.type('mars saturne');
    await expect(play).not.toHaveClass(/is-paused/);
    await expect(page.locator('#palette-input')).toHaveValue('mars saturne');
    // « ? » ouvre l'aide, qui liste les raccourcis
    await page.keyboard.press('Escape');
    await page.keyboard.press('?');
    await expect(page.locator('#help-popover')).toBeVisible();
    await expect(page.locator('#help-popover')).toContainText('/');
  });
});
