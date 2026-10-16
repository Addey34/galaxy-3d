import { expect, test } from '@playwright/test';
import { waitForCalmMainThread } from './mainThread';
import { blockExternalNetwork } from './netBlock';

/**
 * EN ÉDUCATIF, APPROCHER LA TERRE NE LA FAIT PLUS DISPARAÎTRE (lot 53, 2026-10-16).
 *
 * Le plan proche de l'Éducatif était FIXE (0,1 unité, 637 km pour la Terre), alors que le
 * plancher d'approche descend à ~1,007 rayon : sous 637 km d'altitude la Terre était coupée par
 * le plan proche, en production. La sonde `?debug-surface` dit, à chaque image, si le near passe
 * devant le sol (« ok ») ou le coupe (« COUPE LE CORPS »), et c'est ce qu'on lit.
 */
const SCENE_DATE = '2026-06-21T12:00:00Z';

test('le plan proche reste devant le sol jusqu’au plancher d’approche', async ({
  page,
}) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
  await page.goto(`/?body=earth&date=${SCENE_DATE}&debug-surface`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  await waitForCalmMainThread(page);
  const probe = page.locator('#surface-probe');
  await expect(probe).toContainText('near vs sol');

  const altitudeKm = async (): Promise<number> => {
    const text = (await probe.textContent()) ?? '';
    return Number(/altitude\s+([\d.]+) km/.exec(text)?.[1] ?? NaN);
  };
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('canvas absent');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // On descend jusqu'au plancher, sous les 637 km du near fixe d'avant. Sans tuiles (le réseau
  // externe est bloqué), ce plancher est celui de la texture 8k : 469 km, mesuré le 2026-10-16.
  for (let i = 0; i < 12 && (await altitudeKm()) > 600; i += 1) {
    await page.mouse.wheel(0, -1200);
    await page.waitForTimeout(600);
  }
  expect(await altitudeKm()).toBeLessThan(600);
  await expect(probe).toContainText(/near vs sol\s+ok/);
});
