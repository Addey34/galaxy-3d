import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type Request } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { blockExternalNetwork } from './netBlock';

/**
 * L'IMAGERIE DE SURFACE STREAMÉE : ce qu'elle demande, quand, et ce qu'elle peint.
 *
 * Trois affirmations, et aucune n'est vérifiable ailleurs qu'ici :
 *  1. au démarrage, et tant qu'aucun corps n'est approché de près, RIEN n'est demandé ;
 *  2. en descendant sur la Lune, des carreaux sont peints, le bandeau dit ce qui est servi,
 *     et le plancher d'approche SUIT cette nouvelle finesse (1,0737 rayon sans les tuiles,
 *     environ 1,005 avec le niveau 8) ;
 *  3. le réglage éteint, aucune requête n'est émise, même en bas de la descente.
 *
 * Les tuiles sont SERVIES PAR LE TEST, pas par Trek : la mesure ne doit dépendre ni du réseau
 * ni de la disponibilité d'un service tiers, et `e2e/netBlock.ts` coupe cet hôte partout
 * ailleurs. Le gabarit des adresses, lui, est tenu par `src/core/tileUrl.test.ts` contre une
 * adresse réellement mesurée.
 *
 * Un seul démarrage par test : chacun coûte de trente à soixante secondes sur le GPU logiciel
 * de la CI (leçon du shard 4 de la phase 9B).
 */

/**
 * Tuile de test : JPEG 256 x 256 uni, 651 octets, produit par sharp.
 *
 * Un VRAI decodage est exige (`createImageBitmap`), donc une image bricolee a la main ne
 * suffit pas : mesure le 2026-09-21, un PNG 2x2 mal forme rendait
 * « InvalidStateError: The source image could not be decoded » et aucun carreau ne se
 * posait, sans qu'aucune erreur de page ne le dise.
 */
/** Racine du dépôt vue depuis ce fichier : les specs sont des modules ES, sans `__dirname`. */
const HERE = dirname(fileURLToPath(import.meta.url));

const TILE_JPEG = Buffer.from(
  '/9j/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRk' +
    'xOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09P' +
    'T09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAEAAQADASIAAhEBAxEB/8QAFQABAQ' +
    'AAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAA' +
    'AAAAAAL/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCuAlQAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//Z',
  'base64'
);

async function serveTiles(page: Page): Promise<Request[]> {
  const seen: Request[] = [];
  await page.route('**trek.nasa.gov/**', (route) => {
    seen.push(route.request());
    return route.fulfill({
      status: 200,
      contentType: 'image/jpeg',
      headers: { 'access-control-allow-origin': '*' },
      body: TILE_JPEG,
    });
  });
  return seen;
}

async function boot(page: Page, query: string): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
}

/** Un cran de molette très ample : OrbitControls met la distance à l'échelle `0,95^(…)`. */
async function zoomIn(page: Page, delta = -12_000): Promise<void> {
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('canvas absent');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, delta);
}

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

test('asks for nothing at boot, nor from a distance', async ({ page }) => {
  const seen = await serveTiles(page);
  await boot(page, '?mode=explo');
  // La vue d'ensemble : aucun corps suivi, donc rien à recouvrir.
  await page.waitForTimeout(2000);
  expect(seen, 'requêtes de tuiles au démarrage').toHaveLength(0);

  // La LUNE, sélectionnée mais cadrée de loin : elle A un jeu de tuiles, et elle ne doit
  // toujours rien demander. Le cadrage par défaut la place à 7,00 rayons (mesuré), donc
  // au-dessus des 6 rayons sous lesquels le moteur travaille.
  //
  // Prendre ici un corps SANS jeu de tuiles (Jupiter, première version de ce test) ne prouvait
  // rien : il passait encore avec les deux gardes de distance grands ouverts, puisqu'il n'y
  // avait de toute façon aucune fiche à servir. Falsifié, corrigé.
  await page.goto('/?mode=explo&body=moon');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  await page.waitForTimeout(3000);
  expect(seen, 'requêtes de tuiles sans approche').toHaveLength(0);
  await expect(page.locator('#surface-imagery')).toBeHidden();
});

test('paints tiles on the Moon, says what it serves, and lowers the floor', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const seen = await serveTiles(page);

  await boot(page, '?debug-surface&mode=explo&body=moon');
  const probe = page.locator('#surface-probe');
  await expect(probe).toContainText('moon', { timeout: 30_000 });

  // Première descente : elle bute sur le plancher de la texture LIVRÉE (1,0737 rayon, 128 km),
  // parce que la descente ne s'ouvre qu'une fois un carreau réellement PEINT — une fiche seule
  // ne suffit pas à promettre un sol qu'un service en panne ne servira pas.
  await zoomIn(page);
  const badge = page.locator('#surface-imagery');
  await expect(badge).toBeVisible({ timeout: 30_000 });
  expect(seen.length, 'aucune tuile demandée en approche').toBeGreaterThan(0);

  // Toutes les adresses demandées sont celles de la couche déclarée par la fiche, au format
  // `{niveau}/{ligne}/{colonne}.jpg`. Une adresse mal formée partirait quand même : c'est
  // `core/tileUrl.ts` qui refuse, et on vérifie ici que ce refus n'a pas été contourné.
  for (const request of seen) {
    expect(request.url()).toContain(
      '/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0//default/default028mm/'
    );
    expect(request.url()).toMatch(/\/\d+\/\d+\/\d+\.jpg$/);
  }

  // Le bandeau ne s'affiche que si des carreaux sont PEINTS, et il annonce la finesse servie.
  await expect(badge).toHaveAttribute('data-painted', /[1-9]\d*/);
  await expect(badge.locator('.si-headline')).toContainText('LRO WAC Mosaic');
  await expect(badge.locator('.si-detail')).toContainText('observed');
  await expect(badge.locator('.si-credit')).toContainText('NASA');
  // Seconde descente : le plancher a été REPOSÉ d'après la finesse que la source rend
  // atteignable, une fois un carreau peint. Sans le rappel à `CameraSystem`, qui ne pose ses
  // bornes qu'à la sélection, la valeur resterait bloquée à 1,0737 — silencieusement.
  await zoomIn(page);
  await page.waitForTimeout(3000);

  // En bas de la descente, c'est le niveau maximal de la fiche qui est servi : 131 072 px sur
  // 360°, soit 83 m/px sur la Lune, seize fois la texture 8k livrée.
  await expect(badge).toHaveAttribute('data-width', '131072', {
    timeout: 30_000,
  });
  // Et il le DIT : ce niveau agrandit la mosaïque publiée à 303 px/degré.
  await expect(badge.locator('.si-detail')).toContainText('larger than');
  await expect(badge.locator('.si-headline')).toContainText('83 m/pixel');

  // Le plancher a suivi cette finesse : 1,0046 rayon, soit 8,0 km, contre 1,0737 (128 km) avec
  // la seule texture livrée.
  const text = (await probe.textContent()) ?? '';
  const radii = Number(/\(([\d.]+) R\)/.exec(text)?.[1]);
  expect(
    radii,
    'le plancher n’a pas suivi la finesse des carreaux'
  ).toBeLessThan(1.01);
  expect(radii).toBeGreaterThan(1.001);
  // Et le corps est toujours dessiné en bas : le plan proche reste derrière la surface.
  expect(text).not.toContain('COUPE LE CORPS');

  // Une fois en bas ET la file vidée, rien ne bouge : le nombre de requêtes est STABLE. La
  // première version redemandait la couverture entière à chaque image (47 tuiles par seconde,
  // mesuré). On laisse d'abord la couverture finir d'arriver — six requêtes à la fois — puis
  // on compare deux relevés espacés.
  await page.waitForTimeout(4000);
  const settled = seen.length;
  await page.waitForTimeout(4000);
  expect(
    seen.length,
    'des tuiles sont redemandées alors que la caméra ne bouge pas'
  ).toBe(settled);

  // Le bandeau est du texte NOUVEAU à l'écran : il passe axe comme les autres surfaces, au
  // socle normatif habituel, et d'abord sur un écran large.
  const wide = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(wide.violations, JSON.stringify(wide.violations, null, 2)).toEqual([]);

  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
});

/**
 * MARS, AJOUTÉE PAR UNE FICHE ET RIEN D'AUTRE (lot 9, phase 9E).
 *
 * C'est la preuve de généricité du moteur : aucun fichier de `src/components/surface/`, de
 * `src/core/tile*.ts` ni `src/ui/surfacePanel.ts` n'a changé pour ce corps. Ce que ce scénario
 * ajoute à celui de la Lune, c'est tout ce qui DIFFÈRE, parce qu'un moteur qui aurait la Lune
 * câblée quelque part s'y trahirait : une autre couche, un autre hôte de chemin, un niveau
 * maximal de 7 et non 8, et un niveau qui reste PLUS GROSSIER que la mosaïque publiée, donc un
 * bandeau qui se tait sur l'agrandissement au lieu de l'annoncer.
 */
test('paints Mars from a tile set record alone, with no engine change', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const seen = await serveTiles(page);

  await boot(page, '?debug-surface&mode=explo&body=mars');
  const probe = page.locator('#surface-probe');
  await expect(probe).toContainText('mars', { timeout: 30_000 });

  await zoomIn(page);
  const badge = page.locator('#surface-imagery');
  await expect(badge).toBeVisible({ timeout: 30_000 });
  expect(seen.length, 'aucune tuile demandée en approche').toBeGreaterThan(0);

  for (const request of seen) {
    expect(request.url()).toContain(
      '/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0//default/default028mm/'
    );
    expect(request.url()).toMatch(/\/\d+\/\d+\/\d+\.jpg$/);
  }

  await zoomIn(page);
  await page.waitForTimeout(3000);

  // Niveau 7, soit 65 536 px sur 360° : huit fois la texture 8k livrée, et le maximum que Trek
  // publie pour CETTE couche (le niveau 8 y répond 404, mesuré le 2026-09-21).
  await expect(badge).toHaveAttribute('data-width', '65536', {
    timeout: 30_000,
  });
  await expect(badge.locator('.si-headline')).toContainText(
    'Viking Colorized Global Mosaic'
  );
  await expect(badge.locator('.si-headline')).toContainText('325 m/pixel');
  await expect(badge.locator('.si-detail')).toContainText(
    'images from June 1976 to August 1980'
  );
  await expect(badge.locator('.si-detail')).toContainText('observed');
  // LA DIFFÉRENCE AVEC LA LUNE : 182 px/degré servis contre 256 publiés. Le bandeau ne parle
  // d'agrandissement que lorsqu'il y en a un, sans quoi il annoncerait une finesse absente.
  await expect(badge.locator('.si-detail')).not.toContainText('larger than');
  await expect(badge.locator('.si-credit')).toContainText('NASA');

  // Le plancher a suivi : 1,0092 rayon, soit 31,2 km, contre 1,0737 (249,7 km) avec la seule
  // texture livrée. La formule de 9B n'a pas changé, seule sa largeur d'entrée a changé.
  const text = (await probe.textContent()) ?? '';
  const radii = Number(/\(([\d.]+) R\)/.exec(text)?.[1]);
  expect(
    radii,
    'le plancher n’a pas suivi la finesse des carreaux'
  ).toBeLessThan(1.011);
  expect(radii).toBeGreaterThan(1.005);
  expect(text).not.toContain('COUPE LE CORPS');

  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
});

/**
 * UN TÉLÉPHONE OUVERT DIRECTEMENT À 390 PX, et pas une fenêtre de bureau rétrécie après coup.
 *
 * La première forme de cette garde redimensionnait la page de 1280 à 390 px une fois le
 * bandeau affiché : le dock s'y plaçait autrement que sur un vrai téléphone, et la garde
 * restait verte avec le défaut réintroduit (falsifié). Vu en production à 390 px d'emblée :
 * le sélecteur Éduc/Explo, empilé en colonne, cachait la ligne de crédit du bandeau.
 */
test('the provenance badge fits a phone screen and hides nothing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await serveTiles(page);
  await boot(page, '?debug-surface&mode=explo&body=moon');
  await expect(page.locator('#surface-probe')).toContainText('moon', {
    timeout: 30_000,
  });
  await zoomIn(page);
  const badge = page.locator('#surface-imagery');
  await expect(badge).toBeVisible({ timeout: 30_000 });

  // Le bandeau ne doit rien recouvrir, ni rien laisser le recouvrir. axe ne voit pas un
  // chevauchement ; seule une mesure des deux rectangles le voit.
  await expect
    .poll(async () => {
      const a = await badge.boundingBox();
      const b = await page.locator('#mode-controls').boundingBox();
      if (!a || !b) return 'rectangle absent';
      const overlap =
        a.x < b.x + b.width &&
        b.x < a.x + a.width &&
        a.y < b.y + b.height &&
        b.y < a.y + a.height;
      return overlap ? 'chevauchement' : 'libre';
    })
    .toBe('libre');

  const narrow = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(narrow.violations, JSON.stringify(narrow.violations, null, 2)).toEqual(
    []
  );
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
    ),
    'débordement horizontal à 390 px'
  ).toBe(0);
});

test('asks for nothing at all when the setting is off', async ({ page }) => {
  const seen = await serveTiles(page);
  await page.addInitScript(() =>
    localStorage.setItem('ssv-surface-imagery', '0')
  );

  await boot(page, '?debug-surface&mode=explo&body=moon');
  await expect(page.locator('#surface-probe')).toContainText('moon', {
    timeout: 30_000,
  });
  await zoomIn(page);
  await page.waitForTimeout(3000);

  expect(seen, 'une couche éteinte a demandé des tuiles').toHaveLength(0);
  await expect(page.locator('#surface-imagery')).toBeHidden();
  // La moitié inverse de l'affirmation : le réglage EXISTE et il est bien décoché, sinon ce
  // test passerait à vide le jour où la bascule disparaîtrait.
  await expect(page.locator('#surface-imagery-toggle')).not.toBeChecked();
});

/**
 * LE RELIEF MESURÉ (lot 9, phase 9D).
 *
 * Ce scénario confronte ce que l'écran montre aux OCTETS LIVRÉS : la tuile de hauteurs est
 * relue ici, dans le test, et l'altitude qu'elle porte sous le point visé doit être exactement
 * celle que l'application annonce. C'est la même forme de preuve que les quatre épicentres du
 * lot 8 : deux chemins indépendants pour une même grandeur, et non une capture d'écran.
 *
 * Les tuiles de hauteurs viennent de NOTRE origine, donc elles ne sont ni simulées ni bloquées
 * (`e2e/netBlock.ts` ne coupe que les hôtes tiers) : ce qui est mesuré est bien le fichier que
 * le dépôt livre.
 */
test('displaces the ground with measured altitudes, and says where they come from', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await serveTiles(page);
  const heightRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/height-tiles/'))
      heightRequests.push(request.url());
  });

  await boot(page, '?debug-surface&mode=explo&body=moon');
  const probe = page.locator('#surface-probe');
  await expect(probe).toContainText('moon', { timeout: 30_000 });
  await zoomIn(page);

  const badge = page.locator('#surface-imagery');
  await expect(badge).toBeVisible({ timeout: 30_000 });
  // Le relief n'est annoncé qu'une fois posé, et il nomme sa propre source, qui n'est pas
  // celle de l'imagerie.
  await expect(badge).toHaveAttribute('data-relief', /\d+/, {
    timeout: 30_000,
  });
  await expect(badge.locator('.si-relief')).toContainText('LOLA');
  await expect(badge.locator('.si-relief')).toContainText('altimetry from');
  await expect(badge.locator('.si-credit')).toContainText('PDS Geosciences');
  expect(
    heightRequests.filter((url) => url.endsWith('.hgt')).length,
    'aucune tuile de hauteurs demandée'
  ).toBeGreaterThan(0);

  // ── La confrontation : l'altitude annoncée est-elle celle du fichier livré ? ──
  await expect(probe).toContainText('au-dessus du sol', { timeout: 30_000 });
  const text = (await probe.textContent()) ?? '';
  const aim = /visée\s+(-?[\d.]+)°, (-?[\d.]+)°/.exec(text);
  const shown = /sol\s+(-?\d+) m/.exec(text);
  expect(aim, 'le relevé ne donne pas le point visé').toBeTruthy();
  expect(shown, 'le relevé ne donne pas l’altitude du sol').toBeTruthy();

  const manifest = JSON.parse(
    readFileSync(
      resolve(HERE, '../public/assets/height-tiles/moon/manifest.json'),
      'utf-8'
    )
  ) as {
    directory: string;
    baseLevel: number;
    quantumMetres: number;
    offsetMetres: number;
    format: { samples: number };
  };
  const latitude = Number(aim![1]);
  const longitude = Number(aim![2]);
  const level = manifest.baseLevel;
  const columns = 2 * 2 ** level;
  const rows = 2 ** level;
  const column = Math.floor(((longitude + 180) / 360) * columns);
  const row = Math.floor(((90 - latitude) / 180) * rows);
  const bytes = readFileSync(
    resolve(
      HERE,
      `../public/${manifest.directory}/${level}/${row}/${column}.hgt`
    )
  );
  const samples = manifest.format.samples;
  const west = -180 + (column * 360) / columns;
  const north = 90 - (row * 180) / rows;
  const x = Math.round(((longitude - west) / (360 / columns)) * (samples - 1));
  const y = Math.round(((north - latitude) / (180 / rows)) * (samples - 1));
  const dn = bytes.readInt16LE(32 + (y * samples + x) * 2);
  const expected = manifest.offsetMetres + dn * manifest.quantumMetres;

  // Un mètre de tolérance : l'application arrondit à l'entier ce que le fichier donne au
  // demi-mètre. Une convention de longitude inversée, elle, se compterait en kilomètres.
  expect(Math.abs(Number(shown![1]) - expected)).toBeLessThan(1);

  expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
});
