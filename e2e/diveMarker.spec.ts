import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { diveByTapping } from './placeDiveFlow';
import { blockExternalNetwork } from './netBlock';

/**
 * LE REPÈRE D'UNE PLONGÉE (GAL-IMMERSION-002) : une plongée sur un lieu nommé pose un repère sur
 * le lieu VISÉ (anneau et nom), qui suit la pose du corps, et disparaît au premier geste, sans
 * rien laisser dans le DOM. Réutilise `ui/formationMarker` (couche d'instrument, pas un mesh).
 */
test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

test('la plongée pose le repère du lieu visé, un geste de la molette le retire', async ({
  page,
}) => {
  const name = await diveByTapping(page, (x, y) => page.mouse.click(x, y));
  const marker = page.locator('#formation-marker');
  await expect(marker).toHaveCount(1, { timeout: 15_000 });
  await expect(marker.locator('.formation-marker-name')).toContainText(name);
  // Une plongée est déjà près du lieu : pas de phrase « approchez-vous ».
  await expect(marker.locator('.formation-marker-hint')).toHaveCount(0);
  // Un repère visuel, masqué aux technologies d'assistance (la plongée a sa propre annonce) :
  // axe n'y trouve rien.
  const axe = await new AxeBuilder({ page })
    .include('#formation-marker')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(axe.violations).toEqual([]);
  // Un seul repère, même quand la plongée est rejouée à mesure que les carreaux arrivent.
  await page.waitForTimeout(2_500);
  await expect(page.locator('#formation-marker')).toHaveCount(1);

  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('canvas absent');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 300);
  await expect(page.locator('#formation-marker')).toHaveCount(0);
  // Rien ne le ramène : la plongée rejouée est arrêtée par le même geste.
  await page.waitForTimeout(2_000);
  await expect(page.locator('#formation-marker')).toHaveCount(0);
});

test('le retour à la vue globale retire le repère de la plongée', async ({
  page,
}) => {
  await diveByTapping(page, (x, y) => page.mouse.click(x, y));
  await expect(page.locator('#formation-marker')).toHaveCount(1, {
    timeout: 15_000,
  });
  await page.locator('#orbit-overview').click();
  await expect(page.locator('#formation-marker')).toHaveCount(0);
});

/**
 * LES CHEMINS ASYNCHRONES DU REPÈRE (GAL-IMMERSION-002-FINAL). Le repère se charge à la demande :
 * une intention abandonnée avant la fin du chargement ne doit rien poser, et un chargement refusé
 * ne doit ni casser la plongée ni condamner les suivantes. En dev le morceau est le module
 * `formationMarker.ts` lui-même, d'où ce motif de route.
 */
const MARKER_MODULE = /formationMarker\.ts/;

test('un geste pendant le chargement du repère : aucun repère tardif', async ({
  page,
}) => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let held = 0;
  await page.route(MARKER_MODULE, async (route) => {
    held += 1;
    await gate;
    await route.continue();
  });
  await diveByTapping(page, (x, y) => page.mouse.click(x, y));
  await expect.poll(() => held, { timeout: 15_000 }).toBeGreaterThan(0);
  // L'utilisateur reprend la main avant l'arrivée du morceau.
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('canvas absent');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 300);
  release();
  await page.waitForTimeout(3_000);
  await expect(page.locator('#formation-marker')).toHaveCount(0);
});

test('un chargement refusé ne casse pas la plongée et la suivante réessaie', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  let blocked = true;
  await page.route(MARKER_MODULE, (route) =>
    blocked ? route.abort('failed') : route.continue()
  );
  const name = await diveByTapping(page, (x, y) => page.mouse.click(x, y));
  await expect(page.locator('canvas').first()).toHaveAttribute(
    'data-place-dive',
    new RegExp(`^${name}[|]`)
  );
  await page.waitForTimeout(1_500);
  await expect(page.locator('#formation-marker')).toHaveCount(0);
  expect(errors).toEqual([]);
  // Le réseau revient : une nouvelle plongée sur un nom visible pose le repère.
  blocked = false;
  await expect
    .poll(
      async () =>
        (await page
          .locator('#gazetteer-overlay')
          .getAttribute('data-places')) ?? '',
      { timeout: 30_000 }
    )
    .not.toBe('');
  const first = (
    (await page.locator('#gazetteer-overlay').getAttribute('data-places')) ?? ''
  ).split('|')[0]!;
  const match = /^(.*)@(-?\d+),(-?\d+)$/.exec(first);
  if (!match) throw new Error(`nom illisible : ${first}`);
  await page.mouse.click(Number(match[2]), Number(match[3]));
  await expect(page.locator('#formation-marker')).toHaveCount(1, {
    timeout: 20_000,
  });
  expect(errors).toEqual([]);
});
