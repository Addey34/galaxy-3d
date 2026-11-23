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
 * joués par le job `verify`, **qui construit déjà** (au lot 41 : 11 scénarios, 2,4 min du job ; mesuré le
 * 2026-11-23 : 151 scénarios, 6 à 7,5 min, jusqu'à 10,6 sur un runner lent, d'où l'enveloppe de 25 min).
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
  /**
   * DEUX WORKERS (GAL-CI-STABILITY-001E). `fullyParallel: false` garde chaque fichier joué en série
   * par un seul worker, et chaque test garde son contexte de navigateur (aucun stockage ni service
   * worker partagé) : seuls des FICHIERS différents se recouvrent. Les six fichiers ne partagent
   * que le serveur `vite preview`, en lecture seule ; aucun n'écrit sur le disque.
   *
   * Mesuré en local (134 tests, sans reprise, build de `main`) : à 4 cœurs, 1 worker 197 à 203 s
   * contre 2 workers 131 s, deux fois (-35 %) ; à 2 cœurs 199 s contre 153 s ; mémoire maximale 4,2
   * Go contre 3,2. Les durées par test montent de 24 % (jusqu'à 60 % pour `built-pages`) : un test
   * à seuil serré pourrait s'en ressentir sur un runner lent. Trois workers ne gagnent que 5 % de
   * plus pour 5,6 Go : non retenus.
   */
  workers: 2,
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
  /**
   * Ces scénarios servent le BUILD, donc la balise d'audience de la production : sans ce blocage,
   * chaque passage de la suite (en CI à chaque poussée) compterait des centaines de visites de
   * `localhost` sous le jeton du site réel. Le nom est rendu introuvable ; un scénario le vérifie.
   */
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--host-resolver-rules=MAP static.cloudflareinsights.com ~NOTFOUND'],
        },
      },
    },
  ],
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
