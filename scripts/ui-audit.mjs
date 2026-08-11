// One-off UI audit / screenshot harness for the redesigned overlay.
// Usage: node scripts/ui-audit.mjs [outDir]
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, process.argv[2] ?? '.ui-shots-after');
mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:5273/';

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 834, height: 1112 },
  'mobile-portrait': { width: 390, height: 844 },
  'mobile-landscape': { width: 844, height: 390 },
  'low-height': { width: 1280, height: 380 },
};

async function bootPage(context, viewport) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.addInitScript(() => {
    try {
      localStorage.setItem('ssv-guided-tour-v1', '1');
    } catch {}
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await page
    .waitForFunction(
      () => {
        const l = document.getElementById('loader');
        return (
          !l ||
          l.hidden ||
          getComputedStyle(l).opacity === '0' ||
          getComputedStyle(l).display === 'none'
        );
      },
      { timeout: 60000 }
    )
    .catch(() => {});
  await page.waitForTimeout(1500);
  return page;
}

async function shot(page, label) {
  await page.screenshot({ path: resolve(OUT, `${label}.png`) });
  console.log('  shot:', label);
}

const browser = await chromium.launch();
try {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    console.log('viewport:', name);
    const context = await browser.newContext({ deviceScaleFactor: 1 });
    const page = await bootPage(context, viewport);

    await shot(page, `${name}__01-default`);

    // Time bar expanded.
    await page.click('#time-readout').catch(() => {});
    await page.waitForTimeout(500);
    await shot(page, `${name}__02-time-expanded`);
    await page.click('#time-readout').catch(() => {});
    await page.waitForTimeout(400);

    // Body palette open.
    await page.click('#body-search-trigger').catch(() => {});
    await page.waitForTimeout(500);
    await shot(page, `${name}__03-palette`);
    // Type a query.
    await page.fill('#palette-input', 'ma').catch(() => {});
    await page.waitForTimeout(300);
    await shot(page, `${name}__04-palette-search`);

    // Select Mars from palette.
    await page.click('#orbit-mars').catch(() => {});
    await page.waitForTimeout(1200);
    await shot(page, `${name}__05-body-info`);

    // Settings.
    await page.click('#settings-trigger').catch(() => {});
    await page.waitForTimeout(500);
    await shot(page, `${name}__06-settings`);

    // Events.
    await page.click('#events-trigger').catch(() => {});
    await page.waitForTimeout(500);
    await shot(page, `${name}__07-events`);

    // Help.
    await page.click('#help-btn').catch(() => {});
    await page.waitForTimeout(400);
    await shot(page, `${name}__08-help`);
    await page.click('.surface--help .surface-close').catch(() => {});

    // Explo mode + settings (FOV visible).
    await page.click('.mode-btn[data-mode="explo"]').catch(() => {});
    await page.waitForTimeout(1500);
    await shot(page, `${name}__09-explo`);
    await page.click('#settings-trigger').catch(() => {});
    await page.waitForTimeout(400);
    await shot(page, `${name}__10-explo-settings-fov`);

    await context.close();
  }
} finally {
  await browser.close();
}
console.log('done ->', OUT);
