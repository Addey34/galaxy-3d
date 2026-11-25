import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { blockExternalNetwork } from './netBlock';
import { openSettingsTab } from './settingsTab';

/**
 * EXPLORER UN SYSTÈME DEPUIS LE CIEL (GAL-UNIVERSE-007), dans Chromium : la fiche d'un système du ciel ouvre
 * l'exploration de GAL-UNIVERSE-006 (même scène, même fiche), le retour rend la fiche du MÊME système, l'adresse
 * `view=system&host=` rouvre l'exploration, Retour et Suivant la suivent, et les architectures distinctes des
 * données livrées se lisent honnêtement : transit multiplanétaire, imagerie, microlentille, circumbinaire,
 * étoile du voisinage choisie dans le ciel, hôte absent de l'instantané détaillé.
 */
const SOLAR = '/?mode=explo&body=neptune&date=2026-09-15T11:00:00Z';
const explorer = (page: Page) => page.locator('#system-explorer');
const card = (page: Page) => page.locator('#system-card');
const search = (page: Page) => new URL(page.url()).searchParams;

async function quiet(page: Page, locale = 'en'): Promise<void> {
  await blockExternalNetwork(page);
  await page.addInitScript((l) => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', l);
  }, locale);
}

async function load(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
}

/** Ouvre la fiche d'un système du ciel par la recherche (le même chemin qu'un clic sur son anneau). */
async function skyCard(page: Page, name: string): Promise<void> {
  await expect(page.locator('#exoplanets-toggle')).toBeEnabled({
    timeout: 40_000,
  });
  await page.locator('#settings-trigger').dispatchEvent('click');
  await openSettingsTab(page, 'scene');
  if (!(await page.locator('#exoplanets-toggle').isChecked()))
    await page.locator('#exoplanets-toggle').check();
  const field = page.locator('#exoplanets-search');
  await expect(field).toBeVisible();
  await field.fill(name);
  await field.press('Enter');
  await expect(page.locator('#exo-card-name')).toHaveText(name);
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('ciel → fiche de TRAPPIST-1 → exploration → retour à la MÊME fiche ; Retour, Suivant, axe', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await quiet(page);
    const buckets: string[] = [];
    page.on('request', (r) => {
      if (/\/assets\/sky\/systems\/\d\d\.json$/.test(r.url()))
        buckets.push(r.url());
    });
    await load(page, SOLAR);
    await skyCard(page, 'TRAPPIST-1');
    expect(buckets).toEqual([]);
    await page.locator('#exo-card-explore').click();
    await expect(explorer(page)).toBeVisible({ timeout: 60_000 });
    // L'identifiant de l'hôte CHOISI : un seul paquet, celui de son nom.
    expect(buckets).toHaveLength(1);
    await expect(page.locator('#system-title')).toHaveText(
      'The TRAPPIST-1 system'
    );
    expect(search(page).get('view')).toBe('system');
    expect(search(page).get('host')).toBe('trappist-1');
    await expect(page.locator('#system-list .sx-item--planet')).toHaveCount(7);
    await expect(card(page)).toContainText(
      'Star known from the NASA Exoplanet Archive only'
    );
    await expect(card(page)).toContainText('Distance from the Sun (archive)');
    await expect(page.locator('#system-back')).toHaveText('Back to the sky');
    await page
      .locator('#system-list button', { hasText: 'TRAPPIST-1 e (planet)' })
      .click();
    expect(search(page).get('planet')).toBe('trappist-1-e');
    const axe = await new AxeBuilder({ page })
      .include('#system-explorer')
      .analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);

    // Échap : retour à l'observation d'origine, la fiche du MÊME système, l'adresse sans la vue.
    await page.keyboard.press('Escape');
    await expect(explorer(page)).toHaveCount(0);
    await expect(page.locator('#exoplanet-card')).toBeVisible();
    await expect(page.locator('#exo-card-name')).toHaveText('TRAPPIST-1');
    expect(search(page).get('view')).toBeNull();

    // Retour du navigateur ferme l'exploration ouverte par un geste ; Suivant la rouvre.
    await page.locator('#exo-card-explore').click();
    await expect(explorer(page)).toBeVisible({ timeout: 60_000 });
    await page.goBack();
    await expect(explorer(page)).toHaveCount(0);
    expect(search(page).get('view')).toBeNull();
    await page.goForward();
    await expect(explorer(page)).toBeVisible({ timeout: 60_000 });
    await page.locator('#system-back').click();
    await expect(explorer(page)).toHaveCount(0);
    expect(search(page).get('view')).toBeNull();
  });

  test('architectures distinctes, par lien : imagerie, microlentille, circumbinaire, voisine, hôte absent', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await quiet(page);
    // HR 8799 : quatre planètes vues en IMAGERIE ; l'excentricité de b n'est pas publiée.
    await load(page, `${SOLAR}&view=system&host=hr-8799`);
    await expect(explorer(page)).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('#system-list .sx-item--planet')).toHaveCount(4);
    await page
      .locator('#system-list button', { hasText: 'HR 8799 b (planet)' })
      .click();
    await expect(card(page)).toContainText('Direct imaging');
    await expect(card(page)).toContainText(
      'not published: the orbit is a dashed circle'
    );

    // Kepler-47 : trois planètes CIRCUMBINAIRES, aucune étoile seule au centre, et c'est dit.
    await page.keyboard.press('Escape');
    await load(page, `${SOLAR}&view=system&host=kepler-47`);
    await expect(explorer(page)).toBeVisible({ timeout: 60_000 });
    await expect(card(page)).toContainText('orbits a PAIR of stars');
    await expect(card(page)).toContainText(
      'The archive counts 2 stars in this system.'
    );
    await expect(card(page)).not.toContainText('drawn at its published radius');
    await page.locator('#system-list .sx-item--planet').first().click();
    await expect(card(page)).toContainText('circumbinary');

    // Microlentille : une planète sans demi-grand axe ni masse d'étoile n'a pas d'orbite dessinée.
    await load(page, `${SOLAR}&view=system&host=kmt-2024-blg-0404l`);
    await expect(explorer(page)).toBeVisible({ timeout: 60_000 });
    await expect(
      page
        .locator('#system-list button', { hasText: 'orbit not drawn' })
        .first()
    ).toBeVisible();

    // Une étoile du VOISINAGE choisie dans le ciel garde ses données du catalogue (Gaia ou HYG).
    await load(page, `${SOLAR}&view=system&host=eps-eri`);
    await expect(explorer(page)).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('#system-title')).toHaveText('The Ran system');
    await expect(card(page)).toContainText(
      'Spectral type (neighbourhood catalogue)'
    );

    // Gliese 48 : dans le ciel, absent de l'instantané détaillé : vue documentaire, et la raison est dite.
    await load(page, `${SOLAR}&view=system&host=gliese-48`);
    await expect(explorer(page)).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('#system-status')).toContainText(
      'absent from the detailed snapshot: Gliese 48'
    );

    // Un hôte inconnu : rien ne s'ouvre, l'adresse est nettoyée.
    await load(page, `${SOLAR}&view=system&host=no-such-star`);
    await expect.poll(() => search(page).get('view')).toBeNull();
    await expect(explorer(page)).toHaveCount(0);
  });
});

test.describe('téléphone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('en français, par lien : le volet tient sans déborder, retour au ciel', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await quiet(page, 'fr');
    await load(
      page,
      `${SOLAR}&view=system&host=trappist-1&planet=trappist-1-d`
    );
    await expect(explorer(page)).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('#system-card-title')).toHaveText('TRAPPIST-1 d');
    await expect(page.locator('#system-back')).toHaveText('Retour au ciel');
    // Polices Linux plus larges que Windows : le pire cas, tableau déplié compris.
    await page.addStyleTag({
      content: '#system-explorer * { letter-spacing: 1px !important; }',
    });
    await page.locator('#system-table-box summary').tap();
    const overflow = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('#system-explorer *'))
        .filter((e) => !e.closest('.sv-labels'))
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return (
            r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1)
          );
        })
        .map((e) => e.id || e.className || e.tagName)
    );
    expect(overflow).toEqual([]);
    await page.locator('#system-back').tap();
    await expect(explorer(page)).toHaveCount(0);
    expect(search(page).get('view')).toBeNull();
  });
});
