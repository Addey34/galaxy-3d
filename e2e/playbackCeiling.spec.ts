import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

/**
 * LE CURSEUR NE PROMET PAS CE QUE LE LIEN NE TIENT PAS, ET UNE ATTENTE SE DIT (phase 17D).
 *
 * Décision du § 9b du plan du lot 17, prise par l'utilisateur le 2026-09-24, option (c) : la
 * date reste EXACTE (D3, livrée en 17C), et c'est le curseur de vitesse qui renonce, en
 * l'affichant. Les deux moitiés se vérifient ici dans un vrai navigateur, parce qu'aucune
 * mesure unitaire ne dit si le chiffre atteint l'écran :
 *
 *   - sur un lien lent, pousser le curseur au maximum affiche la vitesse SOUTENABLE et la
 *     raison ;
 *   - quand les octets ne viennent pas du tout, le bandeau dit que la date attend, et il ne
 *     dit PAS « précision réduite », qui serait faux puisque rien n'est remplacé.
 *
 * Le lien lent est simulé par la LATENCE des réponses d'éphémérides, pas par un bridage global :
 * le compteur de débit (`core/transferRate`) mesure le temps OCCUPÉ, latence comprise, ce qui
 * est le bon modèle (un lien à forte latence ne soutient réellement pas une lecture rapide) et
 * ce qui garde ce scénario sous la minute.
 */

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

const BINARY = /\/assets\/ephemerides\/.*\.bin$/;

/** Retarde chaque réponse d'éphéméride : le compteur y voit un lien lent, et il a raison. */
async function slowEphemerides(page: Page, delayMs: number): Promise<void> {
  await page.route(BINARY, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.continue();
  });
}

/** Pousse le curseur de vitesse à son maximum, comme un glissement jusqu'au bord. */
async function pushSpeedToMax(page: Page): Promise<void> {
  const slider = page.locator('#speed-range');
  await slider.evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = input.max;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

test('sur un lien lent, le curseur affiche la vitesse que la connexion soutient', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await slowEphemerides(page, 700);

  await page.goto('/?body=mercury');
  await expect(page.locator('#loader')).toBeVisible();
  await expect(page.locator('#loader')).toBeHidden({ timeout: 120_000 });

  const slider = page.locator('#speed-range');
  const readout = page.locator('#speed-value');

  // Avant de pousser : le temps réel ne demande presque rien, donc rien n'est plafonné.
  await expect(slider).not.toHaveAttribute('data-capped', /.*/);

  await pushSpeedToMax(page);

  // Le plafond est ANNONCÉ, et il vaut ce qui a été mesuré : l'attribut porte la vitesse
  // réellement appliquée, que la garde compare à la course maximale du curseur.
  await expect(slider).toHaveAttribute('data-capped', /[0-9]+/, {
    timeout: 30_000,
  });
  await expect(readout).toContainText('limited by your connection');

  const capped = Number(await slider.getAttribute('data-capped'));
  expect(capped).toBeGreaterThan(0);
  expect(capped).toBeLessThan(31_557_600);

  // Et la poignée est revenue sur le plafond : deux positions ne peuvent pas rendre la même
  // vitesse, sinon la fin de course ne voudrait plus rien dire.
  const value = Number(await slider.inputValue());
  expect(value).toBeLessThan(Number(await slider.getAttribute('max')));

  // La date reste exacte : le gain de vitesse abandonné n'est pas payé en précision.
  await expect(page.locator('.bi-position-source')).toContainText(
    'JPL Horizons',
    { timeout: 30_000 }
  );
});

test('quand les octets ne viennent pas, le bandeau dit que la date ATTEND', async ({
  page,
}) => {
  test.setTimeout(180_000);

  await page.goto('/?body=mercury');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 120_000 });
  // Rien à dire tant que tout arrive : le silence EST l'information (lot 15).
  await expect(page.locator('#ephemeris-notice')).toHaveCount(0);

  // À partir d'ici, aucune fenêtre n'arrive plus jamais.
  let held = 0;
  await page.route(BINARY, async () => {
    held += 1;
    // Volontairement jamais résolue : la requête reste en vol.
  });

  await pushSpeedToMax(page);

  const banner = page.locator('#ephemeris-notice');
  await expect(banner).toHaveAttribute('data-state', 'waiting', {
    timeout: 60_000,
  });
  await expect(banner).toContainText('The date is waiting for its data');
  // Ce n'est PAS une dégradation : aucun fichier ne manque, donc pas de reprise à proposer et
  // surtout pas le mot « precision ».
  await expect(banner).not.toContainText('Reduced precision');
  await expect(banner.locator('.en-retry')).toBeHidden();
  expect(held).toBeGreaterThan(0);
});

test('quand le lien se rétablit, le plafond remonte et la vitesse DEMANDÉE revient', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await slowEphemerides(page, 700);

  await page.goto('/?body=mercury');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 120_000 });

  const slider = page.locator('#speed-range');
  await pushSpeedToMax(page);
  await expect(slider).toHaveAttribute('data-capped', /[0-9]+/, {
    timeout: 30_000,
  });
  const cappedWhileSlow = Number(await slider.getAttribute('data-capped'));

  // Le lien redevient normal, et on lui donne du trafic à mesurer : un saut de date charge une
  // fenêtre neuve, cette fois sans latence ajoutée.
  await page.unroute(BINARY);
  const input = page.locator('#date-input');
  await input.fill('2050-06-01');
  await input.dispatchEvent('change');

  /**
   * Le plafond doit REMONTER, et la poignée redemander ce que l'utilisateur avait demandé.
   *
   * Défaut trouvé en relisant `ui/playback.ts`, pas à l'écran : la poignée revenant sur le
   * plafond, sa valeur DEVENAIT la vitesse plafonnée. Sans mémoire de la position demandée, un
   * creux de connexion de trois secondes aurait brimé la lecture pour le reste de la session, et
   * l'attribut aurait simplement DISPARU au lieu de monter.
   */
  await expect
    .poll(
      async () => {
        const value = await slider.getAttribute('data-capped');
        return value === null ? -1 : Number(value);
      },
      { timeout: 90_000, message: 'le plafond ne remonte pas' }
    )
    .toBeGreaterThan(cappedWhileSlow);
});

/**
 * La garde de mise en page mobile démarre À la taille mobile (leçon du lot 9C : une page de
 * bureau redimensionnée ne place pas ses docks comme un téléphone, et axe ne voit pas un
 * chevauchement).
 */
test.describe('sur un téléphone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('le bandeau d’attente ne couvre aucun dock, passe axe et ne déborde pas', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/?body=mercury');
    await expect(page.locator('#loader')).toBeHidden({ timeout: 120_000 });
    await page.route(BINARY, async () => {
      // Jamais résolue : la date va attendre, et devoir le dire.
    });
    await pushSpeedToMax(page);

    const banner = page.locator('#ephemeris-notice');
    await expect(banner).toHaveAttribute('data-state', 'waiting', {
      timeout: 60_000,
    });

    for (const dock of ['.dock--top-left', '.dock--top-right', '.dock--bottom'])
      await expect
        .poll(
          async () => {
            const a = await banner.boundingBox();
            const b = await page.locator(dock).boundingBox();
            if (!a || !b) return 'rectangle absent';
            return a.x < b.x + b.width &&
              b.x < a.x + a.width &&
              a.y < b.y + b.height &&
              b.y < a.y + a.height
              ? 'chevauchement'
              : 'libre';
          },
          { message: `bandeau sur ${dock}` }
        )
        .toBe('libre');

    // Mesurer APRÈS les animations d'ouverture : sinon axe lit des couleurs délavées et rend une
    // violation de contraste qui n'existe pas (défaut de mesure corrigé au lot 17C).
    await page.evaluate(async () => {
      const finite = document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity);
      await Promise.race([
        Promise.all(finite.map((a) => a.finished.catch(() => undefined))),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
    });
    const scan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(scan.violations, JSON.stringify(scan.violations, null, 2)).toEqual(
      []
    );
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
      )
    ).toBeLessThanOrEqual(0);
    expect(errors, `Erreurs page : ${errors.join(' | ')}`).toEqual([]);
  });
});
