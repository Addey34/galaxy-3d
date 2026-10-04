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
    for (const name of ['methodology', 'sources', 'missions'])
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
  await page.goto(`/${path}/`, { waitUntil: 'domcontentloaded' });

  // LE TÉMOIN, appliqué à chaque page : le <h1> servi est celui du document construit, et non
  // celui de la coquille que le repli SPA rendrait pour un chemin absent.
  await expect(page.locator('h1').first()).toHaveText(builtHeading(path));

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
}

test.describe('pages générées, à 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('la dérivation trouve les trois documents dans les quatre langues', () => {
    // Un compte, pour qu'une langue perdue se voie ici plutôt que par l'absence d'un scénario.
    expect(DOCUMENTS.length).toBe(12);
    expect(MISSION_PAGES.length).toBe(4);
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

  for (const path of MISSION_PAGES) {
    test(`/${path} se charge, passe axe et ne déborde pas`, async ({
      page,
    }) => {
      await checkDocument(page, path);
    });
  }

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
    for (const path of [...DOCUMENTS, BODY_PAGE, INSTRUMENT_PAGE])
      expect(
        builtHeading(path),
        `${path} ne se distingue pas de la coquille`
      ).not.toBe(shell);
  });
});
