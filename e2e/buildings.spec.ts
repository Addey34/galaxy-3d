import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  encodeBuildingTile,
  HEIGHT_ORIGIN,
  quantizeToTile,
  tileOfLonLat,
} from '@/core/buildingTile';
import { boot, prepareSurfacePage, TILE_JPEG, zoomIn } from './surfaceTiles';

/**
 * LES BÂTIMENTS 3D DE PARIS (lot 63, C.3b et C.4) : ce que l'application demande et quand, ce
 * qu'elle pose, et surtout ce que l'ÉCRAN dit : la légende des origines de hauteur et l'attribution
 * de la licence du jeu, sans quoi on afficherait des données de l'IGN sans les nommer.
 *
 * L'index et le manifeste sont les VRAIS fichiers livrés (`public/assets/buildings/`). Les tuiles,
 * elles, sont SERVIES PAR LE TEST (une tuile `GXBD` d'un bâtiment, au centre de l'indice demandé) :
 * la mesure ne dépend ni du service de données ni de fichiers absents de git.
 */

/**
 * LA TRACE d'un échec : la caméra et les bâtiments à chaque pas du sondage, les tuiles demandées, l'état
 * de la page. Le cas Explo a été rouge en CI (run 40434197609, 40440698086) sans qu'aucun artefact dise
 * où était la caméra ; les artefacts ne gardent que les essais en échec.
 */
let trace: {
  at: number;
  zoomMs: number;
  probeMs: number;
  longTasks: number;
  longTaskMs: number;
  frames: number;
  probe: string;
  buildings: string;
}[] = [];
let requestedTiles: string[] = [];

test.beforeEach(async ({ page }) => {
  trace = [];
  requestedTiles = [];
  await prepareSurfacePage(page);
  // Ce que fait le fil principal PENDANT la descente : blocages de plus de 50 ms et images
  // dessinées (compteur de rAF), pour distinguer une scène lourde d'une page arrêtée.
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, number>;
    w['__lt'] = 0;
    w['__ltMs'] = 0;
    w['__frames'] = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        w['__lt'] = (w['__lt'] ?? 0) + 1;
        w['__ltMs'] = (w['__ltMs'] ?? 0) + e.duration;
      }
    }).observe({ type: 'longtask' });
    const tick = () => {
      w['__frames'] = (w['__frames'] ?? 0) + 1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
});

test.afterEach(async ({ page }, testInfo) => {
  const state = await page
    .evaluate(() => ({
      visibility: document.visibilityState,
      focus: document.hasFocus(),
      url: location.pathname + location.search,
    }))
    .catch(() => 'page fermée');
  // Un FICHIER dans le dossier de sortie du test : c'est ce que la CI téléverse pour un essai en
  // échec (une pièce jointe passée en mémoire n'y est pas écrite).
  const file = testInfo.outputPath('camera-trace.json');
  writeFileSync(
    file,
    JSON.stringify({ state, requestedTiles, trace }, null, 2)
  );
  await testInfo.attach('camera-trace.json', {
    path: file,
    contentType: 'application/json',
  });
});

/** Un jeu de bâtiments livré : la ville visée, son identifiant, un point sous la visée, son crédit. */
const CITIES: {
  city: string;
  set: string;
  lon: number;
  lat: number;
  credit: string[];
  mode?: 'educ' | 'explo';
  /** Le nom de la ville désigne aussi un lieu d'un autre corps : on part du bouton de la fiche. */
  viaCitiesBlock?: boolean;
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
  {
    city: 'Amsterdam',
    set: 'amsterdam-3dbag',
    lon: 4.8936,
    lat: 52.3731,
    credit: ['3DBAG by tudelft3d and 3DGI', 'CC BY 4.0'],
    // « Amsterdam » est aussi un lieu de Mars : le premier résultat de la palette n'est pas la Terre.
    viaCitiesBlock: true,
  },
  {
    city: 'New York',
    set: 'newyork-opendata',
    lon: -73.9855,
    lat: 40.758,
    credit: ['NYC Open Data', 'City of New York'],
  },
];

/**
 * La tuile que le test sert : un bâtiment au centre de l'indice demandé, mesuré à 30 m ; le
 * décodeur refuse une tuile dont l'en-tête ne nomme pas l'indice demandé.
 */
function servedBuildingTile(zoom: number, column: number, row: number): Buffer {
  const [x, y] = [32768, 32768];
  return Buffer.from(
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
}

/** L'adresse de crédit que l'attribution d'un jeu rend cliquable, quand il en porte une. */
const CREDIT_LINKS: Record<string, string> = {
  'nairobi-overture': 'https://opendatacommons.org/licenses/odbl/1-0/',
  'amsterdam-3dbag': 'https://docs.3dbag.nl/en/copyright',
  'newyork-opendata':
    'https://data.cityofnewyork.us/City-Government/Building/5zhs-2jue',
};

for (const {
  city,
  set,
  lon,
  lat,
  credit,
  mode = 'educ',
  viaCitiesBlock = false,
} of CITIES) {
  test(`draws the buildings of ${city} in ${mode} mode, says where their heights come from, and asks for nothing from afar`, async ({
    page,
  }) => {
    // Explo, rendu logiciel d'un petit runner : la descente finale bloque le fil principal bien
    // au-delà des ~10 s de l'Éduc (traces des runs 40463167127 et 40465715865 : un seul échantillon
    // en 120 s). Le sondage et le test reçoivent le temps que la mesure demande, rien de plus.
    const slow = mode === 'explo';
    if (slow) test.setTimeout(480_000);
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
        const body = servedBuildingTile(zoom, column, row);
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

    if (viaCitiesBlock) {
      // Le bouton de la fiche de la Terre, comme le ferait un visiteur qui y cherche la ville.
      await page.locator('.bi-city', { hasText: city }).click();
    } else {
      // Viser la ville par la recherche, comme le ferait un visiteur.
      await page.locator('#body-search-trigger').click();
      await page.locator('#palette-input').fill(city);
      await page.locator('#palette-hit-0').click();
    }

    const canvas = page.locator('canvas').first();
    await expect
      .poll(
        async () => {
          const t0 = Date.now();
          // La descente bloque parfois le fil principal de la page plus longtemps que le délai
          // d'une action (15 s : `locator.boundingBox`, run 40467972055, premier essai). Une
          // exception levée ICI termine le sondage ; un délai n'est que « pas encore ».
          let buildings: string;
          let zoomMs: number;
          try {
            await zoomIn(page);
            zoomMs = Date.now() - t0;
            buildings = await canvas.evaluate(
              (c) => (c as HTMLCanvasElement).dataset['buildings'] ?? ''
            );
          } catch (error) {
            if (!(error instanceof Error) || error.name !== 'TimeoutError')
              throw error;
            trace.push({
              at: Date.now(),
              zoomMs: Date.now() - t0,
              probeMs: 0,
              longTasks: -1,
              longTaskMs: -1,
              frames: -1,
              probe: 'page occupée (délai de la molette)',
              buildings: '',
            });
            return '';
          }
          const t1 = Date.now();
          const probe = await page
            .locator('#surface-probe')
            .innerText({ timeout: 20_000 })
            .catch(() => 'sonde absente');
          const probeMs = Date.now() - t1;
          const main = await page
            .evaluate(() => {
              const w = window as unknown as Record<string, number>;
              return {
                longTasks: w['__lt'] ?? 0,
                longTaskMs: Math.round(w['__ltMs'] ?? 0),
                frames: w['__frames'] ?? 0,
              };
            })
            .catch(() => ({ longTasks: -1, longTaskMs: -1, frames: -1 }));
          trace.push({
            at: Date.now(),
            zoomMs,
            probeMs,
            ...main,
            probe: probe.split(/\s+/).join(' ').slice(0, 400),
            buildings,
          });
          requestedTiles = tileUrls.map((u) =>
            u.split('/').slice(-3).join('/')
          );
          return buildings;
        },
        { timeout: slow ? 300_000 : 120_000, intervals: [2_000] }
      )
      .toMatch(new RegExp(`^${set}:\\d+:[1-9]\\d*$`));

    // L'écran dit d'où viennent les hauteurs et à qui appartiennent les données.
    const line = page.locator('.si-buildings');
    await expect(line).toBeVisible();
    await expect(line).toContainText('3D buildings');
    await expect(line).toContainText('measured');
    for (const piece of credit) await expect(line).toContainText(piece);
    // Une adresse de crédit dans l'attribution (licence, page de la source) est un lien sûr, pas du
    // texte à recopier.
    if (CREDIT_LINKS[set]) {
      const link = line.locator('.si-buildings-credit a');
      await expect(link).toHaveAttribute('href', CREDIT_LINKS[set]);
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
    // Une pastille ne porte jamais seule l'information : un libellé la suit.
    expect(await line.locator('.si-swatch').count()).toBeGreaterThan(0);

    // Chaque tuile demandée existe dans le manifeste livré, au zoom du jeu.
    const id = tileOfLonLat(lon, lat, 14);
    expect(
      tileUrls.some((u) => u.endsWith(`/14/${id.column}/${id.row}.bin`)),
      'la tuile sous la visée'
    ).toBe(true);
    expect(quantizeToTile(lon, lat, id)).toHaveLength(2);

    const axe = await new AxeBuilder({ page })
      .include('#surface-imagery')
      .analyze();
    expect(axe.violations, JSON.stringify(axe.violations, null, 2)).toEqual([]);
    expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
  });
}

/**
 * LA RÉCUPÉRATION D'UNE PANNE PASSAGÈRE (GAL-A002) : chaque tuile répond d'abord 503 avec
 * `Retry-After: 4`, puis une tuile valide, SANS recharger la page. On prouve par les requêtes
 * (l'instrumentation de démarrage ne publie pas `retrying`) :
 *  - aucune nouvelle demande avant l'échéance (4 s après la RÉPONSE 503, pas après le début de la
 *    première demande),
 *  - au plus deux demandes par tuile (une panne, une reprise : pas de tempête),
 *  - les bâtiments finissent à l'écran, sans erreur de page.
 * La réponse interceptée est d'une autre origine que la page : elle porte donc
 * `Access-Control-Allow-Origin` ET `Access-Control-Expose-Headers: Retry-After`, sans quoi le
 * navigateur masquerait l'en-tête (dépendance du Caddyfile de `galaxy-data`, voir
 * `parseRetryAfter`). Le retard exponentiel initial est de 2 s : un délai de 4 s ne peut venir que
 * de la lecture de l'en-tête, ce qui distingue ce test d'un simple repli sur le retard.
 */
test('recovers from a transient 503 on its tiles without a reload, never asking before Retry-After', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  // Le navigateur journalise lui-même chaque 503 attendu. Les autres ressources de la scène
  // (hauteurs, GIBS WMS) ne sont pas servies par ce test et échouent hors sujet : on ne juge que
  // les ressources de BÂTIMENTS, dont toute erreur autre que le 503 prévu (CORS compris) compte.
  page.on('console', (msg) => {
    if (
      msg.type() === 'error' &&
      msg.location().url.includes('/assets/buildings/') &&
      !/status of 503/.test(msg.text())
    )
      errors.push(`console : ${msg.text()} ${msg.location().url}`);
  });
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
  const RETRY_AFTER_S = 4;
  /** Par tuile : l'instant de chaque demande et celui où la réponse 503 est PARTIE (ms). */
  const asked = new Map<string, { at: number[]; answeredAt: number | null }>();
  await page.route(
    '**galaxy-data.adrianguichard.dev/assets/buildings/**',
    async (route) => {
      const url = route.request().url();
      const m = /\/(\d+)\/(\d+)\/(\d+)\.bin$/.exec(url);
      if (!m) return route.fulfill({ status: 404, body: 'x' });
      const key = m.slice(1).join('/');
      const entry = asked.get(key) ?? { at: [], answeredAt: null };
      entry.at.push(Date.now());
      asked.set(key, entry);
      const cors = {
        'access-control-allow-origin': '*',
        'access-control-expose-headers': 'Retry-After',
      };
      if (entry.at.length === 1) {
        await route.fulfill({
          status: 503,
          headers: { ...cors, 'retry-after': String(RETRY_AFTER_S) },
          body: '',
        });
        entry.answeredAt = Date.now();
        return;
      }
      const [zoom, column, row] = m.slice(1).map(Number) as [
        number,
        number,
        number,
      ];
      return route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        headers: cors,
        body: servedBuildingTile(zoom, column, row),
      });
    }
  );

  await boot(page, '?debug-surface&mode=educ&body=earth');
  await expect(page.locator('#surface-probe')).toContainText('earth', {
    timeout: 30_000,
  });
  await page.locator('#body-search-trigger').click();
  await page.locator('#palette-input').fill('Paris');
  await page.locator('#palette-hit-0').click();

  const canvas = page.locator('canvas').first();
  await expect
    .poll(
      async () => {
        try {
          await zoomIn(page);
          return await canvas.evaluate(
            (c) => (c as HTMLCanvasElement).dataset['buildings'] ?? ''
          );
        } catch (error) {
          if (!(error instanceof Error) || error.name !== 'TimeoutError')
            throw error;
          return '';
        }
      },
      { timeout: 150_000, intervals: [2_000] }
    )
    .toMatch(/^paris-bdtopo:\d+:[1-9]\d*$/);
  await expect(page.locator('.si-buildings')).toBeVisible();

  const entries = [...asked.entries()];
  expect(entries.length, 'tuiles demandées').toBeGreaterThan(0);
  // Pas de tempête : une panne puis une reprise, jamais plus de deux demandes par tuile.
  for (const [key, { at }] of entries)
    expect(at.length, `demandes de la tuile ${key}`).toBeLessThanOrEqual(2);
  // Au moins une tuile a vraiment vécu panne PUIS reprise, et aucune n'a été redemandée avant
  // l'échéance du serveur.
  const recovered = entries.filter(([, { at }]) => at.length === 2);
  expect(recovered.length, 'tuiles reprises après panne').toBeGreaterThan(0);
  for (const [key, { at, answeredAt }] of recovered) {
    expect(answeredAt, `réponse 503 de ${key}`).not.toBeNull();
    // Depuis la RÉPONSE 503 (partie du test), pas depuis le début de la première demande.
    expect(
      at[1]! - answeredAt!,
      `délai entre la réponse 503 et la reprise de ${key}`
    ).toBeGreaterThanOrEqual(RETRY_AFTER_S * 1000);
  }
  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
});
