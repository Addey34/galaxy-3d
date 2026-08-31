import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
});

test('solar debug exposes pole illumination diagnostics', async ({ page }) => {
  await page.goto('/?debug-solar');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });

  const panel = page.locator('#solar-debug');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('SOLAR DEBUG');
  await expect(panel).toContainText('north dot');
  await expect(panel).toContainText('south dot');
  await expect(panel).toContainText('subsolar');
  await expect(panel).toContainText('latitude');
});
test('solar debug keeps the correct hemisphere illuminated at both solstices', async ({
  page,
}) => {
  for (const scenario of [
    { date: '2026-06-21', latitude: 23.44, north: 'DAY', south: 'NIGHT' },
    { date: '2026-12-21', latitude: -23.43, north: 'NIGHT', south: 'DAY' },
  ]) {
    await page.goto(`/?debug-solar&date=${scenario.date}&body=earth`);
    await expect(page.locator('#solar-debug')).toBeVisible({ timeout: 30_000 });

    const panel = page.locator('#solar-debug');
    const text = await panel.textContent();
    expect(text).toContain(`north dot`);
    expect(text).toContain(`south dot`);
    expect(text).toContain(`(${scenario.north})`);
    expect(text).toContain(`(${scenario.south})`);

    const match = text?.match(/subsolar\s+(-?\d+\.\d+) deg latitude/);
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBeCloseTo(scenario.latitude, 0);
  }
});
