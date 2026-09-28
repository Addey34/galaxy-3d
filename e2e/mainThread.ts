import { expect, type Locator, type Page } from '@playwright/test';

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
 *  - `precip-visual.spec.ts:76` sur `#weather-trigger` (PR #40, shard 4, 3 tentatives sur 3) ;
 *  - `titan.spec.ts:53` sur `.mode-btn[data-mode="explo"]` (PR #42, shard 6, 3 sur 3) ;
 *  - `tourPlayer.spec.ts:65` sur `.stour-next`, dans le même shard que le précédent.
 *
 * La preuve du correctif est un chiffre : sur la même page et sous le même frein, le clic sur
 * `#weather-trigger` passe de **14,6 s** (pour un `actionTimeout` de 15 s, d'où l'échec) à
 * **1,9 s** quand on attend d'abord que le thread réponde.
 *
 * Ce n'est ni une pause arbitraire ni une reprise qui masque : on attend un SIGNAL, celui du
 * thread qui rend la main dans un budget, et on échoue bruyamment s'il ne le fait jamais.
 */

/** Budget d'un aller-retour considéré comme calme. */
const CALM_BUDGET_MS = 500;

/**
 * Nombre d'allers-retours calmes CONSÉCUTIFS exigés.
 *
 * Trois, et non un : la série mesurée ci-dessus retombe à 1,12 s après un 2,25 s, donc un seul
 * échantillon sous le budget ne prouve rien. Trois de suite séparent sans ambiguïté les deux
 * régimes mesurés (0,15 s stable contre 1,1 à 13,4 s).
 */
const CALM_SAMPLES = 3;

export interface CalmOptions {
  /** Budget d'un aller-retour calme, en millisecondes. */
  budgetMs?: number;
  /** Allers-retours calmes consécutifs exigés. */
  samples?: number;
  /** Au-delà, on échoue en NOMMANT la série mesurée. */
  timeoutMs?: number;
}

/**
 * Rend la main quand le thread principal a répondu `samples` fois de suite sous `budgetMs`.
 *
 * Lève une erreur portant la série mesurée si ce n'est jamais le cas : un thread qui ne se
 * calme pas en une minute est une information, pas un aléa à absorber en silence.
 */
export async function waitForCalmMainThread(
  page: Page,
  { budgetMs, samples, timeoutMs }: CalmOptions = {}
): Promise<number[]> {
  const budget = budgetMs ?? CALM_BUDGET_MS;
  const wanted = samples ?? CALM_SAMPLES;
  const deadline = Date.now() + (timeoutMs ?? 60_000);
  const series: number[] = [];
  let streak = 0;

  while (streak < wanted) {
    const started = Date.now();
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => resolve(0)))
    );
    const took = Date.now() - started;
    series.push(took);
    streak = took <= budget ? streak + 1 : 0;
    if (streak < wanted && Date.now() > deadline)
      throw new Error(
        `le thread principal n'a pas répondu ${wanted} fois de suite sous ${budget} ms : ` +
          `série mesurée (ms) ${series.join(' ')}`
      );
  }
  return series;
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
): Promise<number[]> {
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
