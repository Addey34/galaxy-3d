import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockInspectorFields, type InspectorMock } from './inspectorMock';
import { waitForCalmMainThread } from './mainThread';

/**
 * L'INSPECTEUR MÉTÉO (GAL-METEO-INSPECT-003), de bout en bout, sur des champs SIMULÉS connus
 * (`inspectorMock.ts`) : ce qu'on prouve est le câblage et l'honnêteté des textes, pas la météo.
 *
 * Quatre promesses :
 *  - il LIT les couches déjà actives, sans jamais en activer une ni émettre une requête ;
 *  - un clic sur le globe choisit le bon point (aller-retour avec le marqueur, qui passe par la
 *    même chaîne de rotation) ; un glisser, le vide et la face cachée ne choisissent rien ;
 *  - une donnée périmée (date changée, réponse en route) n'affiche AUCUNE valeur ;
 *  - unités et langue suivent les préférences existantes.
 */

const SHOTS = process.env['INSPECT_SHOTS'];
async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

async function boot(
  page: Page,
  options: { query?: string; storage?: Record<string, string> } = {}
): Promise<InspectorMock> {
  await page.route('**/sbdb_query.api*', (route) => route.abort());
  const mock = await mockInspectorFields(page);
  const storage = {
    'ssv-guided-tour-v1': '1',
    'ssv-explo-tour-nudge-v1': '1',
    'ssv-locale': 'en',
    ...options.storage,
  };
  await page.addInitScript((entries) => {
    for (const [key, value] of Object.entries(entries))
      localStorage.setItem(key, value);
  }, storage);
  // L'horloge du navigateur est FIGÉE au lendemain de la date de la scène : la source d'une donnée météo dépend
  // de son âge (au-delà de 5 jours, l'archive ERA5 ; en deçà, Open-Meteo). Sans cela, la date épinglée du
  // 2026-11-19 12:00 passait de l'un à l'autre le 2026-11-24 à 12:00 UTC et ce fichier devenait rouge à
  // heure fixe (run `main` 45394112985, trois échecs sur trois ; reproduit en local le même jour).
  await page.clock.setFixedTime(new Date('2026-11-20T12:00:00Z'));
  await page.goto(options.query ?? '/?body=earth&date=2026-11-19T12:00:00Z');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 40_000 });
  await waitForCalmMainThread(page);
  return mock;
}

const card = (page: Page): Locator => page.locator('#weather-inspector');
const row = (page: Page, variable: string): Locator =>
  card(page).locator(`.wi-row[data-variable="${variable}"]`);

async function openPanel(page: Page): Promise<void> {
  await page.locator('#weather-trigger').click();
  await expect(page.locator('#weather-layers')).toBeVisible();
}

async function layerOn(page: Page, label: string): Promise<void> {
  await page
    .locator('#weather-layers .wl-item')
    .filter({ hasText: label })
    .locator('input')
    .check();
}

async function typePoint(page: Page, lat: number, lon: number): Promise<void> {
  await page.locator('#weather-inspector-lat').fill(String(lat));
  await page.locator('#weather-inspector-lon').fill(String(lon));
  await page.locator('#weather-inspector .wi-button--primary').click();
}

const MODEL_LAYERS = [
  'Wind (model)',
  'Rain (model)',
  'Clouds (model)',
  'Air temperature (model)',
];

test('reads the layers that are on, never turns one on, never calls the network', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const mock = await boot(page);
  await openPanel(page);

  const states = () =>
    page
      .locator('#weather-layers input[data-layer]')
      .evaluateAll((inputs) =>
        inputs.map((i) => (i as HTMLInputElement).checked)
      );
  const before = await states();
  const requestsBefore = mock.requests();

  await page.locator('#weather-inspect-toggle').click();
  await expect(card(page)).toBeVisible();
  await expect(page.locator('#weather-inspect-toggle')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await typePoint(page, 48.85, 2.35);

  // Aucune couche de modèle n'est allumée : le dire, ne rien activer, ne rien demander.
  await expect(card(page).locator('.wi-hint--layers')).toBeVisible();
  await expect(card(page).locator('.wi-row')).toHaveCount(0);
  expect(await states()).toEqual(before);
  expect(mock.requests()).toBe(requestsBefore);
  await shot(page, 'desktop-1-no-layer');

  // L'utilisateur allume les couches : l'inspecteur suit, sans rien relancer de lui-même.
  for (const label of MODEL_LAYERS) await layerOn(page, label);
  await expect(row(page, 'temperature').locator('.wi-value')).toContainText(
    '3.6',
    { timeout: 30_000 }
  );
  await expect(row(page, 'temperature').locator('.wi-value')).toContainText(
    '°C'
  );
  await expect(row(page, 'wind').locator('.wi-value')).toContainText('20');
  await expect(row(page, 'wind').locator('.wi-value')).toContainText('km/h');
  await expect(row(page, 'wind').locator('.wi-detail')).toContainText(
    'W · 270°'
  );
  // Un VRAI zéro : « 0 », avec sa phrase, jamais « donnée manquante ».
  await expect(row(page, 'precipitation').locator('.wi-value')).toContainText(
    '0'
  );
  await expect(row(page, 'precipitation').locator('.wi-detail')).toContainText(
    'No precipitation'
  );
  await expect(row(page, 'precipitation').locator('.wi-detail')).toContainText(
    'previous hour'
  );
  await expect(row(page, 'cloudCover').locator('.wi-value')).toContainText(
    '60'
  );
  await expect(card(page).locator('.wi-caveat')).toContainText('interpolated');
  await shot(page, 'desktop-2-paris');

  // Les couches ont fini de charger : plus aucune requête ne doit partir d'ici.
  await expect(page.locator('#weather-trigger')).toHaveAttribute(
    'aria-expanded',
    'true'
  );
  await page.waitForTimeout(1000);
  const settled = mock.requests();

  // Donnée ABSENTE (null) : dite, pas zéro. Vent calme : pas de direction.
  await typePoint(page, -33.87, 151.21);
  await expect(row(page, 'precipitation').locator('.wi-message')).toContainText(
    'No value in the model'
  );
  await expect(row(page, 'precipitation').locator('.wi-value')).toBeHidden();
  await shot(page, 'desktop-3-missing');
  await typePoint(page, -75, 10);
  await expect(row(page, 'wind').locator('.wi-detail')).toContainText('Calm');
  await expect(row(page, 'wind').locator('.wi-detail')).not.toContainText('°');

  // Les métadonnées : fournisseur, nature, date effective, pas de grille.
  await typePoint(page, 48.85, 2.35);
  const meta = row(page, 'temperature').locator('.wi-meta');
  await meta.locator('summary').click();
  await expect(meta).toContainText('Open-Meteo');
  await expect(meta).toContainText('2026-11-19 12:00 UTC');
  await expect(meta).toContainText('° grid, interpolated');
  await shot(page, 'desktop-4-meta');

  expect(mock.requests()).toBe(settled);

  // Accessibilité de la carte ouverte.
  const axe = await new AxeBuilder({ page })
    .include('#weather-inspector')
    .analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('a click picks the point, a drag and the void do not, the marker follows and hides behind the globe', async ({
  page,
}) => {
  await boot(page);
  await openPanel(page);
  await layerOn(page, 'Air temperature (model)');
  await page.locator('#weather-inspect-toggle').click();
  // Le morceau se charge au premier clic : le mode n'est armé qu'une fois la carte ouverte.
  await expect(card(page)).toBeVisible();

  const canvas = page.locator('canvas').first();
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const subtitle = card(page).locator('#weather-inspector-point');
  const marker = page.locator('.wi-marker');
  const markerCenter = async () => {
    const m = (await marker.boundingBox())!;
    return { x: m.x + m.width / 2, y: m.y + m.height / 2 };
  };

  // Rien n'est choisi : un glisser (rotation) ne choisit rien.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 40, cy + 10, { steps: 6 });
  await page.mouse.up();
  await expect(subtitle).toBeHidden();

  // Le clic au centre de la vue choisit un point, et le bouton « centre de la vue » le même.
  await page.mouse.click(cx, cy);
  await expect(subtitle).toBeVisible();
  const first = await subtitle.textContent();
  await page
    .locator('#weather-inspector .wi-button:not(.wi-button--primary)')
    .click();
  // La Terre tourne (1:1) entre les deux lectures : même point à 0,05° près, pas au centième.
  const inputs = () =>
    page.evaluate(() => ({
      lat: Number(
        (document.getElementById('weather-inspector-lat') as HTMLInputElement)
          .value
      ),
      lon: Number(
        (document.getElementById('weather-inspector-lon') as HTMLInputElement)
          .value
      ),
    }));
  const clicked = await inputs();
  await expect
    .poll(async () => {
      const centered = await inputs();
      return Math.hypot(centered.lat - clicked.lat, centered.lon - clicked.lon);
    })
    .toBeLessThan(0.05);
  await expect(marker).toBeVisible();
  const m1 = await markerCenter();
  expect(Math.hypot(m1.x - cx, m1.y - cy)).toBeLessThan(3);
  await shot(page, 'desktop-5-click');

  // Un autre clic : le marqueur retombe là où l'on a cliqué (aller-retour par la rotation).
  const target = { x: cx + 35, y: cy - 25 };
  await page.mouse.click(target.x, target.y);
  await expect(subtitle).not.toHaveText(first!);
  const m2 = await markerCenter();
  expect(Math.hypot(m2.x - target.x, m2.y - target.y)).toBeLessThan(3);

  // Cliquer dans le vide (hors du disque) ne change pas le point.
  const kept = await subtitle.textContent();
  await page.mouse.click(box.x + 6, box.y + 6);
  await expect(subtitle).toHaveText(kept!);

  // Le point opposé est sur la face cachée : le marqueur se masque, la lecture reste possible.
  const [lat, lon] = await page
    .evaluate(() => ({
      lat: Number(
        (document.getElementById('weather-inspector-lat') as HTMLInputElement)
          .value
      ),
      lon: Number(
        (document.getElementById('weather-inspector-lon') as HTMLInputElement)
          .value
      ),
    }))
    .then((v) => [v.lat, v.lon] as const);
  await typePoint(page, -lat, lon + 180);
  await expect(marker).toBeHidden();
  await expect(row(page, 'temperature').locator('.wi-value')).toBeVisible();

  // Échap ferme, désarme, masque le repère.
  await page.locator('#weather-inspector-lat').focus();
  await page.keyboard.press('Escape');
  await expect(card(page)).toBeHidden();
  await expect(marker).toBeHidden();
  await expect(page.locator('#weather-inspect-toggle')).toHaveAttribute(
    'aria-pressed',
    'false'
  );
  await expect(page.locator('body')).not.toHaveClass(/wi-armed/);
  // Désarmé, un clic sur la Terre ne choisit plus rien.
  await page.mouse.click(cx, cy);
  await expect(card(page)).toBeHidden();
});

test('a date change shows no value while the grid is out of date, then the new one', async ({
  page,
}) => {
  const mock = await boot(page);
  await openPanel(page);
  await layerOn(page, 'Air temperature (model)');
  await page.locator('#weather-inspect-toggle').click();
  await typePoint(page, 48.85, 2.35);
  const temperature = row(page, 'temperature');
  await expect(temperature.locator('.wi-value')).toContainText('3.6', {
    timeout: 30_000,
  });

  mock.hold();
  await page.locator('#date-input').evaluate((el) => {
    (el as HTMLInputElement).value = '2026-11-25';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  // Réponse en route : la grille chargée décrit une autre heure. Aucune valeur n'est montrée.
  await expect(temperature.locator('.wi-message')).toContainText(
    /Updating|Out of date/,
    { timeout: 15_000 }
  );
  await expect(temperature.locator('.wi-value')).toBeHidden();
  await shot(page, 'desktop-6-stale');

  mock.release();
  await expect(temperature.locator('.wi-value')).toContainText('3.6', {
    timeout: 30_000,
  });
  const meta = temperature.locator('.wi-meta');
  await meta.locator('summary').click();
  await expect(meta).toContainText('2026-11-25');
});

test('units and language follow the existing preferences', async ({ page }) => {
  await boot(page, {
    storage: { 'ssv-locale': 'fr', 'ssv-units': 'imperial' },
  });
  await page.locator('#weather-trigger').click();
  await layerOn(page, 'Vent (modèle)');
  await layerOn(page, 'Température (modèle)');
  await page.locator('#weather-inspect-toggle').click();
  await expect(card(page).locator('#weather-inspector-title')).toHaveText(
    'Météo en un point'
  );
  await typePoint(page, 48.85, 2.35);
  // 3,575 °C → 38,4 °F ; 20 km/h → 12,4 mph ; décimale française.
  await expect(row(page, 'temperature').locator('.wi-value')).toContainText(
    '38,4',
    { timeout: 30_000 }
  );
  await expect(row(page, 'temperature').locator('.wi-value')).toContainText(
    '°F'
  );
  await expect(row(page, 'wind').locator('.wi-value')).toContainText('12');
  await expect(row(page, 'wind').locator('.wi-value')).toContainText('mph');
  await expect(row(page, 'wind').locator('.wi-detail')).toContainText(
    'Provenance : O · 270°'
  );
  await expect(card(page).locator('.wi-caveat')).toContainText('interpolées');
  await shot(page, 'desktop-7-fr-imperial');
});

test('choosing another body closes the inspector', async ({ page }) => {
  await boot(page);
  await openPanel(page);
  await page.locator('#weather-inspect-toggle').click();
  await expect(card(page)).toBeVisible();
  await page
    .locator('#orbit-mars')
    .evaluate((el) => (el as HTMLElement).click());
  await expect(card(page)).toBeHidden({ timeout: 10_000 });
  await expect(page.locator('#weather-inspect-toggle')).toHaveAttribute(
    'aria-pressed',
    'false'
  );
});

test('opening and closing repeatedly leaves one card, one marker and no DOM churn at rest', async ({
  page,
}) => {
  const mock = await boot(page);
  await openPanel(page);
  await layerOn(page, 'Air temperature (model)');
  const toggle = page.locator('#weather-inspect-toggle');

  for (let cycle = 0; cycle < 3; cycle++) {
    await toggle.click();
    await expect(card(page)).toBeVisible();
    await page.locator('#weather-inspector-lat').focus();
    await page.keyboard.press('Escape');
    await expect(card(page)).toBeHidden();
  }
  // Mode désarmé (carte fermée) : un clic sur le globe ne lit rien et n'ouvre pas la carte.
  const globe = (await page.locator('canvas').first().boundingBox())!;
  // Hors du point de l'étiquette Explo, qui prendrait le clic au centre du disque.
  await page.mouse.click(
    globe.x + globe.width / 2 + 35,
    globe.y + globe.height / 2 - 25
  );
  await page.waitForTimeout(800);
  await expect(card(page)).toBeHidden();
  await expect(page.locator('#weather-inspector-lat')).toHaveValue('');
  await expect(page.locator('.wi-marker')).toBeHidden();
  if (!(await page.locator('#weather-layers').isVisible()))
    await openPanel(page);
  await toggle.click();
  await expect(card(page)).toBeVisible();
  await typePoint(page, 48.85, 2.35);
  await expect(row(page, 'temperature').locator('.wi-value')).toContainText(
    '3.6',
    { timeout: 30_000 }
  );
  await expect(page.locator('#weather-inspector')).toHaveCount(1);
  await expect(page.locator('.wi-marker')).toHaveCount(1);
  await expect(card(page).locator('.wi-row')).toHaveCount(1);

  // Au repos (point choisi, rien ne change) : aucune mutation du DOM de la carte, aucune requête.
  await page.waitForTimeout(1500);
  const requests = mock.requests();
  const mutations = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let count = 0;
        const observer = new MutationObserver((records) => {
          count += records.length;
        });
        observer.observe(document.getElementById('weather-inspector')!, {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true,
        });
        setTimeout(() => {
          observer.disconnect();
          resolve(count);
        }, 2500);
      })
  );
  expect(mutations).toBe(0);
  expect(mock.requests()).toBe(requests);
});

/**
 * Le morceau de l'inspecteur est servi sous la main du test : `hold` retient sa réponse jusqu'à
 * `release()`, `refuse` la fait échouer une fois. La résolution devient déterministe, sans attente
 * chronométrée.
 */
async function controlChunk(page: Page) {
  const asked: string[] = [];
  let gate: Promise<void> | null = null;
  let open: (() => void) | null = null;
  let refusals = 0;
  await page.route(/weatherInspector/, async (route) => {
    asked.push(route.request().url());
    if (gate) await gate;
    if (refusals > 0) {
      refusals--;
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
  return {
    asked: () => asked.length,
    hold() {
      gate = new Promise<void>((resolve) => (open = resolve));
    },
    release() {
      open?.();
      gate = null;
    },
    refuse(count = 1) {
      refusals = count;
    },
  };
}

test('the inspector chunk is not requested before activation, and repeated clicks before it resolves end on the last intent', async ({
  page,
}) => {
  const chunk = await controlChunk(page);
  await boot(page);
  await openPanel(page);
  await layerOn(page, 'Air temperature (model)');
  expect(chunk.asked()).toBe(0);

  // Deux clics pendant que la réponse du module est retenue : l'intention finale est « éteint ».
  chunk.hold();
  const toggle = page.locator('#weather-inspect-toggle');
  await toggle.dblclick();
  await expect.poll(() => chunk.asked()).toBeGreaterThan(0);
  chunk.release();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(500);
  await expect(card(page)).toBeHidden();

  // Un clic seul, le module déjà chargé : allumé, et le morceau n'est pas redemandé.
  const before = chunk.asked();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page)).toBeVisible();
  expect(chunk.asked()).toBe(before);
});

test('a refused module is announced without an unhandled rejection, then a click retries', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const chunk = await controlChunk(page);
  await boot(page);
  await openPanel(page);
  await layerOn(page, 'Air temperature (model)');
  const toggle = page.locator('#weather-inspect-toggle');

  chunk.refuse(1);
  await toggle.click();
  await expect.poll(() => chunk.asked()).toBeGreaterThan(0);
  // Le mécanisme commun dit l'échec (région d'annonce unique), l'intention retombe.
  await expect(page.locator('body > p[role="status"]')).toContainText(
    /could not be loaded/,
    { timeout: 10_000 }
  );
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(card(page)).toBeHidden();
  expect(errors).toEqual([]);

  // Le clic suivant réessaie : le module est servi cette fois.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page)).toBeVisible();
  expect(errors).toEqual([]);
});

test('a module that resolves after the body changed does not arm the inspector elsewhere', async ({
  page,
}) => {
  const chunk = await controlChunk(page);
  await boot(page);
  await openPanel(page);
  await layerOn(page, 'Air temperature (model)');
  const toggle = page.locator('#weather-inspect-toggle');

  chunk.hold();
  await toggle.click();
  await expect.poll(() => chunk.asked()).toBeGreaterThan(0);
  await page
    .locator('#orbit-mars')
    .evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator('#orbit-mars')).toHaveClass(/is-active/);
  // La carte n'a pas le droit de s'ouvrir, même un instant : on observe son attribut `hidden`.
  await page.evaluate(() => {
    (window as unknown as { __wiOpened: boolean }).__wiOpened = false;
    new MutationObserver(() => {
      const c = document.getElementById('weather-inspector');
      if (c && !c.hidden)
        (window as unknown as { __wiOpened: boolean }).__wiOpened = true;
    }).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['hidden'],
    });
  });
  chunk.release();
  await page.waitForTimeout(1500);
  expect(
    await page.evaluate(
      () => (window as unknown as { __wiOpened: boolean }).__wiOpened
    )
  ).toBe(false);
  await expect(card(page)).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
});
