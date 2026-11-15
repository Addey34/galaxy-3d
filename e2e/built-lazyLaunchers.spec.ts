import { expect, test, type Page } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

/**
 * GAL-PERF-001A (REV1) : les lanceurs des chargements différés, sur le BUILD de production (morceaux
 * `/assets/<nom>-<empreinte>.js`, pas les modules du serveur de développement). Quatre contrôles :
 * échec puis reprise d'un import dynamique, premiers clics sous réseau lent, ordre WebXR avec un
 * environnement XR simulé, et le nudge d'Exploration quand l'aide est refermée pendant le chargement.
 * Aucun casque : le runtime XR est un double, c'est dit dans le rapport de la PR.
 *
 * Les service workers sont bloqués : un `sw.js` précache tous les morceaux et masquerait ce que ces
 * tests contrôlent (le chargement à la demande).
 */
test.use({ serviceWorkers: 'block' });

const CHUNK = (name: string): RegExp =>
  new RegExp(`/assets/${name}-[^/]*\\.js(\\?.*)?$`);

async function boot(
  page: Page,
  options: { firstVisitNudge?: boolean; xr?: boolean; url?: string } = {}
): Promise<void> {
  await blockExternalNetwork(page);
  // Une build dotée de `VITE_ASSET_ORIGIN` demande les éphémérides à `galaxy-data`, coupé par
  // `blockExternalNetwork` : on les sert depuis le build (comme `built-skyLayersCsp.spec.ts`).
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
  await page.addInitScript(
    ([nudge, xr]) => {
      localStorage.setItem('ssv-guided-tour-v1', '1');
      if (!nudge) localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
      localStorage.setItem('ssv-locale', 'en');
      if (xr) {
        const w = window as unknown as { __xr: string[] };
        w.__xr = [];
        const log = (what: string): number => w.__xr.push(what);
        const session = Object.assign(new EventTarget(), {
          end: () => {
            log('session.end');
            session.dispatchEvent(new Event('end'));
            return Promise.resolve();
          },
          updateRenderState: () => undefined,
          requestReferenceSpace: () => Promise.reject(new Error('double XR')),
          inputSources: [],
          renderState: {},
        });
        const add = session.addEventListener.bind(session);
        session.addEventListener = ((type: string, ...rest: never[]) => {
          log(`session.listen:${type}`);
          return (add as (t: string, ...r: never[]) => void)(type, ...rest);
        }) as typeof session.addEventListener;
        Object.defineProperty(navigator, 'xr', {
          configurable: true,
          value: {
            isSessionSupported: () => Promise.resolve(true),
            requestSession: () => {
              // Un geste est-il encore actif ? C'est ce que le navigateur exige d'un vrai appel.
              log(
                `requestSession:gesture=${navigator.userActivation.isActive}`
              );
              return Promise.resolve(session);
            },
          },
        });
      }
    },
    [!!options.firstVisitNudge, !!options.xr] as const
  );
  await page.goto(options.url ?? '/earth/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
}

/** Sert le morceau demandé après `ms` millisecondes, comme un réseau lent. */
async function slow(page: Page, name: string, ms: number): Promise<void> {
  await page.route(CHUNK(name), async (route) => {
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.fulfill({ response });
  });
}

/** Retient le morceau demandé jusqu'à l'appel de la fonction rendue (pas de délai à deviner). */
async function hold(page: Page, name: string): Promise<() => void> {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(CHUNK(name), async (route) => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  return release;
}

test('un import dynamique qui échoue est annoncé, puis le clic suivant le réussit', async ({
  page,
}) => {
  await boot(page);
  await page.route(CHUNK('capture'), (route) => route.abort());
  await page.locator('#capture-btn').click();
  await expect(page.locator('[role="status"].sr-only').first()).toContainText(
    'could not be loaded',
    { timeout: 15_000 }
  );
  await page.unroute(CHUNK('capture'));
  if (test.info().project.name === 'iphone') {
    // WebKit garde l'échec du module en mémoire et ne le redemande pas (mesuré) : le clic suivant
    // ne peut pas réussir, et le texte le DIT au lieu de répéter « réessayez ».
    await page.locator('#capture-btn').click();
    await expect(page.locator('[role="status"].sr-only').first()).toContainText(
      'Reload the page',
      { timeout: 15_000 }
    );
    return;
  }
  const download = page.waitForEvent('download', { timeout: 40_000 });
  await page.locator('#capture-btn').click();
  expect((await download).suggestedFilename()).toMatch(/^galaxy-earth-/);
});

test('sous réseau lent, un seul clic suffit et un double clic ne capture qu’une fois', async ({
  page,
}) => {
  await boot(page);
  await slow(page, 'capture', 3000);
  await slow(page, 'tourPlayer', 3000);
  await slow(page, 'guidedTour', 3000);
  let downloads = 0;
  page.on('download', () => downloads++);
  const first = page.waitForEvent('download', { timeout: 60_000 });
  await page.locator('#capture-btn').dblclick();
  await first;
  await page.waitForTimeout(3000);
  expect(downloads).toBe(1);

  // L'aide s'ouvre tout de suite ; le bouton des visites paraît quand leur module est arrivé.
  const start = Date.now();
  await page.locator('#help-btn').click();
  await expect(page.locator('#help-popover')).toBeVisible();
  expect(Date.now() - start).toBeLessThan(2500);
  await expect(page.locator('.stour-start')).toBeVisible({ timeout: 20_000 });
  await page.locator('.stour-start').click();
  await expect(page.locator('.stour-picker-item').first()).toBeVisible();
});

test('WebXR : requestSession dans le geste, la session attend le module, un échec la ferme', async ({
  page,
}) => {
  // Module en retard : requestSession part au clic, mais la session n'est posée qu'après lui.
  const release = await hold(page, 'webxr');
  await boot(page, { xr: true });
  const logs = (): Promise<string[]> =>
    page.evaluate(() => (window as unknown as { __xr: string[] }).__xr);
  await expect(page.locator('#webxr-btn')).toBeVisible();
  await page.locator('#webxr-btn').click();
  await expect.poll(logs).toContain('requestSession:gesture=true');
  await page.waitForTimeout(1000);
  expect(await logs()).not.toContain('session.listen:end');
  release();
  await expect.poll(logs, { timeout: 20_000 }).toContain('session.listen:end');
  const seen = await logs();
  expect(seen.indexOf('requestSession:gesture=true')).toBeLessThan(
    seen.indexOf('session.listen:end')
  );
  // Fermeture : le second clic termine la session.
  await page.locator('#webxr-btn').click();
  await expect.poll(logs).toContain('session.end');
});

test('WebXR : si le module ne charge pas, la session obtenue est refermée et l’échec est annoncé', async ({
  page,
}) => {
  await page.route(CHUNK('webxr'), (route) => route.abort());
  await boot(page, { xr: true });
  await page.locator('#webxr-btn').click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __xr: string[] }).__xr)
    )
    .toContain('session.end');
  await expect(page.locator('[role="status"].sr-only').first()).toContainText(
    'could not be loaded'
  );
});

test('le nudge d’Exploration ne rouvre pas une aide que le visiteur vient de fermer', async ({
  page,
}) => {
  await boot(page, { firstVisitNudge: true });
  await slow(page, 'tourPlayer', 3000);
  await page.locator('[data-mode="explo"]').first().click();
  const action = page.locator('.explo-tour-nudge-action');
  await expect(action).toBeVisible({ timeout: 15_000 });
  await action.click();
  await expect(page.locator('#help-popover')).toBeVisible();
  // Le visiteur change d'avis pendant le chargement.
  await page.locator('#help-btn').click();
  await expect(page.locator('#help-popover')).toBeHidden();
  await page.waitForTimeout(5000);
  // Le sélecteur de visites reste fermé (attribut `hidden`) : le nudge n'a pas cliqué `.stour-start`.
  await expect(page.locator('.stour-picker')).toHaveAttribute('hidden', '');
  // Et rouvrir l'aide plus tard ne montre pas un sélecteur déjà ouvert à l'insu du visiteur.
  await page.locator('#help-btn').click();
  await expect(page.locator('#help-popover')).toBeVisible();
  await expect(page.locator('.stour-start')).toBeVisible();
  await expect(page.locator('.stour-picker')).toHaveAttribute('hidden', '');
});
