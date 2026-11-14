import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';
import { openSettingsTab } from './settingsTab';

/**
 * LES COUCHES DU CIEL SOUS LA CSP DE PRODUCTION (GAL-CSP-001) : les noms des constellations, du
 * ciel profond et des pluies de météores, et le canvas des satellites.
 *
 * Elles injectaient un `<style>` : refusé par `style-src 'self'`, les noms restaient dans le flux
 * (conteneur `static`, sous l'écran) et le canvas des satellites doublait la hauteur du document,
 * hors de la vue, alors que la case annonçait « 171 satellites ». Le serveur de développement ne
 * pose aucune CSP : seul un BUILD servi par `vite preview`, avec la politique que
 * `scripts/prepare-pages.mjs` copie de `firebase.json` (même source, jamais recopiée ici), le voit.
 *
 * Chaque scénario est joué avec la CSP, et une fois SANS elle (témoin) : si le témoin échoue, c'est
 * un défaut de données ou de mise en page, pas de style. `securitypolicyviolation` doit rester muet.
 */
const firebase = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../firebase.json'), 'utf8')
) as {
  hosting: {
    headers: { source: string; headers: { key: string; value: string }[] }[];
  };
};
const CSP = firebase.hosting.headers
  .find((block) => block.source === '**')
  ?.headers.find((h) => h.key === 'Content-Security-Policy')?.value;

const SATELLITES = readFileSync(
  new URL('./satellites.fixture.json', import.meta.url),
  'utf8'
);
/**
 * Date de l'époque de la fixture des satellites (cf. `satelliteLayer.spec.ts`), pour toute la scène.
 * Sur la Terre à cette date, des constellations et des objets du ciel profond sont dans le champ
 * (mesuré, les objets du ciel profond seulement sur la largeur du bureau) ; un radiant de météores
 * y est « dans le champ ou non » (cf. `meteorLayer.spec.ts`) : pour eux on ne contrôle que la mise
 * en page, pas un compte de noms.
 */
const SATELLITES_DATE = '2026-11-02T19:00:00Z';
/** Le JS ou le CSS d'une de ces couches : rien de tout cela ne se charge tant qu'elles sont éteintes. */
const LAYER_ASSET =
  /\/assets\/(skyLabels|constellationNames|deepSkyLayer|meteorLayer|satelliteLayer)-[^/]*\.(js|css)$/;

const VIEWS = {
  desktop: { width: 1280, height: 800 },
  phone: { width: 390, height: 844 },
} as const;

/**
 * La CSP de production, telle quelle, sauf pour WebKit : il applique `upgrade-insecure-requests` à
 * `http://localhost` (Chromium l'en exempte), si bien que le `vite preview` en http ne charge plus
 * rien et que l'application ne démarre pas (mesuré : `#loader` reste affiché, avec le build de
 * `main` aussi). Cette directive ne touche pas aux styles : on la retire pour WebKit seulement,
 * `style-src` et le reste restent ceux de `firebase.json`.
 */
function policyFor(page: Page): string {
  const webkit = page.context().browser()?.browserType().name() === 'webkit';
  return webkit ? CSP!.replace(/;?\s*upgrade-insecure-requests/, '') : CSP!;
}

async function boot(
  page: Page,
  options: { csp: boolean; url: string; toggle: string }
): Promise<{ assets: string[] }> {
  expect(CSP, 'la CSP de firebase.json').toContain("style-src 'self'");
  await blockExternalNetwork(page);
  await page.route('**/satellites/elements.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: SATELLITES,
    })
  );
  if (options.csp) {
    await page.route('**/*', async (route) => {
      // `fallback` et non `continue` : les routes déclarées avant (réseau bloqué, fixture) restent actives.
      if (route.request().resourceType() !== 'document')
        return route.fallback();
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          'content-security-policy': policyFor(page),
        },
      });
    });
  }
  const assets: string[] = [];
  page.on('request', (r) => {
    if (LAYER_ASSET.test(new URL(r.url()).pathname)) assets.push(r.url());
  });
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      w.__csp.push(e.effectiveDirective)
    );
  });
  await page.goto(options.url);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  await expect(page.locator(`#${options.toggle}`)).toBeEnabled({
    timeout: 40_000,
  });
  return { assets };
}

/**
 * Les violations de style vues par la page. Chromium n'en rapporte aucune au démarrage ; WebKit en
 * rapporte quelques-unes (`style-src-attr`, depuis `SolarSystemApp` et d'autres modules, mesuré sur
 * le build de `main`, AVANT toute couche) : sur WebKit on exige donc que les couches n'en ajoutent
 * aucune, sur Chromium qu'il n'y en ait aucune.
 */
async function styleViolations(page: Page): Promise<string[]> {
  const all = await page.evaluate(
    () => (window as unknown as { __csp: string[] }).__csp
  );
  return all.filter((d) => d.startsWith('style-src'));
}

async function expectNoNewStyleViolations(
  page: Page,
  baseline: string[]
): Promise<void> {
  const webkit = page.context().browser()?.browserType().name() === 'webkit';
  if (!webkit) expect(baseline, 'aucune violation au démarrage').toEqual([]);
  expect(
    await styleViolations(page),
    'aucune violation de style due aux couches'
  ).toEqual(baseline);
}

/** Le document ne doit ni défiler ni déborder : un canvas hors flux le ferait. */
async function expectNoParasiticScroll(page: Page): Promise<void> {
  const [horizontal, vertical] = await page.evaluate(() => [
    document.documentElement.scrollWidth - innerWidth,
    document.documentElement.scrollHeight - innerHeight,
  ]);
  expect(horizontal, 'débordement horizontal').toBeLessThanOrEqual(0);
  expect(vertical, 'débordement vertical').toBeLessThanOrEqual(0);
}

/** Les éléments affichés d'une couche de noms, et ceux qui sont dans la fenêtre. */
async function shownInViewport(
  page: Page,
  item: string
): Promise<{ shown: number; inside: number }> {
  return page.evaluate((sel) => {
    const shown = [...document.querySelectorAll<HTMLElement>(sel)].filter(
      (e) => getComputedStyle(e).display !== 'none'
    );
    const inside = shown.filter((e) => {
      const r = e.getBoundingClientRect();
      return (
        r.width > 0 &&
        r.right > 0 &&
        r.left < innerWidth &&
        r.bottom > 0 &&
        r.top < innerHeight
      );
    });
    return { shown: shown.length, inside: inside.length };
  }, item);
}

async function expectHostLayout(
  page: Page,
  host: string,
  zIndex: string
): Promise<void> {
  const look = await page.evaluate((sel) => {
    const el = document.querySelector<HTMLElement>(sel)!;
    const c = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      position: c.position,
      zIndex: c.zIndex,
      pointerEvents: c.pointerEvents,
      rect: [r.left, r.top, r.width, r.height],
      vw: innerWidth,
      vh: innerHeight,
    };
  }, host);
  expect(look.position).toBe('fixed');
  expect(look.zIndex).toBe(zIndex);
  expect(look.pointerEvents).toBe('none');
  expect(look.rect).toEqual([0, 0, look.vw, look.vh]);
  await expect(page.locator(host)).toHaveAttribute('aria-hidden', 'true');
}

const LAYERS = [
  [
    'constellations-toggle',
    '.constellation-names',
    '.constellation-names-item',
    'all',
  ],
  ['deepsky-toggle', '.deepsky-names', '.deepsky-names-item', 'desktop'],
  ['meteors-toggle', '.meteor-names', '.meteor-names-item', 'none'],
] as const;

/**
 * Une seule scène par configuration : le démarrage WebGL d'un runner en rendu logiciel coûte
 * 30 à 60 s, et `pnpm test:pages` tourne dans le job `verify` (garde-fou de 15 minutes). Les
 * satellites d'abord, puis les trois couches de noms, sur la Terre à la date de la fixture.
 * Délais larges (démarrage 90 s, attentes 60 s) : sur ce runner l'image met plusieurs centaines de
 * millisecondes, et un marqueur ne se peint qu'à l'image suivante.
 */
for (const [label, viewName, csp] of [
  ['sous la CSP', 'desktop', true],
  ['sous la CSP', 'phone', true],
  ['sans CSP (témoin)', 'desktop', false],
] as const) {
  test(`couches du ciel, ${viewName} ${label} : satellites et noms, activés, éteints, rallumés`, async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await page.setViewportSize(VIEWS[viewName]);
    const { assets } = await boot(page, {
      csp,
      url: `/?mode=explo&body=earth&date=${SATELLITES_DATE}`,
      toggle: 'satellites-toggle',
    });
    // Éteintes au démarrage : ni JS, ni CSS, ni feuille de ces couches.
    expect(assets, 'rien de ces couches avant activation').toEqual([]);
    expect(
      await page.evaluate(() =>
        [...document.styleSheets].some((s) =>
          /skyLabels|satelliteLayer/.test(s.href ?? '')
        )
      )
    ).toBe(false);
    const baseline = await styleViolations(page);

    await page.locator('#settings-trigger').dispatchEvent('click');
    await openSettingsTab(page, 'scene');

    // --- Satellites : un canvas fixe, plein écran, sous la capture.
    const overlay = page.locator('#satellite-overlay');
    const markers = async (): Promise<number> =>
      Number(await overlay.getAttribute('data-markers'));
    await page.locator('#satellites-toggle').check();
    await expect.poll(markers, { timeout: 60_000 }).toBeGreaterThan(0);
    await expectHostLayout(page, '#satellite-overlay', '21');
    await expectNoParasiticScroll(page);

    // Pendant une capture d'image, la couche s'efface.
    await page.evaluate(() => document.body.classList.add('is-capturing'));
    await expect(overlay).toBeHidden();
    await page.evaluate(() => document.body.classList.remove('is-capturing'));
    await expect(overlay).toBeVisible();

    await page.locator('#satellites-toggle').uncheck();
    await expect(overlay).toBeHidden();
    await expect(overlay).toHaveAttribute('data-markers', '0');
    await page.locator('#satellites-toggle').check();
    await expect.poll(markers, { timeout: 60_000 }).toBeGreaterThan(0);
    await expectNoParasiticScroll(page);
    await page.locator('#satellites-toggle').uncheck();
    expect(assets.some((u) => /satelliteLayer-[^/]*\.css$/.test(u))).toBe(true);

    // --- Les noms écrits sur le ciel.
    for (const [toggle, host, item, expectNames] of LAYERS) {
      // Où un compte de noms est établi par la mesure (la vue change avec la largeur) : ailleurs, la
      // mise en page est seule contrôlée, et tout nom affiché doit tout de même être dans la fenêtre.
      const named =
        expectNames === 'all' ||
        (expectNames === 'desktop' && viewName === 'desktop');
      await expect(page.locator(`#${toggle}`)).toBeEnabled({ timeout: 60_000 });
      await page.locator(`#${toggle}`).check();
      await expect(page.locator(host)).toBeVisible();
      if (named)
        await expect
          .poll(async () => (await shownInViewport(page, item)).inside, {
            timeout: 60_000,
            message: `${item} dans la fenêtre`,
          })
          .toBeGreaterThan(0);
      else await page.waitForTimeout(2000);
      // Tout nom affiché est dans la fenêtre : aucun n'est resté dans le flux sous l'écran.
      const first = await shownInViewport(page, item);
      expect(first.inside).toBe(first.shown);
      await expectHostLayout(page, host, '3');
      await expectNoParasiticScroll(page);

      await page.locator(`#${toggle}`).uncheck();
      await expect(page.locator(host)).toBeHidden();
      await page.locator(`#${toggle}`).check();
      await expect(page.locator(host)).toBeVisible();
      if (named)
        await expect
          .poll(async () => (await shownInViewport(page, item)).inside, {
            timeout: 60_000,
          })
          .toBeGreaterThan(0);
      await expectNoParasiticScroll(page);
      await page.locator(`#${toggle}`).uncheck();
    }

    // La feuille des noms a bien été demandée avec la couche, et seulement alors.
    expect(assets.some((u) => /skyLabels-[^/]*\.css$/.test(u))).toBe(true);
    await expectNoNewStyleViolations(page, baseline);
  });
}
