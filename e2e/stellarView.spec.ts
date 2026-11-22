import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { blockExternalNetwork } from './netBlock';
import { clickWhenInteractive } from './mainThread';
import { openSettingsTab } from './settingsTab';

/**
 * LE VOISINAGE SOLAIRE EN 3D (GAL-UNIVERSE-002) : une vue à part (scène Three.js en parsecs, Soleil
 * à l'origine) rendue par le MÊME renderer et la MÊME boucle que la scène solaire. Ce qu'on prouve :
 * le chargement différé (rien au démarrage), l'entrée par les Réglages et par la fiche d'une étoile,
 * la distance de Proxima lue de bout en bout (trois coordonnées dont la norme est la distance), un
 * VRAI clic ou tap sur une étoile, le clavier, le retour au Système solaire avec la date préservée,
 * et le nettoyage (aucun résidu, la scène solaire de nouveau interactive).
 */

async function boot(page: Page, locale = 'en'): Promise<void> {
  await blockExternalNetwork(page);
  await page.addInitScript((l) => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', l);
  }, locale);
  await page.goto('/?mode=explo&body=neptune&date=2026-09-15T11:00:00Z');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  await expect(page.locator('#stellar-open')).toBeEnabled({ timeout: 40_000 });
}

async function openFromSettings(page: Page): Promise<void> {
  await page.locator('#settings-trigger').dispatchEvent('click');
  await expect(page.locator('#orbit-options')).toBeVisible();
  await openSettingsTab(page, 'scene');
  await page.locator('#stellar-open').click();
  await expect(page.locator('#stellar-view')).toBeVisible({ timeout: 30_000 });
}

/** La date lue sur le panneau du temps (jour et heure), pour prouver qu'elle ne dérive pas. */
async function sceneClock(page: Page): Promise<number> {
  const day = await page.locator('#date-input').inputValue();
  const clock = await page.locator('#time-input').inputValue();
  return new Date(`${day}T${clock}Z`).getTime();
}

for (const [label, viewport, hasTouch] of [
  ['desktop', { width: 1280, height: 800 }, false],
  ['phone', { width: 390, height: 844 }, true],
] as const) {
  test.describe(label, () => {
    test.use({ viewport, hasTouch });

    test('nothing is loaded at start; opening from the settings shows the Sun-centred view, the scale and 48 systems', async ({
      page,
    }) => {
      const requests: string[] = [];
      page.on('request', (r) => {
        if (/stellarView|neighbours\.json/.test(r.url()))
          requests.push(r.url());
      });
      await boot(page);
      const canvases = await page.locator('canvas').count();
      await page.waitForTimeout(1200);
      expect(requests).toEqual([]);
      await expect(page.locator('#stellar-view')).toHaveCount(0);

      await openFromSettings(page);
      const view = page.locator('#stellar-view');
      await expect(view.locator('#stellar-view-title')).toHaveText(
        'Solar neighbourhood in 3D'
      );
      // L'échelle est dite, avec son unité.
      await expect(view.locator('#stellar-scale')).toContainText(
        '1 unit = 1 parsec = 3.26 light-years'
      );
      await expect(view.locator('#stellar-list button')).toHaveCount(48);
      // Un seul canevas (un seul renderer), la scène solaire est masquée et inerte.
      // La vue n'a ajouté aucun canevas : elle dessine sur celui du renderer de l'application.
      await expect(page.locator('canvas')).toHaveCount(canvases);
      await expect(page.locator('.dock').first()).toBeHidden();
      await expect(page.locator('#stellar-back')).toBeFocused();
      expect(requests.some((u) => /stellarView/.test(u))).toBe(true);
      expect(requests.filter((u) => /neighbours\.json/.test(u))).toHaveLength(
        1
      );
    });

    test('Proxima: position x, y, z, dont la norme est sa distance, à 4,25 années-lumière', async ({
      page,
    }) => {
      await boot(page);
      await openFromSettings(page);
      await page
        .locator('#stellar-list button', { hasText: /^Proxima Centauri/ })
        .click();
      const card = page.locator('#stellar-card');
      await expect(card).toContainText(/4\.246\d* ± 0\.000\d+ light-years/);
      const text = (await card.locator('dd').allTextContents()).join('|');
      const match = /(-?[\d.]+), (-?[\d.]+), (-?[\d.]+) pc/.exec(text);
      expect(match, text).not.toBeNull();
      const [x, y, z] = match!.slice(1).map(Number) as [number, number, number];
      // Soleil à l'origine : la norme des trois coordonnées est la distance publiée, 1,302 pc.
      expect(Math.hypot(x, y, z)).toBeGreaterThan(1.29);
      expect(Math.hypot(x, y, z)).toBeLessThan(1.315);
      // Proxima est près du plan galactique (b ≈ −1,9°) : sa hauteur z est faible devant sa distance.
      expect(Math.abs(z)).toBeLessThan(0.06);
      await expect(card).toContainText('Gaia DR3');
      await expect(page.locator('#stellar-view .sv-symbolic')).toContainText(
        'constant size'
      );
    });

    test('a real click or tap on a star selects it; the card is the right star', async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await boot(page);
      await openFromSettings(page);
      const name = page
        .locator('.sv-label--star')
        .filter({ hasText: /^Proxima Centauri/ });
      await expect(name).toBeVisible({ timeout: 20_000 });
      const box = await name.boundingBox();
      if (!box) throw new Error('nom absent');
      // Le nom est posé 16 px sous l'étoile (haut du nom = étoile + 8) : l'étoile est 8 px au-dessus.
      const x = Math.round(box.x + box.width / 2);
      const y = Math.round(box.y - 8);
      if (hasTouch) await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);
      await expect(page.locator('#stellar-card')).toContainText(/4\.246\d* ±/);
      await expect(
        page.locator('#stellar-list button[aria-pressed="true"]')
      ).toContainText('Proxima Centauri');
    });

    test('back to the Solar System: view removed, same body, same date, solar scene interactive again', async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await boot(page);
      const inertBefore = await page.locator('[inert]').count();
      const before = await sceneClock(page);
      await openFromSettings(page);
      await page.waitForTimeout(6000);
      await page.locator('#stellar-back').click();
      await expect(page.locator('#stellar-view')).toHaveCount(0);
      await expect(page.locator('.dock').first()).toBeVisible();
      await expect(page).toHaveURL(/\/neptune\//);
      await expect(page.locator('body')).not.toHaveClass(/stellar-view-active/);
      await expect(page.locator('[data-stellar-hidden]')).toHaveCount(0);
      // Ce que la vue a rendu inerte est rétabli : le décompte est celui d'avant l'ouverture.
      await expect(page.locator('[inert]')).toHaveCount(inertBefore);
      // La date n'a pas dérivé pendant les 6 s passées dans la vue stellaire : l'écart reste de
      // l'ordre de la seconde (horloge figée puis réancrée), jamais 6 s ni davantage.
      const after = await sceneClock(page);
      expect(after - before).toBeGreaterThanOrEqual(0);
      expect(after - before).toBeLessThan(4000);
      // La scène solaire répond : un autre corps se choisit par la palette.
      await clickWhenInteractive(page, page.locator('#body-search-trigger'));
      await expect(page.locator('#palette-input')).toBeFocused();
    });

    test('opening from a star card centres the view on it, Escape returns and gives the focus back', async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await boot(page);
      await page.locator('#settings-trigger').dispatchEvent('click');
      await openSettingsTab(page, 'scene');
      await page.locator('#neighbours-toggle').check();
      const search = page.locator('#neighbour-search');
      await expect(search).toBeVisible({ timeout: 20_000 });
      await search.fill('Barnard');
      await search.press('Enter');
      await expect(page.locator('#neighbour-card')).toBeVisible();
      await page.locator('#neighbour-card-stellar').click();
      await expect(page.locator('#neighbour-card')).toBeHidden();
      await expect(page.locator('#stellar-view')).toBeVisible({
        timeout: 30_000,
      });
      await expect(
        page.locator('#stellar-list button[aria-pressed="true"]')
      ).toContainText("Barnard's Star");
      await expect(page.locator('#stellar-card')).toContainText(
        /5\.96\d* ± 0\.000\d+ light-years/
      );
      await page.keyboard.press('Escape');
      await expect(page.locator('#stellar-view')).toHaveCount(0);
    });

    test('time: Barnard comes closer in a straight line, within the 10,000-year window', async ({
      page,
    }) => {
      await boot(page);
      await openFromSettings(page);
      await page
        .locator('#stellar-list button', { hasText: /^Barnard/ })
        .click();
      const distanceAt = async (): Promise<number> => {
        const dds = await page.locator('#stellar-card dd').allTextContents();
        const hit = dds.find((d) => /light-years/.test(d) && !/±/.test(d));
        return Number(/([\d.]+) light-years/.exec(hit ?? '')![1]);
      };
      const now = await distanceAt();
      const slider = page.locator('#stellar-time');
      await expect(slider).toHaveAttribute('min', '-10000');
      await expect(slider).toHaveAttribute('max', '10000');
      await slider.fill('3000');
      await expect(page.locator('#stellar-time-out')).toContainText(
        '3,000 years'
      );
      expect(await distanceAt()).toBeLessThan(now);
      await expect(page.locator('#stellar-view')).toContainText(
        'limited to 10,000 years'
      );
    });
  });
}

test.describe('keyboard, languages, accessibility', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('keyboard: arrows move the labels, plus zooms, Escape returns the focus to the opener, no axe violation', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await boot(page);
    await openFromSettings(page);
    const surface = page.locator('#stellar-surface');
    await surface.focus();
    const label = page.locator('.sv-label--sun');
    await expect(label).toBeVisible();
    const a = await label.boundingBox();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('+');
    await page.waitForTimeout(300);
    const star = page.locator('.sv-label--star').first();
    await expect(star).toBeVisible();
    // La vue a changé : une étoile a bougé à l'écran (l'axe des flèches tourne autour du Soleil).
    const moved = await star.boundingBox();
    await page.keyboard.press('Home');
    await page.waitForTimeout(300);
    const home = await star.boundingBox();
    expect(a).not.toBeNull();
    expect(moved).not.toBeNull();
    expect(home).not.toBeNull();
    expect(
      Math.abs(moved!.x - home!.x) + Math.abs(moved!.y - home!.y)
    ).toBeGreaterThan(2);

    await page.waitForTimeout(400);
    const results = await new AxeBuilder({ page })
      .include('#stellar-view')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual(
      []
    );

    await page.keyboard.press('Escape');
    await expect(page.locator('#stellar-view')).toHaveCount(0);
    // Le bouton était dans les Réglages, fermés à l'ouverture : le focus revient à leur déclencheur.
    await expect(page.locator('#settings-trigger')).toBeFocused();
  });

  for (const [locale, title, back] of [
    ['fr', 'Voisinage solaire en 3D', 'Retour au Système solaire'],
    ['es', 'Vecindad solar en 3D', 'Volver al Sistema Solar'],
    ['pt-BR', 'Vizinhança solar em 3D', 'Voltar ao Sistema Solar'],
  ] as const)
    test(`language ${locale}: title, back button and units follow, no raw key`, async ({
      page,
    }) => {
      await boot(page, locale);
      await openFromSettings(page);
      await expect(page.locator('#stellar-view-title')).toHaveText(title);
      await expect(page.locator('#stellar-back')).toHaveText(back);
      await expect(page.locator('#stellar-view')).not.toContainText(
        /\bst\.\w+/
      );
      await page
        .locator('#stellar-list button', { hasText: /^Proxima/ })
        .click();
      await expect(page.locator('#stellar-card')).not.toContainText(
        /light-years|nb\.card/
      );
    });
});
