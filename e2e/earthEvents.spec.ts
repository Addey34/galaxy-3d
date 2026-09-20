import { expect, test, type Page } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

/**
 * LES ÉVÉNEMENTS TERRESTRES TOMBENT-ILS AU BON ENDROIT, ET DISENT-ILS CE QU'ILS SONT ?
 *
 * Trois propriétés, dont aucune n'est visible d'un test unitaire.
 *
 * 1. LA PHASE. Un marqueur d'épicentre est posé sur la Terre TELLE QU'ELLE EST RENDUE, donc
 *    derrière la phase de rotation de surface recalculée à chaque image. Une erreur de phase
 *    ne déforme rien : elle glisse les marqueurs par rapport aux continents. Le contrôle est
 *    celui de `subsolar.spec.ts`, en moins circulaire que son assertion de longitude : on
 *    compare la direction du Soleil vue depuis des épicentres PUBLIÉS par l'USGS, mesurée sur
 *    la scène rendue, à celle qu'astronomy-engine calcule pour un observateur à ces mêmes
 *    coordonnées. Les deux chemins n'ont en commun que l'éphéméride du Soleil : le premier
 *    passe par `surfacePointToWorld` et le graphe de scène, le second par le temps sidéral.
 *    Une erreur de phase δ déplace le site de δ·cos(latitude), donc se lit directement, et
 *    ne s'annule nulle part hors des pôles (contrairement à la seule hauteur, plate au midi
 *    local). Seuil 0,05°, le même que le point subsolaire, soit environ 5 km au sol.
 *
 * 2. LE SILENCE AU DÉMARRAGE. Une couche qu'on n'a pas allumée ne doit RIEN demander à un
 *    service public. Mesuré, pas supposé : on compte les requêtes.
 *
 * 3. CE QUE DIT CHAQUE ÉVÉNEMENT. Un séisme est une mesure (« observed ») ; un événement
 *    EONET est un rapport (« reported »), et s'il n'a pas de fin déclarée il est « ongoing »
 *    et non doté d'une date de fin inventée. Les deux couches sont servies par des réponses
 *    mimées, donc sans dépendre du réseau ni du contenu du jour.
 */

const SITES = ['tohoku', 'maule', 'sumatra', 'sanfrancisco'] as const;

/**
 * Dates réparties sur l'année ET sur la journée : la phase de rotation avance de 15° par
 * heure, donc une erreur constante ne peut pas se cacher derrière un choix d'heure.
 */
const CASES = [
  '2026-01-15T03:00:00Z',
  '2026-03-20T12:00:00Z',
  '2026-05-02T18:00:00Z',
  '2026-06-21T09:00:00Z',
  '2026-08-17T21:00:00Z',
  '2026-11-03T06:00:00Z',
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

const readSeparation = (panel: ReturnType<Page['locator']>, site: string) =>
  panel.evaluate((el, id) => {
    const match = el.textContent?.match(
      new RegExp(id + String.raw`\s+.*?sep\s+([\d.]+) deg`)
    );
    return match ? Number(match[1]) : Number.NaN;
  }, site);

for (const date of CASES) {
  test(`published epicentres land on the rendered Earth at ${date}`, async ({
    page,
  }) => {
    await blockExternalNetwork(page);
    await page.goto(`/?debug-geo&body=earth&date=${encodeURIComponent(date)}`);
    const panel = page.locator('#geo-debug');
    await expect(panel).toBeVisible({ timeout: 40_000 });
    await expect(panel).toContainText('sanfrancisco', { timeout: 20_000 });

    for (const site of SITES) {
      const separation = await readSeparation(panel, site);
      expect(Number.isNaN(separation), site).toBe(false);
      expect(separation, site).toBeLessThan(0.05);
    }
  });
}

test('a layer that is off asks its service for nothing', async ({ page }) => {
  await blockExternalNetwork(page);
  const calls: string[] = [];
  page.on('request', (request) => {
    const host = new URL(request.url()).host;
    if (host === 'earthquake.usgs.gov' || host === 'eonet.gsfc.nasa.gov')
      calls.push(request.url());
  });

  await page.goto('/?body=earth');
  // Le boot doit être TERMINÉ avant de cliquer. Le déclencheur est dans le document dès le
  // premier octet : « visible » ne dit donc rien de l'état de l'application. Sous GPU logiciel,
  // le décodage des textures de la Terre bloque le thread principal par à-coups, et un clic
  // lancé pendant ce temps dépasse les 15 s d'actionnabilité — mesuré, shard 1 de la CI rouge
  // aux trois tentatives. Attendre `#loader` caché est la convention de toute la suite, que ce
  // fichier était seul à ignorer.
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('#earth-events-trigger')).toBeVisible({
    timeout: 40_000,
  });
  // Laisse la boucle tourner : le socle daté d'une couche allumée réévalue la date chaque
  // seconde, donc s'il existait, il aurait déjà tiré.
  await page.waitForTimeout(3_000);
  expect(calls).toEqual([]);

  // Et il tire dès qu'on l'allume : sans cette moitié, le test passerait aussi si la couche
  // ne demandait JAMAIS rien.
  // Et le clic lui-même garde de la marge : le loader parti, la Terre vue de près DENSIFIE sa
  // géométrie et décode ses textures 8k sur le thread principal (c'est ce que mesure
  // `earth-visual.spec.ts`, qui flanche pour la même raison). Les 15 s d'`actionTimeout` de la
  // config suffisent partout ailleurs, pas sur un boot cadré sur la Terre : mesuré, une
  // tentative rouge à 15 s puis verte à la reprise. Ça ne masque aucune régression, un câblage
  // cassé échouant aux trois tentatives quel que soit le budget.
  await page.locator('#earth-events-trigger').click({ timeout: 60_000 });
  await page.locator('#earth-events .ee-row input').first().check();
  await expect.poll(() => calls.length, { timeout: 15_000 }).toBeGreaterThan(0);
  expect(new URL(calls[0]).host).toBe('earthquake.usgs.gov');
});

/** Épicentre publié du séisme de Tōhoku, servi à la place de la réponse réelle. */
const QUAKE_RESPONSE = {
  features: [
    {
      type: 'Feature',
      id: 'official20110311054624120_30',
      properties: {
        mag: 9.1,
        place: 'near the east coast of Honshu, Japan',
        time: Date.parse('2011-03-11T05:46:24Z'),
      },
      geometry: { type: 'Point', coordinates: [142.373, 38.297, 29] },
    },
  ],
};

/** Un événement EONET CLOS et un OUVERT : les deux étiquettes doivent différer. */
const EONET_RESPONSE = {
  events: [
    {
      id: 'EONET_TEST_OPEN',
      title: 'Test Volcano',
      closed: null,
      categories: [{ id: 'volcanoes', title: 'Volcanoes' }],
      geometry: [
        {
          date: '2011-03-05T00:00:00Z',
          type: 'Point',
          coordinates: [130.657, 31.585],
        },
      ],
    },
    {
      id: 'EONET_TEST_CLOSED',
      title: 'Test Wildfire',
      closed: '2011-03-09T00:00:00Z',
      categories: [{ id: 'wildfires', title: 'Wildfires' }],
      geometry: [
        {
          date: '2011-03-02T00:00:00Z',
          type: 'Point',
          coordinates: [-120.5, 38.5],
        },
      ],
    },
  ],
};

test('a measurement and a report never get the same label', async ({
  page,
}) => {
  await page.route('**/sbdb_query.api*', (route) => route.abort());
  await page.route('**gibs.earthdata.nasa.gov/**', (route) => route.abort());
  await page.route('**earthdata.nasa.gov/**', (route) => route.abort());
  await page.route('**open-meteo.com/**', (route) => route.abort());
  await page.route('**earthquake.usgs.gov/**', (route) =>
    route.fulfill({ json: QUAKE_RESPONSE })
  );
  await page.route('**eonet.gsfc.nasa.gov/**', (route) =>
    route.fulfill({ json: EONET_RESPONSE })
  );

  await page.goto('/?body=earth&date=2011-03-11T12%3A00%3A00Z');
  // Le boot doit être TERMINÉ avant de cliquer. Le déclencheur est dans le document dès le
  // premier octet : « visible » ne dit donc rien de l'état de l'application. Sous GPU logiciel,
  // le décodage des textures de la Terre bloque le thread principal par à-coups, et un clic
  // lancé pendant ce temps dépasse les 15 s d'actionnabilité — mesuré, shard 1 de la CI rouge
  // aux trois tentatives. Attendre `#loader` caché est la convention de toute la suite, que ce
  // fichier était seul à ignorer.
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('#earth-events-trigger')).toBeVisible({
    timeout: 40_000,
  });
  // Et le clic lui-même garde de la marge : le loader parti, la Terre vue de près DENSIFIE sa
  // géométrie et décode ses textures 8k sur le thread principal (c'est ce que mesure
  // `earth-visual.spec.ts`, qui flanche pour la même raison). Les 15 s d'`actionTimeout` de la
  // config suffisent partout ailleurs, pas sur un boot cadré sur la Terre : mesuré, une
  // tentative rouge à 15 s puis verte à la reprise. Ça ne masque aucune régression, un câblage
  // cassé échouant aux trois tentatives quel que soit le budget.
  await page.locator('#earth-events-trigger').click({ timeout: 60_000 });

  const rows = page.locator('#earth-events .ee-item');
  await rows.nth(0).locator('input').check();
  await rows.nth(1).locator('input').check();

  const quakes = rows.nth(0).locator('.ee-list');
  await expect(quakes).toContainText('M9.1', { timeout: 15_000 });
  await expect(quakes).toContainText('observed');
  await expect(quakes).not.toContainText('reported');

  const natural = rows.nth(1).locator('.ee-list');
  await expect(natural).toContainText('Test Volcano', { timeout: 15_000 });
  await expect(natural).toContainText('reported');
  // La fin non déclarée est une INFORMATION affichée, pas une date fabriquée.
  await expect(
    natural.locator('li', { hasText: 'Test Volcano' })
  ).toContainText('ongoing');
  await expect(
    natural.locator('li', { hasText: 'Test Wildfire' })
  ).not.toContainText('ongoing');

  // Les marqueurs sont peints sur un canvas d'instrument, jamais sur un mesh.
  await expect(page.locator('#earth-events-overlay')).toHaveClass(/is-visible/);
});
