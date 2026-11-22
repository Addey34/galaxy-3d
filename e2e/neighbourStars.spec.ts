import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { blockExternalNetwork } from './netBlock';
import { openSettingsTab } from './settingsTab';

/**
 * LES ÉTOILES VOISINES (GAL-UNIVERSE-001) : la case « Nearby stars » ouvre la couche (repères et
 * noms avec leur distance) et la recherche ; un nom ouvre la fiche, qui dit la distance, ses
 * unités et sa provenance. Couche éteinte : aucune recherche, aucun nom. Une seule surface
 * contextuelle, fermée par Échap, et la scène reste celle du Système solaire (le corps suivi ne
 * change pas : on ne « voyage » pas vers une étoile).
 */

async function boot(page: Page): Promise<void> {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
  await page.goto('/?mode=explo&body=neptune&date=2026-09-15T11:00:00Z');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  await expect(page.locator('#neighbours-toggle')).toBeEnabled({
    timeout: 40_000,
  });
}

async function layerOn(page: Page): Promise<void> {
  await page.locator('#settings-trigger').dispatchEvent('click');
  await expect(page.locator('#orbit-options')).toBeVisible();
  await openSettingsTab(page, 'scene');
  await page.locator('#neighbours-toggle').check();
  await expect(page.locator('#neighbour-search')).toBeVisible({
    timeout: 20_000,
  });
}

for (const [label, viewport, hasTouch] of [
  ['desktop', { width: 1280, height: 800 }, false],
  ['phone', { width: 390, height: 844 }, true],
] as const) {
  test.describe(label, () => {
    test.use({ viewport, hasTouch });

    test('layer off: no search, no card, no names', async ({ page }) => {
      await boot(page);
      await expect(page.locator('#neighbour-search')).toHaveCount(0);
      await expect(page.locator('#neighbour-card')).toHaveCount(0);
      await expect(page.locator('.neighbour-names')).toHaveCount(0);
    });

    test('searching Proxima opens its card with the Gaia distance, units and provenance, no axe violation', async ({
      page,
    }) => {
      await boot(page);
      await layerOn(page);
      const search = page.locator('#neighbour-search');
      await search.fill('Proxima');
      await search.press('Enter');
      const card = page.locator('#neighbour-card');
      await expect(card).toBeVisible();
      await expect(card.locator('#neighbour-card-name')).toHaveText(
        'Proxima Centauri'
      );
      const facts = card.locator('.exo-facts');
      // Gaia DR3 : parallaxe 768,07 mas, soit 4,2465 al, avec son incertitude (±).
      await expect(facts).toContainText(/4\.246\d* ± 0\.000\d+ light-years/);
      await expect(facts).toContainText(/268,\d{3} AU/);
      await expect(facts).toContainText('2.69 km');
      await expect(card).toContainText('Gaia DR3, source 5853498713190525696');
      await expect(card).toContainText(
        'This work has made use of data from the European Space Agency'
      );
      // Une seule surface contextuelle, et le corps suivi n'a pas changé.
      await expect(page.locator('#orbit-options')).toBeHidden();
      await expect(page).toHaveURL(/\/neptune\//);

      const overflow = await card.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return [...el.querySelectorAll('*')]
          .filter((c) => c.getBoundingClientRect().right > box.right + 1)
          .map((c) => c.className || c.tagName);
      });
      expect(overflow).toEqual([]);

      await page.waitForTimeout(400);
      const results = await new AxeBuilder({ page })
        .include('#neighbour-card')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(
        results.violations.map((v) => `${v.id}: ${v.nodes.length}`)
      ).toEqual([]);

      await page.keyboard.press('Escape');
      await expect(card).toBeHidden();
    });

    test('Alpha Centauri is a pair from HYG: both stars, no uncertainty claimed, no Gaia acknowledgement', async ({
      page,
    }) => {
      await boot(page);
      await layerOn(page);
      const search = page.locator('#neighbour-search');
      await search.fill('Alpha Centauri');
      await search.press('Enter');
      const card = page.locator('#neighbour-card');
      await expect(card).toBeVisible();
      await expect(card.locator('.exo-facts')).toContainText('Toliman');
      await expect(card.locator('.exo-facts')).toContainText('Rigil Kentaurus');
      await expect(card.locator('.exo-facts')).toContainText(
        /4\.32\d? light-years/
      );
      await expect(card.locator('.exo-facts')).not.toContainText('±');
      await expect(card).toContainText('HYG v4.4');
      await expect(card).not.toContainText('has made use of data');
    });

    test('a real click or tap on the rendered marker opens its card, Escape closes it, the Solar System context stays', async ({
      page,
    }) => {
      test.setTimeout(180_000);
      await boot(page);
      await layerOn(page);
      // CIBLE STABLE : la recherche amène Proxima au centre de l'écran (`data-sky-centered`), puis
      // on ferme la fiche. Son nom 2D est posé 14 px SOUS le carré (`offsetY` de la couche) : la
      // position du carré se lit donc sur le nom, que la page rend vraiment, et le clic est celui
      // d'un utilisateur, sur le canevas, sans `dispatchEvent` ni appel direct du code métier.
      const search = page.locator('#neighbour-search');
      await search.fill('Proxima');
      await search.press('Enter');
      const card = page.locator('#neighbour-card');
      await expect(card).toBeVisible();
      await expect(page.locator('canvas').first()).toHaveAttribute(
        'data-sky-centered',
        '1',
        { timeout: 30_000 }
      );
      await page.keyboard.press('Escape');
      await expect(card).toBeHidden();

      const name = page
        .locator('.neighbour-names-item')
        .filter({ hasText: /^Proxima Centauri/ });
      await expect(name).toBeVisible({ timeout: 20_000 });
      const box = await name.boundingBox();
      if (!box) throw new Error('nom de Proxima absent');
      // Le nom est centré sous le carré : x au milieu, y = haut du nom + demi-hauteur - 14.
      const x = Math.round(box.x + box.width / 2);
      const y = Math.round(box.y + box.height / 2 - 14);
      if (hasTouch) await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);

      await expect(card).toBeVisible();
      await expect(card.locator('#neighbour-card-name')).toHaveText(
        'Proxima Centauri'
      );
      await expect(card.locator('.exo-facts')).toContainText(/4\.246\d* ±/);
      await expect(card.locator('.surface-close')).toBeFocused();
      // Fermée par Échap ; la scène n'a jamais quitté Neptune.
      await page.keyboard.press('Escape');
      await expect(card).toBeHidden();
      await expect(page).toHaveURL(/\/neptune\//);
    });

    test('switching the layer off closes the card and hides the names', async ({
      page,
    }) => {
      await boot(page);
      await layerOn(page);
      await page.locator('#neighbour-search').fill('Sirius');
      await page.locator('#neighbour-search').press('Enter');
      await expect(page.locator('#neighbour-card')).toBeVisible();
      await page.locator('#settings-trigger').dispatchEvent('click');
      await expect(page.locator('#orbit-options')).toBeVisible();
      await openSettingsTab(page, 'scene');
      await page.locator('#neighbours-toggle').uncheck();
      await expect(page.locator('#neighbour-card')).toBeHidden();
      await expect(page.locator('#neighbour-search-row')).toBeHidden();
      await expect(page.locator('.neighbour-names')).toBeHidden();
    });
  });
}

/**
 * CHARGEMENT DIFFÉRÉ, BASCULES RAPIDES, LANGUES (GAL-UNIVERSE-001-QUAL, lot C). Couche éteinte : le
 * fichier n'est jamais demandé. Trois clics de suite sur la case, sans attendre le fichier : l'état
 * final est celui du dernier clic, et le fichier n'est lu qu'une fois.
 */
test.describe('lazy loading, rapid toggles, languages', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  const requestsFor = (page: Page): string[] => {
    const seen: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/assets/sky/neighbours.json')) seen.push(r.url());
    });
    return seen;
  };

  async function openSettings(page: Page): Promise<void> {
    await page.locator('#settings-trigger').dispatchEvent('click');
    await expect(page.locator('#orbit-options')).toBeVisible();
    await openSettingsTab(page, 'scene');
  }

  test('layer off: the file is never requested; on: exactly once, however often it is toggled', async ({
    page,
  }) => {
    const seen = requestsFor(page);
    await boot(page);
    await page.waitForTimeout(1500);
    expect(seen).toEqual([]);
    await openSettings(page);
    await page.locator('#neighbours-toggle').check();
    await expect(page.locator('#neighbour-search')).toBeVisible({
      timeout: 20_000,
    });
    await page.locator('#neighbours-toggle').uncheck();
    await page.locator('#neighbours-toggle').check();
    await expect(page.locator('#neighbour-search-row')).toBeVisible();
    expect(seen).toHaveLength(1);
  });

  test('three clicks in a row, before the file arrives: the last one wins (on)', async ({
    page,
  }) => {
    await boot(page);
    await openSettings(page);
    const toggle = page.locator('#neighbours-toggle');
    // Trois vrais clics, sans attendre le fichier ni l'état intermédiaire : on, off, on.
    await toggle.click();
    await toggle.click();
    await toggle.click();
    await expect(toggle).toBeChecked();
    await expect(page.locator('#neighbour-search-row')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('.neighbour-names')).toBeVisible();
  });

  test('two clicks in a row, before the file arrives: the last one wins (off)', async ({
    page,
  }) => {
    await boot(page);
    await openSettings(page);
    const toggle = page.locator('#neighbours-toggle');
    await toggle.click();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    // La couche s'est chargée puis éteinte : ni champ, ni noms, ni fiche.
    await expect(page.locator('#neighbour-search-row')).toBeHidden({
      timeout: 20_000,
    });
    await expect(page.locator('.neighbour-names')).toBeHidden();
    await expect(page.locator('#neighbour-card')).toBeHidden();
  });

  test('reopening after a card was closed: the layer and its search still work', async ({
    page,
  }) => {
    await boot(page);
    await layerOn(page);
    const search = page.locator('#neighbour-search');
    await search.fill('Sirius');
    await search.press('Enter');
    await expect(page.locator('#neighbour-card')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#neighbour-card')).toBeHidden();
    // Le champ vit dans les Réglages, que l'ouverture de la fiche a refermés (une seule surface
    // contextuelle, comme pour les fiches du ciel profond et des exoplanètes) : on les rouvre.
    await openSettings(page);
    await expect(search).toBeVisible();
    await search.fill('Barnard');
    await search.press('Enter');
    await expect(page.locator('#neighbour-card-name')).toHaveText(
      "Barnard's Star"
    );
    // Barnard : 10,4″/an et il se rapproche ; la fiche le dit, sa source est Gaia.
    await expect(page.locator('#neighbour-card')).toContainText('approaching');
    await expect(page.locator('#neighbour-card')).toContainText('Gaia DR3');
  });

  for (const [locale, light, unit, toggleLabel] of [
    ['en', 'light-years', 'ly', 'Nearby stars'],
    ['fr', 'années-lumière', 'al', 'Étoiles voisines'],
    ['es', 'años luz', 'al', 'Estrellas cercanas'],
    ['pt-BR', 'anos-luz', 'a.l.', 'Estrelas próximas'],
  ] as const) {
    test(`language ${locale}: toggle label, names, card and units follow`, async ({
      page,
    }) => {
      await blockExternalNetwork(page);
      await page.addInitScript((l) => {
        localStorage.setItem('ssv-guided-tour-v1', '1');
        localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
        localStorage.setItem('ssv-locale', l);
      }, locale);
      await page.goto('/?mode=explo&body=neptune&date=2026-09-15T11:00:00Z');
      await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
      await expect(page.locator('#neighbours-toggle')).toBeEnabled({
        timeout: 40_000,
      });
      await openSettings(page);
      await expect(
        page.locator('#neighbours-toggle-wrapper .settings-switch-label')
      ).toHaveText(toggleLabel);
      await page.locator('#neighbours-toggle').check();
      const search = page.locator('#neighbour-search');
      await expect(search).toBeVisible({ timeout: 20_000 });
      await search.fill('Proxima');
      await search.press('Enter');
      const card = page.locator('#neighbour-card');
      await expect(card).toBeVisible();
      await expect(card.locator('.exo-facts')).toContainText(light);
      // Jamais une clé brute (`nb.card.…`) ni une phrase restée en anglais dans une autre langue.
      await expect(card).not.toContainText(/nb\.card|nb\.unit/);
      if (locale !== 'en') await expect(card).not.toContainText('light-years');
      await page.keyboard.press('Escape');
      await expect(page.locator('.neighbour-names-item').first()).toContainText(
        ` ${unit}`,
        { timeout: 20_000 }
      );
    });
  }

  test('switching the language with the layer on rewrites the names and the toggle', async ({
    page,
  }) => {
    await boot(page);
    await layerOn(page);
    await expect(page.locator('.neighbour-names-item').first()).toContainText(
      ' ly',
      { timeout: 20_000 }
    );
    await page.locator('#help-btn').dispatchEvent('click');
    await page.locator('#lang-switch .lang-btn[data-locale="fr"]').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.locator('.neighbour-names-item').first()).toContainText(
      ' al',
      { timeout: 20_000 }
    );
    await expect(
      page.locator('.neighbour-names-item').first()
    ).not.toContainText(' ly');
    // Une fiche ouverte après le changement est dans la nouvelle langue.
    await page.keyboard.press('Escape');
    await page.locator('#settings-trigger').dispatchEvent('click');
    await openSettingsTab(page, 'scene');
    await expect(page.locator('#neighbour-search')).toBeVisible();
    await page.locator('#neighbour-search').fill('Sirius');
    await page.locator('#neighbour-search').press('Enter');
    await expect(page.locator('#neighbour-card .exo-facts')).toContainText(
      'années-lumière'
    );
  });
});
