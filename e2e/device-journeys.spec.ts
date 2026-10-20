import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { blockExternalNetwork } from './netBlock';
import { MOON_SCENE_DATE } from './moonScene';

/**
 * LES PARCOURS DU TÉLÉPHONE (`pnpm test:mobile`) : au-delà du démarrage de `device-matrix`, chaque
 * surface qu'un visiteur ouvre au doigt (fiche, palette, temps, météo, événements, aide, Explo, une
 * sonde) est ouverte puis MESURÉE : pas de débordement de page, aucun descendant rogné par sa
 * propre surface, aucune cible tactile sous 24 px (WCAG 2.5.8), aucune erreur de console.
 * Captures dans `reports/mobile/<appareil>/journeys-*.png`, à regarder.
 */

const OUT = 'reports/mobile';

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    try {
      localStorage.setItem('ssv-guided-tour-v1', '1');
      localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    } catch {
      /* stockage refusé : le scénario tourne sans */
    }
  });
});

async function boot(page: Page, path: string): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(path);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  await page.waitForTimeout(4_000);
  return errors;
}

async function shot(page: Page, label: string): Promise<void> {
  const device = test.info().project.name;
  mkdirSync(`${OUT}/${device}`, { recursive: true });
  await page.screenshot({ path: `${OUT}/${device}/journeys-${label}.png` });
}

/** Débordement de page, en pixels. */
const pageOverflow = (page: Page): Promise<number> =>
  page.evaluate(() =>
    Math.max(0, document.documentElement.scrollWidth - window.innerWidth)
  );

/**
 * Descendants visibles d'une surface dont le contenu dépasse leur boîte (texte rogné) ou sort de
 * l'écran, `.sr-only` exclus (leur texte dépasse toujours). Mesure ÉLÉMENT PAR ÉLÉMENT : un
 * conteneur en `overflow: hidden` rapporte `scrollWidth === clientWidth`.
 */
async function clipped(page: Page, selector: string): Promise<string[]> {
  return page
    .locator(selector)
    .first()
    .evaluate((root) => {
      const out: string[] = [];
      const vw = window.innerWidth;
      for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
        if (el.closest('.sr-only')) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') continue;
        const tag = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${
          el.className && typeof el.className === 'string'
            ? `.${el.className.split(' ')[0]}`
            : ''
        }`;
        if (
          el.scrollWidth - el.clientWidth > 1 &&
          style.overflowX !== 'auto' &&
          style.overflowX !== 'scroll'
        )
          out.push(`${tag} rogné de ${el.scrollWidth - el.clientWidth}px`);
        if (r.right > vw + 1 && !el.closest('[data-scrolls]'))
          out.push(`${tag} sort de l'écran (${Math.round(r.right)} > ${vw})`);
      }
      return out;
    });
}

/**
 * Boutons et champs visibles d'une surface dont la cible tactile est sous 24 px (WCAG 2.5.8).
 * Exemptés comme le critère les exempte : un lien DANS une phrase, un curseur (sa poignée est la
 * cible) et une case dont l'étiquette, qui la déclenche, atteint 24 px.
 */
async function smallTargets(page: Page, selector: string): Promise<string[]> {
  return page
    .locator(selector)
    .first()
    .evaluate((root) => {
      const out: string[] = [];
      const sel =
        'button, [role="button"], input, select, a[href], [role="tab"]';
      for (const el of Array.from(root.querySelectorAll<HTMLElement>(sel))) {
        if (el.closest('.sr-only')) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (getComputedStyle(el).visibility === 'hidden') continue;
        if (el instanceof HTMLInputElement && el.type === 'range') continue;
        if (el.tagName === 'A' && getComputedStyle(el).display === 'inline')
          continue;
        const label =
          el instanceof HTMLInputElement
            ? (el.closest('label') ?? el.labels?.[0])
            : null;
        const box = label ? label.getBoundingClientRect() : r;
        if (box.width < 24 || box.height < 24)
          out.push(
            `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} ${Math.round(box.width)}x${Math.round(box.height)}`
          );
      }
      return out;
    });
}

const own = (errors: string[]): string[] =>
  errors.filter(
    (e) => !/ERR_FAILED|Failed to load resource|net::|aborted/i.test(e)
  );

for (const [trigger, surface, label] of [
  ['#info-trigger', '#body-info', 'fiche'],
  ['#time-panel button, #clock-display', '#time-panel', 'temps'],
  ['#weather-trigger', '#weather-layers', 'meteo'],
  ['#events-trigger', '#astronomical-events', 'evenements'],
  ['#help-btn', '#help-popover', 'aide'],
] as const) {
  test(`surface « ${label} » : tient dans l'écran, rien de rogné, cibles ≥ 24 px`, async ({
    page,
  }) => {
    const errors = await boot(page, `/fr/earth/?date=${MOON_SCENE_DATE}`);
    const button = page.locator(trigger).first();
    if ((await button.count()) > 0 && (await button.isVisible()))
      await button.tap();
    await page.waitForTimeout(1_000);
    await shot(page, label);

    expect(await pageOverflow(page), 'débordement de page').toBeLessThanOrEqual(
      1
    );
    if (
      await page
        .locator(surface)
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      expect(await clipped(page, surface), 'rognage').toEqual([]);
      expect(await smallTargets(page, surface), 'cibles tactiles').toEqual([]);
    }
    expect(own(errors)).toEqual([]);
  });
}

test('Explo : le passage de mode garde les docks utilisables et la scène lisible', async ({
  page,
}) => {
  const errors = await boot(page, `/fr/jupiter/?date=${MOON_SCENE_DATE}`);
  await page.locator('.mode-btn[data-mode="explo"]').tap();
  await expect(page.locator('.mode-btn[data-mode="explo"]')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await page.waitForTimeout(6_000);
  await shot(page, 'explo');
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  expect(await smallTargets(page, '#mode-controls')).toEqual([]);
  expect(own(errors)).toEqual([]);
});

test('une sonde se sélectionne au doigt depuis la palette et sa fiche tient', async ({
  page,
}) => {
  const errors = await boot(page, `/fr/earth/?date=${MOON_SCENE_DATE}`);
  await page.locator('[aria-controls="body-palette"]').first().tap();
  await page.locator('#palette-input').fill('Voyager 1');
  await page.locator('#palette-results button:visible').first().tap();
  await page.waitForTimeout(3_000);
  await shot(page, 'sonde');
  expect(await pageOverflow(page)).toBeLessThanOrEqual(1);
  await expect(page.locator('#body-info')).toBeVisible();
  expect(await clipped(page, '#body-info')).toEqual([]);
  expect(own(errors)).toEqual([]);
});

test('le changement de langue ne casse pas la mise en page (es, pt)', async ({
  page,
}) => {
  const errors = await boot(page, `/fr/earth/?date=${MOON_SCENE_DATE}`);
  await page.locator('#help-btn').tap();
  for (const lang of ['es', 'pt']) {
    const seg = page
      .locator(
        `#lang-switch [lang="${lang === 'pt' ? 'pt-BR' : lang}"], #lang-switch [data-lang="${lang}"]`
      )
      .first();
    if ((await seg.count()) === 0) continue;
    await seg.tap();
    await page.waitForTimeout(2_000);
    await shot(page, `langue-${lang}`);
    expect(await pageOverflow(page), lang).toBeLessThanOrEqual(1);
    expect(await clipped(page, '#help-popover'), lang).toEqual([]);
  }
  expect(own(errors)).toEqual([]);
});

test("l'aide laisse lire tous les conseils en défilant", async ({ page }) => {
  await boot(page, `/fr/earth/?date=${MOON_SCENE_DATE}`);
  await page.locator('#help-btn').tap();
  await page.waitForTimeout(800);
  // Le corps de l'aide ne doit pas être un défileur écrasé (les boutons de visite, hors de lui,
  // lui laissaient 2,5 lignes) : il montre tout son contenu, c'est la popover qui défile.
  const [client, scroll] = await page
    .locator('#help-popover .surface-body')
    .evaluate((el) => [el.clientHeight, el.scrollHeight]);
  expect(scroll - client).toBeLessThanOrEqual(1);
  await shot(page, 'aide-defile');
});
