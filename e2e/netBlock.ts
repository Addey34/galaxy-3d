import type { Page } from '@playwright/test';

/**
 * Coupe les appels réseau EXTERNES (NASA GIBS/Earthdata, Open-Meteo, JPL SBDB, USGS, EONET).
 *
 * La route SBDB ne sert PLUS à rien depuis le lot 8b (les petits corps viennent d'un instantané
 * livré, cf. `core/sbdb.ts`) : elle reste comme filet, pour qu'un appel réintroduit par erreur
 * soit coupé ici plutôt que de rendre la suite dépendante d'un service tiers.
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
  // Les deux couches d'événements terrestres sont éteintes au départ et ne demandent rien ;
  // ces deux routes couvrent le cas où un test les allume sans vouloir de réseau réel.
  await page.route('**earthquake.usgs.gov/**', (route) => route.abort());
  await page.route('**eonet.gsfc.nasa.gov/**', (route) => route.abort());
  // Tuiles d'imagerie de surface (lot 9, phase 9C) : coupées par défaut comme le reste. Le
  // spec qui les exerce les SERT lui-même (`e2e/surfaceImagery.spec.ts`), pour que la mesure
  // ne dépende ni du réseau ni de la disponibilité de Trek. Sans cette ligne, descendre vers
  // la Lune dans n'importe quel autre spec émettrait de vraies requêtes.
  await page.route('**trek.nasa.gov/**', (route) => route.abort());
}
