import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

const record = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../src/seo/flybyEvents.json'),
    'utf-8'
  )
) as { events: { probe: string; body: string; closestAt: string }[] };

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

/**
 * LE LIEN D'UNE PAGE DE SURVOL OUVRE CE QU'ELLE ANNONCE (2026-10-12) : la sonde, à l'instant du
 * point le plus proche, en Explo. La forme du lien est tenue par `src/seo/flybyPages.test.ts` ;
 * ici, l'application qui le reçoit. Voyager 2 à Neptune, le survol le plus ancien que la scène
 * place par un segment fin.
 */
test('a flyby page opens the probe at its closest approach, at true scale', async ({
  page,
}) => {
  const event = record.events.find(
    (e) => e.probe === 'voyager2' && e.body === 'neptune'
  )!;
  const [day, time] = event.closestAt.replace('Z', '').split('T');

  await page.goto(`/${event.probe}/?mode=explo&date=${event.closestAt}`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  await expect(page.locator('body')).toHaveClass(/is-explo-mode/);
  await expect(page.locator('#body-info .bi-name')).toHaveText('Voyager 2');
  await expect(page.locator('#spacecraft-overlay')).toHaveAttribute(
    'data-markers',
    '1'
  );
  await expect(page.locator('#date-input')).toHaveValue(day!);
  // La scène s'ouvre À l'instant puis l'horloge avance en temps réel, comme pour tout permalien
  // daté : l'heure lue est donc à moins d'une minute après celle publiée, jamais avant.
  const seconds = (hms: string) =>
    hms.split(':').reduce((total, part) => total * 60 + Number(part), 0);
  const shown = await page.locator('#time-input').inputValue();
  const lag = seconds(shown) - seconds(time!);
  expect(
    lag,
    `heure affichée ${shown}, publiée ${time}`
  ).toBeGreaterThanOrEqual(0);
  expect(lag).toBeLessThan(60);
});
