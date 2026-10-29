import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  boot,
  HERE,
  prepareSurfacePage,
  TILE_JPEG,
  zoomIn,
  zoomInSettling,
} from './surfaceTiles';

/**
 * L'IMAGERIE DE SURFACE DE LA TERRE (lots 48 et 50) : ses fonds (Blue Marble de GIBS,
 * Sentinel-2 d'EOX par année, relief ombré, lumières nocturnes, jour de VIIRS), son relief
 * ETOPO et le rideau avant/après. Séparée de `surfaceImagery.spec.ts` le 2026-10-15 pour
 * que chaque fichier tienne sur une machine de la CI ; mêmes règles (tuiles SERVIES par le
 * test, un démarrage par scénario).
 */

test.beforeEach(async ({ page }) => {
  await prepareSurfacePage(page);
});

/**
 * LA TERRE, DEPUIS NASA GIBS (lot 48). Ce qui DIFFÈRE de Trek, et que ce scénario tient :
 *
 *   - une grille qui ne double qu'à partir du niveau 3 (`2x1, 3x2, 5x3` puis `10x5…`, tuiles de
 *     512 px, capabilities lues le 2026-10-12) : aucune tuile n'est demandée sous ce niveau, où
 *     la grille déborde du globe et poserait l'image au mauvais endroit ;
 *   - un gabarit sans jeton `{Style}` et en `.jpeg` ;
 *   - une mosaïque d'UN mois (« Blue Marble (August 2004) », métadonnées de la couche), que le
 *     bandeau date.
 */
test('paints the Earth from NASA GIBS, never below its reference level', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const seen: string[] = [];
  await page.route(
    '**gibs.earthdata.nasa.gov/wmts/epsg4326/best/BlueMarble_NextGeneration/**',
    (route) => {
      seen.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: 'image/jpeg',
        headers: { 'access-control-allow-origin': '*' },
        body: TILE_JPEG,
      });
    }
  );

  const viirsSeen: string[] = [];
  await page.route(
    '**gibs.earthdata.nasa.gov/wmts/**VIIRS_SNPP_**',
    (route) => {
      viirsSeen.push(route.request().url());
      return route.abort();
    }
  );

  await boot(page, '?debug-surface&mode=explo&body=earth');
  await expect(page.locator('#surface-probe')).toContainText('earth', {
    timeout: 30_000,
  });
  // Le fond d'arrivée est Sentinel-2 depuis le 2026-10-23 : ce scénario tient la Blue Marble.
  await chooseEarthBase(page, 'mosaic');
  // De loin, le fond d'arrivée montre l'image du jour (`core/farBase.ts`) : la garde porte sur
  // ce qui est demandé APRÈS le choix de la Blue Marble.
  viirsSeen.length = 0;
  await zoomIn(page);
  const badge = page.locator('#surface-imagery');
  await expect(badge).toBeVisible({ timeout: 30_000 });
  expect(seen.length, 'aucune tuile demandée en approche').toBeGreaterThan(0);

  for (const url of seen) {
    const match =
      /\/BlueMarble_NextGeneration\/default\/500m\/(\d+)\/(\d+)\/(\d+)\.jpeg$/.exec(
        url
      );
    expect(match, url).not.toBeNull();
    const [level, row, column] = match!.slice(1).map(Number) as [
      number,
      number,
      number,
    ];
    expect(level, url).toBeGreaterThanOrEqual(3);
    // La matrice du niveau, telle que les capabilities la publient : 10 × 5 au niveau 3.
    const scale = 2 ** (level - 3);
    expect(row, url).toBeLessThan(5 * scale);
    expect(column, url).toBeLessThan(10 * scale);
  }

  await expect(badge.locator('.si-credit')).toContainText('NASA GIBS');
  await expect(badge).toContainText('2004');
  // La couche DATÉE est éteinte par défaut : ni ses jours publiés ni ses tuiles ne sont demandés.
  expect(viirsSeen, 'la couche du jour, éteinte, a été demandée').toEqual([]);
  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
});

/**
 * LE RELIEF DE LA TERRE, SERVI PAR LE SERVICE DE DONNÉES (lot 48). ETOPO 2022 cuit sur la grille de
 * l'imagerie GIBS pèse 562 Mo : ses tuiles vivent sur `galaxy-data.adrianguichard.dev`, pas sur
 * Firebase, et son manifeste sur le site. Ce scénario tient les trois choses qu'aucune capture ne
 * montre : l'ORIGINE demandée, le répertoire HACHÉ du manifeste, et la GRILLE (10 × 5 au niveau 3,
 * jamais en dessous) ; sur la grille de Trek, le même indice tomberait ailleurs sur le globe.
 *
 * Les tuiles sont servies par le test, d'altitude nulle et d'en-tête exact (le décodeur refuse une
 * tuile dont l'en-tête ne nomme pas l'indice demandé) : ce qui est mesuré est la DEMANDE.
 */
function flatHeightTile(
  level: number,
  row: number,
  column: number,
  metres = 0
): Buffer {
  const samples = 257;
  const bytes = Buffer.alloc(32 + samples * samples * 2);
  bytes.fill(0);
  bytes.write('GXHT', 0, 'latin1');
  bytes.writeUInt16LE(1, 4);
  bytes.writeUInt16LE(32, 6);
  bytes.writeUInt16LE(level, 8);
  bytes.writeUInt16LE(row, 10);
  bytes.writeUInt16LE(column, 12);
  bytes.writeUInt16LE(samples, 14);
  bytes.writeDoubleLE(1, 16);
  bytes.writeDoubleLE(0, 24);
  for (let i = 0; i < samples * samples; i += 1)
    bytes.writeInt16LE(metres, 32 + i * 2);
  return bytes;
}

test('raises the Earth from ETOPO relief, asked of the data service on the GIBS grid', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const manifest = JSON.parse(
    readFileSync(
      resolve(HERE, '../public/assets/height-tiles/earth/manifest.json'),
      'utf-8'
    )
  ) as { directory: string; tileOrigin: string };
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
  const asked: string[] = [];
  await page.route('**galaxy-data.adrianguichard.dev/**/*.hgt', (route) => {
    const url = route.request().url();
    asked.push(url);
    const match = /\/(\d+)\/(\d+)\/(\d+)\.hgt$/.exec(url);
    if (!match) return route.abort();
    const [level, row, column] = match.slice(1).map(Number) as [
      number,
      number,
      number,
    ];
    return route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      headers: { 'access-control-allow-origin': '*' },
      body: flatHeightTile(level, row, column),
    });
  });

  await boot(page, '?debug-surface&mode=explo&body=earth');
  await expect(page.locator('#surface-probe')).toContainText('earth', {
    timeout: 30_000,
  });
  // Le fond d'arrivée est Sentinel-2 depuis le 2026-10-23 : ce scénario tient la Blue Marble.
  await chooseEarthBase(page, 'mosaic');
  await zoomInSettling(page);
  const badge = page.locator('#surface-imagery');
  await expect(badge).toHaveAttribute('data-relief', /\d+/, {
    timeout: 30_000,
  });
  await expect(badge.locator('.si-relief')).toContainText('ETOPO 2022');
  await expect(badge.locator('.si-credit')).toContainText('NOAA');

  expect(asked.length, 'aucune tuile de relief demandée').toBeGreaterThan(0);
  for (const url of asked) {
    expect(
      url.startsWith(`${manifest.tileOrigin}/${manifest.directory}/`),
      url
    ).toBe(true);
    const [level, row, column] = /\/(\d+)\/(\d+)\/(\d+)\.hgt$/
      .exec(url)!
      .slice(1)
      .map(Number) as [number, number, number];
    expect(level, url).toBeGreaterThanOrEqual(3);
    const scale = 2 ** (level - 3);
    expect(row, url).toBeLessThan(5 * scale);
    expect(column, url).toBeLessThan(10 * scale);
  }
  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
});

/**
 * LA TERRE DU JOUR DE LA SCÈNE (lot 48) : VIIRS SNPP, un jour par image, sur réglage.
 *
 * Deux affirmations, l'une par scénario, parce qu'aucune ne se voit sur une capture :
 *  1. un jour PUBLIÉ est demandé tel quel, et le bandeau nomme ce jour ;
 *  2. un jour tombé dans un TROU de la dimension n'est JAMAIS demandé : GIBS y rend 404 sans
 *     en-tête CORS (mesuré le 2026-10-12 sur 2022-08-01), et la surface retombe sur la mosaïque.
 *
 * Les jours publiés sont SERVIS PAR LE TEST, dans la forme exacte de la réponse réelle
 * (`src/core/timeDomain.test.ts` en garde une copie), avec un trou délibéré autour du
 * 2022-08-01 comme dans la vraie dimension.
 */
const VIIRS_DOMAINS =
  "<Domains xmlns:ows='http://www.opengis.net/ows/1.1'><DimensionDomain>" +
  '<ows:Identifier>time</ows:Identifier><Domain>2015-11-24/2022-07-27/P1D,' +
  '2022-08-10/2026-10-12/P1D</Domain><Size>2</Size></DimensionDomain></Domains>';

async function serveViirs(page: Page): Promise<{
  domains: string[];
  viirs: string[];
  blueMarble: string[];
}> {
  const seen = {
    domains: [] as string[],
    viirs: [] as string[],
    blueMarble: [] as string[],
  };
  const tile =
    (list: string[]) => (route: import('@playwright/test').Route) => {
      list.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: 'image/jpeg',
        headers: { 'access-control-allow-origin': '*' },
        body: TILE_JPEG,
      });
    };
  await page.route(
    '**gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/VIIRS_SNPP_CorrectedReflectance_TrueColor/**',
    (route) => {
      seen.domains.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: 'text/xml',
        headers: { 'access-control-allow-origin': '*' },
        body: VIIRS_DOMAINS,
      });
    }
  );
  await page.route(
    '**gibs.earthdata.nasa.gov/wmts/epsg4326/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/**',
    tile(seen.viirs)
  );
  await page.route(
    '**gibs.earthdata.nasa.gov/wmts/epsg4326/best/BlueMarble_NextGeneration/**',
    tile(seen.blueMarble)
  );
  return seen;
}

/** Choisit le fond de la Terre par le panneau, comme un visiteur, puis le referme. */
async function chooseEarthBase(page: Page, choice: string): Promise<void> {
  await page.locator('#settings-trigger').click();
  const select = page.locator('#surface-earth-base');
  await expect(select).toBeVisible();
  await select.selectOption(choice);
  await page.keyboard.press('Escape');
  await expect(page.locator('#orbit-options')).toBeHidden();
}

const enableDailyEarth = (page: Page) => chooseEarthBase(page, 'daily');

/**
 * SENTINEL-2 SANS NUAGES D'EOX (lot 48) : le seul fond de la Terre servi sur la grille de TREK
 * (2 × 1 au niveau 0, tuiles de 256 px), quand tout le reste est sur celle de GIBS. Ce scénario
 * tient les deux conséquences qu'aucune capture ne montre : les tuiles demandées à EOX restent
 * dans sa grille publiée (niveaux 5 à 13), et le relief est demandé dans le jeu cuit sur CETTE
 * grille (`earth-trek`), jamais dans celui de GIBS, dont le même indice tomberait ailleurs. Et
 * l'attribution qu'EOX exige est à l'écran.
 */
test('paints Sentinel-2 on the Trek grid, with the relief baked on that grid', async ({
  page,
}) => {
  // Une descente par crans jusqu'au niveau 12 : ses propres attentes dépassent les 120 s par
  // défaut. Mesuré sur un EPYC 7763 : 1,7 min vert (run 38477193311), puis 2,0 et 2,2 min en
  // échec et 1,8 min au second réessai (run 38535537219). L'enveloppe était pleine. Puis
  // 2,1 min en échec sur un EPYC 9V74 (run 38716131843) : la caméra était DÉJÀ au plancher
  // (0,917 km au-dessus du sol), le niveau 11 servi, le 12 encore en vol à 0,7 image par
  // seconde. Le sondage de 60 s ci-dessous était trop court ; il passe à 90 s, et le test à 4 min.
  // Puis, le 2026-10-17, trois échecs au niveau 11 sur les processeurs les plus lents (EPYC 7763
  // du run 39015554287, Xeon 8370C du run 39060671525, 2,9 min chacun), quand les EPYC 9V74
  // passent en 1,4 min : le même code, une enveloppe pleine. Sondage à 150 s, test à 5 min.
  // 420 s depuis le 2026-10-25 : la Terre n'arrive plus en 8k (la table des paliers suit la taille
  // du disque), ces textures partent PENDANT la descente, et les carreaux se posent à une image
  // par image à 1,2 à 1,4 s l'image sur un processeur lent en rendu logiciel : 49 en vol, 13 une
  // minute plus tard (run 40149648877, journal de l'attente de calme). Ce n'est pas un blocage :
  // le badge attend donc 150 s au lieu de 30.
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const trek = JSON.parse(
    readFileSync(
      resolve(HERE, '../public/assets/height-tiles/earth-trek/manifest.json'),
      'utf-8'
    )
  ) as { directory: string };
  const eox: string[] = [];
  await page.route('**tiles.maps.eox.at/**', (route) => {
    eox.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'image/jpeg',
      headers: { 'access-control-allow-origin': '*' },
      body: TILE_JPEG,
    });
  });
  const relief: string[] = [];
  await page.route('**galaxy-data.adrianguichard.dev/**/*.hgt', (route) => {
    const url = route.request().url();
    relief.push(url);
    const [level, row, column] = /\/(\d+)\/(\d+)\/(\d+)\.hgt$/
      .exec(url)!
      .slice(1)
      .map(Number) as [number, number, number];
    return route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      headers: { 'access-control-allow-origin': '*' },
      // Un sol à 5 000 m au-dessus de la sphère de référence : un plancher compté depuis elle
      // mettrait la caméra dessous, et c'est ce que la sonde doit démentir plus bas.
      body: flatHeightTile(level, row, column, 5000),
    });
  });

  // DATÉ (lot 50) : le fond Sentinel-2 montre l'édition de l'année de la scène, donc un
  // démarrage à la date du jour changerait d'édition, et d'attribution, chaque 1er janvier.
  await boot(
    page,
    '?debug-surface&mode=explo&body=earth&date=2024-07-01T12:00:00Z'
  );
  await expect(page.locator('#surface-probe')).toContainText('earth', {
    timeout: 30_000,
  });
  await chooseEarthBase(page, 'sentinel-2');
  await zoomInSettling(page);
  const badge = page.locator('#surface-imagery');
  await expect(badge).toHaveAttribute('data-relief', /\d+/, {
    timeout: 150_000,
  });
  await expect(badge.locator('.si-credit')).toContainText(
    'EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024)'
  );
  expect(eox.length, 'aucune tuile EOX demandée').toBeGreaterThan(0);
  for (const url of eox) {
    const [level, row, column] = /\/WGS84\/(\d+)\/(\d+)\/(\d+)\.jpg$/
      .exec(url)!
      .slice(1)
      .map(Number) as [number, number, number];
    expect(level, url).toBeGreaterThanOrEqual(5);
    expect(level, url).toBeLessThanOrEqual(13);
    expect(row, url).toBeLessThan(2 ** level);
    expect(column, url).toBeLessThan(2 * 2 ** level);
  }
  expect(relief.length, 'aucune tuile de relief demandée').toBeGreaterThan(0);
  for (const url of relief) expect(url, url).toContain(`/${trek.directory}/`);
  // LE PLANCHER SE COMPTE DEPUIS LE SOL (lot 48) : mesuré sur la vraie Terre avant correction, la
  // caméra descendait à 3,2 km SOUS le sol, l'ellipsoïde et le relief dépassant la sphère. Le
  // plancher ne descend qu'à mesure que des niveaux plus fins se peignent : on descend donc par
  // crans, jusqu'au niveau le plus fin, avant de lire la sonde.
  try {
    await expect
      .poll(
        async () => {
          await zoomIn(page);
          return Number((await badge.getAttribute('data-level')) ?? 0);
        },
        { timeout: 150_000, intervals: [1500] }
      )
      // 11 et non 12 : à 0,9 km au-dessus d'un sol à 5 000 m, le niveau servi est le 12 quand le
      // budget de carreaux le permet, et le 11 quand la caméra, tournée vers l'horizon, l'épuise :
      // 61 à 62 carreaux posés sur 64, grossissement de 4,46 px/texel, visée au-dessus de
      // l'Atlantique (sonde imprimée au run 39066233363, Xeon 8370C). En rendu logiciel le budget
      // reste 64 (`ui/surfacePanel.ts`). Ce que protège ce scénario, le plancher compté depuis le
      // SOL, se vérifie juste après (« au-dessus du sol » positif) ; sous le sol, la caméra fautive
      // atteignait le 13.
      .toBeGreaterThanOrEqual(11);
  } catch (error) {
    // Bloqué au niveau 11 sur certains coureurs, quel que soit le temps donné (2026-10-17) : ce
    // que la caméra et le moteur disaient à ce moment, pour diagnostiquer sans rejouer.
    const probe = (await page.locator('#surface-probe').textContent()) ?? '';
    console.log(`[sentinel] ${probe.replace(/\s+/g, ' ').slice(0, 1200)}`);
    throw error;
  }
  await zoomIn(page);
  await expect
    .poll(
      async () => {
        const text = (await page.locator('#surface-probe').textContent()) ?? '';
        const match = /→\s*(-?[\d.]+) km au-dessus du sol/.exec(text);
        return match ? Number(match[1]) : null;
      },
      { timeout: 30_000 }
    )
    .toBeGreaterThan(0);
  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
});

/**
 * LES FONDS DE RECHANGE DE LA TERRE (lot 48) : relief ombré avec bathymétrie, et lumières
 * nocturnes (Black Marble 2016). Chacun est une mosaïque statique de GIBS, sur la grille de Blue
 * Marble ; le scénario tient qu'un choix fait demander SA couche, et rien de la couche du jour.
 */
/**
 * LES ÉDITIONS ANNUELLES (lot 50) : le fond Sentinel-2 montre la mosaïque de l'ANNÉE de la scène,
 * et changer d'année change d'édition ET d'attribution exigée. Le témoin réel est le réservoir de
 * Kakhovka, en eau sur l'édition 2022 et à sec sur celle de 2023 (mesuré chez EOX) ; ici on tient
 * ce que l'application en demande et ce qu'elle affiche.
 */
test('follows the scene’s year from one Sentinel-2 edition to the next', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const eox: string[] = [];
  await page.route('**tiles.maps.eox.at/**', (route) => {
    eox.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'image/jpeg',
      headers: { 'access-control-allow-origin': '*' },
      body: TILE_JPEG,
    });
  });

  await boot(
    page,
    '?debug-surface&mode=explo&body=earth&date=2022-07-01T12:00:00Z'
  );
  await expect(page.locator('#surface-probe')).toContainText('earth', {
    timeout: 30_000,
  });
  await chooseEarthBase(page, 'sentinel-2');
  await zoomIn(page);
  const credit = page.locator('#surface-imagery .si-credit');
  await expect(credit).toHaveText(
    'EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2022)',
    { timeout: 30_000 }
  );
  expect(eox.length, 'aucune tuile EOX demandée').toBeGreaterThan(0);
  for (const url of eox) expect(url).toContain('/s2cloudless-2022/');

  const before = eox.length;
  const input = page.locator('#date-input');
  await input.fill('2023-07-01');
  await input.dispatchEvent('change');
  await expect(credit).toHaveText(
    'EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2023)',
    { timeout: 30_000 }
  );
  // Des tuiles de 2022 peuvent encore partir juste après le saut : la date n'est relue qu'à sa
  // cadence (`DATED_RECHECK_MS`) et l'ancienne génération reste peinte jusqu'à la relève. Une
  // fois l'attribution de 2023 à l'écran, en revanche, plus rien ne se demande à 2022.
  expect(
    eox.slice(before).some((url) => url.includes('/s2cloudless-2023/')),
    'aucune tuile 2023 demandée'
  ).toBe(true);
  const settled = eox.length;
  await zoomIn(page);
  await expect
    .poll(() => eox.length, { timeout: 30_000 })
    .toBeGreaterThan(settled);
  for (const url of eox.slice(settled))
    expect(url).toContain('/s2cloudless-2023/');
  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
});

/**
 * LE RIDEAU AVANT/APRÈS (lot 50, pas 2) : une année comparée à celle de la scène, chaque carreau
 * portant les deux images. Ce scénario tient ce qu'aucune capture ne prouve : les DEUX éditions
 * sont demandées pour les mêmes tuiles, les DEUX attributions exigées sont à l'écran, et la
 * poignée se règle au clavier, dit les deux années et reste entière à l'écran.
 */
test('compares two Sentinel-2 editions across a curtain, with both attributions', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const eox: string[] = [];
  await page.route('**tiles.maps.eox.at/**', (route) => {
    eox.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'image/jpeg',
      headers: { 'access-control-allow-origin': '*' },
      body: TILE_JPEG,
    });
  });

  await boot(
    page,
    '?debug-surface&mode=explo&body=earth&date=2023-07-01T12:00:00Z'
  );
  await expect(page.locator('#surface-probe')).toContainText('earth', {
    timeout: 30_000,
  });
  await page.locator('#settings-trigger').click();
  // Le choix d'année n'existe qu'avec le fond Sentinel-2, la seule série d'éditions : il est là
  // d'emblée puisque c'est le fond d'arrivée, et disparaît avec la Blue Marble.
  await expect(page.locator('#surface-earth-compare')).toBeVisible();
  await page.locator('#surface-earth-base').selectOption('mosaic');
  await expect(page.locator('#surface-earth-compare')).toBeHidden();
  await page.locator('#surface-earth-base').selectOption('sentinel-2');
  await page.locator('#surface-earth-compare').selectOption('2022');
  await page.keyboard.press('Escape');
  await expect(page.locator('#orbit-options')).toBeHidden();
  await zoomIn(page);

  const handle = page.locator('#surface-compare .sc-handle');
  await expect(handle).toBeVisible({ timeout: 30_000 });
  await expect(handle).toHaveAttribute('aria-valuetext', /2022.*2023/);
  const credit = page.locator('#surface-imagery .si-credit');
  await expect(credit).toContainText('Copernicus Sentinel data 2023)');
  await expect(credit).toContainText('Copernicus Sentinel data 2022)');
  await expect(page.locator('#surface-imagery .si-compare')).toContainText(
    'cloudless 2022'
  );
  // Les MÊMES tuiles, demandées aux deux éditions.
  const tiles = (year: number) =>
    new Set(
      eox
        .filter((url) => url.includes(`/s2cloudless-${year}/`))
        .map((url) => /\/WGS84\/(.*)\.jpg$/.exec(url)![1])
    );
  const before = tiles(2022);
  expect(before.size).toBeGreaterThan(0);
  for (const tile of before) expect(tiles(2023).has(tile), tile).toBe(true);

  await handle.focus();
  await expect(handle).toHaveAttribute('aria-valuenow', '50');
  await page.keyboard.press('ArrowLeft');
  await expect(handle).toHaveAttribute('aria-valuenow', '45');
  await page.keyboard.press('End');
  await expect(handle).toHaveAttribute('aria-valuenow', '100');
  // La poignée reste ENTIÈRE à l'écran au bout de sa course (elle sortait de moitié).
  const viewport = page.viewportSize()!;
  const end = (await handle.boundingBox())!;
  expect(end.x + end.width).toBeLessThanOrEqual(viewport.width);
  await page.keyboard.press('Home');
  const start = (await handle.boundingBox())!;
  expect(start.x).toBeGreaterThanOrEqual(0);

  const audit = await new AxeBuilder({ page })
    .include('#surface-compare')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(audit.violations, JSON.stringify(audit.violations, null, 2)).toEqual(
    []
  );

  // Retirer la comparaison n'est PAS rejoué ici : rouvrir les réglages au-dessus de carreaux
  // portant deux images figeait le thread du coureur au clic (« performing click action »,
  // run 38708567048, EPYC 7763), et la relève sans rideau est tenue par le test du moteur
  // (« retirer la comparaison ouvre une génération sans rideau »).
  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
});

test.describe('the Earth’s alternate grounds', () => {
  for (const [choice, layer, extension] of [
    [
      'shaded-relief',
      'BlueMarble_ShadedRelief_Bathymetry/default/500m',
      'jpeg',
    ],
    ['night-lights', 'VIIRS_Black_Marble/default/2016-01-01/500m', 'png'],
  ] as const) {
    test(`paints ${choice} once chosen`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(err.message));
      const asked: string[] = [];
      const viirs: string[] = [];
      await page.route('**gibs.earthdata.nasa.gov/wmts/**', (route) => {
        const url = route.request().url();
        if (url.includes('VIIRS_SNPP_')) viirs.push(url);
        if (url.includes(`/${layer}/`)) asked.push(url);
        return route.fulfill({
          status: 200,
          contentType: 'image/jpeg',
          headers: { 'access-control-allow-origin': '*' },
          body: TILE_JPEG,
        });
      });
      await boot(page, '?debug-surface&mode=explo&body=earth');
      await expect(page.locator('#surface-probe')).toContainText('earth', {
        timeout: 30_000,
      });
      await chooseEarthBase(page, choice);
      // De loin, le fond d'arrivée montre l'image du jour (`core/farBase.ts`) : ce qui a été
      // demandé AVANT le choix ne compte pas, la garde porte sur ce qui suit.
      viirs.length = 0;
      await zoomIn(page);
      await expect(page.locator('#surface-imagery')).toBeVisible({
        timeout: 30_000,
      });
      await expect
        .poll(() => asked.length, { timeout: 30_000 })
        .toBeGreaterThan(0);
      for (const url of asked)
        expect(url, url).toMatch(
          new RegExp('/' + String.raw`\d+/\d+/\d+\.` + extension + '$')
        );
      expect(viirs, 'la couche du jour, non choisie, a été demandée').toEqual(
        []
      );
      expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
    });
  }
});

/**
 * LE FOND DE LOIN (2026-10-23) : sans rien toucher au réglage, la Terre vue de loin se peint dans
 * l'image du JOUR de la scène, et le réglage continue d'afficher Sentinel-2. Le scénario compte
 * aussi qu'aucune tuile Sentinel-2 ne parte de si loin.
 */
test('shows the day’s VIIRS from afar while the setting still says Sentinel-2', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const seen = await serveViirs(page);
  const eox: string[] = [];
  await page.route('**tiles.maps.eox.at/**', (route) => {
    eox.push(route.request().url());
    return route.abort();
  });

  await boot(
    page,
    '?debug-surface&mode=explo&body=earth&date=2026-10-11T12:00:00Z'
  );
  await expect(page.locator('#surface-probe')).toContainText('earth', {
    timeout: 30_000,
  });
  // Un cran modéré, mesuré : -4000 amène la caméra à 1,66 rayon, où l'imagerie est demandée et
  // où le fond de loin règne encore (`core/farBase.ts`). -3600 s'arrête à 1,92 rayon sans rien
  // demander, -4400 à 1,44, -5200 au plancher de la texture livrée. En deux temps depuis le
  // 2026-10-25 : -3300 (le 8k se pose dans le calme), puis -700, soit -4000 en tout.
  await zoomInSettling(page, -700);
  const badge = page.locator('#surface-imagery');
  await expect(badge).toHaveAttribute('data-day', '2026-10-11', {
    timeout: 60_000,
  });
  expect(seen.viirs.length, 'aucune tuile VIIRS demandée').toBeGreaterThan(0);
  expect(eox, 'Sentinel-2 demandé de trop loin').toEqual([]);
  // Le clic final tombait dans le travail de la scène sur un runner lent (Xeon 8370C, run
  // 40729356516 : « waiting for element to be visible, enabled and stable » 3 fois sur 3, 15 s).
  // Ni `click()` (il attend un bouton « stable », donc plusieurs images fluides) ni l'attente du
  // calme (elle mesure des images par `requestAnimationFrame`) ne reviennent sur un runner lent
  // en rendu logiciel : EPYC 7763, runs 40803413715 et 40805652678 (ce dernier sur `d4d2a64f`,
  // antérieur aux calques), puis Xeon 8370C, run 40812587060, 120 s à chaque fois. Ce scénario
  // vérifie la valeur du réglage, pas la géométrie du bouton ni la fluidité : le clic est donc
  // ENVOYÉ à l'élément, sans rien attendre de la scène.
  await page.locator('#settings-trigger').dispatchEvent('click');
  await expect(page.locator('#surface-earth-base')).toHaveValue('sentinel-2', {
    timeout: 60_000,
  });
  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
});

test('paints the Earth of the scene’s day from VIIRS, and names that day', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const seen = await serveViirs(page);

  await boot(
    page,
    '?debug-surface&mode=explo&body=earth&date=2026-10-11T12:00:00Z'
  );
  await expect(page.locator('#surface-probe')).toContainText('earth', {
    timeout: 30_000,
  });
  await enableDailyEarth(page);
  await zoomIn(page);

  const badge = page.locator('#surface-imagery');
  await expect(badge).toHaveAttribute('data-day', '2026-10-11', {
    timeout: 30_000,
  });
  expect(seen.domains.length, 'jours publiés jamais lus').toBeGreaterThan(0);
  expect(seen.domains[0]).toMatch(/\/default\/250m\/all\/all\.xml$/);
  expect(seen.viirs.length, 'aucune tuile VIIRS demandée').toBeGreaterThan(0);
  for (const url of seen.viirs)
    expect(url).toMatch(
      /\/VIIRS_SNPP_CorrectedReflectance_TrueColor\/default\/2026-10-11\/250m\/\d+\/\d+\/\d+\.jpeg$/
    );
  await expect(badge).toContainText('October 11, 2026');
  await expect(badge.locator('.si-credit')).toContainText('Suomi NPP VIIRS');
  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
});

test('never asks VIIRS for an Earth day in a gap of its dimension, and falls back on Blue Marble', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const seen = await serveViirs(page);

  await boot(
    page,
    '?debug-surface&mode=explo&body=earth&date=2022-08-01T12:00:00Z'
  );
  await expect(page.locator('#surface-probe')).toContainText('earth', {
    timeout: 30_000,
  });
  await enableDailyEarth(page);
  await zoomIn(page);

  const badge = page.locator('#surface-imagery');
  await expect(badge).toBeVisible({ timeout: 30_000 });
  // La dimension a bien été LUE : sans cela, le repli prouverait seulement qu'elle manquait.
  await expect.poll(() => seen.domains.length).toBeGreaterThan(0);
  await expect(badge).toContainText('2004');
  await expect(badge).not.toHaveAttribute('data-day', /.+/);
  expect(seen.blueMarble.length).toBeGreaterThan(0);
  expect(
    seen.viirs,
    'un jour hors dimension a été demandé (404 sans CORS chez GIBS)'
  ).toEqual([]);
  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
});
