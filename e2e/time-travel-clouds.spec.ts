import { expect, test } from '@playwright/test';

/**
 * Voyage dans le temps de la couche NUAGES (NASA GIBS), synchronisée sur la date de simulation.
 *
 * Deux invariants produit (cf. docs/ARCHITECTURE.md § « Contrat Terre temps réel : réel par
 * défaut ») :
 *
 *  - FUTUR → l'imagerie satellite n'existe pas au-delà de `now − latence`. La couche se FIGE sur
 *    la dernière observation réelle : aucune donnée future n'est inventée, et surtout aucune
 *    rafale de requêtes GIBS ratées (le socle passe l'instant RÉEL comme `now`, pas la date de
 *    simulation — sinon défiler dans le futur demandait une tuile inexistante par frame et les
 *    textures « déchiraient »).
 *  - PASSÉ → la couche charge l'ARCHIVE réelle datée du jour simulé (VIIRS ≥ 2015, MODIS avant),
 *    pas la date du jour.
 *
 * Ces scénarios comptent les requêtes réseau GIBS réelles plutôt que d'inspecter des pixels :
 * ce sont des tests de CÂBLAGE du pipeline date → source, déterministes.
 */
test.beforeEach(async ({ page }) => {
  await page.route('**/sbdb_query.api*', (route) => route.abort());
  // GIBS/Open-Meteo : on ABORT (échec immédiat) au lieu de laisser pendre. Les compteurs de
  // requêtes de ce test s'incrémentent à l'ÉMISSION (event `request`), donc le comptage reste
  // valide ; mais l'app ne bloque plus en attendant une vraie tuile réseau → le loader se cache
  // en CI (GPU logiciel lent) sans dépendre de la latence NASA. Le repli silencieux des couches
  // garde le rendu propre. sbdb déjà abort ci-dessus.
  await page.route('**gibs.earthdata.nasa.gov/**', (route) => route.abort());
  await page.route('**open-meteo.com/**', (route) => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

test('future freezes clouds: no GIBS request storm, no page error', async ({
  page,
}) => {
  test.setTimeout(120_000);

  const gibsRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('gibs.earthdata.nasa.gov')) gibsRequests.push(r.url());
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto('/?body=earth');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  // Laisse charger l'observation temps réel (baseline) avant de mesurer le futur.
  await page.waitForTimeout(6000);
  const baseline = gibsRequests.length;

  // Défile vite dans le FUTUR : slider de vitesse au max + lecture.
  await page.locator('#speed-range').evaluate((el: HTMLInputElement) => {
    el.value = '100';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const playBtn = page.locator('#play-pause-btn');
  if (await playBtn.count()) await playBtn.click().catch(() => {});
  await page.waitForTimeout(12_000);

  const duringFuture = gibsRequests.length - baseline;
  // Clampé à la dernière image → la requête se répète à l'identique et le gating l'absorbe.
  // Avant le fix : une requête ratée par frame (des centaines). Après : une poignée au plus.
  expect(duringFuture).toBeLessThan(15);
  expect(errors, errors.join(' | ')).toEqual([]);
});

test('past loads the dated GIBS archive for the simulated day', async ({
  page,
}) => {
  test.setTimeout(90_000);

  const gibsDates = new Set<string>();
  page.on('request', (r) => {
    const u = r.url();
    if (u.includes('gibs.earthdata.nasa.gov')) {
      const m = u.match(/TIME=([0-9-]+)/i);
      if (m) gibsDates.add(m[1]);
    }
  });

  await page.setViewportSize({ width: 1400, height: 1000 });
  // Boot sur une date passée dans l'archive VIIRS via permalink.
  await page.goto('/?body=earth&date=2018-06-15T12:00:00Z');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  await page.waitForTimeout(8000);

  // La couche True Color doit viser juin 2018 (archive réelle), pas la date du jour.
  expect([...gibsDates].some((d) => d.startsWith('2018-06'))).toBe(true);
});
