import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';
import { MOON_SCENE_DATE } from './moonScene';

/**
 * LE BLOC « FORMATIONS OBSERVÉES » AU DOIGT (GAL-SCIENCE-022A, `pnpm test:mobile`) : les trois
 * états qui ne sont pas une liste (non évalué, indisponible, inconnu) et la recherche sans accent,
 * dans les quatre langues, sur Pixel 7 et iPhone 15 émulés. Le morceau est intercepté : c'est le
 * RENDU, l'annonce accessible et la mise en page qu'on mesure, pas la donnée.
 */
const MOON_NAMES = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '..', 'public/assets/gazetteer/moon.json'),
    'utf-8'
  )
) as { name: string; iauId: number }[];

const NOT_EVALUATED: Record<string, RegExp> = {
  en: /not evaluated in the ODE dataset currently published/,
  fr: /n’a pas été évaluée dans le jeu de données ODE actuellement publié/,
  es: /no se evaluó en el conjunto de datos ODE publicado actualmente/,
  pt: /não foi avaliada no conjunto de dados ODE atualmente publicado/,
};

// Un service worker intercepte `fetch` avant `page.route` sous WebKit : sans ce blocage, le morceau
// simulé n'est jamais servi et le scénario attend une réponse qui n'arrive pas.
test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    try {
      localStorage.setItem('ssv-guided-tour-v1', '1');
      localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    } catch {
      /* stockage refusé : le scénario tourne sans */
    }
  });
});

async function openPlaces(page: Page, lang: string) {
  // Le préfixe portugais du chemin est `pt-br` (`LOCALE_PATH` de `i18n/locales.ts`).
  const prefix = lang === 'en' ? '' : `/${lang === 'pt' ? 'pt-br' : lang}`;
  await page.goto(`${prefix}/moon/?date=${MOON_SCENE_DATE}`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  await page.waitForTimeout(3_000);
  if (!(await page.locator('#body-info').isVisible()))
    await page.locator('#info-trigger').tap();
  // Sur téléphone la fiche s'ouvre RÉDUITE : « Afficher tous les détails » porte les blocs.
  const toggle = page.locator('#body-info .bi-toggle');
  if ((await toggle.getAttribute('aria-expanded')) === 'false')
    await toggle.tap();
  const places = page.locator('#body-info .bi-places');
  await expect(places).toBeVisible({ timeout: 30_000 });
  await places.locator('summary').tap();
  await expect(places.locator('datalist option').first()).toBeAttached({
    timeout: 30_000,
  });
  return places;
}

async function ask(page: Page, name: string): Promise<void> {
  const input = page.locator('#body-info .bi-places-input');
  await input.fill(name);
  // `requestSubmit` et non `press('Enter')` : sous WebKit émulé, Entrée sur un nom qui est EXACTEMENT
  // une proposition de la liste choisit la proposition au lieu de soumettre le formulaire (constaté
  // le 2026-11-13 : aucune requête, aucune réponse). Non élucidé hors de l'émulation ; le clavier
  // est couvert sur Chromium par `places.spec.ts`.
  await input.evaluate((el) => (el as HTMLInputElement).form!.requestSubmit());
}

const overflow = (page: Page): Promise<number> =>
  page.evaluate(() =>
    Math.max(0, document.documentElement.scrollWidth - window.innerWidth)
  );

/** Descendants rognés du bloc, `.sr-only` exclus (leur texte dépasse toujours). */
const clippedIn = (page: Page): Promise<string[]> =>
  page.locator('#body-info .bi-places').evaluate((root) => {
    const out: string[] = [];
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
      if (el.closest('.sr-only')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (el.scrollWidth - el.clientWidth > 1)
        out.push(
          `${el.tagName.toLowerCase()} rogné de ${el.scrollWidth - el.clientWidth}px`
        );
    }
    return out;
  });

for (const lang of ['en', 'fr', 'es', 'pt']) {
  test(`« non évalué » dans la langue ${lang} : texte, annonce et mise en page`, async ({
    page,
  }) => {
    await page.route('**/assets/place-observations/moon/*.json', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ instruments: [], observed: {} }),
      })
    );
    const places = await openPlaces(page, lang);
    await ask(page, MOON_NAMES[0]!.name);
    const result = places.locator('.bi-places-result');
    await expect(result).toContainText(NOT_EVALUATED[lang]!, {
      timeout: 15_000,
    });
    // L'annonce accessible reprend la même phrase (la file de l'annonceur attend 1,2 s).
    await expect(
      page.locator('body > p[role="status"][aria-live="polite"]')
    ).toContainText(NOT_EVALUATED[lang]!, { timeout: 15_000 });
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    expect(await clippedIn(page)).toEqual([]);
  });
}

test('un morceau invalide dit « n’a pas pu être chargé » au doigt', async ({
  page,
}) => {
  await page.route('**/assets/place-observations/moon/*.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ instruments: [] }),
    })
  );
  const places = await openPlaces(page, 'en');
  await ask(page, MOON_NAMES[0]!.name);
  await expect(places.locator('.bi-places-result')).toContainText(
    /could not be loaded/,
    { timeout: 15_000 }
  );
  expect(await overflow(page)).toBeLessThanOrEqual(1);
});

test('la recherche sans accent trouve la formation sur téléphone', async ({
  page,
}) => {
  const places = await openPlaces(page, 'en');
  await ask(page, 'Tÿcho');
  await expect(places.locator('.bi-places-title')).toContainText('Tycho', {
    timeout: 30_000,
  });
  await expect(places.locator('.bi-places-result li').first()).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  expect(await clippedIn(page)).toEqual([]);
});
