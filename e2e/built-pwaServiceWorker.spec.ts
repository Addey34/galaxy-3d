import { expect, test } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blockExternalNetwork } from './netBlock';

/**
 * GAL-PERF-PWA-001 : un service worker RÉELLEMENT actif, qui contrôle la page, sert encore leur vrai
 * document aux pages de formations et d'activités (titre et canonique), alors qu'elles ne sont plus
 * précachées : le refus du repli SPA les envoie au réseau, et l'app shell (« Galaxy: Real-Time… »,
 * canonique `/`) ne les remplace jamais. Les attentes sont lues dans les fichiers du build, pas
 * recopiées.
 */
test.use({ serviceWorkers: 'allow' });

const DIST = join(import.meta.dirname, '..', 'dist');
const read = (file: string): { title: string; canonical: string } => {
  const html = readFileSync(join(DIST, file), 'utf8');
  return {
    title: /<title>([^<]*)<\/title>/.exec(html)![1]!,
    canonical: new URL(/rel="canonical" href="([^"]+)"/.exec(html)![1]!)
      .pathname,
  };
};

/** Une formation et une activité réelles par langue, prises dans le build (la première par ordre alphabétique). */
const first = (dir: string): string => readdirSync(join(DIST, dir)).sort()[0]!;
const PAGES = ['', 'fr/', 'es/', 'pt-br/'].flatMap((lang) => {
  const body = first(`${lang}places`);
  const place = first(`${lang}places/${body}`);
  const activity = first(`${lang}activities`);
  return [
    `${lang}places/${body}/${place}/index.html`,
    `${lang}activities/${activity}/index.html`,
  ];
});

test('le service worker contrôle la page et laisse leur vrai document aux pages de formations et d’activités', async ({
  page,
}) => {
  await blockExternalNetwork(page);
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  // Le précache ne contient plus les milliers de pages générées (il en avait 3 442).
  const entries = await page.evaluate(async () => {
    const key = (await caches.keys()).find((k) => k.includes('precache'));
    return key ? (await (await caches.open(key)).keys()).length : -1;
  });
  expect(entries, 'entrées du précache').toBeGreaterThan(20);
  expect(entries, 'entrées du précache').toBeLessThan(300);

  for (const file of PAGES) {
    const expected = read(file);
    const route = `/${file.replace(/index\.html$/, '')}`;
    for (const suffix of ['', '?utm_source=test']) {
      await page.goto(`${route}${suffix}`, { waitUntil: 'domcontentloaded' });
      expect(
        await page.evaluate(() => !!navigator.serviceWorker.controller),
        `${route} : page contrôlée`
      ).toBe(true);
      expect(await page.title(), `${route}${suffix} : titre`).toBe(
        expected.title.replace(/&amp;/g, '&').replace(/&#39;/g, "'")
      );
      expect(
        new URL(
          (await page
            .locator('link[rel="canonical"]')
            .getAttribute('href')) as string
        ).pathname,
        `${route}${suffix} : canonique`
      ).toBe(expected.canonical);
    }
  }
});
