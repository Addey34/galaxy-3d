import { expect, type Page } from '@playwright/test';

/**
 * Les scénarios des grandes expéditions (GAL-TOUR-EXCELLENCE-002), partagés par
 * `tourExpeditions.spec.ts` (Chromium, bureau et 390 px) et `device-tourExpeditions.spec.ts`
 * (Pixel 7 et iPhone 15 émulés, hors CI).
 */
export const EXPEDITIONS = [
  'voyager2-giants',
  'cassini-saturn-titan',
  'juno-jupiter',
  'osiris-rex-bennu',
] as const;

/** Coupe les visites d'accueil et fixe la langue anglaise (les légendes attendues sont anglaises). */
export async function quietEnglish(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
}

/** Une étape d'éphémérides ou de plongée attend ses octets : 90 s couvrent le saut le plus lent mesuré. */
export const STEP_TIMEOUT = 90_000;

export async function boot(page: Page, id: string): Promise<void> {
  await page.goto(`/?tour=${id}`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('.stour-card')).toBeVisible({ timeout: 60_000 });
}

/** La fiche de Jupiter dit-elle cette édition comme montrée par la scène ? */
export async function expectJupiterEdition(
  page: Page,
  edition: string
): Promise<void> {
  await expect(page.locator('.bi-editions')).toHaveAttribute(
    'data-applied-edition',
    edition,
    { timeout: 30_000 }
  );
}

/** Ouvre la fiche de Jupiter par la palette, comme un visiteur. */
export async function openJupiter(page: Page): Promise<void> {
  await page.locator('#body-search-trigger').click();
  await page.locator('#palette-input').fill('Jupiter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('#body-info')).toBeVisible({ timeout: 30_000 });
}

/**
 * Joue la visite jusqu'au bout. Rend le nombre de légendes vues et le nombre d'inspections ouvertes,
 * chacune refermée par Échap.
 */
export async function playToEnd(
  page: Page,
  onCaption?: (text: string) => Promise<void>
): Promise<{ captions: number; inspections: number }> {
  const card = page.locator('.stour-card');
  const next = page.locator('.stour-next');
  const craft = page.locator('#craft-view');
  let captions = 0;
  let inspections = 0;
  /** La visite est finie quand le document ne porte plus `data-tour` (une inspection le garde). */
  const finished = async (): Promise<boolean> =>
    (await page.locator('html[data-tour]').count()) === 0;
  for (let guard = 0; guard < 40; guard++) {
    // Trois états possibles : une légende attend un geste, une inspection est ouverte, la visite est finie.
    await expect
      .poll(
        async () =>
          (await craft.count()) > 0 ||
          (await finished()) ||
          ((await card.isVisible()) && (await next.isEnabled())),
        { timeout: STEP_TIMEOUT }
      )
      .toBe(true);
    if ((await craft.count()) > 0) {
      inspections += 1;
      // La carte s'est retirée : l'inspection est une autre vue, avec son propre Échap.
      await expect(card).toBeHidden();
      await expect(craft).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(craft).toHaveCount(0);
      // Échap a fermé l'INSPECTION, pas la visite : la carte revient, le focus sur « Pause ».
      await expect(card).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('.stour-pause')).toBeFocused();
      continue;
    }
    if (await finished()) break;
    const text = (await page.locator('.stour-caption').textContent()) ?? '';
    expect(text.length).toBeGreaterThan(0);
    captions += 1;
    await onCaption?.(text);
    await next.click();
  }
  await expect(card).toBeHidden({ timeout: STEP_TIMEOUT });
  return { captions, inspections };
}

export async function expectContextRestored(page: Page): Promise<void> {
  await expect(page.locator('#mode-controls .is-active')).toHaveAttribute(
    'data-mode',
    'educ'
  );
  expect(new URL(page.url()).searchParams.get('tour')).toBeNull();
  // Aucune vue plein écran ne reste ouverte, rien n'est inerte.
  await expect(page.locator('#craft-view')).toHaveCount(0);
  expect(await page.locator('[data-craft-hidden]').count()).toBe(0);
}
