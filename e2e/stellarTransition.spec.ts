import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { blockExternalNetwork } from './netBlock';
import { useAnimatedMotion } from './motion';
import { openSettingsTab } from './settingsTab';

/**
 * LE CHANGEMENT D'ÉCHELLE (GAL-UNIVERSE-003) : à l'ouverture de la vue du voisinage solaire, la
 * caméra recule du Soleil (70 UA) jusqu'à la vue d'ensemble, selon une progression géométrique dans
 * UN SEUL repère, avec la largeur du champ lue en UA puis en années-lumière. Ce qu'on prouve : la
 * transition existe et traverse bien les deux unités, elle s'interrompt (bouton, geste, touche,
 * retour), l'étoile choisie est gardée, le mouvement réduit l'évite, rien n'est laissé derrière.
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

/** Chaque texte successif de la largeur du champ, depuis l'ouverture (le premier est celui du départ). */
async function recordField(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __field: string[] };
    w.__field = [];
    new MutationObserver(() => {
      const node = document.getElementById('stellar-field');
      const text = node?.textContent ?? '';
      if (text && w.__field.at(-1) !== text) w.__field.push(text);
    }).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
}
const recorded = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __field: string[] }).__field);

/** Ouvre une fois (chunk et données en cache) puis referme : la réouverture mesurée est immédiate. */
async function warm(page: Page): Promise<void> {
  await openFromSettings(page);
  await page.locator('#stellar-skip').click();
  await page.locator('#stellar-back').click();
  await expect(page.locator('#stellar-view')).toHaveCount(0);
}

async function reopen(page: Page): Promise<void> {
  await page.locator('#settings-trigger').dispatchEvent('click');
  await openSettingsTab(page, 'scene');
  await page.locator('#stellar-open').click();
  await expect(page.locator('#stellar-view')).toBeVisible({ timeout: 30_000 });
}

const number = (text: string): number => Number(text.replace(/,/g, ''));

test.describe('the change of scale', () => {
  useAnimatedMotion();
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the field starts in astronomical units and ends in light-years, with the unit explained', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await boot(page);
    await warm(page);
    await recordField(page);
    const canvases = await page.locator('canvas').count();
    await reopen(page);
    // Pendant le recul : le bouton pour passer, l'unité et le repère expliqués, jamais un voyage.
    await expect(page.locator('#stellar-skip')).toBeVisible();
    await expect(page.locator('#stellar-stage')).toContainText(
      'astronomical unit (AU)'
    );
    await expect(page.locator('#stellar-stage')).toContainText('not a journey');
    await expect(page.locator('#stellar-stage')).toContainText('No speed');
    // Un seul canevas : la transition est le rendu de la même boucle, pas un second renderer.
    await expect(page.locator('canvas')).toHaveCount(canvases);
    // Arrivée : le bouton et l'explication disparaissent, la largeur est en années-lumière.
    await expect(page.locator('#stellar-skip')).toBeHidden({ timeout: 15_000 });
    await expect(page.locator('#stellar-stage')).toBeHidden();
    await expect(page.locator('#stellar-field')).toContainText(/ly \(/);
    const texts = await recorded(page);
    const first = texts[0]!;
    expect(first).toMatch(/^Field width at the Sun: [\d.,]+ AU$/);
    const startAu = number(/([\d.,]+) AU/.exec(first)![1]!);
    // 70 UA de distance, champ de 50° sur un écran de 1280 × 800 : de l'ordre de 100 UA.
    expect(startAu).toBeGreaterThan(60);
    expect(startAu).toBeLessThan(160);
    const last = texts.at(-1)!;
    const end = /^Field width at the Sun: ([\d.,]+) ly \(([\d.,]+) pc\)$/.exec(
      last
    );
    expect(end, last).not.toBeNull();
    // Les deux unités du même champ sont cohérentes : 1 pc = 3,26 al.
    // (trois chiffres significatifs affichés : à 3 % près)
    expect(
      Math.abs(number(end![1]!) / number(end![2]!) / 3.2616 - 1)
    ).toBeLessThan(0.03);
    // Le champ a traversé les deux unités, en ne faisant que croître.
    expect(texts.some((t) => / AU$/.test(t))).toBe(true);
    expect(texts.length).toBeGreaterThan(4);
    const widthsAu = texts.map((t) => {
      const m = /([\d.,]+) (AU|ly)/.exec(t)!;
      const v = number(m[1]!);
      return m[2] === 'AU' ? v : v * 63_241.077;
    });
    for (let i = 1; i < widthsAu.length; i++)
      expect(widthsAu[i]!).toBeGreaterThanOrEqual(widthsAu[i - 1]! * 0.985);
  });

  test('the skip button ends the transition at once; Back returns at once, mid-transition', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await boot(page);
    await warm(page);
    await reopen(page);
    await expect(page.locator('#stellar-skip')).toBeVisible();
    await page.locator('#stellar-skip').click();
    await expect(page.locator('#stellar-skip')).toBeHidden({ timeout: 1500 });
    await expect(page.locator('#stellar-field')).toContainText(/ly \(/);
    await page.locator('#stellar-back').click();
    await expect(page.locator('#stellar-view')).toHaveCount(0);

    // Aller-retour : on referme PENDANT la transition, la scène solaire est intacte, on rouvre.
    const inertBefore = await page.locator('[inert]').count();
    await reopen(page);
    await expect(page.locator('#stellar-skip')).toBeVisible();
    await page.locator('#stellar-back').click();
    await expect(page.locator('#stellar-view')).toHaveCount(0, {
      timeout: 1500,
    });
    await expect(page.locator('[data-stellar-hidden]')).toHaveCount(0);
    await expect(page.locator('[inert]')).toHaveCount(inertBefore);
    await expect(page).toHaveURL(/\/neptune\//);
    await reopen(page);
    await expect(page.locator('#stellar-skip')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#stellar-view')).toHaveCount(0, {
      timeout: 1500,
    });
    // Le rendu solaire a repris : la barre d'outils est de nouveau là.
    await expect(page.locator('.dock').first()).toBeVisible();
  });

  test('a key or a gesture on the scene ends the transition without choosing a star', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await boot(page);
    await warm(page);
    await reopen(page);
    await expect(page.locator('#stellar-skip')).toBeVisible();
    await page.locator('#stellar-surface').focus();
    await page.keyboard.press('+');
    await expect(page.locator('#stellar-skip')).toBeHidden({ timeout: 1500 });
    await page.locator('#stellar-back').click();

    await reopen(page);
    await expect(page.locator('#stellar-skip')).toBeVisible();
    await page.mouse.click(640, 400);
    await expect(page.locator('#stellar-skip')).toBeHidden({ timeout: 1500 });
    // Le geste a terminé la transition : il n'a choisi aucune étoile.
    await expect(
      page.locator('#stellar-list button[aria-pressed="true"]')
    ).toHaveCount(0);
  });

  test('the selected star is kept through the transition when entering from its card', async ({
    page,
  }) => {
    test.setTimeout(180_000);
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
    await expect(page.locator('#stellar-view')).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.locator('#stellar-list button[aria-pressed="true"]')
    ).toContainText("Barnard's Star");
    await expect(page.locator('#stellar-skip')).toBeHidden({ timeout: 15_000 });
    // Toujours choisie à l'arrivée, avec sa distance.
    await expect(
      page.locator('#stellar-list button[aria-pressed="true"]')
    ).toContainText("Barnard's Star");
    await expect(page.locator('#stellar-card')).toContainText(/5\.96\d* ±/);
  });

  test('the solar context is kept: same body and same URL after an interrupted transition', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await boot(page);
    const url = page.url();
    await warm(page);
    await reopen(page);
    await expect(page.locator('#stellar-skip')).toBeVisible();
    await page.locator('#stellar-back').click();
    await expect(page.locator('#stellar-view')).toHaveCount(0);
    expect(page.url().replace(/date=[^&]*/, '')).toBe(
      url.replace(/date=[^&]*/, '')
    );
    await expect(page.locator('#orbit-neptune')).toHaveClass(/is-active/);
  });

  test('accessible while it runs: no axe violation on the explanation, keyboard focus kept on Back', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await boot(page);
    await warm(page);
    await reopen(page);
    await expect(page.locator('#stellar-stage')).toBeVisible();
    await expect(page.locator('#stellar-back')).toBeFocused();
    const during = await new AxeBuilder({ page })
      .include('#stellar-view')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(during.violations).toEqual([]);
    await page.locator('#stellar-skip').click();
    await expect(page.locator('#stellar-back')).toBeFocused();
  });

  for (const [locale, journey] of [
    ['fr', 'pas un voyage'],
    ['es', 'no un viaje'],
    ['pt-BR', 'não uma viagem'],
  ] as const) {
    test(`language ${locale}: the field, the unit and the "not a journey" line follow, no raw key`, async ({
      page,
    }) => {
      test.setTimeout(180_000);
      await boot(page, locale);
      await openFromSettings(page);
      const stage = page.locator('#stellar-stage');
      await expect(stage).toContainText(journey);
      await expect(stage).toContainText('UA');
      await expect(page.locator('#stellar-field')).toContainText(
        /Largeur|Ancho|Largura/
      );
      const text = (await page.locator('#stellar-view').textContent()) ?? '';
      expect(text).not.toMatch(/st\.[a-zA-Z]+/);
      await page.locator('#stellar-skip').click();
    });
  }
});

test.describe('reduced motion', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('arrives directly, in light-years, with no transition to skip', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await boot(page);
    await openFromSettings(page);
    await expect(page.locator('#stellar-skip')).toBeHidden();
    await expect(page.locator('#stellar-stage')).toBeHidden();
    await expect(page.locator('#stellar-field')).toContainText(/ly \(/);
  });
});

test.describe('the graphics context is lost', () => {
  test('the view refuses to open and says so', async ({ page }) => {
    test.setTimeout(120_000);
    await boot(page);
    const canLose = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
      const ext = gl?.getExtension('WEBGL_lose_context');
      if (!ext) return false;
      ext.loseContext();
      return true;
    });
    test.skip(!canLose, 'WEBGL_lose_context unsupported in this browser');
    await page.locator('#settings-trigger').dispatchEvent('click');
    await openSettingsTab(page, 'scene');
    await page.locator('#stellar-open').click();
    await page.waitForTimeout(1500);
    await expect(page.locator('#stellar-view')).toHaveCount(0);
    await expect(page.locator('[data-stellar-hidden]')).toHaveCount(0);
  });
});
