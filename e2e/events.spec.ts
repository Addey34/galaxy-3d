import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/sbdb_query.api*', (route) => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
  });
});

test('opens upcoming astronomical events and jumps the simulation to one', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  const toggle = page.locator('#events-trigger');
  await expect(toggle).toBeVisible();
  await toggle.click();

  const panel = page.locator('#astronomical-events');
  await expect(panel).toBeVisible();

  const panelsDoNotOverlap = await page.evaluate(() => {
    const settings = document
      .querySelector('#orbit-options')
      ?.getBoundingClientRect();
    const events = document
      .querySelector('#astronomical-events')
      ?.getBoundingClientRect();
    if (!settings || !events) return false;
    return !(
      settings.left < events.right &&
      settings.right > events.left &&
      settings.top < events.bottom &&
      settings.bottom > events.top
    );
  });
  expect(panelsDoNotOverlap).toBe(true);

  const firstEvent = panel.locator('.event-row').first();
  await expect(firstEvent).toBeVisible();

  const eventDate = await firstEvent.getAttribute('data-event-date');
  expect(eventDate).not.toBeNull();
  const expectedDate = new Date(eventDate!);
  const expectedDateInput = expectedDate.toISOString().slice(0, 10);

  await firstEvent.click();
  await expect(panel).toBeHidden();
  await expect(page.locator('#date-input')).toHaveValue(expectedDateInput);

  const url = new URL(page.url());
  expect(url.searchParams.get('date')).toContain(
    expectedDate.toISOString().slice(0, 19)
  );

  // La lecture doit être figée sur l'instant de l'événement…
  await expect(page.locator('#play-pause-btn')).toHaveClass(/is-paused/);
  // …et un corps observé (Lune ou Terre) doit être sélectionné.
  expect(url.searchParams.get('body')).toMatch(/^(moon|earth)$/);
});
