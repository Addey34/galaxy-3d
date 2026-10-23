import { describe, expect, it } from 'vitest';
import {
  FAR_BASE_ENTER_RADII,
  FAR_BASE_LEAVE_RADII,
  showsFarBase,
} from './farBase';

describe('fond de loin', () => {
  it('montre le jour au-delà du seuil d’entrée, le fond fin en deçà', () => {
    expect(showsFarBase(FAR_BASE_ENTER_RADII + 0.01, false)).toBe(true);
    expect(showsFarBase(FAR_BASE_LEAVE_RADII - 0.01, true)).toBe(false);
    expect(showsFarBase(1.0, false)).toBe(false);
  });

  it('garde sa réponse entre les deux seuils (hystérésis)', () => {
    const between = (FAR_BASE_ENTER_RADII + FAR_BASE_LEAVE_RADII) / 2;
    expect(FAR_BASE_LEAVE_RADII).toBeLessThan(FAR_BASE_ENTER_RADII);
    expect(showsFarBase(between, true)).toBe(true);
    expect(showsFarBase(between, false)).toBe(false);
  });

  it('ignore une distance non finie', () => {
    expect(showsFarBase(NaN, true)).toBe(true);
    expect(showsFarBase(Infinity, false)).toBe(false);
  });
});
