import { defineConfig, devices } from '@playwright/test';

/**
 * Config Playwright — tests navigateur de fumée (`e2e/`).
 *
 * Séparés des tests unitaires Vitest (`src/**\/*.test.ts`) : Vitest ne balaie que
 * `src/`, Playwright que `e2e/`. Le serveur de dev Vite est lancé automatiquement et
 * réutilisé s'il tourne déjà.
 *
 * Ces tests valident le CÂBLAGE (boot, UI, navigation) — pas les pixels ni la vitesse.
 * Or chaque test fait un `page.goto('/')` qui reboote toute l'app WebGL (Three.js +
 * décodage de textures haute résolution sur le thread principal) : un boot dure ~15-30 s et
 * ses pics de décodage bloquent le thread par à-coups. Sous charge, l'actionnabilité d'un
 * clic peut alors dépasser le timeout par défaut de 30 s pendant une pause GC/décodage.
 * On calibre donc les timeouts sur ce coût réel (sans masquer une vraie régression : un
 * scénario cassé échoue à toutes les tentatives) et on absorbe l'aléa GPU intrinsèque avec :
 *   - un seul worker + pas de parallélisme → aucune contention GPU entre onglets ;
 *   - une reprise (retry) — standard pour une suite de fumée WebGL.
 */
export default defineConfig({
  testDir: './e2e',
  // Un seul worker : toute la suite partage un serveur Vite unique (une seule app WebGL) ;
  // le parallélisme provoquait des timeouts de chargement sous contention.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // Reprise 1× en local (aléa GPU/boot), 2× en CI (machines partagées plus chargées).
  retries: process.env.CI ? 2 : 1,
  // Budget par test : boot (~15-30 s) + interactions + vols caméra (1,2 s chacun).
  timeout: 60_000,
  expect: {
    // Assertions jouées pendant/juste après le boot (thread encore sous à-coups de décodage).
    timeout: 15_000,
  },
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5273',
    trace: 'on-first-retry',
    // Un clic peut tomber pendant une pause de décodage de texture : on laisse de la marge
    // à l'actionnabilité au lieu de subir le défaut de 30 s pile sur un à-coup.
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    // Transition Éduc↔Explo instantanée en test (le morph de positions/tailles respecte
    // prefers-reduced-motion) : rend les scénarios déterministes, sans attendre le « dolly zoom ».
    reducedMotion: 'reduce',
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
