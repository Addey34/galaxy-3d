import { expect, type Page } from '@playwright/test';
import { openSettingsTab } from './settingsTab';

/**
 * L'ADRESSE D'UNE OBSERVATION DU VOISINAGE SOLAIRE (GAL-UNIVERSE-004). Les scénarios sont écrits
 * une fois ici et joués par deux fichiers : `stellarPermalink.spec.ts` (Chromium, bureau et
 * téléphone, en CI) et `device-stellarPermalink.spec.ts` (Pixel 7 et iPhone 15 émulés, hors CI).
 *
 * Le contrat (`core/stellarPermalink`) : `?view=neighbourhood&star=<identifiant>&t=<années>`.
 * Ce qu'on prouve ici, de bout en bout : un lien ouvre la vue sur la bonne étoile et au bon temps ;
 * un identifiant inconnu ou une donnée absente est dit, jamais ignoré en silence ; l'adresse suit
 * les choix ; le retour (bouton, Échap, Retour du navigateur) ramène au Système solaire sans
 * recharger, sans écrire dans l'historique du Système solaire, et sans rien laisser derrière.
 */

export const SOLAR = '/?mode=explo&body=neptune&date=2026-09-15T11:00:00Z';

/** Les drapeaux qui coupent les visites d'accueil, et la langue demandée, avant tout `goto`. */
export async function quiet(page: Page, locale = 'en'): Promise<void> {
  await page.addInitScript((l) => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', l);
  }, locale);
}

/** Charge l'adresse et attend que la scène solaire soit prête (le loader est masqué). */
export async function load(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  // Détruit par tout rechargement du document : c'est ce qui prouve « sans recharger ».
  await page.evaluate(() => {
    (window as unknown as { __alive?: string }).__alive = 'yes';
  });
}

const view = (page: Page) => page.locator('#stellar-view');
const pressed = (page: Page) =>
  page.locator('#stellar-list button[aria-pressed="true"]');
const search = (page: Page): URLSearchParams =>
  new URLSearchParams(new URL(page.url()).search);

async function openFromSettings(page: Page): Promise<void> {
  await expect(page.locator('#stellar-open')).toBeEnabled({ timeout: 40_000 });
  await page.locator('#settings-trigger').dispatchEvent('click');
  await expect(page.locator('#orbit-options')).toBeVisible();
  await openSettingsTab(page, 'scene');
  await page.locator('#stellar-open').click();
  await expect(view(page)).toBeVisible({ timeout: 30_000 });
}

/** Ce que le lecteur d'écran reçoit : la région `aria-live` unique de l'application. */
const announced = (page: Page) =>
  page.locator('p.sr-only[role="status"][aria-live="polite"]');

/**
 * Une pose de la caméra solaire qui n'est PAS celle par défaut, donnée par le permalien lui-même
 * (`az`, `pol`, `dist`, cf. `ui/share.ts`) : elle marche sur tous les appareils, sans molette ni
 * glissement (WebKit mobile n'a pas de molette). Sans elle, rien ne prouverait qu'un retour ne
 * ramène pas la caméra à sa pose d'origine : mesuré, un retour qui rappelle le permalien solaire
 * ramène la DISTANCE à sa valeur par défaut et garde l'azimut et la polaire.
 */
const NON_DEFAULT_POSE = '&az=-137&pol=62&dist=0.035';

/**
 * La pose de la caméra SOLAIRE, lue par le bouton Partager : il grave azimut, polaire et distance
 * dans l'adresse (`ui/share.ts`). Deux relevés égaux = la caméra n'a pas bougé entre eux. Un retour
 * qui rappellerait le permalien solaire reselectionnerait le corps et la ramènerait à sa pose par
 * défaut : c'est ce que ce relevé attrape.
 */
async function solarPose(page: Page): Promise<string> {
  await page.locator('#share-btn').click();
  await expect(page.locator('#share-toast')).toBeVisible();
  const p = search(page);
  return `${p.get('az')}|${p.get('pol')}|${p.get('dist')}`;
}

/** Un lien ouvre la vue sur la bonne étoile et au bon temps, depuis une session toute neuve. */
export async function scenarioDeepLink(page: Page): Promise<void> {
  const requests: string[] = [];
  page.on('request', (r) => {
    if (/stellarView|neighbours\.json/.test(r.url())) requests.push(r.url());
  });
  await load(page, `${SOLAR}&view=neighbourhood&star=barnards-star&t=1200`);
  await expect(view(page)).toBeVisible({ timeout: 60_000 });
  await expect(pressed(page)).toHaveCount(1);
  await expect(pressed(page)).toContainText(/^Barnard/);
  await expect(page.locator('#stellar-time-out')).toContainText('1,200 years');
  // La scène solaire garde sa date et son corps : l'observation s'ajoute, elle ne les remplace pas.
  const params = search(page);
  expect(params.get('view')).toBe('neighbourhood');
  expect(params.get('star')).toBe('barnards-star');
  expect(params.get('t')).toBe('1200');
  expect(params.get('date')).toBe('2026-09-15T11:00:00Z');
  expect(new URL(page.url()).pathname).toBe('/neptune/');
  // Le chargement différé reste vrai : le morceau et le fichier ne viennent que pour ce lien.
  expect(requests.length).toBeGreaterThan(0);
}

/** Un lien sans la vue ne la rouvre pas, même avec `star` et `t` (un lien ancien). */
export async function scenarioNoViewNoOpen(page: Page): Promise<void> {
  await load(page, `${SOLAR}&star=barnards-star&t=1200`);
  await page.waitForTimeout(1500);
  await expect(view(page)).toHaveCount(0);
}

/** Une étoile inconnue ou mal formée est DITE, la vue s'ouvre sans sélection, l'adresse est remise au propre. */
export async function scenarioUnknownStar(
  page: Page,
  star: string,
  phrase: RegExp
): Promise<void> {
  await load(
    page,
    `${SOLAR}&view=neighbourhood&star=${encodeURIComponent(star)}&t=300`
  );
  await expect(view(page)).toBeVisible({ timeout: 60_000 });
  await expect(pressed(page)).toHaveCount(0);
  await expect(announced(page)).toContainText(phrase, { timeout: 15_000 });
  // L'identifiant fautif est retiré : le lien partagé d'ici ne le porte plus. Le reste est gardé.
  await expect.poll(() => search(page).get('star')).toBeNull();
  expect(search(page).get('view')).toBe('neighbourhood');
  expect(search(page).get('t')).toBe('300');
}

/** Les étoiles illisibles : la vue ne s'ouvre pas, c'est dit, et la demande est retirée de l'adresse. */
export async function scenarioDataUnavailable(
  page: Page,
  phrase: RegExp
): Promise<void> {
  await page.route('**/neighbours.json', (route) =>
    route.fulfill({ status: 500, body: 'nope' })
  );
  await load(page, `${SOLAR}&view=neighbourhood&star=barnards-star`);
  await expect(announced(page)).toContainText(phrase, { timeout: 30_000 });
  await expect(view(page)).toHaveCount(0);
  await expect.poll(() => search(page).get('view')).toBeNull();
  expect(search(page).get('star')).toBeNull();
  // Le Système solaire reste utilisable et à sa place.
  expect(new URL(page.url()).pathname).toBe('/neptune/');
}

/** L'adresse suit l'observation : l'étoile choisie, puis le temps ; un rechargement la retrouve. */
export async function scenarioAddressFollows(page: Page): Promise<void> {
  await load(page, SOLAR);
  expect(search(page).get('view')).toBeNull();
  await openFromSettings(page);
  expect(search(page).get('view')).toBe('neighbourhood');
  expect(search(page).get('star')).toBeNull();
  await page
    .locator('#stellar-list button', { hasText: /^Proxima/ })
    .first()
    .click();
  await expect.poll(() => search(page).get('star')).toBe('proxima-centauri');
  await page.locator('#stellar-time').fill('-3000');
  await expect.poll(() => search(page).get('t')).toBe('-3000');
  // Revenir à la date de la scène retire `t` : c'est l'état d'ouverture, pas une observation.
  await page.locator('#stellar-time').fill('0');
  await expect.poll(() => search(page).get('t')).toBeNull();
  await page.locator('#stellar-time').fill('-3000');
  await expect.poll(() => search(page).get('t')).toBe('-3000');

  // Une nouvelle session sur la même adresse retrouve la même observation.
  await page.reload();
  await expect(view(page)).toBeVisible({ timeout: 90_000 });
  await expect(pressed(page)).toContainText(/^Proxima/);
  await expect(page.locator('#stellar-time-out')).toContainText('3,000 years');
}

/**
 * Le retour : Échap, le bouton, et Retour/Suivant du navigateur, sans recharger le document, sans
 * que le permalien du Système solaire soit rappelé (il relancerait le vol de la caméra), et sans
 * second renderer ni résidu.
 */
export async function scenarioReturn(page: Page): Promise<void> {
  await load(page, `${SOLAR}${NON_DEFAULT_POSE}`);
  // Le cadrage demandé n'est appliqué qu'à l'arrivée du vol : on attend qu'il le soit.
  await expect
    .poll(async () => solarPose(page), { timeout: 60_000 })
    .toMatch(/\|0\.035\d*$/);
  const pose = await solarPose(page);
  const canvases = await page.locator('canvas').count();
  const entries = await page.evaluate(() => window.history.length);
  await openFromSettings(page);
  await page
    .locator('#stellar-list button', { hasText: /^Barnard/ })
    .first()
    .click();
  await expect.poll(() => search(page).get('star')).toBe('barnards-star');
  // L'ouverture a ajouté UNE entrée : le Retour du navigateur peut la défaire.
  expect(await page.evaluate(() => window.history.length)).toBe(entries + 1);

  // 1. Retour du navigateur : la vue se ferme, l'adresse est celle du Système solaire.
  await page.goBack();
  await expect(view(page)).toHaveCount(0);
  expect(search(page).get('view')).toBeNull();
  expect(search(page).get('star')).toBeNull();
  expect(new URL(page.url()).pathname).toBe('/neptune/');
  expect(await page.locator('canvas').count()).toBe(canvases);
  // Le permalien solaire n'a pas reselectionné Neptune : la caméra est restée où le visiteur l'avait mise.
  expect(await solarPose(page)).toBe(pose);

  // 2. Suivant : la même observation revient.
  await page.goForward();
  await expect(view(page)).toBeVisible({ timeout: 30_000 });
  await expect(pressed(page)).toContainText(/^Barnard/);

  // 3. Le bouton « Retour au Système solaire » : même résultat, l'entrée ajoutée est retirée.
  await page.locator('#stellar-back').click();
  await expect(view(page)).toHaveCount(0);
  await expect.poll(() => search(page).get('view')).toBeNull();
  expect(new URL(page.url()).pathname).toBe('/neptune/');
  expect(await solarPose(page)).toBe(pose);

  // 4. Suivant rouvre encore la vue, Échap la ferme.
  await page.goForward();
  await expect(view(page)).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('Escape');
  await expect(view(page)).toHaveCount(0);
  await expect.poll(() => search(page).get('view')).toBeNull();
  expect(await solarPose(page)).toBe(pose);

  // Rien n'a rechargé le document, rien ne reste : un seul canevas, aucune surface, scène solaire utilisable.
  expect(
    await page.evaluate(
      () => (window as unknown as { __alive?: string }).__alive
    )
  ).toBe('yes');
  expect(await page.locator('canvas').count()).toBe(canvases);
  await expect(page.locator('#stellar-view')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/stellar-view-active/);
  await expect(page.locator('#settings-trigger')).toBeEnabled();
}

/** Arrivé par un lien, la vue n'a pas d'entrée à elle : se fermer RÉÉCRIT l'adresse, sans en retirer une autre. */
export async function scenarioDeepLinkClose(page: Page): Promise<void> {
  await load(page, `${SOLAR}&view=neighbourhood&star=wolf-359`);
  await expect(view(page)).toBeVisible({ timeout: 60_000 });
  await expect(pressed(page)).toContainText(/^Wolf/);
  const entries = await page.evaluate(() => window.history.length);
  await page.locator('#stellar-back').click();
  await expect(view(page)).toHaveCount(0);
  await expect.poll(() => search(page).get('view')).toBeNull();
  expect(new URL(page.url()).pathname).toBe('/neptune/');
  expect(await page.evaluate(() => window.history.length)).toBe(entries);
  expect(
    await page.evaluate(
      () => (window as unknown as { __alive?: string }).__alive
    )
  ).toBe('yes');
}

/** Ouvrir et fermer plusieurs fois ne laisse ni écouteur d'historique en double, ni canevas, ni surface. */
export async function scenarioRepeat(page: Page): Promise<void> {
  await load(page, SOLAR);
  const canvases = await page.locator('canvas').count();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (let i = 0; i < 3; i++) {
    await openFromSettings(page);
    await page.locator('#stellar-back').click();
    await expect(view(page)).toHaveCount(0);
    await expect.poll(() => search(page).get('view')).toBeNull();
  }
  await openFromSettings(page);
  await page.goBack();
  await expect(view(page)).toHaveCount(0);
  // Un seul gestionnaire d'historique : un Retour ne ferme qu'une fois et ne laisse rien ouvert.
  await expect(page.locator('#stellar-view')).toHaveCount(0);
  await page.goForward();
  await expect(view(page)).toBeVisible({ timeout: 30_000 });
  await page.goBack();
  await expect(view(page)).toHaveCount(0);
  expect(await page.locator('canvas').count()).toBe(canvases);
  expect(errors).toEqual([]);
}
