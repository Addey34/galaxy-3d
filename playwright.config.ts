import { defineConfig, devices } from '@playwright/test';

/**
 * Config Playwright — tests navigateur de fumée (`e2e/`).
 *
 * Séparés des tests unitaires Vitest (`src/**\/*.test.ts`) : Vitest ne balaie que
 * `src/`, Playwright que `e2e/`. Le serveur de dev Vite est lancé automatiquement et
 * réutilisé s'il tourne déjà.
 */
export default defineConfig({
  testDir: './e2e',
  // Un seul worker : toute la suite partage un serveur Vite unique (une seule app WebGL) ;
  // le parallélisme provoquait des timeouts de chargement sous contention.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5273',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Port dédié aux tests (5273) + strictPort : évite toute collision avec un autre
  // serveur de dev sur 5173 (que `reuseExistingServer` réutiliserait à tort).
  webServer: {
    command: 'pnpm exec vite --port 5273 --strictPort',
    url: 'http://localhost:5273',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
