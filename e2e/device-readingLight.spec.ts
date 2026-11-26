import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { openSettingsTab } from './settingsTab';

/**
 * L'ÉCLAIRAGE DE LECTURE SUR TÉLÉPHONE ÉMULÉ (GAL-IMMERSION-003A) : Pixel 7 (Chromium) et iPhone 15
 * (WebKit). Mars de nuit (Soleil sous l'horizon d'Olympus Mons) : la scène est noire ; allumée,
 * l'assistance l'éclaire et un indicateur dit que la lumière n'est pas naturelle ; éteinte, la
 * luminance revient. Sur la Terre, qui ne porte pas le plancher, l'indicateur le dit au lieu de
 * prétendre agir. Ne prouve PAS le toucher réel, la chaleur ni la mémoire d'un téléphone physique.
 */
const OUT = 'reports/mobile/reading-light';

async function sceneMean(page: Page, label: string): Promise<number> {
  const device = test.info().project.name;
  mkdirSync(`${OUT}/${device}`, { recursive: true });
  const hide = await page.addStyleTag({
    content:
      // Le repère de lieu (« Olympus Mons · Mars ») est une légende HTML provisoire posée au centre de la
      // zone mesurée : présente à la première prise et effacée à la dernière, elle faisait dire 5,5
      // niveaux d'écart à une scène identique (iPhone 15, GAL-MOBILE-EXCELLENCE-001). On mesure la SCÈNE.
      '.surface, .dock, #reading-light-badge, #formation-marker { visibility: hidden !important; }',
  });
  const png = await page.screenshot({ path: `${OUT}/${device}/${label}.png` });
  await hide.evaluate((el) => (el as Element).remove());
  // Le disque du corps, au centre : la moyenne de l'écran entier noie un globe de 400 px.
  const meta = await sharp(png).metadata();
  const size = Math.round(Math.min(meta.width!, meta.height!) * 0.5);
  const { data } = await sharp(png)
    .extract({
      left: Math.round((meta.width! - size) / 2),
      top: Math.round((meta.height! - size) / 2),
      width: size,
      height: size,
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  for (let i = 0; i < data.length; i += 3)
    sum += 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
  return sum / (data.length / 3);
}

async function boot(page: Page, query: string): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
  await page.goto(query);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  await page.waitForTimeout(4_000);
}

async function setReadingLight(page: Page, on: boolean): Promise<void> {
  await page.locator('#settings-trigger').dispatchEvent('click');
  await openSettingsTab(page, 'image');
  const toggle = page.locator('#reading-light-toggle');
  if (on) await toggle.check();
  else await toggle.uncheck();
  // Referme les réglages pour mesurer la scène seule.
  await page.locator('#settings-trigger').dispatchEvent('click');
  await page.waitForTimeout(2_000);
}

test('Mars de nuit : l’assistance éclaire, signale, et le retour est exact', async ({
  page,
}) => {
  await boot(
    page,
    '/?body=mars&date=2026-11-20T00:00:00Z&place=Olympus%20Mons'
  );
  const off = await sceneMean(page, 'mars-night-off');
  await setReadingLight(page, true);
  const badge = page.locator('#reading-light-badge');
  await expect(badge).toBeVisible();
  await expect(badge).toContainText('not natural lighting');
  const box = await badge.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
    )
  ).toBeLessThanOrEqual(0);
  const on = await sceneMean(page, 'mars-night-on');
  await setReadingLight(page, false);
  const back = await sceneMean(page, 'mars-night-back');
  expect(on).toBeGreaterThan(off + 4);
  expect(Math.abs(back - off)).toBeLessThan(1.5);
});

test('Terre : l’indicateur dit que l’assistance ne s’applique pas', async ({
  page,
}) => {
  await boot(page, '/?body=earth&date=2026-11-20T00:00:00Z');
  await setReadingLight(page, true);
  await expect(page.locator('#reading-light-badge')).toContainText(
    'does not apply to this body'
  );
});
