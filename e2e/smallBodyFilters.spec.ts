import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';
import { waitForCalmMainThread } from './mainThread';

// Déterminisme : réseau externe coupé. Depuis le lot 8b cela ne vide plus l'overlay, qui lit un
// instantané livré avec l'application ; ces scénarios testent de toute façon la section, pas le
// rendu des marqueurs (`e2e/smallBodyDataset.spec.ts` s'en charge). Tour d'accueil neutralisé
// (son backdrop intercepterait les clics sur les boutons de mode).
test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
});

/**
 * Le champ d'astéroïdes et de comètes se règle dans la surface Réglages d'affichage, dans les
 * DEUX modes. Il avait son propre bouton, qui n'apparaissait qu'en Exploration : la rangée de
 * boutons du haut changeait donc d'un mode à l'autre, et le réglage n'était pas là où vivent
 * tous les autres.
 */
test('the asteroid and comet field is a section of display settings, in both modes', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  // Plus de bouton dédié, dans aucun mode.
  await expect(page.locator('#smallbody-filters-trigger')).toHaveCount(0);

  const section = page.locator('#orbit-options #smallbody-filters');
  await page.locator('#settings-trigger').click();
  await expect(section).toBeVisible();
  const rows = section.locator('.oo-row');
  await expect(rows).toHaveCount(4);
  // Les mêmes lignes que le tableau des corps : pastille, nom, case.
  await expect(rows.first().locator('.oo-dot')).toHaveCount(1);

  // Décocher une catégorie ("Comets") ne doit rien casser et laisser le panneau ouvert.
  const cometRow = section.locator('.oo-row', { hasText: 'Comets' });
  await cometRow.locator('.oo-checkbox').uncheck();
  await expect(section).toBeVisible();

  await page.keyboard.press('Escape');
  await page.locator('.mode-btn[data-mode=explo]').click();
  await page.locator('#settings-trigger').click();
  await expect(section).toBeVisible();
  await expect(cometRow.locator('.oo-checkbox')).not.toBeChecked();

  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
});

/**
 * UN MARQUEUR DERRIÈRE UNE PLANÈTE NE SE PEINT PAS SUR SON SOL (ligne 45.8, 2026-10-09).
 *
 * Mesuré avant correction, à 1 000 km au-dessus de Mars qui remplit l'écran : 1 064 pixels de
 * marqueurs d'astéroïdes peints sur la surface, pris d'abord pour des étoiles. La couche publie
 * ce qu'elle peint et ce qu'un corps a masqué : ici, rien ne doit être peint, et quelque chose
 * doit avoir été masqué (sinon le scénario ne prouverait rien).
 */
test('asteroid markers behind a near planet are hidden, not painted on its ground', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto('/?body=mars&mode=explo&date=2026-04-10T00:00:00Z');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  await waitForCalmMainThread(page);
  const canvas = page.locator('canvas').first();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -12_000);

  const overlay = page.locator('#smallbody-overlay');
  await expect
    .poll(async () => Number(await overlay.getAttribute('data-occluded')), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  // DEPUIS LE LOT 48 (pas 5) la caméra Explo regarde l'horizon près du sol : le ciel occupe le
  // haut de l'image, et des astéroïdes y sont légitimement dessinés. Ce qui ne doit JAMAIS
  // arriver reste le défaut d'origine, un marqueur peint sur le SOL. Mesuré en bandes de 10 % :
  // ciel en 0 à 20 %, horizon dans la troisième, sol de 30 % au bas (86 à 100 % allumé), et les
  // marqueurs seulement dans le ciel. On lit donc les deux couches sous 40 %.
  const below = await page.evaluate(() => {
    const read = (
      selector: string,
      painted: (d: Uint8ClampedArray, i: number) => boolean
    ) => {
      const source = document.querySelector(
        selector
      ) as HTMLCanvasElement | null;
      if (!source) return -1;
      const flat = document.createElement('canvas');
      flat.width = 160;
      flat.height = 100;
      const context = flat.getContext('2d')!;
      context.drawImage(source, 0, 0, 160, 100);
      const { data } = context.getImageData(0, 40, 160, 60);
      let n = 0;
      for (let i = 0; i < data.length; i += 4) if (painted(data, i)) n += 1;
      return n / (160 * 60);
    };
    return {
      ground: read(
        'canvas[data-engine]',
        (d, i) => d[i]! + d[i + 1]! + d[i + 2]! > 30
      ),
      markers: read('#smallbody-overlay', (d, i) => d[i + 3]! > 0),
    };
  });
  // Le témoin : sous 40 % c'est bien Mars (sinon l'absence de marqueurs ne prouverait rien).
  expect(below.ground, 'le sol de Mars sous l’horizon').toBeGreaterThan(0.95);
  expect(below.markers, 'des marqueurs peints sur le sol').toBe(0);
});
