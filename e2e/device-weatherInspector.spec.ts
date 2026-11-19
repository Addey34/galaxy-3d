import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { mockInspectorFields } from './inspectorMock';
import { waitForCalmMainThread } from './mainThread';

/**
 * L'INSPECTEUR MÉTÉO AU DOIGT, sur un téléphone ÉMULÉ (GAL-METEO-INSPECT-003) : Pixel 7 et iPhone 15
 * (`pnpm test:mobile`). Ce qu'on vérifie : la carte tient dans l'écran dans les quatre langues, ne
 * recouvre ni le panneau météo ni les commandes de temps, rien ne déborde latéralement, un tap sur
 * le globe choisit un point et pose le repère. Jamais un vrai téléphone (toucher, chaleur, GPU).
 * Les captures vont dans `INSPECT_SHOTS` quand la variable est posée.
 */
const LOCALES = ['en', 'fr', 'es', 'pt-BR'] as const;
const SHOTS = process.env['INSPECT_SHOTS'];

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

async function rectOf(page: Page, selector: string): Promise<Rect | null> {
  return page.locator(selector).first().boundingBox();
}

for (const locale of LOCALES) {
  test(`${locale}: l'inspecteur compact laisse le globe, le développé donne tout, au doigt`, async ({
    page,
  }, info) => {
    await page.route('**/sbdb_query.api*', (route) => route.abort());
    const mock = await mockInspectorFields(page);
    await page.addInitScript((l) => {
      localStorage.setItem('ssv-guided-tour-v1', '1');
      localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
      localStorage.setItem('ssv-locale', l);
    }, locale);
    await page.goto('/?body=earth&date=2026-11-19T12:00:00Z');
    await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
    await waitForCalmMainThread(page);

    await page.locator('#weather-trigger').tap();
    await expect(page.locator('#weather-layers')).toBeVisible();
    for (const id of ['wind', 'precip-model', 'clouds-model', 'thermal-model'])
      await page.locator(`#weather-layers input[data-layer="${id}"]`).check();
    await page.locator('#weather-inspect-toggle').tap();
    await expect(page.locator('#weather-layers')).toBeHidden();
    const card = page.locator('#weather-inspector');
    await expect(card).toBeVisible();
    const expand = card.locator('.wi-expand');
    const subtitle = card.locator('#weather-inspector-point');
    const chips = card.locator('.wi-chip');
    const view = page.viewportSize()!;

    // ---- compact : démarre ainsi, tient dans un bandeau bas, le globe reste libre.
    await expect(card).toHaveClass(/is-compact/);
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
    const canvas = (await page.locator('canvas').first().boundingBox())!;
    const cx = canvas.x + canvas.width / 2;
    const cy = canvas.y + canvas.height / 2;
    await page.touchscreen.tap(cx, cy);
    await expect(subtitle).toBeVisible();
    await expect(page.locator('.wi-marker')).toBeVisible();
    await expect(chips).toHaveCount(4, { timeout: 40_000 });
    await expect(chips.first()).toContainText(/\d/);
    const first = await subtitle.textContent();

    // Un second point au doigt : le repère suit, la carte reste compacte.
    await page.touchscreen.tap(cx + 30, cy - 20);
    await expect(subtitle).not.toHaveText(first!);
    await expect(card).toHaveClass(/is-compact/);
    await page.waitForTimeout(500);

    const compactBox = (await card.boundingBox())!;
    expect(compactBox.height).toBeLessThan(view.height * 0.3);
    const markerBox = (await page.locator('.wi-marker').boundingBox())!;
    expect(markerBox.y + markerBox.height).toBeLessThan(compactBox.y);
    const timeBox = await rectOf(page, '#time-panel');
    if (timeBox)
      expect(
        overlaps(compactBox, timeBox),
        'la carte compacte recouvre la barre de temps'
      ).toBe(false);
    // Le formulaire et les lignes détaillées sont derrière la bascule.
    await expect(card.locator('.wi-coords')).toBeHidden();
    await expect(card.locator('.wi-rows')).toBeHidden();

    if (SHOTS && (locale === 'en' || locale === 'fr')) {
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({
        path: join(SHOTS, `aud3-${info.project.name}-${locale}-1-compact.png`),
      });
    }

    // ---- changement de date : les pastilles passent en attente, puis reviennent.
    if (locale === 'en') {
      mock.hold();
      await page.locator('#date-input').evaluate((el) => {
        (el as HTMLInputElement).value = '2026-11-25';
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await expect(chips.first()).toHaveAttribute(
        'data-status',
        /pending|unavailable/,
        { timeout: 20_000 }
      );
      await expect(subtitle).toBeVisible();
      if (SHOTS)
        await page.screenshot({
          path: join(
            SHOTS,
            `aud3-${info.project.name}-${locale}-2-compact-stale.png`
          ),
        });
      mock.release();
      await expect(chips.first()).toHaveAttribute('data-status', 'value', {
        timeout: 40_000,
      });
    }

    // ---- développé : même point, mêmes valeurs, formulaire, notes ; rien ne déborde.
    const pointBefore = await subtitle.textContent();
    await expand.tap();
    await expect(card).not.toHaveClass(/is-compact/);
    await expect(expand).toHaveAttribute('aria-expanded', 'true');
    await expect(subtitle).toHaveText(pointBefore!);
    await expect(card.locator('.wi-coords')).toBeVisible();
    for (const variable of [
      'temperature',
      'precipitation',
      'cloudCover',
      'wind',
    ])
      await expect(
        card.locator(`.wi-row[data-variable="${variable}"] .wi-value`)
      ).toBeVisible();
    await page.waitForTimeout(600);
    const box = (await card.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(view.width + 0.5);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(view.height + 0.5);
    const timeBox2 = await rectOf(page, '#time-panel');
    if (timeBox2)
      expect(
        overlaps(box, timeBox2),
        'la carte développée recouvre la barre de temps'
      ).toBe(false);
    const wide = await card.evaluate((root) =>
      Array.from(root.querySelectorAll<HTMLElement>('*'))
        .filter((e) => !e.classList.contains('sr-only'))
        .filter((e) => e.scrollWidth - e.clientWidth > 1)
        .map((e) => `${e.tagName}.${e.className}`)
    );
    expect(wide).toEqual([]);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
      )
    ).toBeLessThanOrEqual(0);
    if (SHOTS && (locale === 'en' || locale === 'fr'))
      await page.screenshot({
        path: join(SHOTS, `aud3-${info.project.name}-${locale}-3-expanded.png`),
      });

    // ---- retour au compact : le point et les valeurs sont conservés.
    await expand.tap();
    await expect(card).toHaveClass(/is-compact/);
    await expect(subtitle).toHaveText(pointBefore!);
    await expect(chips).toHaveCount(4);

    // ---- l'avertissement : un bouton du bandeau compact l'ouvre et le met au focus.
    await card.locator('.wi-about').tap();
    await expect(card).not.toHaveClass(/is-compact/);
    await expect(card.locator('.wi-caveat')).toBeVisible();
    await expect(card.locator('.wi-caveat')).toBeFocused();
    if (SHOTS && locale === 'en')
      await page.screenshot({
        path: join(SHOTS, `aud3-${info.project.name}-${locale}-4-caveat.png`),
      });

    // La croix ferme : carte masquée, repère masqué.
    await card.locator('.surface-close').tap();
    await expect(card).toBeHidden();
    await expect(page.locator('.wi-marker')).toBeHidden();
  });
}

test('un glissement au doigt tourne le globe sans choisir de point, un tap en choisit un', async ({
  page,
}) => {
  await page.route('**/sbdb_query.api*', (route) => route.abort());
  await mockInspectorFields(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
  await page.goto('/?body=earth&date=2026-11-19T12:00:00Z');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  await waitForCalmMainThread(page);
  await page.locator('#weather-trigger').tap();
  await page
    .locator('#weather-layers input[data-layer="thermal-model"]')
    .check();
  await page.locator('#weather-inspect-toggle').tap();
  const card = page.locator('#weather-inspector');
  await expect(card).toBeVisible();

  const canvas = (await page.locator('canvas').first().boundingBox())!;
  const cx = canvas.x + canvas.width / 2;
  const cy = canvas.y + canvas.height / 2;
  // Glissement tactile : appui, déplacement de 60 px, relâchement (événements pointeur tactiles).
  await page
    .locator('canvas')
    .first()
    .evaluate(
      (el, [x, y]) => {
        const fire = (type: string, dx: number): void => {
          el.dispatchEvent(
            new PointerEvent(type, {
              pointerId: 7,
              pointerType: 'touch',
              isPrimary: true,
              button: 0,
              buttons: type === 'pointerup' ? 0 : 1,
              clientX: x + dx,
              clientY: y,
              bubbles: true,
            })
          );
        };
        fire('pointerdown', 0);
        fire('pointermove', 30);
        fire('pointermove', 60);
        fire('pointerup', 60);
      },
      [cx, cy]
    );
  await page.waitForTimeout(800);
  await expect(page.locator('#weather-inspector-point')).toBeHidden();
  await expect(page.locator('#weather-inspector-lat')).toHaveValue('');
  await expect(page.locator('.wi-marker')).toBeHidden();

  await page.touchscreen.tap(cx, cy);
  await expect(page.locator('#weather-inspector-point')).toBeVisible();
});
