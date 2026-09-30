import { defineConfig, devices } from '@playwright/test';

/**
 * LES PAGES GÉNÉRÉES, DANS UN VRAI NAVIGATEUR (ligne 39.1, lot 41).
 *
 * `/methodology`, `/sources` et les pages de corps ne naissent qu'au BUILD. Le serveur de
 * développement que lance `playwright.config.ts` ne les sert donc pas : `e2e/bodyLanding.spec.ts`
 * teste l'application ouverte sur un CHEMIN, jamais la page elle-même. Résultat, personne ne les
 * avait jamais chargées dans un navigateur en CI, et la section que le lot 39 leur a ajoutée a dû
 * être vérifiée à la main — une vérification qui ne se rejoue pas toute seule.
 *
 * DEUX CONFIGS PLUTÔT QU'UNE, et la raison est un COÛT mesuré. Une seconde entrée `webServer`
 * dans la config principale serait démarrée à CHAQUE lancement, y compris par les six shards du
 * job e2e, qui ne construisent pas : il faudrait donc six `pnpm build`. Ici, ces scénarios sont
 * joués par le job `verify`, **qui construit déjà** et n'utilise que 2,4 min de ses 15.
 *
 * Le partage se fait par MOTIF de nom : la config principale ignore `built-*.spec.ts`, celle-ci
 * ne prend que lui. Le fichier reste dans `e2e/`, donc dans le périmètre de `pnpm format` et
 * d'ESLint — un dossier à part en sortirait, et c'est exactement la dérive que ce dépôt a déjà
 * payée deux fois.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/built-*.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  timeout: 90_000,
  expect: { timeout: process.env.CI ? 20_000 : 10_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5275',
    trace: 'on-first-retry',
    reducedMotion: 'reduce',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  /**
   * Port dédié (5275), distinct de celui du serveur de dev (5273) : les deux suites doivent
   * pouvoir tourner l'une après l'autre sans qu'un `reuseExistingServer` attrape le mauvais.
   *
   * `vite preview` sert `dist/` et REPLIE tout chemin inconnu sur la coquille de l'application,
   * exactement comme la réécriture SPA de Firebase. C'est une bonne nouvelle pour la fidélité du
   * test, et c'est aussi pourquoi ces scénarios portent un TÉMOIN : sans lui, une page absente
   * serait servie en HTTP 200 et passerait pour présente.
   */
  webServer: {
    command: 'pnpm exec vite preview --port 5275 --strictPort',
    url: 'http://localhost:5275/methodology/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
