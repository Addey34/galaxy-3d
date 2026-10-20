import { defineConfig, devices } from '@playwright/test';

/**
 * LA MATRICE MOBILE, REJOUABLE (2026-10-20, étape 5 du plan directeur).
 *
 * Deux appareils émulés, un parcours : Android (Pixel 7, Chromium) et iPhone (WebKit). Les
 * scénarios vivent dans `e2e/device-*.spec.ts`, ignorés par la suite principale comme les
 * `built-*` le sont, et jouent les parcours qui comptent sur un téléphone : démarrage, absence de
 * débordement horizontal, luminance du canvas (un écran « tout noir » est un défaut mesurable), la
 * visite du Nil. Captures et traces vont dans `reports/mobile/`.
 *
 * VRAI GPU PAR DÉFAUT pour Chromium (`--use-angle=d3d11`) : le rendu logiciel de la CI n'a pas les
 * mêmes temps ni les mêmes pièges (le noir de la visite du Nil n'est apparu qu'à la mesure sur
 * GPU). `MOBILE_SOFTWARE=1` rend en logiciel (SwiftShader), pour une machine sans GPU. WebKit
 * choisit seul son moteur de rendu.
 *
 * HORS de `pnpm verify` et de la CI, comme `perf:measure` : c'est une mesure qui demande des
 * navigateurs et un GPU, pas une porte. Ce que cela NE prouve PAS : le toucher réel, la chaleur, la
 * mémoire GPU d'un téléphone physique.
 */
const software = process.env.MOBILE_SOFTWARE === '1';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/device-*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  reporter: 'list',
  outputDir: './reports/mobile/artifacts',
  use: {
    baseURL: 'http://localhost:5277',
    trace: 'retain-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 90_000,
    reducedMotion: 'reduce',
  },
  projects: [
    {
      name: 'android',
      use: {
        ...devices['Pixel 7'],
        launchOptions: {
          args: software
            ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
            : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
        },
      },
    },
    {
      name: 'iphone',
      use: { ...devices['iPhone 15'] },
    },
  ],
  // Port dédié (5277) : ni 5273 (suite principale) ni 5275 (pages générées).
  webServer: {
    command: 'pnpm exec vite --port 5277 --strictPort',
    url: 'http://localhost:5277',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
