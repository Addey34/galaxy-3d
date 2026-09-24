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
 * Les scénarios sont désormais déterministes et ne masquent plus un échec local par une reprise.
 */
export default defineConfig({
  testDir: './e2e',
  // Un seul worker : toute la suite partage un serveur Vite unique (une seule app WebGL) ;
  // le parallélisme provoquait des timeouts de chargement sous contention.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // Reprises en CI pour absorber l'aléa des machines partagées + décodage texture qui stalle
  // le thread (les scénarios lourds comme titan enchaînent 8 corps × 2 modes). 2 reprises =
  // 3 tentatives : un vrai bug échoue aux 3, un à-coup GPU/GC est absorbé.
  retries: process.env.CI ? 2 : 0,
  // Budget par test : boot (~15-30 s) + interactions + vols caméra (1,2 s chacun). En CI, le
  // runner rend en GPU LOGICIEL (SwiftShader, pas de vrai GPU) : le decodage des textures haute
  // resolution (dont la normal map 8k) est bien plus lent → on double le budget en CI pour les
  // scenarios lourds (titan, solarDebug), sans masquer un vrai bug (qui echoue quand meme aux 3
  // tentatives).
  //
  // Depuis le lot 17C, un boot coûte plus cher SUR LE SERVEUR DE DEV, et la raison est mesurée :
  // les éphémérides sont lues par PLAGES, une réponse 206 n'est jamais servie par le cache du
  // navigateur, et le serveur de dev parle HTTP/1.1 (six connexions par hôte). Les 62 plages
  // occupent donc les connexions et retardent les ressources du document, celles qu'attend
  // l'événement `load` : mesuré, `load` tombe exactement quand la dernière plage arrive
  // (17,0 s à froid, 4,7 s à chaud, contre 3,4 s avec les fichiers entiers servis par le cache).
  // C'est un artefact du serveur de DEV : en production l'hôte parle HTTP/2 et l'A/B ne montre
  // aucun écart (12,5 s contre 12,8 s, lien non bridé). Le budget local rejoint donc celui de
  // la CI au lieu de faire échouer la porte sur une machine chargée.
  timeout: 120_000,
  expect: {
    // Assertions jouées pendant/juste après le boot (thread encore sous à-coups de décodage).
    timeout: process.env.CI ? 30_000 : 15_000,
  },
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5273',
    trace: 'on-first-retry',
    // Un clic peut tomber pendant une pause de décodage de texture : on laisse de la marge
    // à l'actionnabilité au lieu de subir le défaut de 30 s pile sur un à-coup.
    actionTimeout: 15_000,
    // 60 s et non 45 : cf. la note du budget par test ci-dessus, un boot de dev paie désormais
    // ses 62 plages à chaque fois. Une navigation VRAIMENT cassée échoue quand même, elle
    // n'aboutit jamais.
    navigationTimeout: 60_000,
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
