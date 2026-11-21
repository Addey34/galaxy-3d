import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';
import { MOON_SCENE_DATE } from './moonScene';
import { waitForInteractiveMainThread } from './mainThread';
import { HERE, prepareSurfacePage, TILE_JPEG } from './surfaceTiles';

/**
 * LA NAC D'APOLLO 11 (PDS, 5 m) SOUS LA WAC, DANS UN VRAI NAVIGATEUR (GAL-IMMERSION-003B-PDS-005).
 *
 * Ce que ce scénario prouve, avec la configuration RÉELLEMENT livrée (la fiche
 * `moon-lroc-nac-apollo11-5m`, son manifeste, la recette) et aucun réseau :
 *  - à Statio Tranquillitatis, descendu sous la base, des tuiles du jeu partent vers le service de
 *    données, UNIQUEMENT sous son répertoire haché et à des niveaux que la base ne sert pas ;
 *  - le bandeau annonce la NAC, son crédit, et la résolution des carreaux PEINTS (10 m par pixel au
 *    niveau 11), pas les 5 m de la source ;
 *  - en remontant, la NAC cesse d'être annoncée et la base reprend ;
 *  - quand le service ne sert rien (404) ou est en panne (503), la scène reste sur la base et la
 *    NAC n'est jamais annoncée.
 *
 * Les tuiles sont des réponses de test : la couverture est celle de l'INVENTAIRE versionné
 * (`objects.json`, 334 objets) ; tout chemin hors inventaire répond 404, comme sur le service.
 * La vérification des vrais octets sur l'origine est faite hors CI (`PUBLICATION.md`).
 */
const ID = 'moon-lroc-nac-apollo11-5m';
const HASH = '2a218dbaa134';
const NAC_CREDIT = 'NASA/GSFC/Arizona State University';

const inventory = new Set(
  (
    JSON.parse(
      readFileSync(
        resolve(
          HERE,
          '../scripts/pending-publication/moon-lroc-nac-apollo11-5m/objects.json'
        ),
        'utf8'
      )
    ) as { objects: Array<{ path: string }> }
  ).objects.map((o) => o.path)
);

type Mode = 'serve' | 'absent' | 'down';

async function setup(page: Page, mode: Mode) {
  await prepareSurfacePage(page);
  const nac: Array<{ path: string; status: number }> = [];
  const wac = (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/jpeg',
      headers: { 'access-control-allow-origin': '*' },
      body: TILE_JPEG,
    });
  await page.route('**trek.nasa.gov/**', wac);
  await page.route(
    `**galaxy-data.adrianguichard.dev/assets/imagery/${ID}/**`,
    (route) => {
      const url = route.request().url();
      const path = /\/imagery\/[^/]+\/([0-9a-f]+)\/(.*)$/.exec(url);
      const status =
        mode === 'down'
          ? 503
          : mode === 'serve' && path?.[1] === HASH && inventory.has(path[2]!)
            ? 200
            : 404;
      nac.push({ path: path ? `${path[1]}/${path[2]}` : url, status });
      if (status !== 200)
        return route.fulfill({
          status,
          headers: { 'access-control-allow-origin': '*' },
          body: 'absent',
        });
      return wac(route);
    }
  );
  await page.goto(
    `/?debug-surface&mode=explo&body=moon&place=Statio%20Tranquillitatis&date=${MOON_SCENE_DATE}`
  );
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('canvas').first()).toHaveAttribute(
    'data-search-focus',
    /^Statio Tranquillitatis[|]/,
    { timeout: 90_000 }
  );
  await waitForInteractiveMainThread(page);
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('canvas absent');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  return { nac, credit: page.locator('#surface-imagery .si-credit') };
}

const headline = (page: Page) =>
  page.locator('#surface-imagery .si-headline').textContent();

test('Statio Tranquillitatis: la NAC PDS est servie sous la WAC, annoncée à la résolution peinte, puis la WAC reprend', async ({
  page,
}) => {
  test.setTimeout(480_000);
  const { nac, credit } = await setup(page, 'serve');
  await expect
    .poll(
      async () => {
        await page.mouse.wheel(0, -12_000);
        return (await credit.textContent().catch(() => '')) ?? '';
      },
      { timeout: 300_000, intervals: [2000] }
    )
    .toContain(NAC_CREDIT);
  const served = nac.filter((r) => r.status === 200);
  expect(served.length).toBeGreaterThan(0);
  for (const { path } of nac) {
    expect(path, 'jamais hors du répertoire haché').toMatch(
      new RegExp(`^${HASH}/default/galaxy-eq2x1/(1[1-3])/\\d+/\\d+\\.jpg$`)
    );
  }
  const text = (await headline(page)) ?? '';
  expect(text).toContain('LROC NAC');
  expect(text).toContain('NAC_ROI_APOLLO11LOA_E004N0235_5M');
  // La résolution annoncée est celle du niveau peint (11 : ~10 m, 12 : ~5 m), pas celle de la source.
  const level = Number(
    await page.locator('#surface-imagery').getAttribute('data-level')
  );
  expect([11, 12, 13]).toContain(level);
  expect(text).toMatch(/at (10|5|2[.,]\d) m\/pixel/);
  // Remonter par crans courts : le bandeau est masqué au-dessus de la surface streamée (son texte
  // reste alors celui d'avant), on ne juge donc que lorsqu'il est VISIBLE. La base doit reprendre.
  const badge = page.locator('#surface-imagery');
  await expect
    .poll(
      async () => {
        await page.mouse.wheel(0, 1500);
        if (!(await badge.isVisible())) return 'hors surface';
        return (await credit.textContent().catch(() => '')) ?? '';
      },
      { timeout: 300_000, intervals: [2000] }
    )
    .toMatch(/^(?!hors surface)(?![\s\S]*NASA\/GSFC\/Arizona)[\s\S]+/);
  expect((await headline(page)) ?? '').toContain('LRO WAC');
});

for (const mode of ['absent', 'down'] as const) {
  test(`Statio Tranquillitatis: service ${mode === 'absent' ? 'sans tuile (404)' : 'indisponible (503)'}: la base reste, la NAC n'est jamais annoncée`, async ({
    page,
  }) => {
    test.setTimeout(480_000);
    const { nac, credit } = await setup(page, mode);
    const seen = new Set<string>();
    // Descend jusqu'à ce que le moteur ait demandé la NAC (la région est sous la visée), puis encore.
    await expect
      .poll(
        async () => {
          await page.mouse.wheel(0, -12_000);
          const text = (await credit.textContent().catch(() => '')) ?? '';
          seen.add(text);
          return nac.length;
        },
        { timeout: 300_000, intervals: [2000] }
      )
      .toBeGreaterThan(0);
    for (let i = 0; i < 6; i += 1) {
      await page.mouse.wheel(0, -12_000);
      seen.add((await credit.textContent().catch(() => '')) ?? '');
      await page.waitForTimeout(1500);
    }
    expect(nac.every((r) => r.status === (mode === 'down' ? 503 : 404))).toBe(
      true
    );
    for (const text of seen) expect(text).not.toContain(NAC_CREDIT);
    expect((await headline(page)) ?? '').toContain('LRO WAC');
    // Un échec se retient : la même tuile n'est pas redemandée à chaque image.
    const perUrl = new Map<string, number>();
    for (const { path } of nac) perUrl.set(path, (perUrl.get(path) ?? 0) + 1);
    expect(Math.max(...perUrl.values())).toBeLessThanOrEqual(3);
  });
}
