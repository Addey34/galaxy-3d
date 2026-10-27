import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  encodeBuildingTile,
  HEIGHT_ORIGIN,
  quantizeToTile,
  tileOfLonLat,
} from '@/core/buildingTile';
import {
  boot,
  prepareSurfacePage,
  TILE_JPEG,
  zoomIn,
  zoomInSettling,
} from './surfaceTiles';

/**
 * LES BÂTIMENTS 3D DE PARIS (lot 63, C.3b et C.4) : ce que l'application demande et quand, ce
 * qu'elle pose, et surtout ce que l'ÉCRAN dit : la légende des origines de hauteur et l'attribution
 * de la licence du jeu, sans quoi on afficherait des données de l'IGN sans les nommer.
 *
 * L'index et le manifeste sont les VRAIS fichiers livrés (`public/assets/buildings/`). Les tuiles,
 * elles, sont SERVIES PAR LE TEST (une tuile `GXBD` d'un bâtiment, au centre de l'indice demandé) :
 * la mesure ne dépend ni du service de données ni de fichiers absents de git.
 */

test.beforeEach(async ({ page }) => {
  await prepareSurfacePage(page);
});

/** Un jeu de bâtiments livré : la ville visée, son identifiant, un point sous la visée, son crédit. */
const CITIES: {
  city: string;
  set: string;
  lon: number;
  lat: number;
  credit: string[];
  mode?: 'educ' | 'explo';
}[] = [
  {
    city: 'Paris',
    set: 'paris-bdtopo',
    lon: 2.353,
    lat: 48.8581,
    credit: ['IGN', 'Licence Ouverte 2.0'],
  },
  // Même Terre (rayon 35 dans les deux modes) mais caméra différente en Explo : relevée vers
  // l'horizon, FOV optique, plans near/far adaptatifs (`CameraSystem`). Une ville suffit à le prouver.
  {
    city: 'Paris',
    set: 'paris-bdtopo',
    lon: 2.353,
    lat: 48.8581,
    credit: ['IGN', 'Licence Ouverte 2.0'],
    mode: 'explo',
  },
  {
    city: 'Berlin',
    set: 'berlin-lod2',
    lon: 13.3777,
    lat: 52.5163,
    credit: ['Land Berlin', 'Datenlizenz Deutschland Zero 2.0'],
  },
  {
    city: 'Nairobi',
    set: 'nairobi-overture',
    lon: 36.82,
    lat: -1.285,
    credit: ['Overture Maps Foundation', 'Open Database License (ODbL)'],
  },
];

for (const { city, set, lon, lat, credit, mode = 'educ' } of CITIES) {
  test(`draws the buildings of ${city} in ${mode} mode, says where their heights come from, and asks for nothing from afar`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.route(
      '**gibs.earthdata.nasa.gov/wmts/epsg4326/best/BlueMarble_NextGeneration/**',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'image/jpeg',
          headers: { 'access-control-allow-origin': '*' },
          body: TILE_JPEG,
        })
    );
    const tileUrls: string[] = [];
    await page.route(
      '**galaxy-data.adrianguichard.dev/assets/buildings/**',
      (route) => {
        const url = route.request().url();
        tileUrls.push(url);
        const m = /\/(\d+)\/(\d+)\/(\d+)\.bin$/.exec(url);
        if (!m) return route.fulfill({ status: 404, body: 'x' });
        const [zoom, column, row] = m.slice(1).map(Number) as [
          number,
          number,
          number,
        ];
        // Un bâtiment au centre de la tuile demandée, mesuré à 30 m ; le décodeur refuse une
        // tuile dont l'en-tête ne nomme pas l'indice demandé.
        const [x, y] = [32768, 32768];
        const body = Buffer.from(
          encodeBuildingTile({
            zoom,
            column,
            row,
            buildings: [
              {
                ring: Uint16Array.from([
                  x,
                  y,
                  x + 900,
                  y,
                  x + 900,
                  y + 900,
                  x,
                  y + 900,
                ]),
                heightDecimetres: 300,
                origin: HEIGHT_ORIGIN.measured,
              },
            ],
          })
        );
        return route.fulfill({
          status: 200,
          contentType: 'application/octet-stream',
          headers: { 'access-control-allow-origin': '*' },
          body,
        });
      }
    );

    await boot(page, `?debug-surface&mode=${mode}&body=earth`);
    await expect(page.locator('#surface-probe')).toContainText('earth', {
      timeout: 30_000,
    });
    // Le mode demandé est bien celui de la scène (sinon le cas Explo rejouerait l'Éduc).
    await expect(
      page.locator(`.mode-btn[data-mode="${mode}"]`)
    ).toHaveAttribute('aria-pressed', 'true');
    // De loin, ni tuile ni légende.
    expect(tileUrls, 'tuiles demandées avant toute approche').toEqual([]);
    await expect(page.locator('.si-buildings')).toBeHidden();

    // Viser Paris par la recherche, comme le ferait un visiteur.
    await page.locator('#body-search-trigger').click();
    await page.locator('#palette-input').fill(city);
    await page.locator('#palette-hit-0').click();

    // Explo : la Terre est la même (rayon 35) mais la caméra descend en vraie échelle ; sur un
    // processeur lent en rendu logiciel (run 40434197609, shard 8) la course d'un seul tenant
    // ne posait aucun bâtiment en 120 s. Même remède que les scénarios de surface : un premier
    // cran, le calme, puis la fin de la course.
    if (mode === 'explo') {
      test.slow();
      await zoomInSettling(page);
    }
    const canvas = page.locator('canvas').first();
    await expect
      .poll(
        async () => {
          await zoomIn(page);
          return canvas.evaluate(
            (c) => (c as HTMLCanvasElement).dataset['buildings'] ?? ''
          );
        },
        { timeout: 120_000, intervals: [2_000] }
      )
      .toMatch(new RegExp(`^${set}:\\d+:[1-9]\\d*$`));

    // L'écran dit d'où viennent les hauteurs et à qui appartiennent les données.
    const line = page.locator('.si-buildings');
    await expect(line).toBeVisible();
    await expect(line).toContainText('3D buildings');
    await expect(line).toContainText('measured');
    for (const piece of credit) await expect(line).toContainText(piece);
    // Une pastille ne porte jamais seule l'information : un libellé la suit.
    expect(await line.locator('.si-swatch').count()).toBeGreaterThan(0);

    // Chaque tuile demandée existe dans le manifeste livré, au zoom du jeu.
    const id = tileOfLonLat(lon, lat, 14);
    await expect
      .poll(
        () =>
          tileUrls.some((u) => {
            const m = /\/14\/(\d+)\/(\d+)\.bin$/.exec(u);
            if (!m) return false;
            // Éduc : la tuile exacte. Explo : la caméra, relevée vers l'horizon, regarde à
            // 1 ou 2 colonnes (~3 km) à l'ouest de la cible (mesuré le 2026-10-27 : tuiles 8297 et
            // 8298 demandées pour 8299) ; on borne cet écart au lieu de le laisser grandir.
            const reach = mode === 'explo' ? 3 : 0;
            return (
              Math.abs(Number(m[1]) - id.column) <= reach &&
              Math.abs(Number(m[2]) - id.row) <= (mode === 'explo' ? 1 : 0)
            );
          }),
        {
          message: 'la tuile sous la visée',
          timeout: 60_000,
          intervals: [1_000],
        }
      )
      .toBe(true);
    expect(quantizeToTile(lon, lat, id)).toHaveLength(2);

    const axe = await new AxeBuilder({ page })
      .include('#surface-imagery')
      .analyze();
    expect(axe.violations, JSON.stringify(axe.violations, null, 2)).toEqual([]);
    expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
  });
}
