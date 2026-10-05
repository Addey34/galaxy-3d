import { expect, type Locator, type Page } from '@playwright/test';
import { LOD_UPDATE_INTERVAL } from '../src/core/modelLod';

/**
 * ATTENDRE QUE LE THREAD PRINCIPAL RÉPONDE, PAS QUE LE CHARGEUR DISPARAISSE (lot 24).
 *
 * `#loader` masqué ne veut PAS dire « l'application accepte un clic ». Mesuré le 2026-09-28,
 * frein CPU × 8 par le protocole DevTools (le même mécanisme que `e2e/perf-fps.spec.ts`), page
 * `?debug-meteo&body=earth` : juste après que le chargeur se masque, un aller-retour
 * `requestAnimationFrame` met **13,43 s**, puis 2,25, 1,12 et 2,98 s, et seulement ensuite
 * 0,15 s de façon stable. Vingt secondes de thread saturé APRÈS le signal que tout le monde
 * prenait pour « prêt ».
 *
 * Or un clic de Playwright a besoin de ce thread : il y exécute son test de cible puis attend
 * l'acquittement de l'événement. Pendant ces vingt secondes, `locator.click()` n'avance pas.
 * C'est la cause, MESURÉE et non supposée, des trois clics restés bloqués sur `main` :
 *
 *  - `precip-visual.spec.ts` sur `#weather-trigger` (PR #40, shard 4, 3 tentatives sur 3) ;
 *  - `titan.spec.ts` sur `.mode-btn[data-mode="explo"]` (PR #42, shard 6, 3 sur 3) ;
 *  - `tourPlayer.spec.ts` sur `.stour-next`, dans le même shard que le précédent.
 *
 * Les sélecteurs plutôt que les numéros de ligne : ces trois fichiers ont changé en corrigeant
 * le défaut, donc un numéro cité ici pourrirait dès le premier commit.
 *
 * La preuve du correctif est un chiffre : sur la même page et sous le même frein, le clic sur
 * `#weather-trigger` passe de **14,6 s** (pour un `actionTimeout` de 15 s, d'où l'échec) à
 * **1,9 s** quand on attend d'abord que le thread réponde.
 *
 * Ce n'est ni une pause arbitraire ni une reprise qui masque : on attend un SIGNAL, celui du
 * thread qui rend la main dans un budget, et on échoue bruyamment s'il ne le fait jamais.
 */

/**
 * Budget d'une image considérée comme calme (d'un aller-retour jusqu'au 2026-10-05, qui contenait
 * une image : les mesures ci-dessous restent des majorants).
 *
 * **1 500 ms depuis le 2026-10-03 (ligne 44.3) ; c'était 500.** Les 500 ms séparaient les deux
 * régimes mesurés ci-dessus, et ce « régime chargé » était celui de la Terre au démarrage,
 * c'est-à-dire des TEXTURES qui se décodent et s'uploadent. Elles sont désormais exclues par un
 * signal réel (`data-textures-loading`, lu dans le même aller-retour), donc le budget n'a plus à
 * les attraper par la durée. Il doit encore rejeter les pics qui restent (un vol de caméra, un
 * upload : 2,5 à 5,5 s sur un EPYC 7763) SANS rejeter une machine lente mais stable : la vue
 * d'ensemble tient 700 à 1 180 ms par aller-retour sur un EPYC 9V74 en fin de shard (run
 * `37072161618`, `titan.spec.ts` passé au réessai sur « 3 fois de suite sous 500 ms »), et la
 * vue Terre ~430 ms sur un 7763. Un budget absolu de 500 confondait ces deux machines avec un
 * thread occupé.
 */
const CALM_BUDGET_MS = 1500;

/**
 * Nombre d'images calmes CONSÉCUTIVES exigées, observées sans trou dans la page.
 *
 * C'étaient trois allers-retours, chacun lisant UNE image : la série mesurée ci-dessus retombe à
 * 1,12 s après un 2,25 s, donc un seul échantillon sous le budget ne prouve rien. **Ce n'était
 * pas assez (2026-10-05)** : le niveau de détail n'est réévalué qu'une image sur
 * `LOD_UPDATE_INTERVAL`, et un chargement DÛ n'apparaît dans `data-textures-loading` qu'à cette
 * réévaluation. Trois images tenaient donc entre deux réévaluations, pendant le vol vers la Terre
 * comme juste après la fin d'un palier. Mesuré sous frein CPU × 4 : deux fois sur cinq, le calme
 * se déclarait une seconde après la sélection de la Terre et ses textures au gros plan partaient
 * juste après, sans aucun clic. C'est le réessai de `modes.spec.ts` au run de `main`
 * `37268935169` : le clic sur Explo est tombé dans ces uploads, et Playwright est resté plus de
 * 15 s sur « waiting for scheduled navigations ». Une image de plus que la cadence garantit
 * qu'une réévaluation au moins a eu lieu pendant le calme observé.
 */
const CALM_FRAMES = LOD_UPDATE_INTERVAL + 1;

/** Fenêtre d'une observation côté page ; au-delà, on rend la série et on recommence. */
const OBSERVATION_WINDOW_MS = 15_000;

export interface CalmOptions {
  /** Budget d'une image calme, en millisecondes. */
  budgetMs?: number;
  /** Images calmes consécutives exigées. */
  frames?: number;
  /** Au-delà, on échoue en NOMMANT la série mesurée. */
  timeoutMs?: number;
}

/**
 * Rend la main quand la page a enchaîné `frames` images calmes : chacune sous `budgetMs`, aucune
 * texture en vol, ni vol de caméra ni glissement d'échelle (`data-scene-moving`).
 *
 * Les images sont observées DANS la page, sans trou entre elles : un aller-retour par image
 * laissait passer des images que personne ne regardait. La première image compte depuis l'entrée
 * du script, donc un thread bloqué à ce moment la rend lente.
 *
 * Lève une erreur portant la série mesurée si ce n'est jamais le cas : un thread qui ne se
 * calme pas en une minute est une information, pas un aléa à absorber en silence.
 */
export async function waitForCalmMainThread(
  page: Page,
  { budgetMs, frames, timeoutMs }: CalmOptions = {}
): Promise<string[]> {
  const budget = budgetMs ?? CALM_BUDGET_MS;
  const wanted = frames ?? CALM_FRAMES;
  const deadline = Date.now() + (timeoutMs ?? 60_000);
  const series: string[] = [];

  for (;;) {
    // Attributs absents (page sans l'application) : rien en vol, rien en mouvement.
    const observed = await page.evaluate(
      ({ budget, wanted, windowMs }) =>
        new Promise<{ calm: boolean; series: string[] }>((resolve) => {
          const canvas = document.querySelector('canvas');
          const start = performance.now();
          const out: string[] = [];
          let last = start;
          let streak = 0;
          // `performance.now()` et non l'horodatage du rAF, qui date le DÉBUT de l'image et
          // rendait la première négative (mesuré : -9 à -19 ms).
          const tick = (): void => {
            const now = performance.now();
            const took = Math.round(now - last);
            last = now;
            const loading = canvas?.dataset['texturesLoading'] ?? '0';
            const moving = canvas?.dataset['sceneMoving'] === '1';
            out.push(
              `${took}${loading === '0' ? '' : `+${loading}tex`}${moving ? '~' : ''}`
            );
            streak =
              took <= budget && loading === '0' && !moving ? streak + 1 : 0;
            if (streak >= wanted) resolve({ calm: true, series: out });
            else if (now - start > windowMs)
              resolve({ calm: false, series: out });
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
      { budget, wanted, windowMs: OBSERVATION_WINDOW_MS }
    );
    series.push(...observed.series);
    if (observed.calm) return series;
    if (Date.now() > deadline)
      throw new Error(
        `le thread principal n'a pas enchaîné ${wanted} images sous ${budget} ms sans texture ` +
          `en vol ni scène en mouvement : série mesurée (ms par image, +N tex = N textures en ` +
          `vol, ~ = vol de caméra ou glissement d'échelle) ${series.slice(-60).join(' ')}`
      );
  }
}

/**
 * Le démarrage complet : le chargeur s'en va, PUIS le thread répond.
 *
 * À employer partout où un scénario clique juste après un démarrage — c'est-à-dire là où la
 * mesure ci-dessus s'applique.
 */
export async function bootAndSettle(
  page: Page,
  path = '/',
  {
    loaderTimeoutMs = 60_000,
    ...calm
  }: CalmOptions & { loaderTimeoutMs?: number } = {}
): Promise<string[]> {
  await page.goto(path);
  await expect(page.locator('#loader')).toBeHidden({
    timeout: loaderTimeoutMs,
  });
  return waitForCalmMainThread(page, calm);
}

/**
 * Clique APRÈS que le thread ait rendu la main.
 *
 * À employer quand on clique dans une scène qui travaille encore : juste après un démarrage,
 * après un saut de date, ou pendant une visite guidée qui enchaîne vols de caméra et sauts de
 * date. C'est exactement ce que la mesure ci-dessus décrit, et la raison pour laquelle le
 * journal d'un clic bloqué s'arrête à « done scrolling » sans jamais dire pourquoi.
 */
export async function clickWhenCalm(
  page: Page,
  locator: Locator,
  options: CalmOptions = {}
): Promise<void> {
  await waitForCalmMainThread(page, options);
  await locator.click();
}
