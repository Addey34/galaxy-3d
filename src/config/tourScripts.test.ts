import { describe, expect, it } from 'vitest';
import { TOUR_SCRIPTS, resolveEclipseDate } from './tourScripts';
import { CELESTIAL_CONFIG } from './bodies';
import { flattenBodies } from './catalog';

describe('TOUR_SCRIPTS', () => {
  const catalogNames = flattenBodies(CELESTIAL_CONFIG);

  it('references only real catalog body names in flyTo steps', () => {
    for (const script of TOUR_SCRIPTS) {
      for (const step of script.steps) {
        if (step.kind === 'flyTo') {
          expect(catalogNames.has(step.body)).toBe(true);
        }
      }
    }
  });

  it('has at least one step per script and a localized title', () => {
    for (const script of TOUR_SCRIPTS) {
      expect(script.steps.length).toBeGreaterThan(0);
      expect(script.titleKey.en).toBeTruthy();
      expect(script.titleKey.fr).toBeTruthy();
    }
  });

  it('has unique ids', () => {
    const ids = TOUR_SCRIPTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('resolveEclipseDate', () => {
  it('finds a real solar eclipse within a year of the reference date', () => {
    const reference = new Date('2026-08-28T00:00:00Z');
    const date = resolveEclipseDate(reference);
    expect(date.getTime()).toBeGreaterThan(reference.getTime());
    const oneYearMs = 366 * 86_400_000;
    expect(date.getTime() - reference.getTime()).toBeLessThan(oneYearMs);
  });
});
