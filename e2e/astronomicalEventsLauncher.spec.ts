import { expect, test, type Page } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

/**
 * GAL-PERF-001B-01 : le panneau des événements astronomiques est un module chargé AU PREMIER CLIC
 * (`ui/astronomicalEventsLauncher`). Le serveur de développement le sert sous `/src/ui/astronomicalEvents.ts`
 * (le morceau de production, son précache et l'ouverture hors ligne sont contrôlés sur le build par
 * `built-pwaPrecache.spec.ts` et `built-astronomicalEventsOffline.spec.ts`). Les scénarios fixent ce
 * que le chargement différé ne doit pas casser : pas de chargement au démarrage, une ouverture au
 * premier clic, une seule charge et une seule instance, une intention d'ouvrir qui EXPIRE si le
 * visiteur a fait autre chose (autre surface, Échap, focus ailleurs), un échec annoncé puis réessayé.
 * L'import est retenu par une porte, jamais par un délai deviné. Ils sont ici, et non dans
 * `test:pages`, parce que chacun démarre l'application entière : ce job a 15 minutes en tout.
 */
const CHUNK = /\/src\/ui\/astronomicalEvents\.ts(\?.*)?$/;
const PANEL = '#astronomical-events';
const TRIGGER = '#events-trigger';

async function boot(page: Page): Promise<{ requests: string[] }> {
  await blockExternalNetwork(page);
  const requests: string[] = [];
  page.on('request', (request) => {
    if (CHUNK.test(request.url())) requests.push(request.url());
  });
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
  await page.goto('/earth/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  return { requests };
}

/** Retient le morceau jusqu'à l'appel de la fonction rendue ; `seen()` compte ses requêtes. */
async function hold(
  page: Page
): Promise<{ release: () => void; seen: () => number }> {
  let release: () => void = () => undefined;
  let count = 0;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(CHUNK, async (route) => {
    count++;
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  return { release, seen: () => count };
}

test('rien n’est chargé au démarrage : ni morceau ni panneau, le déclencheur reste étiqueté', async ({
  page,
}) => {
  const { requests } = await boot(page);
  await page.waitForTimeout(2000);
  expect(requests, 'requêtes du morceau').toEqual([]);
  await expect(page.locator(PANEL)).toHaveCount(0);
  const trigger = page.locator(TRIGGER);
  await expect(trigger).toHaveAttribute('aria-label', 'Astronomical events');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).not.toHaveAttribute('aria-busy', /.*/);
});

test('le premier clic ouvre le panneau sans second clic, calculé à la date d’ouverture', async ({
  page,
}) => {
  const { requests } = await boot(page);
  await page.locator(TRIGGER).click();
  const panel = page.locator(PANEL);
  await expect(panel).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(`${PANEL} .event-row`)).toHaveCount(8);
  await expect(page.locator(TRIGGER)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator(`${PANEL} .events-close`)).toBeFocused();
  expect(requests).toHaveLength(1);

  // Fermé puis rouvert : la MÊME instance, aucune seconde charge.
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(page.locator(TRIGGER)).toBeFocused();
  await page.locator(TRIGGER).click();
  await expect(panel).toBeVisible();
  await expect(page.locator(PANEL)).toHaveCount(1);
  expect(requests).toHaveLength(1);
});

test('des clics répétés pendant le chargement : une charge, une instance, une ouverture', async ({
  page,
}) => {
  await boot(page);
  const gate = await hold(page);
  const trigger = page.locator(TRIGGER);
  await trigger.click();
  await expect.poll(gate.seen).toBe(1);
  await expect(trigger).toHaveAttribute('aria-busy', 'true');
  await trigger.click();
  await trigger.click();
  await expect(page.locator(PANEL)).toHaveCount(0);
  gate.release();
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(PANEL)).toHaveCount(1);
  await expect(page.locator(`${PANEL} .event-row`)).toHaveCount(8);
  expect(gate.seen()).toBe(1);
  await expect(trigger).not.toHaveAttribute('aria-busy', /.*/);
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
});

test('une autre surface ouverte pendant le chargement : la réponse ne rouvre pas le panneau', async ({
  page,
}) => {
  await boot(page);
  const gate = await hold(page);
  await page.locator(TRIGGER).click();
  await expect.poll(gate.seen).toBe(1);
  // Clic PROGRAMMATIQUE, puis focus REMIS sur le déclencheur des événements (les réglages prennent
  // le focus en s'ouvrant) : le focus est donc intact à l'arrivée du module, et seule l'annonce du
  // coordinateur (une autre surface s'ouvre) peut annuler l'intention.
  await page.evaluate(() =>
    document.getElementById('settings-trigger')!.click()
  );
  await expect(page.locator('#orbit-options')).toBeVisible();
  await page.locator(TRIGGER).focus();
  await expect(page.locator(TRIGGER)).toBeFocused();
  gate.release();
  await expect(page.locator(TRIGGER)).not.toHaveAttribute('aria-busy', /.*/);
  // Le module est arrivé et monté, mais le panneau reste fermé, les réglages restent ouverts.
  await expect(page.locator(PANEL)).toBeHidden();
  await expect(page.locator('#orbit-options')).toBeVisible();
  await expect(page.locator(`${PANEL} .events-close`)).not.toBeFocused();
  // Le clic suivant ouvre normalement, et ferme la surface précédente.
  await page.locator(TRIGGER).click();
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(page.locator('#orbit-options')).toBeHidden();
  await expect(page.locator(PANEL)).toHaveCount(1);
});

test('Échap pendant le chargement annule l’ouverture', async ({ page }) => {
  await boot(page);
  const gate = await hold(page);
  await page.locator(TRIGGER).click();
  await expect.poll(gate.seen).toBe(1);
  await page.keyboard.press('Escape');
  gate.release();
  await expect(page.locator(TRIGGER)).not.toHaveAttribute('aria-busy', /.*/);
  await expect(page.locator(PANEL)).toBeHidden();
  await expect(page.locator(TRIGGER)).toHaveAttribute('aria-expanded', 'false');
  await page.locator(TRIGGER).click();
  await expect(page.locator(PANEL)).toBeVisible();
});

test('le focus parti ailleurs pendant le chargement n’est pas volé', async ({
  page,
}) => {
  await boot(page);
  const gate = await hold(page);
  await page.locator(TRIGGER).click();
  await expect.poll(gate.seen).toBe(1);
  await page.locator('#settings-trigger').focus();
  gate.release();
  await expect(page.locator(TRIGGER)).not.toHaveAttribute('aria-busy', /.*/);
  await expect(page.locator(PANEL)).toBeHidden();
  await expect(page.locator('#settings-trigger')).toBeFocused();
});

test('un échec de chargement est annoncé, puis le clic suivant le réussit', async ({
  page,
}) => {
  await boot(page);
  await page.route(CHUNK, (route) => route.abort());
  await page.locator(TRIGGER).click();
  await expect(page.locator('[role="status"].sr-only').first()).toContainText(
    'could not be loaded',
    { timeout: 15_000 }
  );
  await expect(page.locator(PANEL)).toHaveCount(0);
  await expect(page.locator(TRIGGER)).not.toHaveAttribute('aria-busy', /.*/);
  await page.unroute(CHUNK);
  await page.locator(TRIGGER).click();
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(`${PANEL} .event-row`)).toHaveCount(8);
});

test('le survol précharge le morceau sans rien monter, et le clic le réutilise', async ({
  page,
}) => {
  const { requests } = await boot(page);
  await page.locator(TRIGGER).hover();
  await expect.poll(() => requests.length).toBe(1);
  await expect(page.locator(PANEL)).toHaveCount(0);
  await page.locator(TRIGGER).click();
  await expect(page.locator(PANEL)).toBeVisible();
  expect(requests).toHaveLength(1);
});

test('choisir un événement ferme le panneau instancié au premier clic', async ({
  page,
}) => {
  // La date exacte, la pause et le recadrage sont contrôlés par `events.spec.ts` (chemin du serveur
  // de développement, qui passe désormais par ce même lanceur) : ici, seulement la ligne cliquable.
  await boot(page);
  await page.locator(TRIGGER).click();
  const row = page.locator(`${PANEL} .event-row`).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  expect(await row.getAttribute('data-event-date')).toMatch(
    /^\d{4}-\d{2}-\d{2}T/
  );
  await row.click();
  await expect(page.locator(PANEL)).toBeHidden();
  await expect(page.locator(TRIGGER)).toHaveAttribute('aria-expanded', 'false');
});
