import { expect, test, type Page } from '@playwright/test';
import { mockOpenMeteo } from './openMeteoMock';

/**
 * LE TERMINATEUR, MESURÉ EN PIXELS.
 *
 * Ce fichier existe parce que deux défauts livrés de suite sont passés sous des tests
 * unitaires verts. Les courbes de `core/terminator.ts` étaient justes ; ce qui était faux,
 * c'était ce que l'écran en faisait :
 *
 *   1. La bande de crépuscule rendait 0 % de pixels visibles de 0° à −2° sous l'horizon, alors
 *      que le garde-fou de l'époque — « la somme sol + villes ne descend jamais sous sa valeur
 *      au terminateur » — était vrai. Sa référence, `wrap/4 ≈ 2,6 %` du plein soleil, est
 *      elle-même sous le plancher d'affichage une fois multipliée par l'albédo et compressée
 *      par le tone mapping. Une garantie exprimée dans une unité que personne n'avait
 *      confrontée à un pixel.
 *   2. Les couches météo MODÈLE remplaçaient le matériau de leur couche par un matériau nu :
 *      les nuages Open-Meteo brillaient à plein régime sur la face nuit là où les nuages
 *      satellite, sur le MÊME mesh, s'éteignaient.
 *
 * Aucun test JS ne pouvait voir l'un ni l'autre. Ceux-ci comptent des pixels, via
 * `?debug-terminator` (`src/ui/terminatorProbe.ts`), qui cadre le terminateur au centre du
 * disque et rend la mesure reproductible.
 */

const DATE = '2026-09-09T06:45:00Z';

interface TerminatorBin {
  raw: number;
  pixels: number;
  litFraction: number;
  meanLuminance: number;
  maxLuminance: number;
}

/** Cadre le terminateur au centre du disque, laisse le rendu se poser, puis mesure. */
async function measure(page: Page): Promise<TerminatorBin[]> {
  const framed = await page.evaluate(() =>
    (
      window as unknown as { terminatorProbe: { frame(n?: string): boolean } }
    ).terminatorProbe.frame('earth')
  );
  expect(framed).toBe(true);
  await page.waitForTimeout(1500);
  const bins = await page.evaluate(() =>
    (
      window as unknown as {
        terminatorProbe: { sample(o?: { step?: number }): TerminatorBin[] };
      }
    ).terminatorProbe.sample({ step: 2 })
  );
  // Le cadrage doit vraiment montrer les deux côtés : sans cela les assertions ci-dessous
  // porteraient sur un disque vide et passeraient pour de mauvaises raisons.
  expect(bins.some((bin) => bin.raw > 0.3)).toBe(true);
  expect(bins.some((bin) => bin.raw < -0.3)).toBe(true);
  return bins;
}

const average = (values: number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);

test.beforeEach(async ({ page }) => {
  await page.route('**/sbdb_query.api*', (route) => route.abort());
  await page.route('**gibs.earthdata.nasa.gov/**', (route) => route.abort());
  await page.route('**earthdata.nasa.gov/**', (route) => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

test('the twilight band leaves no dark gap along the terminator', async ({
  page,
}) => {
  await page.route('**open-meteo.com/**', (route) => route.abort());
  await page.goto(
    `/?debug-terminator&body=earth&date=${encodeURIComponent(DATE)}`
  );
  await expect(page.locator('#loader')).toBeHidden({ timeout: 40_000 });
  await page.waitForTimeout(2500);

  const bins = await measure(page);
  const band = bins.filter((bin) => Math.abs(bin.raw) <= 0.06);
  expect(band.length).toBeGreaterThan(8);

  // LA propriété : aucune tranche de la bande n'est ENTIÈREMENT noire. Mesuré avant
  // correction, au même cadrage : 4 % de pixels allumés à +0,6°, puis 0 % de 0° à −2°. La
  // rampe des lumières de ville ne pouvait pas combler ce trou — elle ne s'allume que là où
  // il y a des villes. Ce qui le comble est la lueur du CIEL, indépendante de l'albédo, donc
  // présente sur toute la tranche : le seuil porte sur une MAJORITÉ de pixels, pas sur
  // quelques-uns.
  for (const bin of band) {
    expect(
      bin.litFraction,
      `tranche raw=${bin.raw} : ${(100 * bin.litFraction).toFixed(0)} % de pixels au-dessus ` +
        `du plancher d'affichage (moyenne ${bin.meanLuminance.toFixed(1)}/255)`
    ).toBeGreaterThan(0.5);
  }

  // Et la nuit profonde reste noire : sans cela le bandeau aurait été « corrigé » en posant
  // un voile gris partout, ce qui écraserait le contraste des lumières de ville.
  const deepNight = bins.filter((bin) => bin.raw <= -0.25);
  expect(deepNight.length).toBeGreaterThan(5);
  expect(average(deepNight.map((bin) => bin.litFraction))).toBeLessThan(0.25);
});

test('a model weather layer keeps its layer’s twilight, not its own', async ({
  page,
}) => {
  await mockOpenMeteo(page);
  await page.goto(
    `/?debug-terminator&debug-meteo&body=earth&date=${encodeURIComponent(DATE)}`
  );
  await expect(page.locator('#loader')).toBeHidden({ timeout: 40_000 });
  const debug = page.locator('#meteo-debug');

  // La largeur du crépuscule que le matériau applique RÉELLEMENT, telle que le rendu la voit.
  const twilightOf = async (layerId: string): Promise<string> => {
    const block = await debug.evaluate((el, id) => {
      const text = el.textContent ?? '';
      const start = text.indexOf(id + ' [');
      return start < 0 ? '' : text.slice(start, start + 700);
    }, layerId);
    return block.match(/twilight=([\d.]+|none)/)?.[1] ?? 'absent';
  };

  // Référence : la couche satellite, qui a toujours eu son terminateur.
  const satellite = await twilightOf('clouds');
  expect(satellite).not.toBe('none');
  expect(satellite).not.toBe('absent');

  await page.locator('#weather-trigger').click();
  await page
    .locator('#weather-layers .wl-item')
    .filter({ hasText: 'Clouds (Open-Meteo)' })
    .locator('input')
    .check();
  await expect(debug).toContainText('clouds-model [model] ready ON', {
    timeout: 30_000,
  });

  // LA propriété : la couche modèle a remplacé le matériau du mesh, et le nouveau porte la
  // MÊME largeur. Avant correction, `setDataOverlay` posait un MeshBasicMaterial nu — la
  // couche satellite s'éteignait au terminateur et sa jumelle modèle, sur le même mesh,
  // brillait à plein régime sur la face nuit.
  expect(await twilightOf('clouds-model')).toBe(satellite);

  // Le pendant — une couche d'INSTRUMENT n'en prend pas — N'EST PAS vérifié ici : la couche
  // thermique reste inactive dans ce scénario, donc son mesh porte encore son matériau
  // d'origine et annoncerait `none` quoi qu'on mette dans `LAYER_TERMINATOR_WRAP`. Écrite ici,
  // l'assertion passerait sans rien prouver — exactement le défaut que ce fichier existe pour
  // ne plus commettre. Elle vit dans `src/config/layerConfig.test.ts`
  // (« leaves instrument layers unshaded »), où elle est falsifiable.
});

/**
 * Pourquoi ce dernier test lit une largeur plutôt que des pixels, alors que tout ce fichier
 * existe pour compter des pixels : sous le rendu logiciel des runners (SwiftShader), la
 * `DataTexture` des couches modèle ne remonte pas — le calque sort noir opaque, AVEC ou SANS
 * la correction (mesuré : face jour 40 → 3,4 dans les deux cas). Une assertion en pixels y
 * serait donc verte pour une mauvaise raison. Ce qui reste mesurable et décisif est la
 * divergence elle-même : deux matériaux posés tour à tour sur le même mesh doivent annoncer
 * la même largeur. Le rendu réel du calque modèle, lui, a été vérifié à la main en navigateur.
 */
