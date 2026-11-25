import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { blockExternalNetwork } from './netBlock';
import { openSettingsTab } from './settingsTab';
import { SOLAR, load, quiet } from './stellarAddressScenarios';

/**
 * EXPLORER UN SYSTÈME STELLAIRE (GAL-UNIVERSE-006), dans Chromium : du Système solaire au voisinage, puis
 * au système d'une étoile, à ses composantes et aux orbites de ses planètes cataloguées, et retour. Les
 * valeurs sont LUES dans les fichiers livrés par la vue : ce fichier vérifie le parcours, la nature dite de
 * chaque information et les quatre cas de couverture ; `core/exoplanetSystems.test.ts` leur justesse.
 */
const EXPLORER_MODULE = /\/src\/ui\/systemExplorer\.ts(\?.*)?$/;
const BUCKET = /\/assets\/sky\/systems\/\d\d\.json$/;
const explorer = (page: Page) => page.locator('#system-explorer');
const card = (page: Page) => page.locator('#system-card');
const search = (page: Page) => new URL(page.url()).searchParams;

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
});

async function chooseStar(page: Page, name: string): Promise<void> {
  await page.locator('#stellar-list button', { hasText: name }).first().click();
  await expect(page.locator('#stellar-card-title')).toBeVisible();
  await expect(page.locator('#stellar-explore')).toBeVisible();
}

async function explore(page: Page): Promise<void> {
  await page.locator('#stellar-explore').click();
  await expect(explorer(page)).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#system-list button').first()).toBeVisible();
}

/** Le point de l'écran (px) où la vue a posé le nom d'un objet : celui de l'objet lui-même. */
async function labelPoint(
  page: Page,
  key: string
): Promise<{ x: number; y: number }> {
  const label = page.locator(`#system-explorer [data-label="${key}"]`);
  await expect(label).toBeVisible({ timeout: 20_000 });
  const x = Number(await label.getAttribute('data-sx'));
  const y = Number(await label.getAttribute('data-sy'));
  return { x, y };
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('Système solaire → voisinage → Proxima → ses orbites, la nature de chaque valeur, l’adresse, et retour', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await quiet(page);
    const modules: string[] = [];
    const buckets: string[] = [];
    page.on('request', (r) => {
      if (EXPLORER_MODULE.test(r.url())) modules.push(r.url());
      if (BUCKET.test(r.url())) buckets.push(r.url());
    });
    await load(page, SOLAR);
    await page.locator('#settings-trigger').dispatchEvent('click');
    await openSettingsTab(page, 'scene');
    await page.locator('#stellar-open').click();
    await expect(page.locator('#stellar-view')).toBeVisible({
      timeout: 60_000,
    });
    // Rien de l'exploration n'est téléchargé avant qu'on la demande.
    expect(modules).toEqual([]);
    expect(buckets).toEqual([]);
    await chooseStar(page, 'Proxima Centauri');
    await explore(page);
    expect(modules).toHaveLength(1);
    expect(buckets).toHaveLength(1);
    await expect(page.locator('#system-title')).toHaveText(
      'The Proxima Centauri system'
    );
    expect(search(page).get('explore')).toBe('1');
    expect(search(page).get('star')).toBe('proxima-centauri');
    // La vue du voisinage est masquée (pas retirée) : seule l'exploration se voit.
    await expect(page.locator('#stellar-list')).toBeHidden();
    await expect(page.locator('#system-back')).toBeFocused();

    // La primaire : les paramètres de l'hôte de l'archive, et le compte d'étoiles qu'elle donne (α Cen).
    await expect(card(page)).toContainText('Effective temperature');
    await expect(card(page)).toContainText('The archive counts 3 stars');
    await expect(
      page.locator('#system-list button', { hasText: 'Proxima Cen b (planet)' })
    ).toBeVisible();

    // Un VRAI clic sur l'orbite, au point où la vue en pose le nom : la planète est choisie.
    const point = await labelPoint(page, 'planet-1');
    await page.mouse.click(point.x, point.y);
    await expect(page.locator('#system-card-title')).toHaveText(
      'Proxima Cen b'
    );
    await expect(card(page)).toContainText('minimum mass, m sin i');
    await expect(card(page)).toContainText('calculated by the archive');
    await expect(card(page)).toContainText(
      'Where the planet is on its orbit is not known'
    );
    await expect(card(page)).toContainText('often fixed at zero by the fit');
    expect(search(page).get('planet')).toBe('proxima-cen-b');

    // La comparaison avec le Système solaire : un bouton à état, les orbites nommées comme telles.
    await page.locator('#system-compare').click();
    await expect(page.locator('#system-compare')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(page.locator('#system-compare-note')).toBeVisible();
    await expect(
      page.locator('#system-explorer [data-label="ring-mercury"]')
    ).toBeVisible({ timeout: 20_000 });

    // La nature de chaque information, et la source datée avec le remerciement exigé.
    await page.locator('#system-read summary').click();
    await expect(page.locator('#system-read')).toContainText('Illustrative');
    await expect(page.locator('#system-read')).toContainText('Unknown');
    await expect(page.locator('#system-sources')).toContainText(
      'This research has made use of the NASA Exoplanet Archive'
    );

    // Accessibilité de la vue ouverte (tableau déplié compris).
    await page.locator('#system-table-box summary').click();
    await expect(page.locator('#system-table tbody tr')).toHaveCount(2);
    const axe = await new AxeBuilder({ page })
      .include('#system-explorer')
      .analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);

    // Retour du navigateur : on revient au VOISINAGE, l'étoile toujours choisie ; Suivant rouvre l'exploration.
    await page.goBack();
    await expect(explorer(page)).toHaveCount(0);
    await expect(page.locator('#stellar-view')).toBeVisible();
    expect(search(page).get('explore')).toBeNull();
    expect(search(page).get('star')).toBe('proxima-centauri');
    await page.goForward();
    await expect(explorer(page)).toBeVisible({ timeout: 30_000 });
    // Échap ferme l'EXPLORATION seulement ; le focus revient à son bouton ; un second Échap ferme la vue.
    await page.keyboard.press('Escape');
    await expect(explorer(page)).toHaveCount(0);
    await expect(page.locator('#stellar-explore')).toBeFocused();
    await expect(page.locator('#stellar-view')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#stellar-view')).toHaveCount(0);
    expect(
      await page.evaluate(
        () => (window as unknown as { __alive?: string }).__alive
      )
    ).toBe('yes');
  });

  test('quatre systèmes réels (plusieurs planètes, plusieurs étoiles, orbite incomplète, aucune planète), puis le clavier seul', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await quiet(page);
    // Un lien ouvre directement l'exploration (Barnard : quatre planètes, chacune sa bande de distances).
    await load(
      page,
      `${SOLAR}&view=neighbourhood&star=barnards-star&explore=1`
    );
    await expect(explorer(page)).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('#system-list .sx-item--planet')).toHaveCount(4);
    await page.locator('#system-table-box summary').click();
    await expect(page.locator('#system-table tbody tr')).toHaveCount(4);
    await page
      .locator('#system-list button', { hasText: 'Barnard b (planet)' })
      .click();
    await expect(card(page)).toContainText('Distance to the star');
    expect(search(page).get('planet')).toBe('barnard-b');

    // Struve 2398 : deux étoiles, une planète chacune, la séparation projetée DÉRIVÉE.
    await page.locator('#system-back').click();
    await expect(explorer(page)).toHaveCount(0);
    await chooseStar(page, 'Struve 2398 A');
    await explore(page);
    await expect(page.locator('#system-list .sx-item--star')).toHaveCount(2);
    await expect(page.locator('#system-list .sx-item--planet')).toHaveCount(2);
    await page
      .locator('#system-list button', { hasText: 'Struve 2398 B (star)' })
      .click();
    await expect(card(page)).toContainText(
      'Projected separation from Struve 2398 A'
    );
    await expect(card(page)).toContainText('a minimum');

    // GJ 1002 : des demi-grands axes, aucune excentricité publiée : l'orbite est incomplète et le dit.
    await page.keyboard.press('Escape');
    await chooseStar(page, 'GJ 1002');
    await explore(page);
    await page
      .locator('#system-list button', { hasText: 'GJ 1002 b (planet)' })
      .click();
    await expect(card(page)).toContainText(
      'not published: the orbit is a dashed circle'
    );

    // Sirius : deux étoiles, aucune planète dans l'archive : vue documentaire, et la nuance est dite.
    await page.keyboard.press('Escape');
    await chooseStar(page, 'Sirius');
    await explore(page);
    await expect(page.locator('#system-status')).toContainText(
      'the archive lists no planet for this system'
    );
    await expect(page.locator('#system-status')).toContainText(
      'That does not mean it has none'
    );
    await expect(page.locator('#system-list .sx-item--planet')).toHaveCount(0);
    await expect(page.locator('#system-table-box')).toBeHidden();

    // Le clavier seul (même démarrage, une ouverture neuve de l'exploration) : la liste donne le même accès
    // que le clic, et les touches tournent et zooment la vue.
    await page.keyboard.press('Escape');
    await chooseStar(page, 'Gl 71');
    await page.locator('#stellar-explore').focus();
    await page.keyboard.press('Enter');
    await expect(explorer(page)).toBeVisible({ timeout: 60_000 });
    const planet = page.locator('#system-list .sx-item--planet').first();
    await planet.focus();
    await page.keyboard.press('Enter');
    await expect(planet).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#system-card-title')).toHaveText(/^tau Cet /);
    await page.locator('#system-surface').focus();
    const before = await page.locator('#system-field').textContent();
    await page.keyboard.press('-');
    await page.keyboard.press('-');
    await expect(page.locator('#system-field')).not.toHaveText(before ?? '');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Home');
    await expect(explorer(page)).toBeVisible();
  });
});

test.describe('téléphone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('en français : le volet porte la fiche, rien ne déborde, une planète se choisit', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await quiet(page, 'fr');
    await load(
      page,
      `${SOLAR}&view=neighbourhood&star=proxima-centauri&explore=1&planet=proxima-cen-d`
    );
    await expect(explorer(page)).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('#system-title')).toHaveText(
      'Le système Proxima Centauri'
    );
    // La planète de l'adresse est choisie dès l'ouverture.
    await expect(page.locator('#system-card-title')).toHaveText(
      'Proxima Cen d'
    );
    await expect(card(page)).toContainText('masse minimale, m sin i');
    await expect(card(page)).toContainText('calculé');
    // Les polices Linux de la CI sont plus larges que celles de Windows (33 px de débordement déjà vus) :
    // on élargit le texte ici pour mesurer le pire cas, tableau déplié compris.
    await page.addStyleTag({
      content: '#system-explorer * { letter-spacing: 1px !important; }',
    });
    await page.locator('#system-table-box summary').tap();
    const overflow = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('#system-explorer *'))
        .filter((e) => !e.classList.contains('sr-only'))
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return (
            r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1)
          );
        })
        .filter((e) => !e.closest('.sv-labels'))
        .map((e) => e.id || e.className)
    );
    expect(overflow).toEqual([]);
    await page
      .locator('#system-list button', { hasText: 'Proxima Centauri (étoile)' })
      .tap();
    await expect(page.locator('#system-card-title')).toHaveText(
      'Proxima Centauri'
    );
    expect(search(page).get('planet')).toBeNull();
  });
});
