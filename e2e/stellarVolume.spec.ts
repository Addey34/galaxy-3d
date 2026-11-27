import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';
import { reportFailureDiagnostics } from './failureDiagnostics';
import { openSettingsTab } from './settingsTab';
import { assembleVolume } from '../src/core/stellarVolumeAssembly';
import { starSlug } from '../src/core/stellarPermalink';
import {
  shippedVolumeSources,
  volumeJson,
} from '../src/core/stellarVolumeTestFixture';

/**
 * LE VOLUME STELLAIRE ÉTENDU (GAL-UNIVERSE-008) dans la vue du voisinage : échelles 5, 25, 50, 100 pc,
 * recherche, sélection au clic, fiche, hôte d'exoplanètes vers son exploration, filtres, chargement
 * interrompu ou refusé, adresse partageable, Retour et Suivant du navigateur, accessibilité. Les rangs
 * des étoiles témoins sont LUS dans `names.json` : un fichier regénéré ne casse pas le test en silence.
 */
/**
 * Les noms et les rangs tels que le client les assemble (un dossier par fournisseur, tables de Galaxy) :
 * le test les calcule avec le même module, à partir des fichiers livrés.
 */
const ASSEMBLY = assembleVolume(shippedVolumeSources());
const NAMED = (() => {
  const index = shippedVolumeSources().index;
  return ASSEMBLY.withHygNames(
    volumeJson(index.providers.hyg.names.file),
    volumeJson(index.crossmatch.names.file)
  );
})();
const NAMES = NAMED.names as Record<string, (string | number | null)[]>;
/**
 * Une étoile du GCNS nommée par HYG, dans la coquille de 25 pc et dans le paquet de détails `bucket` du
 * GCNS, au nom unique (la recherche la trouve seule) : ses détails viennent du réseau, contrairement à
 * Véga (absente de Gaia, détails connus sans paquet).
 */
function gcnsNamedStar(bucket: number): { index: number; name: string } {
  const counts = new Map<string, number>();
  for (const e of Object.values(NAMES))
    counts.set(String(e[0]), (counts.get(String(e[0])) ?? 0) + 1);
  for (const at of [...NAMED.fromHyg].sort((a, b) => a - b)) {
    const g = ASSEMBLY.gcnsIndexOf(at);
    const name = String(NAMES[String(at)]![0]);
    if (
      at < ASSEMBLY.manifest.shells[0]!.count &&
      Math.floor(g / ASSEMBLY.manifest.detailBucket) === bucket &&
      counts.get(name) === 1 &&
      NAMES[String(at)]!.length === 1 &&
      /^[A-Za-z0-9 ]{5,}$/.test(name)
    )
      return { index: at, name };
  }
  throw new Error(`aucune étoile nommée dans le paquet ${bucket}`);
}
/** Les fichiers lus à la première échelle : l'index, puis les petits fichiers de l'assemblage. */
const FIRST_LOAD = [
  'crossmatch.json',
  'gcns-missing/missing.json',
  'hyg/complement.json',
  'nasa/hosts.json',
];
const indexOf = (name: string): number =>
  Number(Object.entries(NAMES).find(([, e]) => e[0] === name)![0]);
const VEGA = indexOf('Vega');

test.afterEach(async ({ page }, testInfo) => {
  await reportFailureDiagnostics(page, testInfo);
});

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

const box = (page: Page) => page.locator('#stellar-volume');
const search = (page: Page): URLSearchParams =>
  new URL(page.url()).searchParams;

async function openView(page: Page, query = ''): Promise<void> {
  await page.goto(`/?view=neighbourhood${query}`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  await expect(page.locator('#stellar-view')).toBeVisible({ timeout: 60_000 });
}

async function chooseScale(page: Page, pc: number): Promise<void> {
  await page.locator(`.sv-volume-scale[data-pc="${pc}"]`).click();
  await expect(box(page)).toHaveAttribute('data-scale', String(pc));
  await expect(box(page)).toHaveAttribute('data-state', 'idle', {
    timeout: 90_000,
  });
}

async function findStar(page: Page, name: string): Promise<void> {
  await page.locator('#stellar-volume-search').fill(name);
  await page
    .locator('#stellar-volume-results button', { hasText: name })
    .first()
    .click();
  await expect(page.locator('#stellar-volume-card-title')).toHaveText(name, {
    timeout: 60_000,
  });
}

test('rien du volume à l’ouverture ; chaque échelle charge sa coquille, et seulement elle', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const requests: string[] = [];
  page.on('request', (r) => {
    const m = /\/assets\/sky\/volume\/(.+)$/.exec(r.url());
    if (m) requests.push(m[1]!);
  });
  await openView(page);
  await expect(box(page)).toHaveAttribute('data-scale', '5');
  expect(requests).toEqual([]);
  await chooseScale(page, 25);
  // L'index d'abord, puis (en parallèle) les petits fichiers de l'assemblage, puis la coquille du GCNS.
  expect(requests[0]).toBe('index.json');
  expect(requests.slice(1, 5).sort()).toEqual(FIRST_LOAD);
  expect(requests.slice(5)).toEqual(['gcns/stars-25.bin']);
  expect(search(page).get('vol')).toBe('25');
  await expect(page.locator('#stellar-volume-status')).toContainText('5,377');
  await chooseScale(page, 100);
  expect(requests.slice(5)).toEqual([
    'gcns/stars-25.bin',
    'gcns/stars-50.bin',
    'gcns/stars-100.bin',
  ]);
  await expect(page.locator('#stellar-volume-status')).toContainText('301,721');
  await expect(box(page)).toHaveAttribute('data-visible', '301721');
  // Revenir à 5 pc ne recharge rien et retire l'échelle de l'adresse.
  await chooseScale(page, 5);
  expect(search(page).get('vol')).toBeNull();
  await chooseScale(page, 50);
  expect(requests).toHaveLength(8);
});

test('la recherche trouve Véga, la fiche dit sa source, l’adresse la partage et la rouvre', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openView(page);
  await chooseScale(page, 25);
  await findStar(page, 'Vega');
  const card = page.locator('#stellar-volume-card');
  await expect(card).toContainText('Hipparcos');
  await expect(card).toContainText('A0V');
  // La fiche du voisinage se cache : une seule étoile choisie à la fois.
  await expect(page.locator('#stellar-card')).toBeHidden();
  expect(search(page).get('vstar')).toBe(`${VEGA}.vega`);
  // Une nouvelle session sur la même adresse retrouve la même étoile.
  await page.reload();
  await expect(page.locator('#stellar-volume-card-title')).toHaveText('Vega', {
    timeout: 90_000,
  });
});

test('un clic choisit l’étoile du volume sous le pointeur', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openView(page);
  await chooseScale(page, 25);
  await findStar(page, 'Vega');
  const label = page.locator('.sv-label--volume');
  await expect(label).toBeVisible();
  // La fiche paraît AVANT que la caméra cadre l'étoile : on attend que sa position écran ne bouge plus
  // (l'arrivée du cadrage), jamais une durée.
  const at = async (): Promise<string> =>
    `${await label.getAttribute('data-sx')},${await label.getAttribute('data-sy')}`;
  let last = '';
  await expect
    .poll(
      async () => {
        const now = await at();
        const stable = now === last;
        last = now;
        return stable;
      },
      { intervals: [400], timeout: 20_000 }
    )
    .toBe(true);
  const [sx, sy] = last.split(',').map(Number) as [number, number];
  // Désélectionner en choisissant une étoile du voisinage, puis recliquer Véga sur la surface.
  await page.locator('#stellar-list button').first().click();
  await expect(page.locator('#stellar-volume-card')).toBeHidden();
  await page.mouse.click(sx, sy);
  await expect(page.locator('#stellar-volume-card-title')).toHaveText('Vega', {
    timeout: 30_000,
  });
});

test('un hôte d’exoplanètes, rapproché par son numéro Gaia, mène à l’exploration de son système', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openView(page);
  await chooseScale(page, 25);
  await findStar(page, 'Copernicus');
  const card = page.locator('#stellar-volume-card');
  await expect(card).toContainText('55 Cnc');
  await expect(card).toContainText('Gaia DR3');
  await page.locator('#stellar-volume-explore').click();
  await expect(page.locator('#stellar-view')).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(page.locator('#system-view')).toBeVisible({ timeout: 60_000 });
});

test('un filtre masque ce qui n’y répond pas ; le choix incompatible est retiré', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openView(page);
  await chooseScale(page, 25);
  await findStar(page, 'Vega');
  await page.locator('#stellar-volume-filter').selectOption('whiteDwarfs');
  await expect(page.locator('#stellar-volume-card')).toBeHidden();
  expect(search(page).get('vstar')).toBeNull();
});

test('un chargement remplacé est annulé ; un chargement refusé est dit, l’échelle revient', async ({
  page,
}) => {
  test.setTimeout(240_000);
  let released = false;
  await page.route('**/assets/sky/volume/gcns/stars-100.bin', async (route) => {
    await new Promise((r) => setTimeout(r, 6_000));
    released = true;
    await route.continue().catch(() => {});
  });
  await page.route('**/assets/sky/volume/gcns/stars-50.bin', (route) =>
    route.abort()
  );
  await openView(page);
  await chooseScale(page, 25);
  // 50 pc est refusé : la vue le dit et reste à 25 pc.
  await page.locator('.sv-volume-scale[data-pc="50"]').click();
  await expect(box(page)).toHaveAttribute('data-state', 'failed', {
    timeout: 30_000,
  });
  await expect(box(page)).toHaveAttribute('data-scale', '25');
  await expect(page.locator('#stellar-volume-status')).toContainText(
    'could not'
  );
  expect(search(page).get('vol')).toBe('25');
  // 100 pc demandé puis remplacé par 5 pc avant d'arriver : rien ne se pose ensuite.
  await page.unroute('**/assets/sky/volume/gcns/stars-50.bin');
  await page.locator('.sv-volume-scale[data-pc="100"]').click();
  await chooseScale(page, 5);
  await expect.poll(() => released, { timeout: 20_000 }).toBe(true);
  await page.waitForTimeout(1_500);
  await expect(box(page)).toHaveAttribute('data-scale', '5');
  expect(search(page).get('vol')).toBeNull();
  // Ce que la scène trace : aucune étoile du volume à 5 pc, même après l'arrivée tardive de 100 pc.
  await expect(box(page)).toHaveAttribute('data-visible', '0');
});

test('Retour puis Suivant du navigateur : la vue, son échelle et l’étoile reviennent', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.goto('/?mode=explo&body=neptune&date=2026-09-15T11:00:00Z');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  // Ouverte par les Réglages, comme un visiteur : la vue ajoute SON entrée d'historique.
  await expect(page.locator('#stellar-open')).toBeEnabled({ timeout: 40_000 });
  await page.locator('#settings-trigger').dispatchEvent('click');
  await openSettingsTab(page, 'scene');
  await page.locator('#stellar-open').click();
  await expect(page.locator('#stellar-view')).toBeVisible({ timeout: 60_000 });
  await chooseScale(page, 25);
  await findStar(page, 'Vega');
  await page.goBack();
  await expect(page.locator('#stellar-view')).toHaveCount(0, {
    timeout: 30_000,
  });
  await page.goForward();
  await expect(page.locator('#stellar-view')).toBeVisible({ timeout: 60_000 });
  await expect(box(page)).toHaveAttribute('data-scale', '25', {
    timeout: 60_000,
  });
  await expect(page.locator('#stellar-volume-card-title')).toHaveText('Vega', {
    timeout: 60_000,
  });
});

test('une étoile inconnue dans l’adresse est dite, jamais remplacée par une autre', async ({
  page,
}) => {
  test.setTimeout(240_000);
  // Bon rang, mauvais nom : le jeton ne désigne pas Véga.
  await openView(page, `&vol=25&vstar=${VEGA}.not-vega`);
  await expect(box(page)).toHaveAttribute('data-state', 'idle', {
    timeout: 90_000,
  });
  await page.waitForTimeout(2_000);
  await expect(page.locator('#stellar-volume-card')).toBeHidden();
});

test('aucune violation d’accessibilité, aucun débordement, à 100 pc avec une fiche', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openView(page);
  await chooseScale(page, 100);
  await findStar(page, 'Vega');
  const axe = await new AxeBuilder({ page })
    .include('#stellar-volume')
    .include('#stellar-volume-card')
    .analyze();
  expect(axe.violations).toEqual([]);
});

test.describe('téléphone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('les échelles, la recherche et la fiche tiennent dans 390 px', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openView(page);
    await chooseScale(page, 50);
    await findStar(page, 'Vega');
    const overflow = await page.evaluate(
      () =>
        [
          ...document.querySelectorAll(
            '#stellar-volume *, #stellar-volume-card *'
          ),
        ]
          .filter((e) => !(e as HTMLElement).classList.contains('sr-only'))
          .map((e) => e.getBoundingClientRect())
          .filter(
            (r) =>
              r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1)
          ).length
    );
    expect(overflow).toBe(0);
  });
});

/**
 * LE CYCLE DE VIE (revue du CTO) : la dernière intention du visiteur garde seule l'autorité, une vue fermée
 * ne crée, ne cadre, n'annonce ni n'écrit plus rien. Chaque scénario retarde ou refuse UNE ressource.
 */
test.describe('cycle de vie du volume', () => {
  /** Toutes les annonces de l'`aria-live` unique, même remplacées dans sa file. */
  async function recordAnnouncements(page: Page): Promise<void> {
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { __announced: string[] }).__announced = seen;
      const region = document.querySelector('p.sr-only[role="status"]')!;
      new MutationObserver(() => seen.push(region.textContent ?? '')).observe(
        region,
        { childList: true, characterData: true, subtree: true }
      );
    });
  }
  const announced = (page: Page): Promise<string[]> =>
    page.evaluate(
      () => (window as unknown as { __announced: string[] }).__announced
    );

  test('fermée pendant le manifeste : son arrivée tardive ne crée, n’annonce ni n’écrit rien', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    let released = false;
    await page.route('**/assets/sky/volume/index.json', async (route) => {
      await new Promise((r) => setTimeout(r, 4_000));
      released = true;
      await route.continue().catch(() => {});
    });
    await openView(page);
    await recordAnnouncements(page);
    await page.locator('.sv-volume-scale[data-pc="25"]').click();
    await expect(box(page)).toHaveAttribute('data-state', 'loading');
    await page.keyboard.press('Escape');
    await expect(page.locator('#stellar-view')).toHaveCount(0);
    const urlAfterClose = page.url();
    await expect.poll(() => released, { timeout: 20_000 }).toBe(true);
    await page.waitForTimeout(3_000);
    expect(page.url()).toBe(urlAfterClose);
    expect(search(page).get('vol')).toBeNull();
    await expect(page.locator('.sv-volume-labels')).toHaveCount(0);
    expect((await announced(page)).some((a) => /stars shown/.test(a))).toBe(
      false
    );
    expect(errors).toEqual([]);
  });

  test('100 pc puis 50 pc pendant le téléchargement : la coquille commune est partagée, la suite annulée', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const requested: string[] = [];
    page.on('request', (r) => {
      const m = /\/assets\/sky\/volume\/gcns\/(stars-\d+\.bin)$/.exec(r.url());
      if (m) requested.push(m[1]!);
    });
    await page.route(
      '**/assets/sky/volume/gcns/stars-50.bin',
      async (route) => {
        await new Promise((r) => setTimeout(r, 3_000));
        await route.continue().catch(() => {});
      }
    );
    await openView(page);
    await chooseScale(page, 25);
    await page.locator('.sv-volume-scale[data-pc="100"]').click();
    await expect.poll(() => requested.includes('stars-50.bin')).toBe(true);
    await page.locator('.sv-volume-scale[data-pc="50"]').click();
    await expect(box(page)).toHaveAttribute('data-state', 'idle', {
      timeout: 60_000,
    });
    await expect(box(page)).toHaveAttribute('data-scale', '50');
    // Ce que la scène trace : les coquilles de 25 et 50 pc, jamais celle de 100 pc.
    await expect(box(page)).toHaveAttribute('data-visible', '40787');
    expect(requested.filter((f) => f === 'stars-50.bin')).toHaveLength(1);
    expect(search(page).get('vol')).toBe('50');
  });

  test('retour à 5 pc avec une étoile du volume choisie : scène, fiche, nom et adresse la retirent ensemble', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openView(page);
    await chooseScale(page, 25);
    await findStar(page, 'Vega');
    await expect(page.locator('.sv-label--volume')).toBeVisible();
    await chooseScale(page, 5);
    await expect(page.locator('#stellar-volume-card')).toBeHidden();
    await expect(page.locator('#stellar-card')).toBeVisible();
    await expect(page.locator('.sv-label--volume')).toBeHidden();
    await expect(box(page)).toHaveAttribute('data-visible', '0');
    expect(search(page).get('vstar')).toBeNull();
    expect(search(page).get('vol')).toBeNull();
  });

  test('manifeste refusé puis accepté : l’échec est dit, le geste suivant réessaie', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/assets/sky/volume/index.json', (route) =>
      route.abort()
    );
    await openView(page);
    await page.locator('.sv-volume-scale[data-pc="25"]').click();
    await expect(box(page)).toHaveAttribute('data-state', 'failed', {
      timeout: 30_000,
    });
    await expect(page.locator('#stellar-volume-status')).toContainText(
      'could not'
    );
    await page.unroute('**/assets/sky/volume/index.json');
    await chooseScale(page, 25);
    await expect(box(page)).toHaveAttribute('data-visible', '5377');
    expect(errors).toEqual([]);
  });

  test('paquet de détails refusé : la fiche le dit, sans promesse rejetée ; un nouveau choix réessaie', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/assets/sky/volume/gcns/details/*.bin', (route) =>
      route.abort()
    );
    const star = gcnsNamedStar(0);
    await openView(page);
    await chooseScale(page, 25);
    await findStar(page, star.name);
    const card = page.locator('#stellar-volume-card');
    await expect(card).toContainText('could not be loaded');
    await expect(card).not.toContainText('Parallax');
    // Le nom vient de HYG : la fiche le dit, avec sa licence.
    await expect(card).toContainText('Name: HYG v4.4 (CC BY-SA 4.0)');
    await page.unroute('**/assets/sky/volume/gcns/details/*.bin');
    await findStar(page, star.name);
    await expect(card).toContainText('Parallax');
    await expect(card).not.toContainText('could not be loaded');
    expect(errors).toEqual([]);
  });

  test('un lien retardé est remplacé par un choix plus récent, qui garde l’autorité', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    // Les détails de l'étoile du lien (paquet 000 du GCNS) arrivent avec 6 s de retard ; l'étoile choisie
    // entre-temps est dans un autre paquet, donc servie tout de suite.
    let released = false;
    await page.route(
      '**/assets/sky/volume/gcns/details/000.bin',
      async (route) => {
        await new Promise((r) => setTimeout(r, 6_000));
        released = true;
        await route.continue().catch(() => {});
      }
    );
    const linked = gcnsNamedStar(0);
    const other = gcnsNamedStar(1);
    const otherName = other.name;
    await openView(
      page,
      `&vol=25&vstar=${linked.index}.${starSlug(linked.name)}`
    );
    await expect(box(page)).toHaveAttribute('data-state', 'idle', {
      timeout: 60_000,
    });
    await findStar(page, otherName);
    await expect.poll(() => released, { timeout: 20_000 }).toBe(true);
    await page.waitForTimeout(2_000);
    await expect(page.locator('#stellar-volume-card-title')).toHaveText(
      otherName
    );
    expect(search(page).get('vstar')).toMatch(new RegExp(`^${other.index}\\.`));
  });
});
