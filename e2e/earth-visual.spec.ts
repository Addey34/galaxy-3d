import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

/**
 * Validation visuelle du relief géométrique de la Terre (EA-03).
 *
 * Le displacement n'est visible qu'au gros plan : la surface est densifiée
 * (GEOMETRY_SEGMENTS → GEOMETRY_SEGMENTS_HI) une fois la caméra suffisamment proche.
 * Ces scénarios attendent un ÉTAT OBSERVABLE — le panneau ?debug-earth passe à HI-RES
 * quand la géométrie hi-res est réellement montée — plutôt qu'un délai arbitraire, pour
 * ne pas masquer une course (décodage texture / reconstruction de sphère).
 *
 * Couvre : densification au gros plan, préservation des UV, absence d'erreur WebGL, et
 * retour à la géométrie standard au dézoom (hystérésis du LOD).
 */
test.beforeEach(async ({ page }) => {
  // Déterminisme : pas d'appel réseau SBDB, pas de visite guidée bloquante, locale figée.
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

test('close-up Earth densifies its surface for real geometric relief', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  // Boot directement sur la Terre : le permalink amène la caméra à sa distance de visite
  // (cameraDistance.educ = 5 rayons apparents), sous le seuil hi-res (≤ 12 rayons).
  await page.goto('/?debug-earth&body=earth');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  const panel = page.locator('#earth-debug');
  await expect(panel).toBeVisible();

  // État observable : la surface passe en HI-RES quand la géométrie densifiée est montée.
  // On attend cet état (Playwright ré-évalue jusqu'à satisfaction), pas un délai fixe.
  await expect(panel).toContainText('surface tessel  HI-RES', {
    timeout: 20_000,
  });

  // La densité correspond bien au palier hi-res (desktop 257² = 66049, mobile 129² = 16641),
  // très au-dessus de la densité standard (65² = 4225).
  const verts = await panel.evaluate((el) => {
    const match = el.textContent?.match(/surface verts\s+(\d+)/);
    return match ? Number(match[1]) : 0;
  });
  expect(verts).toBeGreaterThan(10_000);

  // Le displacement ne casse pas la paramétrisation : autant d'UV que de vertices
  // (la SphereGeometry hi-res conserve l'UV équirectangulaire de la surface).
  const uvs = await panel.evaluate((el) => {
    const match = el.textContent?.match(/uv count\s+(\d+)/);
    return match ? Number(match[1]) : 0;
  });
  expect(uvs).toBe(verts);

  // La couche surface reste un matériau PBR standard (displacement posé dessus, pas un
  // overlay météo) — le mesh réellement rendu, pas la config.
  await expect(panel).toContainText('material        MeshStandardMaterial');

  // Aucune erreur WebGL pendant la reconstruction de géométrie / le displacement.
  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
});

test('mobile viewport applies the Earth surface texture', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?debug-earth&body=earth');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  await expect(page.locator('#earth-debug')).toContainText(
    /surface map\s+(1024x512|2048x1024)/,
    { timeout: 20_000 }
  );
});
test('mobile boot defers hidden thermal imagery', async ({ page }) => {
  const thermalRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('MERRA2_2m_Air_Temperature_Monthly'))
      thermalRequests.push(request.url());
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?debug-earth&body=earth');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  expect(thermalRequests).toEqual([]);
});

test('Earth surface returns to standard tessellation when zoomed out', async ({
  page,
}) => {
  await page.goto('/?debug-earth&body=earth');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  const panel = page.locator('#earth-debug');
  await expect(panel).toContainText('surface tessel  HI-RES', {
    timeout: 20_000,
  });

  // Retour Vue Globale : la caméra recule bien au-delà du seuil de sortie (hystérésis),
  // la géométrie hi-res est libérée et la surface repasse en densité standard.
  await page.locator('#body-search-trigger').click();
  await page.locator('#orbit-overview').click();

  await expect(panel).toContainText('surface tessel  STANDARD', {
    timeout: 20_000,
  });
});
