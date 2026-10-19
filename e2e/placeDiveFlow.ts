import { expect, type Page } from '@playwright/test';
import { waitForCalmMainThread } from './mainThread';
import { MOON_SCENE_DATE } from './moonScene';

/** Le parcours commun de la plongée : approcher la Lune, viser un nom écrit, le toucher. */
async function approachUntilNamed(page: Page): Promise<void> {
  const overlay = page.locator('#gazetteer-overlay');
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('canvas absent');
  for (let i = 0; i < 14; i += 1) {
    if (Number((await overlay.getAttribute('data-names')) ?? '0') > 0) return;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -6000);
    await page.waitForTimeout(400);
  }
}

export async function diveByTapping(
  page: Page,
  tap: (x: number, y: number) => Promise<void>
): Promise<void> {
  await page.goto(`/?body=moon&date=${MOON_SCENE_DATE}`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  await waitForCalmMainThread(page);
  await approachUntilNamed(page);

  const overlay = page.locator('#gazetteer-overlay');
  const canvas = page.locator('canvas').first();
  await expect
    .poll(async () => (await overlay.getAttribute('data-places')) ?? '')
    .not.toBe('');
  const first = ((await overlay.getAttribute('data-places')) ?? '').split(
    '|'
  )[0]!;
  const match = /^(.*)@(-?\d+),(-?\d+)$/.exec(first);
  if (!match) throw new Error(`nom illisible : ${first}`);
  const [, name, x, y] = match;

  await tap(Number(x), Number(y));
  await expect(canvas).toHaveAttribute('data-place-dive', /\|/, {
    timeout: 30_000,
  });
  const dive = (await canvas.getAttribute('data-place-dive')) ?? '';
  expect(dive.startsWith(`${name}|`)).toBe(true);
  // Les noms sont sur un canevas : la plongée doit être dite à un lecteur d'écran.
  await expect(page.locator('[role="status"].sr-only').first()).toContainText(
    `Diving to ${name}`
  );
}
