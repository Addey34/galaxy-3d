import { expect, test, type Page } from '@playwright/test';

/**
 * LES BÂTIMENTS SUR UN VRAI APPAREIL (`pnpm test:devices`, lot 63) : Paris visé par la recherche
 * comme le fait un visiteur, puis la descente à la molette jusqu'à la pose, la même que
 * `pnpm perf:measure` (scène `earth-buildings`). Ce que cela prouve : la scène tient sur la
 * ferme (images qui tournent, bâtiments posés, aucune erreur de page). Ce que cela NE prouve PAS
 * : un nombre d'images par seconde certifié (réseau et ferme partagés). Le résultat est écrit en
 * annotation pour être relu, pas seulement en vert ou rouge.
 */

const DATE = '2024-07-01T12:00:00Z';

/**
 * Un cran de molette vers l'avant. WebKit mobile ÉMULÉ refuse `mouse.wheel` (« Mouse wheel is not
 * supported in mobile WebKit ») alors que la ferme d'appareils réels l'accepte : on tombe alors sur
 * l'événement `wheel` que les contrôles de la caméra écoutent sur le canevas.
 */
async function wheelIn(page: Page): Promise<void> {
  try {
    await page.mouse.wheel(0, -3000);
  } catch {
    await page
      .locator('canvas')
      .first()
      .evaluate((canvas) => {
        const box = canvas.getBoundingClientRect();
        canvas.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY: -3000,
            clientX: box.left + box.width / 2,
            clientY: box.top + box.height / 2,
            bubbles: true,
            cancelable: true,
          })
        );
      });
  }
}

/**
 * Les deux échelles : Éduc (comprimée) et Explo (vraie, 2026-10-28). Le rendu au sol de l'Explo
 * n'avait jamais tourné sur un vrai GPU ; c'est le même parcours, seul `mode` change.
 */
for (const mode of ['educ', 'explo'] as const) {
  test(`Paris (${mode}) : la descente pose les bâtiments et la scène reste vivante`, async ({
    page,
  }) => {
    await descendToParis(page, mode);
  });
}

async function descendToParis(
  page: Page,
  mode: 'educ' | 'explo'
): Promise<void> {
  test.setTimeout(480_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    try {
      localStorage.setItem('ssv-guided-tour-v1', '1');
      localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    } catch {
      /* stockage refusé : le scénario tourne sans */
    }
  });
  await page.goto(
    `/?debug-surface&mode=${mode}&body=earth&date=${encodeURIComponent(DATE)}`
  );
  await expect(page.locator('#loader')).toBeHidden({ timeout: 120_000 });

  // Simulation EN PAUSE : horloge qui tourne, la Terre glisse de 7 à 9 km sous la caméra pendant
  // le vol et la descente, hors de l'emprise de Paris (4 km sur 2 km). Un clic DOM, le panneau
  // du temps pouvant être replié sur un téléphone.
  await page.locator('#play-pause-btn').evaluate((b: HTMLElement) => {
    if (b.getAttribute('aria-pressed') !== 'true') b.click();
  });
  await expect(page.locator('#play-pause-btn')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await page.locator('#body-search-trigger').click();
  await page.locator('#palette-input').fill('Paris');
  await page
    .locator('#palette-hit-0')
    .filter({ hasText: 'Paris' })
    .waitFor({ timeout: 30_000 });
  await page.locator('#palette-hit-0').click();
  await page.waitForTimeout(8_000);

  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('canvas sans boîte');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const state = async () => ({
    buildings: await page
      .locator('canvas')
      .first()
      .evaluate((c) => c.dataset['buildings'] ?? ''),
    altitude: await page
      .locator('#surface-probe')
      .innerText({ timeout: 2_000 })
      .then(
        (t) =>
          /altitude ([-0-9.]+) km/.exec(t.split(/\s+/).join(' '))?.[1] ?? '?'
      )
      .catch(() => 'sonde absente'),
  });
  const log: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    await wheelIn(page);
    await page.waitForTimeout(3_000);
    const s = await state();
    log.push(
      `${i + 1}: altitude ${s.altitude} km, bâtiments « ${s.buildings} »`
    );
    if (/:\d+:[1-9]\d*$/.test(s.buildings)) break;
  }
  await page.waitForTimeout(6_000);
  const frames = await page.evaluate(
    () =>
      new Promise<number>((done) => {
        let n = 0;
        const t0 = performance.now();
        const tick = () => {
          n += 1;
          if (performance.now() - t0 < 1000) requestAnimationFrame(tick);
          else done(n);
        };
        requestAnimationFrame(tick);
      })
  );
  const final = await state();
  const report = [
    `appareil ${test.info().project.name}, mode ${mode}`,
    ...log,
    `final : altitude ${final.altitude} km, bâtiments « ${final.buildings} », ${frames} images en 1 s`,
  ].join('\n');
  console.log(report);
  test
    .info()
    .annotations.push({ type: 'device-buildings', description: report });
  await test.info().attach('device-buildings.txt', {
    body: report,
    contentType: 'text/plain',
  });

  expect(errors, 'aucune erreur de page').toEqual([]);
  expect(frames, 'la scène dessine (plancher de panne)').toBeGreaterThanOrEqual(
    3
  );
  expect(final.buildings, 'des bâtiments sont posés').toMatch(/:\d+:[1-9]\d*$/);
}
