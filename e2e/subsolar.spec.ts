import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

/**
 * Le point subsolaire tombe-t-il sur la BONNE longitude de la texture terrestre ?
 *
 * L'ombre elle-même est juste par construction : elle ne dépend que de dot(normale, Soleil).
 * Ce qui peut être faux, c'est la PHASE DE ROTATION de la Terre — c'est-à-dire quelle ville
 * se trouve sous cette ombre. Une erreur de phase décale donc les continents et les lumières
 * de ville par rapport au terminateur, en avance sur un limbe et en retard sur l'autre, sans
 * jamais déformer le terminateur. Aucun test unitaire ne voit ce décalage : il n'apparaît
 * qu'en comparant la scène RENDUE à la vérité astronomique, ce que fait ?debug-solar.
 *
 * Portée EXACTE de ce fichier, à ne pas surestimer : la longitude est calée SUR
 * `computeGreenwichSubsolarLongitude` puis vérifiée CONTRE elle. Cette assertion-là est donc
 * circulaire — elle attrape une rupture de plomberie (celle décrite ci-dessous), jamais une
 * erreur dans la vérité elle-même. L'assertion de LATITUDE, elle, ne l'est pas : elle compare
 * l'axe rendu (RotationAxis → equatorialToScene → setAxisDirection) à la déclinaison apparente
 * du Soleil, deux chemins de code sans rien en commun. Une erreur d'axe ferait pivoter le
 * terminateur — lumières en avance à un bout, en retard à l'autre — sans toucher la longitude.
 *
 * Régression réellement livrée : l'azimut du Soleil était mesuré dans le plan XZ de la scène
 * (l'écliptique) puis composé avec une longitude équatoriale (RA − GAST). L'écart résiduel
 * était le terme d'obliquité de l'équation du temps — mesuré ici même à ±2.4°, nul aux
 * équinoxes et aux solstices, maximal entre les deux. D'où les dates ci-dessous : les quatre
 * points de passage à zéro NE SUFFISENT PAS, il faut les dates intermédiaires pour voir le
 * bug. Un seuil large (0.05°) suffit — l'erreur corrigée était 50 fois plus grande.
 */
const CASES = [
  '2026-01-15T00:00:00Z',
  '2026-03-20T12:00:00Z', // équinoxe : le bug y était invisible
  '2026-05-02T18:00:00Z', // −2.44° avant correction
  '2026-06-21T09:00:00Z', // solstice : invisible
  '2026-08-17T12:00:00Z', // +2.29° avant correction
  '2026-11-03T21:00:00Z', // −2.43° avant correction
];

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

const readError = (
  panel: ReturnType<import('@playwright/test').Page['locator']>,
  label: string
) =>
  panel.evaluate((el, l) => {
    const match = el.textContent?.match(
      new RegExp(l + String.raw`\s+(-?[\d.]+) deg`)
    );
    return match ? Number(match[1]) : Number.NaN;
  }, label);

for (const date of CASES) {
  test(`subsolar point lands on its true longitude at ${date}`, async ({
    page,
  }) => {
    await page.goto(`/?debug-solar&body=earth&date=${encodeURIComponent(date)}`);
    const panel = page.locator('#solar-debug');
    await expect(panel).toBeVisible({ timeout: 40_000 });
    await expect(panel).toContainText('lat error', { timeout: 20_000 });

    const lonError = await readError(panel, 'lon error');
    expect(Number.isNaN(lonError)).toBe(false);
    expect(Math.abs(lonError)).toBeLessThan(0.05);

    const latError = await readError(panel, 'lat error');
    expect(Number.isNaN(latError)).toBe(false);
    expect(Math.abs(latError)).toBeLessThan(0.05);
  });
}

/**
 * Le calage ci-dessus ne prouve que l'instant du saut temporel. Ce test-ci porte sur la
 * propriété qui manquait vraiment : la phase reste juste PENDANT que l'horloge défile.
 *
 * Régression réellement livrée : la phase était ancrée aux sauts temporels puis laissée
 * s'intégrer frame par frame (`rotation.y += rotationSpeed * delta`), derrière le test de
 * visibilité du frustum. Toute frame sautée — hors-champ, pause, onglet en arrière-plan,
 * décodage de texture qui bloque le thread — était perdue DÉFINITIVEMENT, rien ne la
 * rattrapait. Mesuré au démarrage : 0,68° puis 2,35° d'erreur selon la durée, soit exactement
 * le temps simulé écoulé sans intégration.
 *
 * À 1 an/s le défaut n'est plus subtil : une frame vaut ~6 jours simulés, donc une seule frame
 * perdue décale la Terre de plusieurs tours. Playwright tourne justement sur un GPU logiciel
 * qui en saute — c'est ce qui rend ce test sensible là où un test unitaire ne voit rien. La
 * phase étant désormais DÉRIVÉE de la date à chaque frame, il n'existe plus d'état à perdre.
 */
test('the subsolar longitude does not drift while the clock races', async ({
  page,
}) => {
  await page.goto('/?debug-solar&body=earth');
  const panel = page.locator('#solar-debug');
  await expect(panel).toBeVisible({ timeout: 40_000 });
  await expect(panel).toContainText('lat error', { timeout: 20_000 });

  // Vitesse maximale via le curseur de lecture (le même chemin que l'utilisateur).
  const speed = page.locator('#speed-range');
  await speed.evaluate((el: HTMLInputElement) => {
    el.value = el.max;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });

  const dateOf = () =>
    panel.evaluate(
      (el) => el.textContent?.match(/date\s+(\S+)/)?.[1] ?? ''
    );
  const startDate = await dateOf();

  // Laisse réellement défiler : sans avance de date, le test ne prouverait rien.
  await expect
    .poll(dateOf, { timeout: 20_000 })
    .not.toBe(startDate);
  await page.waitForTimeout(4_000);

  const advanced = await dateOf();
  expect(new Date(advanced).getTime() - new Date(startDate).getTime()).toBeGreaterThan(
    86_400_000
  );

  const lonError = await readError(panel, 'lon error');
  expect(Number.isNaN(lonError)).toBe(false);
  expect(Math.abs(lonError)).toBeLessThan(0.05);
});
