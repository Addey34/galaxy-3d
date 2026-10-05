import { expect, test } from '@playwright/test';
import { clickWhenCalm, waitForCalmMainThread } from './mainThread';
import { blockExternalNetwork } from './netBlock';

/**
 * LE TÉMOIN DU SIGNAL « TEXTURES EN VOL » (ligne 44.3, 2026-10-02).
 *
 * `e2e/mainThread.ts` ne déclare le thread calme que si `data-textures-loading` vaut `0`. Si ce
 * signal se taisait (publication retirée, notification oubliée), l'attente redeviendrait celle
 * d'avant, fondée sur la seule durée des images, sans que rien ne rougisse : elle se déclarait
 * alors satisfaite ENTRE deux couches de la Terre, juste avant la suivante, qui fige l'image 2,5
 * à 5 s en rendu logiciel. Ce scénario exige donc que le compte MONTE à l'arrivée sur la Terre,
 * puis retombe à zéro.
 */
test('selecting the Earth raises the in-flight texture count, then it settles to zero', async ({
  page,
}) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  await waitForCalmMainThread(page);

  const canvas = page.locator('canvas').first();
  await expect(canvas).toHaveAttribute('data-textures-loading', /^\d+$/);

  // Le plus haut compte vu pendant l'approche, relevé à chaque image côté page : un sondage
  // depuis le test pourrait tomber entre deux couches et ne jamais voir que des zéros.
  await page.evaluate(() => {
    const w = window as unknown as { __maxTexturesLoading?: number };
    w.__maxTexturesLoading = 0;
    const el = document.querySelector('canvas')!;
    new MutationObserver(() => {
      const n = Number(el.dataset['texturesLoading'] ?? '0');
      w.__maxTexturesLoading = Math.max(w.__maxTexturesLoading ?? 0, n);
    }).observe(el, {
      attributes: true,
      attributeFilter: ['data-textures-loading'],
    });
  });

  await page.locator('#body-search-trigger').click();
  await page.locator('#orbit-earth').click();

  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as { __maxTexturesLoading?: number })
              .__maxTexturesLoading ?? 0
        ),
      { timeout: 30_000 }
    )
    .toBeGreaterThan(0);
  await expect(canvas).toHaveAttribute('data-textures-loading', '0', {
    timeout: 90_000,
  });
});

/**
 * LE TÉMOIN DU SIGNAL « SCÈNE EN MOUVEMENT » (2026-10-05).
 *
 * `e2e/mainThread.ts` refuse aussi le calme pendant un vol de caméra ou un glissement d'échelle,
 * parce que chaque palier franchi demandera ses textures. Si `data-scene-moving` se taisait,
 * rien ne rougirait ailleurs : ce scénario exige qu'il MONTE pendant le vol vers la Terre et
 * pendant le passage en Explo, puis retombe à zéro.
 */
test('a camera flight and a scale switch raise the scene-moving flag, then it settles', async ({
  page,
}) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  await waitForCalmMainThread(page);

  const canvas = page.locator('canvas').first();
  await expect(canvas).toHaveAttribute('data-scene-moving', '0');
  // Chaque passage à `1`, compté côté page : un sondage depuis le test pourrait tomber après.
  await page.evaluate(() => {
    const w = window as unknown as { __sceneMoves?: number };
    w.__sceneMoves = 0;
    const el = document.querySelector('canvas')!;
    new MutationObserver(() => {
      if (el.dataset['sceneMoving'] === '1')
        w.__sceneMoves = (w.__sceneMoves ?? 0) + 1;
    }).observe(el, {
      attributes: true,
      attributeFilter: ['data-scene-moving'],
    });
  });
  const moves = () =>
    page.evaluate(
      () => (window as unknown as { __sceneMoves?: number }).__sceneMoves ?? 0
    );

  await page.locator('#body-search-trigger').click();
  await page.locator('#orbit-earth').click();
  await expect.poll(moves, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  await expect(canvas).toHaveAttribute('data-scene-moving', '0', {
    timeout: 30_000,
  });

  const beforeSwitch = await moves();
  await clickWhenCalm(page, page.locator('.mode-btn[data-mode="explo"]'));
  await expect.poll(moves, { timeout: 30_000 }).toBeGreaterThan(beforeSwitch);
  await expect(canvas).toHaveAttribute('data-scene-moving', '0', {
    timeout: 30_000,
  });
});

/**
 * LE CALME ATTENDU PAR LA SUITE N'EST SUIVI D'AUCUN CHARGEMENT (2026-10-05).
 *
 * Le défaut que ce scénario retient : trois allers-retours d'une image tenaient entre deux
 * réévaluations du niveau de détail, donc le calme se déclarait pendant le vol vers la Terre, et
 * ses textures au gros plan partaient juste après. Mesuré sous ce même frein, cinq tirages par
 * variante : sans `data-scene-moving` et à trois images (l'ancienne attente, à l'observation
 * près), ce scénario rougit QUATRE fois ; avec l'un OU l'autre remède seul (six images, ou le
 * signal de mouvement), zéro. Les deux sont gardés parce qu'ils couvrent deux trous différents :
 * un vol plus long que six images rapides, et l'attente qui suit la fin d'un palier caméra
 * immobile. Le frein CPU × 4 (protocole DevTools,
 * comme `perf-fps.spec.ts`) rapproche la machine locale des coureurs de CI, où un clic tombé là
 * reste bloqué plus de 15 s (run de `main` `37268935169`).
 */
test('the calm the suite waits for after selecting the Earth is not followed by a texture load', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  await page.locator('#body-search-trigger').click({ timeout: 60_000 });
  await page.locator('#orbit-earth').click({ timeout: 60_000 });
  const series = await waitForCalmMainThread(page, { timeoutMs: 120_000 });

  // Les cinq secondes suivantes, image par image, sans rien toucher.
  const after = await page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const el = document.querySelector('canvas')!;
        const start = performance.now();
        const seen: string[] = [];
        const tick = (): void => {
          seen.push(el.dataset['texturesLoading'] ?? '0');
          if (performance.now() - start < 5000) requestAnimationFrame(tick);
          else resolve(seen);
        };
        requestAnimationFrame(tick);
      })
  );
  expect(
    after.filter((n) => n !== '0'),
    `calme déclaré après ${series.join(' ')}`
  ).toEqual([]);
});
