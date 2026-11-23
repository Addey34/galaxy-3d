import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';
import { openSettingsTab } from './settingsTab';

/**
 * L'INSPECTION 3D D'UN ENGIN SOUS LA CSP DE PRODUCTION (GAL-OBJECT-IMMERSION-001).
 *
 * Les modèles de la NASA sont compressés en Draco. Le décodeur de three tourne dans un Worker créé
 * depuis un `blob:` et, en WebAssembly, serait refusé par `script-src 'self'` (pas de
 * `wasm-unsafe-eval`). Le serveur de développement ne pose AUCUNE CSP : un décodeur qui ne marche
 * que sans elle passerait tous les autres tests et casserait en production. Ce fichier charge un
 * modèle (la sonde JWST par sa fiche, l'ISS par la couche des satellites) dans un BUILD servi par
 * `vite preview`, avec la politique que `scripts/prepare-pages.mjs` copie de `firebase.json`, et
 * exige un modèle `ready` et AUCUNE violation. Témoin : la même chose sans CSP.
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
const SATELLITES_DATE = '2026-11-02T19:00:00Z';

test.use({ serviceWorkers: 'block' });

async function boot(
  page: Page,
  options: { csp: boolean; url: string }
): Promise<string[]> {
  expect(CSP, 'la CSP de firebase.json').toContain("script-src 'self'");
  await blockExternalNetwork(page);
  const origin = test.info().project.use.baseURL;
  await page.route(
    '**galaxy-data.adrianguichard.dev/assets/ephemerides/**',
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      const response = await route.fetch({ url: new URL(path, origin).href });
      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          'access-control-allow-origin': '*',
          'access-control-expose-headers': '*',
        },
      });
    }
  );
  await page.route('**/satellites/elements.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: SATELLITES,
    })
  );
  if (options.csp) {
    const policy = (): string => {
      const webkit =
        page.context().browser()?.browserType().name() === 'webkit';
      return webkit ? CSP!.replace(/;?\s*upgrade-insecure-requests/, '') : CSP!;
    };
    await page.route('**/*', async (route) => {
      if (route.request().resourceType() !== 'document')
        return route.fallback();
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          'content-security-policy': policy(),
        },
      });
    });
  }
  const violations: string[] = [];
  await page.exposeFunction('reportViolation', (text: string) =>
    violations.push(text)
  );
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    document.addEventListener('securitypolicyviolation', (event) =>
      (
        window as unknown as { reportViolation: (t: string) => void }
      ).reportViolation(`${event.violatedDirective} ${event.blockedURI}`)
    );
  });
  await page.goto(options.url);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  return violations;
}

for (const csp of [true, false]) {
  const label = csp ? 'sous la CSP de production' : 'sans CSP (témoin)';

  test(`la sonde JWST se décode et s’affiche ${label}`, async ({ page }) => {
    test.setTimeout(240_000);
    const violations = await boot(page, {
      csp,
      url: '/?body=jwst&mode=explo',
    });
    await page.locator('#craft-inspect').click({ timeout: 60_000 });
    await expect(page.locator('#craft-view')).toHaveAttribute(
      'data-craft-state',
      'ready',
      { timeout: 120_000 }
    );
    expect(violations).toEqual([]);
  });

  test(`l’ISS, depuis la couche des satellites, s’affiche ${label}`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const violations = await boot(page, {
      csp,
      url: `/?mode=explo&body=earth&date=${SATELLITES_DATE}`,
    });
    await page.locator('#settings-trigger').dispatchEvent('click');
    await openSettingsTab(page, 'scene');
    await page.locator('#satellites-toggle').check();
    const button = page.locator('#satellites-craft');
    await expect(button).toBeVisible({ timeout: 60_000 });
    await button.click();
    await expect(page.locator('#craft-view')).toHaveAttribute(
      'data-craft-state',
      'ready',
      { timeout: 120_000 }
    );
    await expect(page.locator('#craft-title')).toContainText(
      'International Space Station'
    );
    expect(violations).toEqual([]);
    // Fermée, la couche des satellites et son bouton sont tels qu'avant.
    await page.keyboard.press('Escape');
    await expect(page.locator('#craft-view')).toHaveCount(0);
    await page.locator('#info-trigger').waitFor({ state: 'attached' });
  });
}
