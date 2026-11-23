import { expect, test, type Locator, type Page } from '@playwright/test';
import { noteTrail, reportFailureDiagnostics } from './failureDiagnostics';
import {
  waitForCalmMainThread,
  waitForInteractiveMainThread,
} from './mainThread';
import { MOON_SCENE_DATE } from './moonScene';
import { blockExternalNetwork } from './netBlock';

/**
 * LE REPÈRE APRÈS UNE RECHERCHE DE FORMATION (GAL-PRODUCT-014). La caméra se tourne vers la
 * formation choisie mais garde sa distance : à ~9 rayons le gazetteer n'écrit aucun nom, donc
 * rien à l'écran ne disait ce qui avait été sélectionné. Le repère est un élément DOM éphémère,
 * posé sur le point projeté de la formation, qui la nomme avec son corps.
 */
test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

test.afterEach(async ({ page }, testInfo) => {
  await reportFailureDiagnostics(page, testInfo);
});

const marker = (page: Page): Locator => page.locator('#formation-marker');

async function openPalette(page: Page): Promise<void> {
  await page.goto(`/?date=${MOON_SCENE_DATE}`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  await waitForCalmMainThread(page);
  await page.locator('#body-search-trigger').click();
  await expect(page.locator('#palette-input')).toBeFocused();
}

async function searchPlace(
  page: Page,
  query: string,
  label: string
): Promise<void> {
  const input = page.locator('#palette-input');
  await input.fill('');
  await input.pressSequentially(query);
  const hit = page.locator('.palette-hit[data-kind="place"]', {
    hasText: label,
  });
  await expect(hit.first()).toBeVisible();
  await hit.first().click();
}

/** Ce que le repère montre à l'instant où il devient visible (photographié DANS la page). */
interface MarkerSnapshot {
  text: string;
  ring: { x: number; y: number; width: number; height: number };
}

/**
 * Le repère vit 12 s de TEMPS RÉEL (`LIFETIME_MS`, voulu) à partir de l'instant où
 * `data-search-focus` est publié. Lire son état par une suite d'actions Playwright (visible,
 * deux textes, boîte : cinq allers-retours) dépend donc de la vitesse du coureur : à 2-6 s par
 * action, la lecture dépasse 12 s et trouve `marker: null` alors que `data-search-focus` est
 * toujours posé (run `44641618452`, shard 6 : deux échecs puis un succès au 3e essai, état de
 * scène calme, aucune texture en vol). Reproduit en local : repère présent à la publication,
 * absent 13 s plus tard, `data-search-focus` inchangé. L'observateur est donc posé AVANT le choix
 * et photographie le repère au moment où il apparaît : plus aucune dépendance à la latence.
 */
async function watchFirstVisibleMarker(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __markerSnapshot?: MarkerSnapshot };
    w.__markerSnapshot = undefined;
    const observer = new MutationObserver(() => {
      if (w.__markerSnapshot) return;
      const el = document.querySelector<HTMLElement>('#formation-marker');
      const ring = el?.querySelector('.formation-marker-ring');
      if (!el || !ring || el.hidden) return;
      const r = ring.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      w.__markerSnapshot = {
        text: el.textContent ?? '',
        ring: { x: r.x, y: r.y, width: r.width, height: r.height },
      };
      observer.disconnect();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });
  });
}

async function firstVisibleMarker(page: Page): Promise<MarkerSnapshot> {
  const handle = await page.waitForFunction(
    () =>
      (window as unknown as { __markerSnapshot?: MarkerSnapshot })
        .__markerSnapshot,
    undefined,
    { timeout: 60_000 }
  );
  return (await handle.jsonValue()) as MarkerSnapshot;
}

test('after choosing a formation a visible marker names it and its body', async ({
  page,
}) => {
  await openPalette(page);
  await watchFirstVisibleMarker(page);
  await searchPlace(page, 'Tycho', 'Tycho');
  const shown = await firstVisibleMarker(page);
  expect(shown.text).toContain('Tycho');
  expect(shown.text).toContain('Moon');
  // Il pose le repère sur le point visé : au centre de l'image, puisque le cadrage l'y amène.
  const box = shown.ring;
  const view = page.viewportSize();
  if (view) {
    expect(Math.abs(box.x + box.width / 2 - view.width / 2)).toBeLessThan(
      view.width * 0.1
    );
    expect(Math.abs(box.y + box.height / 2 - view.height / 2)).toBeLessThan(
      view.height * 0.15
    );
  }
  // Le point visé est bien celui que la page annonce : même formation que le repère.
  await expect(page.locator('canvas').first()).toHaveAttribute(
    'data-search-focus',
    /^Tycho\|/
  );
});

test('the marker is announced once, with the formation and its body', async ({
  page,
}) => {
  await openPalette(page);
  await searchPlace(page, 'Tycho', 'Tycho');
  await expect(
    page.locator('[role="status"][aria-live="polite"]').filter({
      hasText: /Tycho.*Moon|Moon.*Tycho/,
    })
  ).toHaveCount(1, { timeout: 60_000 });
});

test('Escape removes the marker and leaves nothing running', async ({
  page,
}) => {
  await openPalette(page);
  await searchPlace(page, 'Tycho', 'Tycho');
  await expect(marker(page)).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press('Escape');
  await expect(marker(page)).toHaveCount(0);
});

test('going back to the global view removes the marker', async ({ page }) => {
  await openPalette(page);
  await searchPlace(page, 'Tycho', 'Tycho');
  await expect(marker(page)).toBeVisible({ timeout: 60_000 });
  // Le repère s'affiche pendant que la scène charge encore la Lune. Un clic de Playwright y attend
  // son tour : « click action done » puis « waiting for scheduled navigations to finish » jusqu'aux
  // 15 s (run `44971241404`, shard 2 : l'application avait pourtant répondu, URL revenue à la vue
  // d'ensemble, `marker: null`, 2 textures en vol). Mesuré en local, frein CPU x8, ce test seul :
  // 2 échecs sur 4 sans cette attente, 0 sur 6 avec (puis 5 sur 5 avec la variante interactive, même
  // frein). Variante INTERACTIVE : la cause est la texture en vol, que le contrat interactif garde
  // (avec l'absence de vol de caméra), et son budget d'image de 3 s (cf. `mainThread.ts`) évite
  // d'expirer sur un coureur lent où `waitForCalmMainThread` exigerait des images sous 1,5 s.
  await waitForInteractiveMainThread(page);
  await page.locator('#orbit-overview').click();
  await expect(marker(page)).toHaveCount(0);
});

test('a place address shows the same marker and keeps its contract', async ({
  page,
}) => {
  await page.goto(`/moon/?place=Mare%20Imbrium&date=${MOON_SCENE_DATE}`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  await expect(marker(page)).toBeVisible({ timeout: 60_000 });
  await expect(marker(page)).toContainText('Mare Imbrium');
  await expect(page).not.toHaveURL(/place=/);
});

test('two quick choices leave only the last formation marked', async ({
  page,
}) => {
  await openPalette(page);
  await searchPlace(page, 'Tycho', 'Tycho');
  // Le fil principal est saturé par le vol vers la Lune et ses textures : un clic de Playwright
  // y attend son tour (« waiting for scheduled navigations », puis « scrolling into view »), et
  // à 15 s il tombait (run `43641969374`, shard 4). Reproduit en local sous frein CPU ×8 : 4
  // échecs sur 6 avant. On attend donc que le fil réponde, comme `openPalette` le fait au
  // départ. Le CHEVAUCHEMENT des deux choix n'est plus l'affaire de ce test, qui joue le
  // parcours d'un utilisateur : il est garanti, et prouvé, par le test déterministe qui suit
  // (la réponse du premier choix y est retenue pendant que le second est fait).
  await waitForCalmMainThread(page);
  await page.locator('#body-search-trigger').click();
  await expect(page.locator('#palette-input')).toBeFocused();
  await searchPlace(page, 'Copernicus', 'Copernicus');
  const canvas = page.locator('canvas').first();
  await expect(canvas).toHaveAttribute('data-search-focus', /^Copernicus\|/, {
    timeout: 60_000,
  });
  await expect(marker(page)).toContainText('Copernicus');
  await expect(marker(page)).not.toContainText('Tycho');
  await page.waitForTimeout(1500);
  await expect(canvas).toHaveAttribute('data-search-focus', /^Copernicus\|/);
  await expect(marker(page)).toHaveCount(1);
});

/**
 * LE CHEVAUCHEMENT, CETTE FOIS DÉTERMINISTE. Le test précédent joue le scénario d'un utilisateur
 * pressé, mais sous `prefers-reduced-motion` (celui de la suite) le vol est instantané et la
 * réponse de `loadFormations` arrive souvent avant le second choix : le chevauchement y dépend de
 * la machine. Ici on RETIENT la réponse du fichier des formations de la Lune : le premier choix
 * est alors forcément en attente quand le second est fait, puis on libère les deux.
 *
 * Les deux choix sont de vrais clics sur de vraies entrées de la palette. Ce que l'on exige :
 * LES DEUX FORMATIONS SONT SUR LA LUNE (« Copernicus » désigne d'abord un cratère de Mars : le
 * second choix aurait alors changé de corps, et la garde de CIBLE de `lookAtFormation` aurait écarté
 * la première réponse à elle seule, sans éprouver la garde du NUMÉRO de demande qu'on veut tenir).
 * Ce que l'on exige : le premier ne tourne jamais la caméra et ne pose jamais de repère (on enregistre CHAQUE valeur
 * de `data-search-focus` et CHAQUE texte du repère, pas seulement l'état final, qu'un premier
 * repère vite remplacé laisserait identique), le dernier gagne, et il n'y a qu'un repère.
 */
test('a first choice still waiting when the second is made never turns the camera nor marks', async ({
  page,
}, testInfo) => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = 0;
  await page.route('**/assets/gazetteer/moon.json', async (route) => {
    requested += 1;
    await gate;
    await route.continue();
  });
  await openPalette(page);
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __formationSeen: string[] }).__formationSeen = seen;
    // On lit les ENREGISTREMENTS, pas l'état au moment du rappel : deux écritures dans la même
    // tâche (un premier choix périmé suivi du second) ne donnent qu'un rappel, qui ne verrait que
    // la dernière valeur. `oldValue` et les nœuds ajoutés gardent chacune des valeurs posées.
    const canvas = document.querySelector('canvas');
    if (canvas) {
      new MutationObserver((records) => {
        for (const record of records) {
          if (record.oldValue)
            seen.push(`focus:${record.oldValue.split('|')[0]}`);
        }
        const focus = canvas.getAttribute('data-search-focus');
        if (focus) seen.push(`focus:${focus.split('|')[0]}`);
      }).observe(canvas, {
        attributes: true,
        attributeOldValue: true,
        attributeFilter: ['data-search-focus'],
      });
    }
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of Array.from(record.addedNodes)) {
          if ((node as Element).id === 'formation-marker') {
            const text = node.textContent?.replace(/\s+/g, ' ').trim();
            if (text) seen.push(`marker:${text}`);
          }
        }
      }
    }).observe(document.body, { childList: true });
  });

  await searchPlace(page, 'Tycho', 'Tycho');
  // Le premier choix est EN ATTENTE : sa réponse est demandée et retenue.
  await expect.poll(() => requested, { timeout: 60_000 }).toBeGreaterThan(0);
  noteTrail(
    testInfo,
    `fichier des formations demandé ${requested} fois, retenu`
  );
  await expect(marker(page)).toHaveCount(0);
  await expect(page.locator('canvas').first()).not.toHaveAttribute(
    'data-search-focus',
    /.+/
  );

  // Attendre le calme ne change rien au chevauchement : c'est la réponse RETENUE, et non la
  // vitesse du second clic, qui garde le premier choix en attente.
  await waitForCalmMainThread(page);
  await page.locator('#body-search-trigger').click();
  await expect(page.locator('#palette-input')).toBeFocused();
  await searchPlace(page, 'Clavius', 'Clavius');
  noteTrail(testInfo, 'second choix fait, première réponse toujours retenue');

  release();
  const canvas = page.locator('canvas').first();
  await expect(canvas).toHaveAttribute('data-search-focus', /^Clavius\|/, {
    timeout: 60_000,
  });
  await expect(marker(page)).toContainText('Clavius');
  await expect(marker(page)).toHaveCount(1);
  const seen = await page.evaluate(
    () => (window as unknown as { __formationSeen: string[] }).__formationSeen
  );
  noteTrail(testInfo, `valeurs vues : ${JSON.stringify(seen)}`);
  expect(seen.filter((entry) => entry.includes('Tycho'))).toEqual([]);
  expect(seen.some((entry) => entry.includes('Clavius'))).toBe(true);
});

test('a choice overtaken by the global view neither turns the camera nor marks', async ({
  page,
}) => {
  await openPalette(page);
  const input = page.locator('#palette-input');
  await input.pressSequentially('Tycho');
  const hit = page.locator('.palette-hit[data-kind="place"]', {
    hasText: 'Tycho',
  });
  await expect(hit.first()).toBeVisible();
  // Dans le même tick : la formation se charge encore (`loadFormations`) quand la vue globale
  // reprend la main, donc la réponse qui arrive ensuite est périmée. Les vols sont instantanés
  // sous `prefers-reduced-motion`, c'est cette attente-là qui est la fenêtre de la course.
  await hit.first().evaluate((el) => {
    (el as HTMLElement).click();
    (document.querySelector('#orbit-overview') as HTMLElement).click();
  });
  const canvas = page.locator('canvas').first();
  await page.waitForTimeout(4000);
  await expect(marker(page)).toHaveCount(0);
  await expect(canvas).not.toHaveAttribute('data-search-focus', /.+/);
});

test('the marker never takes focus nor adds a tab stop', async ({ page }) => {
  await openPalette(page);
  await searchPlace(page, 'Tycho', 'Tycho');
  await expect(marker(page)).toBeVisible({ timeout: 60_000 });
  const before = await page.evaluate(
    () => document.activeElement?.id ?? document.activeElement?.tagName
  );
  await page.waitForTimeout(500);
  const after = await page.evaluate(
    () => document.activeElement?.id ?? document.activeElement?.tagName
  );
  expect(after).toBe(before);
  await expect(marker(page)).toHaveAttribute('aria-hidden', 'true');
  expect(
    await marker(page).locator('a, button, input, [tabindex]').count()
  ).toBe(0);
});

for (const [place, body] of [
  ['Olympus Mons', 'Mars'],
  ['Caloris Planitia', 'Mercury'],
] as const) {
  test(`${place} on ${body}: the marker names both and sits on the formation`, async ({
    page,
  }) => {
    await openPalette(page);
    await searchPlace(page, place, place);
    const canvas = page.locator('canvas').first();
    await expect(canvas).toHaveAttribute(
      'data-search-focus',
      new RegExp(`^${place}[|]`),
      { timeout: 60_000 }
    );
    const [, offset, side] = (
      (await canvas.getAttribute('data-search-focus')) ?? ''
    ).split('|');
    expect(side).toBe('front');
    expect(Number(offset)).toBeLessThan(0.05);
    await expect(marker(page)).toBeVisible();
    await expect(marker(page)).toContainText(place);
    await expect(marker(page)).toContainText(body);
    const ring = await marker(page)
      .locator('.formation-marker-ring')
      .boundingBox();
    const view = page.viewportSize();
    expect(ring).not.toBeNull();
    if (ring && view) {
      expect(Math.abs(ring.x + ring.width / 2 - view.width / 2)).toBeLessThan(
        view.width * 0.1
      );
    }
  });
}
