import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { blockExternalNetwork } from './netBlock';
import { MOON_SCENE_DATE } from './moonScene';

/**
 * Audit d'accessibilité automatisé (axe-core) — pas un remplacement d'un vrai passage au
 * lecteur d'écran (NVDA/VoiceOver), mais le meilleur proxy qu'on puisse faire tourner en CI :
 * détecte ~30-50 % des problèmes WCAG réels (contraste, labels manquants, rôles ARIA mal
 * formés, structure de landmarks). Un audit manuel avec un vrai lecteur d'écran reste
 * recommandé avant de clore le point « accessibilité » du roadmap.
 */

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
});

async function boot(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
}

/**
 * Attend la fin des animations d'OUVERTURE avant de mesurer.
 *
 * Les surfaces s'ouvrent par `animation: surface-in 0.16s` de `opacity: 0` à `1`
 * (`src/styles.css`), et `toBeVisible()` est satisfait dès le premier pixel : axe pouvait donc
 * échantillonner EN COURS de fondu et lire des couleurs délavées. Mesuré le 2026-09-23 sur les
 * en-têtes du tableau de réglages : contraste 3,14 au lieu des 4,5 exigés, avec un alpha de
 * 0,40 là où le CSS déclare 0,62 (`--ink-dim`), soit un parent à environ 64,5 % d'opacité.
 * Ce n'était donc PAS un défaut d'accessibilité mais un défaut de MESURE, et il rendait la
 * porte non reproductible : la même page passait ou échouait selon la charge de la machine.
 *
 * Les animations INFINIES sont exclues (`tb-pulse`, `loader-orbit`, `context-recovery-spin`…) :
 * les attendre ne finirait jamais. Et l'attente est bornée, pour qu'une animation pathologique
 * fasse au pire une mesure imparfaite, jamais une suite suspendue.
 */
async function settleAnimations(
  page: import('@playwright/test').Page
): Promise<void> {
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter((animation) => {
      const iterations = animation.effect?.getTiming().iterations;
      return iterations !== Infinity;
    });
    await Promise.race([
      Promise.all(finite.map((a) => a.finished.catch(() => undefined))),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  });
}

async function runAxe(page: import('@playwright/test').Page) {
  await settleAnimations(page);
  return (
    new AxeBuilder({ page })
      // wcag2a/wcag2aa/wcag21aa : le socle normatif standard. Pas de disable de règle — si axe
      // trouve quelque chose, c'est traité comme un vrai finding, pas filtré par défaut.
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze()
  );
}

test('overview screen has no automatically detectable a11y violations', async ({
  page,
}) => {
  await boot(page);
  const results = await runAxe(page);
  expect(
    results.violations,
    JSON.stringify(results.violations, null, 2)
  ).toEqual([]);
});

test('body info panel has no automatically detectable a11y violations', async ({
  page,
}) => {
  await boot(page);
  await page.locator('#body-search-trigger').click();
  await page.locator('#orbit-earth').click();
  await expect(page.locator('#body-info')).toBeVisible();
  const results = await runAxe(page);
  expect(
    results.violations,
    JSON.stringify(results.violations, null, 2)
  ).toEqual([]);
});

test('body search palette has no automatically detectable a11y violations', async ({
  page,
}) => {
  await boot(page);
  await page.locator('#body-search-trigger').click();
  await expect(page.locator('#body-palette')).toBeVisible();
  const results = await runAxe(page);
  expect(
    results.violations,
    JSON.stringify(results.violations, null, 2)
  ).toEqual([]);
});

test('display settings panel has no automatically detectable a11y violations', async ({
  page,
}) => {
  await boot(page);
  await page.locator('#settings-trigger').click();
  await expect(page.locator('#orbit-options')).toBeVisible();
  await expect(page.locator('#quality-group')).toBeVisible();
  const results = await runAxe(page);
  expect(
    results.violations,
    JSON.stringify(results.violations, null, 2)
  ).toEqual([]);
});

test('weather layers panel has no automatically detectable a11y violations', async ({
  page,
}) => {
  await boot(page);
  await page.locator('#weather-trigger').click();
  await expect(page.locator('#weather-layers')).toBeVisible();
  const results = await runAxe(page);
  expect(
    results.violations,
    JSON.stringify(results.violations, null, 2)
  ).toEqual([]);
});

test('display settings, every group unfolded, has no automatically detectable a11y violations', async ({
  page,
}) => {
  // Tous les groupes dépliés : les lignes de groupe (un bouton dans un <th scope=rowgroup>,
  // trois cases) et les lignes repliées au départ passent aussi à axe. La section du champ
  // d'astéroïdes porte depuis le lot 8b une mention de provenance datée.
  await boot(page);
  await page.locator('#settings-trigger').click();
  const toggles = page.locator('#settings-table .oo-group-toggle');
  for (const toggle of await toggles.all())
    if ((await toggle.getAttribute('aria-expanded')) === 'false')
      await toggle.click();
  await expect(page.locator('#settings-table .oo-tr:visible')).toHaveCount(
    await page.locator('#settings-table .oo-tr').count()
  );
  await expect(page.locator('#smallbody-filters')).toBeVisible();
  await expect(page.locator('#smallbody-filters .sb-source')).toBeVisible();
  const results = await runAxe(page);
  expect(
    results.violations,
    JSON.stringify(results.violations, null, 2)
  ).toEqual([]);
});

test('earth events panel has no automatically detectable a11y violations', async ({
  page,
}) => {
  await boot(page);
  await page.locator('#earth-events-trigger').click();
  await expect(page.locator('#earth-events')).toBeVisible();
  // Les deux couches allumées : la liste des événements, le badge et la note sont alors
  // rendus. Le réseau est coupé par `blockExternalNetwork`, donc les listes restent vides et
  // le panneau montre son état « aucun événement », qui doit lui aussi être lisible.
  const rows = page.locator('#earth-events .ee-item');
  await rows.nth(0).locator('input').check();
  await rows.nth(1).locator('input').check();
  const results = await runAxe(page);
  expect(
    results.violations,
    JSON.stringify(results.violations, null, 2)
  ).toEqual([]);
});

test('astronomical events panel has no automatically detectable a11y violations', async ({
  page,
}) => {
  await boot(page);
  await page.locator('#events-trigger').click();
  await expect(page.locator('#astronomical-events')).toBeVisible();
  const results = await runAxe(page);
  expect(
    results.violations,
    JSON.stringify(results.violations, null, 2)
  ).toEqual([]);
});

test('help popover has no automatically detectable a11y violations', async ({
  page,
}) => {
  await boot(page);
  await page.locator('#help-btn').click();
  await expect(page.locator('#help-popover')).toBeVisible();
  const results = await runAxe(page);
  expect(
    results.violations,
    JSON.stringify(results.violations, null, 2)
  ).toEqual([]);
});

test('explo mode overview has no automatically detectable a11y violations', async ({
  page,
}) => {
  await page.goto('/?mode=explo');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  const results = await runAxe(page);
  expect(
    results.violations,
    JSON.stringify(results.violations, null, 2)
  ).toEqual([]);
});

/**
 * LE DÉBORDEMENT QU'UNE FICHE NE PEUT PAS MONTRER, ET QUE SEULE CETTE MESURE VOIT.
 *
 * `#body-info` est en `overflow-x: hidden`. Un texte trop large y est donc ROGNÉ, et la fiche
 * rapporte `scrollWidth === clientWidth` comme si tout allait bien : mesuré le 2026-09-30, un
 * identifiant PDS débordant de 70 px laissait la fiche à 286 contre 286. La métrique « la fiche
 * déborde-t-elle » est donc AVEUGLE à l'intérieur de la fiche, et c'est ce qu'elle était censée
 * tenir depuis le lot 40.
 *
 * Ce qui voit le défaut est la mesure ÉLÉMENT PAR ÉLÉMENT. Les `.sr-only` en sont exclus, et c'est
 * mesuré aussi : ce sont des boîtes d'un pixel destinées au lecteur d'écran, dont le texte
 * dépasse TOUJOURS de 179 à 213 px selon la langue. Les inclure rendrait la garde rouge à
 * l'arrivée, donc désarmée le jour suivant.
 */
/** La formation lunaire la plus observée, LUE dans la donnée livrée (ligne 40.3). */
const MOST_OBSERVED_MOON = (() => {
  const dir = resolve(
    import.meta.dirname,
    '../public/assets/place-observations/moon'
  );
  let best = { id: '', rows: -1 };
  for (const f of readdirSync(dir))
    for (const [id, rows] of Object.entries(
      (
        JSON.parse(readFileSync(resolve(dir, f), 'utf-8')) as {
          observed: Record<string, unknown[]>;
        }
      ).observed
    ))
      if (rows.length > best.rows) best = { id, rows: rows.length };
  const names = JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, '../public/assets/gazetteer/moon.json'),
      'utf-8'
    )
  ) as { name: string; iauId: number }[];
  return names.find((n) => String(n.iauId) === best.id)!.name;
})();

async function clippedOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const card = document.getElementById('body-info');
    if (!card) return ['#body-info absent'];
    const out: string[] = [];
    for (const el of card.querySelectorAll('*')) {
      if (el.classList.contains('sr-only')) continue;
      const delta = el.scrollWidth - el.clientWidth;
      if (delta > 1)
        out.push(
          `${el.tagName.toLowerCase()}.${el.className || '-'} +${delta}px ` +
            `« ${(el.textContent ?? '').trim().slice(0, 48)} »`
        );
    }
    return out;
  });
}

test.describe('mobile viewport', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('mobile overview has no automatically detectable a11y violations', async ({
    page,
  }) => {
    await boot(page);
    const results = await runAxe(page);
    expect(
      results.violations,
      JSON.stringify(results.violations, null, 2)
    ).toEqual([]);
  });

  /**
   * UN `<details>` REPLIÉ N'EST PAS AUDITÉ, et c'est le trou que cette garde ferme.
   *
   * Les onze scénarios ci-dessus ouvrent chaque surface, mais aucun ne DÉPLIE un `<details>` :
   * axe ne voit donc ni les sources d'une fiche, ni, depuis le lot 40, son bloc « Missions ».
   * Un contraste ou une structure fautive y resterait verte indéfiniment. Ce scénario l'ouvre,
   * dans les QUATRE langues, à 390 px, et vérifie en plus qu'aucun texte ne débordre en largeur
   * — la mesure que la règle du texte publié demande et qui se faisait jusqu'ici à la main.
   */
  for (const locale of ['en', 'fr', 'es', 'pt-BR'] as const) {
    test(`body card, missions and sources UNFOLDED, ${locale}, is clean at 390 px`, async ({
      page,
    }) => {
      await page.addInitScript((lang) => {
        localStorage.setItem('ssv-locale', lang);
      }, locale);
      await page.goto('/?body=titan');
      await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
      const card = page.locator('#body-info');
      await expect(card).toBeVisible();
      const missions = card.locator('.bi-missions');
      await expect(missions).toBeVisible({ timeout: 15_000 });
      // Déplier par la propriété, et non par un clic : un clic dépend du thread principal, et
      // cette garde mesure la MISE EN PAGE, pas l'interaction (que e2e/missions.spec.ts couvre).
      await card.evaluate((el) => {
        for (const d of el.querySelectorAll('details')) d.open = true;
      });
      const results = await runAxe(page);
      expect(
        results.violations,
        JSON.stringify(results.violations, null, 2)
      ).toEqual([]);

      // Aucun débordement horizontal : ni la page, ni la fiche elle-même.
      const overflow = await page.evaluate(() => {
        const el = document.getElementById('body-info')!;
        return {
          page:
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
          card: el.scrollWidth - el.clientWidth,
        };
      });
      expect(
        overflow.page,
        `débordement de la page (${locale})`
      ).toBeLessThanOrEqual(0);
      expect(
        overflow.card,
        `débordement de la fiche (${locale})`
      ).toBeLessThanOrEqual(0);
      // Et le débordement que la fiche ROGNE, donc qu'elle ne peut pas rapporter elle-même.
      expect(
        await clippedOverflow(page),
        `texte rogné dans la fiche (${locale})`
      ).toEqual([]);
    });
  }

  /**
   * LE BLOC « INSTRUMENTS » D'UNE SONDE (lot 42), même mesure et pour la même raison qu'au lot 40 :
   * les scénarios ci-dessus ouvrent la fiche d'un CORPS, où ce bloc est masqué. Il n'aurait donc
   * jamais été audité, et un contraste ou un débordement y serait resté vert indéfiniment.
   *
   * LA SONDE TÉMOIN EST MESURÉE, PAS CHOISIE AU HASARD : BepiColombo est la seule qui exerce TOUS
   * les chemins de rendu du bloc — trois légendes de porteur, dont une qui ne déclare AUCUN
   * instrument, treize instruments avec leur identifiant logique, et une investigation à fin non
   * déclarée. Elle porte aussi le plus long jeton insécable rendu (45 caractères,
   * `urn:esa:psa:context:instrument:mpo.simbio-sys`), à égalité avec Cassini : c'est exactement ce
   * qu'un identifiant non coupable ferait déborder, et le lot 41 a payé ce défaut sur un DOI.
   */
  for (const locale of ['en', 'fr', 'es', 'pt-BR'] as const) {
    test(`spacecraft card, instruments UNFOLDED, ${locale}, is clean at 390 px`, async ({
      page,
    }) => {
      await page.addInitScript((lang) => {
        localStorage.setItem('ssv-locale', lang);
      }, locale);
      await page.goto('/?body=bepicolombo');
      await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
      const card = page.locator('#body-info');
      await expect(card).toBeVisible();
      const instruments = card.locator('.bi-instruments');
      await expect(instruments).toBeVisible({ timeout: 15_000 });
      // Déplier par la propriété et non par un clic : cette garde mesure la MISE EN PAGE.
      await card.evaluate((el) => {
        for (const d of el.querySelectorAll('details')) d.open = true;
      });
      // Le bloc doit avoir du contenu à auditer : un bloc vide passerait sans rien prouver.
      await expect(instruments.locator('.bi-instruments-lid')).not.toHaveCount(
        0
      );
      await expect(instruments.locator('.bi-instruments-host')).toHaveCount(3);

      const results = await runAxe(page);
      expect(
        results.violations,
        JSON.stringify(results.violations, null, 2)
      ).toEqual([]);

      const overflow = await page.evaluate(() => {
        const el = document.getElementById('body-info')!;
        return {
          page:
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
          card: el.scrollWidth - el.clientWidth,
        };
      });
      expect(
        overflow.page,
        `débordement de la page (${locale})`
      ).toBeLessThanOrEqual(0);
      expect(
        overflow.card,
        `débordement de la fiche (${locale})`
      ).toBeLessThanOrEqual(0);
      // Et le débordement que la fiche ROGNE, donc qu'elle ne peut pas rapporter elle-même.
      expect(
        await clippedOverflow(page),
        `texte rogné dans la fiche (${locale})`
      ).toEqual([]);
    });
  }

  /**
   * LE BLOC « FORMATIONS OBSERVÉES » (ligne 40.3), avec un RÉSULTAT rendu : c'est lui qui porte
   * les noms longs de missions et d'instruments publiés par l'ODE, et le lien de l'étiquette PDS.
   * La formation témoin est la plus observée de la Lune, LUE dans la donnée livrée : elle rend le
   * plus de lignes, donc le plus de chances de déborder.
   */
  for (const locale of ['en', 'fr', 'es', 'pt-BR'] as const) {
    test(`moon card, observed formation SHOWN, ${locale}, is clean at 390 px`, async ({
      page,
    }) => {
      await page.addInitScript((lang) => {
        localStorage.setItem('ssv-locale', lang);
      }, locale);
      await page.goto(`/moon/?date=${MOON_SCENE_DATE}`);
      await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
      const card = page.locator('#body-info');
      await expect(card).toBeVisible();
      const places = card.locator('.bi-places');
      await expect(places).toBeVisible({ timeout: 15_000 });
      await card.evaluate((el) => {
        for (const d of el.querySelectorAll('details')) d.open = true;
      });
      await expect(places.locator('datalist option').first()).toBeAttached({
        timeout: 15_000,
      });
      await places.locator('.bi-places-input').fill(MOST_OBSERVED_MOON);
      await places.locator('.bi-places-input').press('Enter');
      await expect(places.locator('.bi-places-result li').first()).toBeVisible({
        timeout: 15_000,
      });

      const results = await runAxe(page);
      expect(
        results.violations,
        JSON.stringify(results.violations, null, 2)
      ).toEqual([]);
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
      );
      expect(
        overflow,
        `débordement de la page (${locale})`
      ).toBeLessThanOrEqual(0);
      expect(
        await clippedOverflow(page),
        `texte rogné dans la fiche (${locale})`
      ).toEqual([]);
    });
  }
});

/**
 * LE BLOC « DÉCOUVERTE » (lot 44), à 390 px et dans les QUATRE langues. La fiche témoin est
 * MESURÉE : Pluton en février 1930 est la seule qui exerce TOUT le bloc à la fois, deux
 * affirmations qui divergent (SBDB et NSSDCA), la phrase d'état, le compte des lunes, la prochaine
 * découverte et la note. Neptune s'y ajoute en anglais pour le découvreur le plus long publié
 * (« Galle (based on predictions by John Couch Adams and Urbain Leverrier) »).
 */
test.describe('mobile viewport, discovery block', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  const cases = [
    ...(['en', 'fr', 'es', 'pt-BR'] as const).map((locale) => ({
      locale,
      path: '/pluto/?date=1930-02-01T12:00:00Z',
    })),
    { locale: 'en' as const, path: '/neptune/' },
    // Ligne 22.10, pas 2 : Hauméa en 2004 exerce la note SBDB, la plus longue du bloc, et une
    // découverte suivante à deux noms.
    ...(['en', 'fr', 'es', 'pt-BR'] as const).map((locale) => ({
      locale,
      path: '/haumea/?date=2004-06-01T12:00:00Z',
    })),
    // Ligne 22.10, front des noms : Pluton avant ses premiers noms exerce les trois lignes des
    // noms officiels et leur note, la plus longue.
    ...(['en', 'fr', 'es', 'pt-BR'] as const).map((locale) => ({
      locale,
      path: '/pluto/?date=2017-06-01T12:00:00Z',
    })),
    // Ligne 22.10, front des croyances : Vénus en 2010 exerce le signalement ET la recherche,
    // la plus longue ligne du bloc, avec son lien.
    ...(['en', 'fr', 'es', 'pt-BR'] as const).map((locale) => ({
      locale,
      path: '/venus/?date=2010-06-01T12:00:00Z',
    })),
  ];
  for (const { locale, path } of cases) {
    test(`discovery block ${path}, ${locale}, is clean at 390 px`, async ({
      page,
    }) => {
      await page.addInitScript((lang) => {
        localStorage.setItem('ssv-locale', lang);
      }, locale);
      await page.goto(path);
      await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
      const discovery = page.locator('#body-info .bi-discovery');
      await expect(discovery).toBeVisible({ timeout: 15_000 });
      await expect(
        discovery.locator('.bi-discovery-claims li').first()
      ).toBeVisible();

      const results = await runAxe(page);
      expect(
        results.violations,
        JSON.stringify(results.violations, null, 2)
      ).toEqual([]);
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
      );
      expect(
        overflow,
        `débordement de la page (${locale})`
      ).toBeLessThanOrEqual(0);
      expect(
        await clippedOverflow(page),
        `texte rogné dans la fiche (${locale})`
      ).toEqual([]);
    });
  }
});

/**
 * LE GROUPE JULIEN DE LA BARRE DE TEMPS (ligne 22.10, années avant J.-C., pas 2), ouvert à une
 * date avant notre ère, à 390 px et dans les QUATRE langues : chaque champ porte son nom
 * (jour, mois, année, ère), le groupe le sien, et rien ne déborde ni n'est rogné.
 */
test.describe('mobile viewport, Julian date group', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  for (const locale of ['en', 'fr', 'es', 'pt-BR'] as const)
    test(`Julian date group, ${locale}, is clean at 390 px`, async ({
      page,
    }) => {
      await page.addInitScript((lang) => {
        localStorage.setItem('ssv-locale', lang);
        localStorage.setItem('ssv-guided-tour-v1', '1');
      }, locale);
      await page.goto('/jupiter/?date=-009000-07-15T12:00:00Z');
      await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
      await page.locator('#time-readout').click();
      await expect(page.locator('#historic-date')).toBeVisible({
        timeout: 15_000,
      });
      // Le cas le plus large : un jour à DEUX chiffres et une année à QUATRE. À une date dont le
      // jour julien n'a qu'un chiffre, la garde ne pouvait pas voir le champ rogné (vu le
      // 2026-10-02 : la falsification restait verte).
      expect((await page.locator('#hist-day').inputValue()).length).toBe(2);
      expect((await page.locator('#hist-year').inputValue()).length).toBe(4);
      const results = await runAxe(page);
      expect(
        results.violations,
        JSON.stringify(results.violations, null, 2)
      ).toEqual([]);
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
      );
      expect(
        overflow,
        `débordement de la page (${locale})`
      ).toBeLessThanOrEqual(0);
      const clipped = await page.evaluate(() =>
        // Le GROUPE, pas toute la barre : l'affichage de la vitesse de la barre compacte est
        // tronqué par une ellipsis VOULUE, et perd de 11 à 24 px de texte sur le runner Linux
        // (mesuré le 2026-10-02). Ce défaut est antérieur à ce pas et écrit dans la file.
        [
          ...document.querySelectorAll<HTMLElement>(
            '#historic-date, #historic-date *'
          ),
        ]
          .filter((e) => !e.classList.contains('sr-only') && e.offsetParent)
          .filter((e) => e.scrollWidth - e.clientWidth > 1)
          .map((e) => `${e.id || e.className}:${e.scrollWidth - e.clientWidth}`)
      );
      expect(clipped, `texte rogné dans la barre de temps (${locale})`).toEqual(
        []
      );
    });
});
