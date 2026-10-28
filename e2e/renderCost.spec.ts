import { expect, test } from '@playwright/test';
import { RENDER_COST_CEILINGS } from '../src/core/gpuBudget';
import { bootAndSettle } from './mainThread';
import { blockExternalNetwork } from './netBlock';

/**
 * LE COÛT DE RENDU D'UNE SCÈNE TIENT SOUS SON PLAFOND (2026-10-28) : appels de dessin, triangles et
 * programmes de shaders. Contrairement au temps d'image, ces nombres ne dépendent pas du processeur
 * du runner : ils sont identiques d'un tirage à l'autre (voir `core/gpuBudget.ts`). Le temps
 * d'image reste gardé par `perf-fps.spec.ts` (plancher) et par l'A/B simultané (`perf-ab.yml`).
 */
for (const scene of RENDER_COST_CEILINGS) {
  test(`render cost of ${scene.id} stays under its ceiling`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await blockExternalNetwork(page);
    await bootAndSettle(page, `/${scene.query}`, {
      loaderTimeoutMs: 120_000,
      timeoutMs: 120_000,
    });
    await page.waitForFunction(() => 'perfProbe' in window, null, {
      timeout: 60_000,
    });
    // Les couches paresseuses finissent de charger après le calme : une seconde et demie de plus.
    await page.waitForTimeout(1500);
    const got = await page.evaluate(() => {
      const s = (
        window as unknown as {
          perfProbe: {
            snapshot: () => {
              drawCalls: number;
              triangles: number;
              programs: number;
            };
          };
        }
      ).perfProbe.snapshot();
      return {
        drawCalls: s.drawCalls,
        triangles: s.triangles,
        programs: s.programs,
      };
    });
    const at = `(mesuré ${JSON.stringify(scene.measured)} le ${scene.measuredOn})`;
    expect(got.drawCalls, `appels de dessin ${at}`).toBeGreaterThan(0);
    expect(got.drawCalls, `appels de dessin ${at}`).toBeLessThanOrEqual(
      scene.ceiling.drawCalls
    );
    expect(got.triangles, `triangles ${at}`).toBeGreaterThan(0);
    expect(got.triangles, `triangles ${at}`).toBeLessThanOrEqual(
      scene.ceiling.triangles
    );
    expect(got.programs, `programmes ${at}`).toBeLessThanOrEqual(
      scene.ceiling.programs
    );
  });
}
