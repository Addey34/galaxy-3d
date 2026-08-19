import type { Page } from '@playwright/test';

/**
 * Coupe les appels réseau EXTERNES (NASA GIBS/Earthdata, Open-Meteo, JPL SBDB) pour un test.
 *
 * Pourquoi : les tests de câblage n'ont pas besoin des données réelles, et en CI ces services
 * sont lents, soumis à quota (429 Open-Meteo) ou indisponibles — leur latence/échec déstabilise
 * les scénarios lourds (boot WebGL + décodage texture). Les couches météo/petit-corps dégradent
 * proprement sans réseau (repli silencieux), donc les couper rend l'e2e DÉTERMINISTE.
 *
 * À appeler dans un `beforeEach` du spec, avant `page.goto`.
 */
export async function blockExternalNetwork(page: Page): Promise<void> {
  await page.route('**/sbdb_query.api*', (route) => route.abort());
  await page.route('**gibs.earthdata.nasa.gov/**', (route) => route.abort());
  await page.route('**earthdata.nasa.gov/**', (route) => route.abort());
  await page.route('**open-meteo.com/**', (route) => route.abort());
}
