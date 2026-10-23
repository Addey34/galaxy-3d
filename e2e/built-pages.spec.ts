import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * LES PAGES GÉNÉRÉES, CHARGÉES DANS UN NAVIGATEUR (ligne 39.1).
 *
 * `/methodology`, `/sources` et les pages de corps ne naissent qu'au build, et le serveur de
 * développement que joue `playwright.config.ts` ne les sert pas. Personne ne les avait donc
 * jamais ouvertes en CI : la section que le lot 39 a ajoutée à `/methodology` a été vérifiée À LA
 * MAIN, et cette vérification ne se rejouait pas. Ces scénarios la rejouent.
 *
 * LE TÉMOIN N'EST PAS DÉCORATIF. `vite preview` REPLIE tout chemin inconnu sur la coquille de
 * l'application, exactement comme la réécriture SPA de Firebase : une page absente est servie en
 * **HTTP 200** avec du HTML parfaitement valide. Vérifier le code de statut ne prouverait donc
 * rien. Chaque page est identifiée par son `<h1>`, LU dans le fichier construit, et un scénario
 * dédié exige qu'un chemin jamais existé rende la coquille — dont le `<h1>` diffère de tous les
 * autres.
 *
 * RIEN N'EST RECOPIÉ : la liste des pages et leurs titres sont dérivés de `dist/`.
 */

const DIST = resolve(import.meta.dirname, '../dist');

/** Le `<h1>` d'un document construit, lu sur le disque. Jamais saisi à la main. */
function builtHeading(path: string): string {
  const file = join(DIST, path, 'index.html');
  const html = readFileSync(file, 'utf-8');
  const match = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
  if (!match)
    throw new Error(`${path} : aucun <h1> dans le document construit`);
  return match[1]!.replace(/<[^>]+>/g, '').trim();
}

/**
 * Les documents à charger, DÉRIVÉS de `dist/` : `/methodology` et `/sources` dans chaque langue
 * (l'anglais sans préfixe), plus une page de corps comme témoin de cette troisième famille.
 *
 * La dérivation plutôt qu'une liste : ajouter une langue amène ses pages ici sans que personne y
 * pense, et en retirer une fait échouer le compte ci-dessous au lieu de sauter en silence.
 */
function generatedDocuments(): string[] {
  if (!existsSync(DIST))
    throw new Error(
      `dist/ est absent : ces scénarios lisent un BUILD. Lancer \`pnpm build\`, ` +
        `puis \`pnpm test:pages\`. Ils ne se sautent pas, parce qu'une garde qui se saute ` +
        `en silence n'est pas une garde.`
    );
  const prefixes = [
    '',
    ...readdirSync(DIST).filter((d) => /^(fr|es|pt-br)$/.test(d)),
  ];
  const docs: string[] = [];
  for (const prefix of prefixes)
    for (const name of [
      'methodology',
      'sources',
      'missions',
      'flybys',
      'orbit-insertions',
      'perihelia',
      'contacts',
      'places',
      'activities',
      'research',
    ])
      if (existsSync(join(DIST, prefix, name, 'index.html')))
        docs.push(prefix ? `${prefix}/${name}` : name);
  return docs;
}

const DOCUMENTS = generatedDocuments();
/** Une page de corps : la troisième famille de documents générés. */
const BODY_PAGE = 'titan';
/**
 * Une page d'objet d'instrument (2026-10-03) : la quatrième famille. Une SONDE, et celle dont le
 * bloc d'instruments est le plus long (douze identifiants du PDS), donc le pire cas de la page.
 */
const INSTRUMENT_PAGE = 'voyager1';
/**
 * Une page de mission (2026-10-04), la cinquième famille, dans les QUATRE langues : celle de
 * Voyager, qui déclare le plus de cibles (55) et donc la plus longue liste à 390 px. Chemins
 * dérivés des préfixes de langue trouvés dans `dist/`, comme les documents.
 */
const MISSION_PAGES = DOCUMENTS.filter((d) => d.endsWith('missions')).map(
  (index) => `${index}/voyager`
);

/**
 * Une page de survol (2026-10-12), la sixième famille, dans les quatre langues : une PRÉDICTION,
 * dont la note est le plus long paragraphe de la famille.
 */
const FLYBY_PAGES = DOCUMENTS.filter((d) => d.endsWith('flybys')).map(
  (index) => `${index}/solar-orbiter-venus-2026-12-24`
);

/**
 * Une page de mise en orbite (lot 49), la septième famille, dans les quatre langues : Rosetta
 * autour de 67P, le plus long nom de corps et la seule famille à porter la phrase sur
 * l'incertitude de masse, donc le pire cas à 390 px.
 */
const ORBIT_PAGES = DOCUMENTS.filter((d) => d.endsWith('orbit-insertions')).map(
  (index) => `${index}/rosetta-churyumov-gerasimenko-2014-09-10`
);

/**
 * Une page de périhélie (lot 69), dans les quatre langues : le passage du 2024-12-24 de Parker, le
 * plus cité (la NASA l'appelle son record), mesuré et donc stable d'une lecture d'Horizons à l'autre.
 */
const PERIHELION_PAGES = DOCUMENTS.filter((d) => d.endsWith('perihelia')).map(
  (index) => `${index}/parker-solar-probe-2024-12-24`
);

/**
 * Une page de contact (lot 49, pas 3), la huitième famille : Cassini dans Saturne, la seule à
 * porter les deux paragraphes du niveau de 1 bar, donc la plus longue à 390 px.
 */
const CONTACT_PAGES = DOCUMENTS.filter((d) => d.endsWith('contacts')).map(
  (index) => `${index}/cassini-saturn-2017-09-15`
);

/**
 * Une page de grand lieu (lot 55), la neuvième famille : l'océan des Tempêtes, dont le tableau des
 * instruments de l'ODE est le plus long de la Lune, donc le pire cas à 390 px.
 */
const PLACE_PAGES = DOCUMENTS.filter((d) => d.endsWith('places')).map(
  (index) => `${index}/moon/oceanus-procellarum`
);

/**
 * Une fiche d'activité (lot 58), la dixième famille, dans les quatre langues : la seule dont la
 * fiche élève imprime une adresse EN CLAIR, sans espace, donc le pire cas de coupure à 390 px.
 */
const ACTIVITY_PAGES = DOCUMENTS.filter((d) =>
  d.endsWith('activities')
).flatMap((index) =>
  readdirSync(join(DIST, index), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `${index}/${e.name}`)
);

async function settleAnimations(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const finite = document
      .getAnimations()
      .filter((a) => a.effect?.getTiming().iterations !== Infinity);
    await Promise.race([
      Promise.all(finite.map((a) => a.finished.catch(() => undefined))),
      new Promise((r) => setTimeout(r, 2000)),
    ]);
  });
}

/** Ce que mesure chaque page : la bonne page, axe propre, et aucun débordement horizontal. */
async function checkDocument(page: Page, path: string): Promise<void> {
  const response = await page.goto(`/${path}/`, {
    waitUntil: 'domcontentloaded',
  });

  // LE TÉMOIN, appliqué à chaque page : le <h1> servi est celui du document construit, et non
  // celui de la coquille que le repli SPA rendrait pour un chemin absent. Il se lit dans la
  // RÉPONSE HTTP et non dans le DOM : sur une page de corps l'application démarre, et son
  // démarrage remplace ce <h1> par le titre générique (`documentChrome`). Lu dans le DOM, le
  // témoin courait contre ce démarrage : vert sur une machine calme, rouge juste après un build
  // (`/titan` seul, au premier passage, vu quatre fois le 2026-10-23, reproduit 1 fois sur 3).
  const served = await response!.text();
  const heading = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(served);
  expect(heading, `${path} : aucun <h1> dans la réponse servie`).not.toBeNull();
  expect(heading![1]!.replace(/<[^>]+>/g, '').trim()).toBe(builtHeading(path));

  await settleAnimations(page);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    results.violations,
    `${path} : ${JSON.stringify(results.violations, null, 2)}`
  ).toEqual([]);

  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
  );
  expect(overflow, `${path} : débordement horizontal`).toBeLessThanOrEqual(0);
  await expectSeparatedLanguages(page, path);
}

/**
 * LES LIENS DE LANGUE NE SE COLLENT PAS. Sans règle de mise en page, ils s'affichaient
 * « EnglishEspañolPortuguês (Brasil) » : vu sur une capture le 2026-10-04, aucune garde ne le
 * disait, puisque axe et le débordement étaient verts. Deux liens posés sur la MÊME ligne doivent
 * être séparés d'un écart visible ; passer à la ligne est permis. Une page sans sélecteur (page de
 * corps) n'a rien à vérifier.
 */
async function expectSeparatedLanguages(page: Page, path: string) {
  // Seuls les liens RENDUS : imprimée, une fiche d'activité masque l'en-tête (lot 58), et des
  // boîtes de taille nulle se lisaient alors « collées » sans que rien ne soit affiché.
  const boxes = await page.locator('.doc-lang').evaluateAll((links) =>
    links
      .map((link) => link.getBoundingClientRect())
      .filter((r) => r.width > 0)
      .map((r) => ({ left: r.left, right: r.right, top: r.top }))
  );
  for (let i = 1; i < boxes.length; i++) {
    const [a, b] = [boxes[i - 1]!, boxes[i]!];
    if (Math.abs(a.top - b.top) > 2) continue;
    expect(
      b.left - a.right,
      `${path} : liens de langue ${i} et ${i + 1} collés`
    ).toBeGreaterThanOrEqual(4);
  }
}

test.describe('pages générées, à 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('la dérivation trouve les sept documents dans les quatre langues', () => {
    // Un compte, pour qu'une langue perdue se voie ici plutôt que par l'absence d'un scénario.
    expect(DOCUMENTS.length).toBe(40);
    expect(PLACE_PAGES.length).toBe(4);
    expect(ACTIVITY_PAGES.length).toBe(8);
    expect(DOCUMENTS).toContain('pt-br/activities');
    expect(DOCUMENTS).toContain('fr/places');
    expect(MISSION_PAGES.length).toBe(4);
    expect(FLYBY_PAGES.length).toBe(4);
    expect(ORBIT_PAGES.length).toBe(4);
    expect(CONTACT_PAGES.length).toBe(4);
    expect(PERIHELION_PAGES.length).toBe(4);
    expect(DOCUMENTS).toContain('fr/perihelia');
    expect(DOCUMENTS).toContain('pt-br/contacts');
    expect(DOCUMENTS).toContain('es/orbit-insertions');
    expect(DOCUMENTS).toContain('pt-br/flybys');
    expect(DOCUMENTS).toContain('methodology');
    expect(DOCUMENTS).toContain('es/missions');
    expect(DOCUMENTS).toContain('fr/sources');
    expect(DOCUMENTS).toContain('pt-br/methodology');
  });

  for (const path of DOCUMENTS) {
    test(`/${path} se charge, passe axe et ne déborde pas`, async ({
      page,
    }) => {
      await checkDocument(page, path);
    });
  }

  test(`/${BODY_PAGE} se charge, passe axe et ne déborde pas`, async ({
    page,
  }) => {
    await checkDocument(page, BODY_PAGE);
  });

  test(`/${INSTRUMENT_PAGE} se charge, passe axe et ne déborde pas`, async ({
    page,
  }) => {
    await checkDocument(page, INSTRUMENT_PAGE);
  });

  for (const path of [
    ...MISSION_PAGES,
    ...FLYBY_PAGES,
    ...ORBIT_PAGES,
    ...PERIHELION_PAGES,
    ...CONTACT_PAGES,
    ...PLACE_PAGES,
    ...ACTIVITY_PAGES,
  ]) {
    test(`/${path} se charge, passe axe et ne déborde pas`, async ({
      page,
    }) => {
      await checkDocument(page, path);
    });
  }

  /**
   * À 390 px les liens de langue peuvent passer chacun à la ligne ; c'est sur un écran large,
   * où ils tiennent sur une seule, que le défaut se voyait. Une page documentaire suffit : les
   * trois familles partagent le même en-tête (`documentPage.ts`).
   */
  /**
   * LA BALISE D'AUDIENCE (2026-10-20) : le build la porte (une fois), et cette suite ne l'atteint
   * pas. Sans le blocage de `playwright.pages.config.ts`, chaque passage compterait des visites
   * de `localhost` sous le jeton de la production (305 k pages vues en 30 jours, presque toutes
   * de nos tests). Falsifié en retirant l'argument de lancement : la requête n'échoue plus.
   */
  test('la balise d’audience est dans le build, et ces tests ne l’atteignent pas', async ({
    page,
  }) => {
    const html = readFileSync(join(DIST, 'index.html'), 'utf-8');
    expect(html.match(/data-cf-beacon/g)?.length).toBe(1);
    const failed: string[] = [];
    page.on('requestfailed', (request) => {
      if (request.url().includes('static.cloudflareinsights.com'))
        failed.push(request.failure()?.errorText ?? '');
    });
    await page.goto('/', { waitUntil: 'load' });
    await expect.poll(() => failed.length).toBeGreaterThan(0);
    expect(failed[0]).toContain('ERR_NAME_NOT_RESOLVED');
  });

  test('les liens de langue restent séparés sur un écran large', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/fr/missions/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.doc-lang')).toHaveCount(3);
    await expectSeparatedLanguages(page, 'fr/missions (1280 px)');
  });

  /**
   * LA FICHE IMPRIMÉE (lot 58) : une fiche d'activité est faite pour le papier. Imprimée, elle
   * perd l'en-tête et le pied de page du site, passe axe, ne déborde pas à 390 px, et la fiche
   * élève commence sur une nouvelle feuille. L'adresse de la scène y est écrite en clair.
   */
  for (const path of ACTIVITY_PAGES)
    test(`/${path} imprimée : sans habillage du site, fiche élève sur sa feuille`, async ({
      page,
    }) => {
      await page.emulateMedia({ media: 'print' });
      await checkDocument(page, path);
      await expect(page.locator('.page-header')).toBeHidden();
      await expect(page.locator('footer')).toBeHidden();
      expect(
        await page
          .locator('h2.activity-pupil')
          .evaluate((h) => getComputedStyle(h).breakBefore)
      ).toBe('page');
      await expect(page.locator('.activity-url')).toContainText(
        `?tour=${path.split('/').pop()}`
      );
    });

  /**
   * LE TÉMOIN, ISOLÉ. Sans lui, les scénarios ci-dessus pourraient passer sur une coquille servie
   * à la place d'une page absente — c'est le piège que ce dépôt a déjà payé en production. Ce
   * scénario exige donc que le repli existe ET qu'il soit DISTINGUABLE.
   */
  test('un chemin jamais existé rend la coquille, distinguable de toute page générée', async ({
    page,
  }) => {
    const response = await page.goto('/ceci-na-jamais-existe/', {
      waitUntil: 'domcontentloaded',
    });
    expect(response?.status(), 'le repli SPA sert bien un 200').toBe(200);

    const shell =
      (await page.locator('h1').first().textContent())?.trim() ?? '';
    expect(shell.length, 'la coquille porte un <h1>').toBeGreaterThan(0);
    for (const path of [
      ...DOCUMENTS,
      BODY_PAGE,
      INSTRUMENT_PAGE,
      ...FLYBY_PAGES,
      ...ORBIT_PAGES,
      ...PERIHELION_PAGES,
      ...CONTACT_PAGES,
      ...PLACE_PAGES,
      ...ACTIVITY_PAGES,
    ])
      expect(
        builtHeading(path),
        `${path} ne se distingue pas de la coquille`
      ).not.toBe(shell);
  });
});
