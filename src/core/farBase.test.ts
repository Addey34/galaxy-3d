import { describe, expect, it } from 'vitest';
import {
  FAR_BASE_CEILING_EXIT_RADII,
  FAR_BASE_CEILING_RADII,
  FAR_BASE_ENTER_RADII,
  FAR_BASE_LEAVE_RADII,
  showsFarBase,
} from './farBase';

describe('fond de loin', () => {
  it('montre le jour dans la bande, le fond fin en dessous', () => {
    expect(showsFarBase(1.6, false)).toBe(true);
    expect(showsFarBase(FAR_BASE_LEAVE_RADII - 0.01, true)).toBe(false);
    expect(showsFarBase(1.0, false)).toBe(false);
  });

  it('ne demande RIEN au-dessus du plafond, démarrage compris', () => {
    // Le démarrage d'un visiteur est loin de la Terre : lire les jours publiés à ce moment
    // serait une requête de loin, que le dépôt s'interdit.
    expect(showsFarBase(FAR_BASE_CEILING_RADII + 0.01, false)).toBe(false);
    expect(showsFarBase(3, false)).toBe(false);
    expect(showsFarBase(12, true)).toBe(false);
    expect(showsFarBase(FAR_BASE_CEILING_EXIT_RADII + 0.01, true)).toBe(false);
  });

  it('garde sa réponse entre les seuils (hystérésis des deux bords)', () => {
    const lower = (FAR_BASE_ENTER_RADII + FAR_BASE_LEAVE_RADII) / 2;
    expect(FAR_BASE_LEAVE_RADII).toBeLessThan(FAR_BASE_ENTER_RADII);
    expect(showsFarBase(lower, true)).toBe(true);
    expect(showsFarBase(lower, false)).toBe(false);
    const upper = (FAR_BASE_CEILING_RADII + FAR_BASE_CEILING_EXIT_RADII) / 2;
    expect(FAR_BASE_CEILING_RADII).toBeLessThan(FAR_BASE_CEILING_EXIT_RADII);
    expect(showsFarBase(upper, true)).toBe(true);
    expect(showsFarBase(upper, false)).toBe(false);
  });

  it('ignore une distance non finie', () => {
    expect(showsFarBase(NaN, true)).toBe(true);
    expect(showsFarBase(Infinity, false)).toBe(false);
  });
});
