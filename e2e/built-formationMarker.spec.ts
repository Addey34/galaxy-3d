import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

/**
 * LE REPÈRE D'UNE FORMATION SOUS LA CSP DE PRODUCTION (GAL-PRODUCT-014, REV1).
 *
 * Le serveur de développement ne pose aucune CSP : un `<style>` injecté y marche, et la
 * production le refuse (`style-src 'self'`, sans `unsafe-inline`). Ce test joue le BUILD sous
 * `vite preview`, dont chaque document reçoit la politique que `scripts/prepare-pages.mjs` copie
 * de `firebase.json` (même source, jamais recopiée ici), puis lit la présentation CALCULÉE de
 * l'anneau et de la légende : un élément présent mais non stylé échouerait.
 * `securitypolicyviolation` doit rester muet pour les styles.
 */
const firebase = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../firebase.json'), 'utf8')
) as {
  hosting: {
    headers: { source: string; headers: { key: string; value: string }[] }[];
  };
};
const CSP = firebase.hosting.headers
  .find((block) => block.source === '**')
  ?.headers.find((h) => h.key === 'Content-Security-Policy')?.value;

test('the marker is styled under the production CSP', async ({ page }) => {
  expect(CSP, 'la CSP de firebase.json').toContain("style-src 'self'");
  await blockExternalNetwork(page);
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'content-security-policy': CSP! },
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      w.__csp.push(`${e.effectiveDirective} ${e.blockedURI}`)
    );
  });
  await page.goto('/?date=2026-01-15T12:00:00Z');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  await page.waitForTimeout(2000);
  await page.locator('#body-search-trigger').click();
  await page.locator('#palette-input').pressSequentially('Tycho');
  await page
    .locator('.palette-hit[data-kind="place"]', { hasText: 'Tycho' })
    .first()
    .click();
  const marker = page.locator('#formation-marker');
  await expect(marker).toBeVisible({ timeout: 60_000 });

  const look = await page.evaluate(() => {
    const css = (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement;
      const c = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        position: c.position,
        pointerEvents: c.pointerEvents,
        zIndex: c.zIndex,
        width: r.width,
        height: r.height,
        radius: c.borderTopLeftRadius,
        borderWidth: c.borderTopWidth,
        borderStyle: c.borderTopStyle,
        color: c.color,
        textAlign: c.textAlign,
        transform: c.transform,
      };
    };
    return {
      host: css('#formation-marker'),
      pin: css('.formation-marker-pin'),
      ring: css('.formation-marker-ring'),
      caption: css('.formation-marker-caption'),
      violations: (window as unknown as { __csp: string[] }).__csp,
    };
  });
  expect(look.host).toMatchObject({
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '3',
  });
  expect(look.ring).toMatchObject({
    position: 'absolute',
    width: 28,
    height: 28,
    borderWidth: '2px',
    borderStyle: 'solid',
  });
  expect(look.ring.radius).not.toBe('0px');
  expect(look.caption).toMatchObject({
    position: 'absolute',
    textAlign: 'center',
    color: 'rgb(255, 255, 255)',
  });
  // Le positionnement dynamique (écriture CSSOM, permise par la CSP) fonctionne : l'ancre bouge.
  expect(look.pin.transform).not.toBe('none');
  expect(
    look.violations.filter((v) => v.startsWith('style-src')),
    'aucune violation de style'
  ).toEqual([]);
});
