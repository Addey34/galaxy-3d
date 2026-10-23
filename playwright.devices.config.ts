import { defineConfig } from '@playwright/test';

/**
 * LES VRAIS APPAREILS (BrowserStack), à la demande : `pnpm test:devices`.
 *
 * Rejoue les parcours de `e2e/device-*.spec.ts` (ceux de `pnpm test:mobile`, émulés) sur de vrais
 * iPhone et Android. Les appareils, le projet et la région vivent dans `browserstack.yml` ; les
 * identifiants ne sont JAMAIS dans le dépôt : variables d'environnement BROWSERSTACK_USERNAME et
 * BROWSERSTACK_ACCESS_KEY.
 *
 * L'application visée est la PRODUCTION (`DEVICES_ORIGIN` pour viser autre chose) : aucun tunnel,
 * donc rien de local n'est envoyé à un tiers. Pour tester une branche, la servir publiquement ou
 * activer `browserstackLocal` dans `browserstack.yml`.
 *
 * HORS de `pnpm verify` et de la CI : les minutes de BrowserStack se comptent. Ce que cela prouve :
 * le rendu, les gestes et la mémoire d'un vrai appareil. Ce que cela NE prouve PAS : les images par
 * seconde au sens d'une mesure certifiée (réseau et farm partagés).
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/device-*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 45_000 },
  reporter: 'list',
  outputDir: './reports/devices/artifacts',
  use: {
    baseURL: process.env.DEVICES_ORIGIN ?? 'https://galaxy.adrianguichard.dev',
    trace: 'retain-on-failure',
    actionTimeout: 30_000,
    navigationTimeout: 120_000,
    // Les scénarios touchent (`tap`) : sans cela Playwright refuse le geste sur une vraie page.
    hasTouch: true,
  },
  // Un seul projet : le SDK le décline en un par appareil de `browserstack.yml`.
  projects: [{ name: 'real' }],
});
