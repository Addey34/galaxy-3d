import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { clickWhenCalm, waitForCalmMainThread } from './mainThread';
import { blockExternalNetwork } from './netBlock';
import { scaleFromSlider } from '../src/ui/speedSlider';

/**
 * UNE VISITE EMPRUNTE LA VITESSE ET LA RENDUE TELLE QUE LE VISITEUR LA VOULAIT (GAL-PRODUCT-013).
 *
 * Défaut constaté sur la production le 2026-11-12 (GAL-PRODUCT-012, § C) : la visite des
 * Galiléennes impose 200 000x par `om.setSimulationSpeed`, hors du module qui possède le curseur,
 * puis remet 1:1 en dur. Avec une vitesse de départ de 6,6 h/s, l'horloge tournait ensuite à 1:1
 * pendant que le curseur et le libellé annonçaient toujours 6,6 h/s : la vitesse annoncée n'était
 * pas la vitesse appliquée, et celle que le visiteur avait choisie était perdue.
 *
 * Ce que ce fichier tient, dans un vrai navigateur :
 *   - PENDANT la visite, curseur, libellé et ARIA disent la vitesse que la visite impose ;
 *   - APRÈS (fin normale, Fermer, Échap), ils redisent la vitesse DEMANDÉE avant, avec son signe,
 *     et l'horloge la suit (mesurée, pas déduite du libellé) ;
 *   - une visite qui ne touche pas à la vitesse ne la touche pas ;
 *   - la date atteinte reste (GAL-PRODUCT-012) et ne fait aucun saut au moment du retour.
 * Le plafond de débit qui bouge pendant une visite est tenu par `ui/playbackTour.test.ts`, où il
 * se règle à la main ; ici un lien lent donnerait une mesure de l'horloge sans valeur.
 */
const TOURS = resolve(import.meta.dirname, '../src/registry/tours');
const ORDER = (
  JSON.parse(readFileSync(resolve(TOURS, 'order.json'), 'utf-8')) as {
    order: string[];
  }
).order;
const GALILEANS = ORDER.indexOf('galileans');
const KUIPER = ORDER.indexOf('kuiper');

/** Libellés anglais des positions de curseur utilisées (80 : 6,6 h/s ; 20 : en arrière). */
const REAL_TIME = '1:1 · Earth real time';
const FORWARD = { slider: 80, label: '6.6 h/s' };
const BACKWARD = { slider: 20, label: '◀ 6.6 h/s (past)' };
/** 200 000x, ce que la visite des Galiléennes impose, vu par le libellé. */
const TOUR_LABEL = '2.3 d/s';
const TOUR_SCALE = 200_000;

const JUMP_TIMEOUT = 90_000;

test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
});

async function load(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  await waitForCalmMainThread(page);
}

/** Pose le curseur comme un glissement le ferait (`input`), puis attend que le libellé suive. */
async function dragSpeed(page: Page, value: number): Promise<void> {
  await page.locator('#speed-range').evaluate((element, next) => {
    const input = element as HTMLInputElement;
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

async function speedUi(
  page: Page
): Promise<{ value: number; label: string; aria: string; capped: boolean }> {
  return page.evaluate(() => {
    const range = document.getElementById('speed-range') as HTMLInputElement;
    return {
      value: Number(range.value),
      label: document.getElementById('speed-value')!.textContent ?? '',
      aria: range.getAttribute('aria-valuetext') ?? '',
      capped: range.dataset['capped'] !== undefined,
    };
  });
}

/** Deux réécritures effectives de l'horloge affichée (voir `waitForFreshClock`). */
const FRESH_CLOCK_CHANGES = 2;
/** À 1:1 une réécriture tombe chaque seconde : de la marge pour une machine chargée. */
const FRESH_CLOCK_TIMEOUT = 20_000;

/**
 * Attend que l'horloge AFFICHÉE ait été réécrite deux fois depuis l'appel.
 *
 * `ui/timePanel` ne réécrit `#clock-display` et `#date-input` que toutes les 250 ms. Le libellé
 * de vitesse, lui, change tout de suite : à la fermeture d'une visite qui imposait 200 000x, un
 * relevé pris aussitôt lit encore une heure d'AVANT la restitution, et la mesure de vitesse
 * inclut alors jusqu'à 250 ms de temps écoulé à 200 000x (+50 000 s : un échec mesuré à +2 412 s/s
 * au lieu de -23 760 s/s, GAL-RELEASE-013). Une réécriture observée APRÈS l'appel lit une horloge
 * postérieure à la restitution ; la seconde écarte une réécriture déjà en route. On observe un
 * CHANGEMENT de l'affichage, jamais un délai : à 1:1 il tombe chaque seconde, à haute vitesse à
 * chaque cycle, et un délai fixe ne garantirait rien sur une machine chargée.
 */
async function waitForFreshClock(page: Page): Promise<void> {
  await page.evaluate(() => {
    delete (window as unknown as { __clockWatch?: unknown }).__clockWatch;
  });
  await page.waitForFunction(
    (changes) => {
      const watch = window as unknown as {
        __clockWatch?: { last: string; seen: number };
      };
      const shown =
        (document.getElementById('date-input') as HTMLInputElement).value +
        'T' +
        document.getElementById('clock-display')!.textContent;
      if (!watch.__clockWatch) {
        watch.__clockWatch = { last: shown, seen: 0 };
        return false;
      }
      if (shown !== watch.__clockWatch.last) {
        watch.__clockWatch.last = shown;
        watch.__clockWatch.seen++;
      }
      return watch.__clockWatch.seen >= changes;
    },
    FRESH_CLOCK_CHANGES,
    { polling: 25, timeout: FRESH_CLOCK_TIMEOUT }
  );
}

/**
 * La vitesse EFFECTIVE de l'horloge, SIGNÉE : le déplacement de la date et de l'heure de
 * simulation (lues ensemble, minuit compris) par seconde réelle sur deux relevés. Le premier ne
 * part qu'une fois l'affichage réécrit après l'appel (`waitForFreshClock`).
 */
async function clockRate(page: Page): Promise<{
  simSeconds: number;
  elapsed: number;
  rate: number;
}> {
  await waitForFreshClock(page);
  const sample = (): Promise<{ sim: number; t: number }> =>
    page.evaluate(() => {
      const date = (document.getElementById('date-input') as HTMLInputElement)
        .value;
      const time = document.getElementById('clock-display')!.textContent!;
      return {
        sim: Date.parse(`${date}T${time}Z`) / 1000,
        t: performance.now(),
      };
    });
  const a = await sample();
  await page.waitForTimeout(2000);
  const b = await sample();
  const simSeconds = b.sim - a.sim;
  const elapsed = (b.t - a.t) / 1000;
  return { simSeconds, elapsed, rate: simSeconds / elapsed };
}

/** 6,6 h/s, la vitesse des deux positions de départ (80 en avant, 20 en arrière). */
const SIX_POINT_SIX_HOURS = 23_760;

function expectRate(measured: { rate: number }, startSlider: number): void {
  const info = JSON.stringify(measured);
  if (startSlider === 50) {
    // 1:1 : progression cohérente avec le temps réel.
    expect(Math.abs(measured.rate - 1), info).toBeLessThan(0.5);
  } else if (startSlider > 50) {
    // En avant : le temps avance, à 6,6 h/s (la lecture est à la seconde près).
    expect(measured.rate, info).toBeGreaterThan(SIX_POINT_SIX_HOURS * 0.5);
    expect(measured.rate, info).toBeLessThan(SIX_POINT_SIX_HOURS * 1.5);
  } else {
    // En arrière : le temps RECULE, à la même magnitude.
    expect(measured.rate, info).toBeLessThan(-SIX_POINT_SIX_HOURS * 0.5);
    expect(measured.rate, info).toBeGreaterThan(-SIX_POINT_SIX_HOURS * 1.5);
  }
}

test('la mesure refuse un mauvais signe, un mauvais module et une lecture trop précoce', () => {
  expect(() => expectRate({ rate: -SIX_POINT_SIX_HOURS }, 20)).not.toThrow();
  expect(() => expectRate({ rate: SIX_POINT_SIX_HOURS }, 20)).toThrow();
  // Le relevé trop précoce mesuré le 2026-11-13 : le temps de la visite (200 000x) y est mêlé.
  expect(() => expectRate({ rate: 2_412 }, 20)).toThrow();
  expect(() => expectRate({ rate: -SIX_POINT_SIX_HOURS }, 80)).toThrow();
  expect(() => expectRate({ rate: 1 }, 80)).toThrow();
  expect(() => expectRate({ rate: 1 }, 50)).not.toThrow();
  expect(() => expectRate({ rate: SIX_POINT_SIX_HOURS }, 50)).toThrow();
});

async function startTour(page: Page, index: number): Promise<void> {
  await page.locator('#help-btn').click();
  await page.locator('.stour-start').click();
  await page.locator('.stour-picker-item').nth(index).click();
  await expect(page.locator('.stour-card')).toBeVisible();
}

async function advanceToEnd(page: Page): Promise<void> {
  const card = page.locator('.stour-card');
  const next = page.locator('.stour-next');
  for (let i = 0; i < 40; i++) {
    if (!(await card.isVisible())) return;
    if (!(await next.isDisabled())) await clickWhenCalm(page, next);
    else await page.waitForTimeout(250);
  }
  await expect(card).toBeHidden({ timeout: JUMP_TIMEOUT });
}

/** Attend que la visite ait imposé SA vitesse : le libellé quitte celui de départ. */
async function waitForTourSpeed(page: Page): Promise<void> {
  await expect(page.locator('#speed-value')).toHaveText(TOUR_LABEL, {
    timeout: JUMP_TIMEOUT,
  });
}

for (const [name, viewport] of [
  ['desktop', { width: 1280, height: 800 }],
  ['mobile 390 px', { width: 390, height: 844 }],
] as const) {
  test.describe(`la vitesse après une visite, ${name}`, () => {
    test.use({ viewport });
    test.setTimeout(240_000);

    for (const [label, start, how] of [
      ['départ 1:1, fin normale', { slider: 50, label: REAL_TIME }, 'end'],
      ['départ en avant, fin normale', FORWARD, 'end'],
      ['départ en arrière, Fermer', BACKWARD, 'close'],
      ['départ en avant, Échap', FORWARD, 'escape'],
    ] as const) {
      test(`Galiléennes : ${label}`, async ({ page }) => {
        await load(page);
        await dragSpeed(page, start.slider);
        await expect(page.locator('#speed-value')).toHaveText(start.label);
        const dateInput = page.locator('#date-input');
        const dateBefore = await dateInput.inputValue();

        await startTour(page, GALILEANS);
        await waitForTourSpeed(page);

        // PENDANT : curseur, libellé et ARIA disent la vitesse de la visite, d'une seule voix.
        const dateDuring = await dateInput.inputValue();
        const during = await speedUi(page);
        expect(during.label).toBe(TOUR_LABEL);
        expect(during.aria).toBe(TOUR_LABEL);
        // Le curseur natif (`step="1"`) arrondit la position : sa vitesse mathématique n'est
        // qu'une représentation APPROCHÉE de celle qui s'applique. L'horloge, le libellé et
        // l'ARIA, eux, disent la vitesse exacte de la visite. Mesuré : voir l'annotation.
        const implied = scaleFromSlider(during.value);
        test.info().annotations.push({
          type: 'curseur',
          description: `valeur DOM ${during.value}, vitesse implicite ${implied}, visite ${TOUR_SCALE}, rapport ${(implied / TOUR_SCALE).toFixed(3)}`,
        });
        expect(Number.isInteger(during.value)).toBe(true);
        expect(implied / TOUR_SCALE).toBeGreaterThan(1 / 1.5);
        expect(implied / TOUR_SCALE).toBeLessThan(1.5);
        expect(during.value).toBeGreaterThan(50);
        expect(during.value).not.toBe(start.slider);

        if (how === 'end') await advanceToEnd(page);
        else {
          await waitForCalmMainThread(page);
          if (how === 'close')
            await clickWhenCalm(page, page.locator('.stour-close'));
          else await page.keyboard.press('Escape');
        }
        await expect(page.locator('.stour-card')).toBeHidden({
          timeout: JUMP_TIMEOUT,
        });

        // La date de la visite reste, sans saut au retour (GAL-PRODUCT-012) : lue AVANT toute
        // mesure de l'horloge, elle n'est jamais en deçà de celle que la visite avait atteinte.
        const dateAfter = await dateInput.inputValue();
        expect(dateAfter >= dateDuring, `${dateDuring} puis ${dateAfter}`).toBe(
          true
        );
        if (how === 'end') expect(dateAfter).not.toBe(dateBefore);
        expect(new URL(page.url()).searchParams.get('date')).not.toBeNull();

        // APRÈS : la vitesse DEMANDÉE avant la visite, avec son signe, partout.
        const after = await speedUi(page);
        expect(after.label).toBe(start.label);
        expect(after.aria).toBe(start.label);
        expect(after.value).toBe(start.slider);
        expect(after.capped).toBe(false);
        expectRate(await clockRate(page), start.slider);
      });
    }

    test('Kuiper, qui ne touche pas à la vitesse, la laisse telle que choisie', async ({
      page,
    }) => {
      await load(page);
      await dragSpeed(page, FORWARD.slider);
      await expect(page.locator('#speed-value')).toHaveText(FORWARD.label);

      await startTour(page, KUIPER);
      // Aucune vitesse n'est imposée pendant la visite.
      expect((await speedUi(page)).label).toBe(FORWARD.label);
      await advanceToEnd(page);
      await expect(page.locator('.stour-card')).toBeHidden();

      const after = await speedUi(page);
      expect(after.label).toBe(FORWARD.label);
      expect(after.aria).toBe(FORWARD.label);
      expect(after.value).toBe(FORWARD.slider);
      expectRate(await clockRate(page), FORWARD.slider);
    });
  });
}
