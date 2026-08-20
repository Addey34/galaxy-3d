import { describe, expect, it } from 'vitest';
import { isLowPowerDevice } from './engine';

/**
 * Classification « rendu allégé » (mobile/tablette) vs « rendu complet » (desktop).
 * La logique est pure (signaux injectés) : on couvre les cas limites, en particulier la
 * tablette en PAYSAGE (≥ 768) que l'ancien seuil `innerWidth < 768` ratait.
 */
describe('isLowPowerDevice', () => {
  it('classe un mobile (user-agent connu) comme allégé', () => {
    expect(
      isLowPowerDevice({
        mobileUserAgent: true,
        touch: true,
        largestViewportSide: 844,
      })
    ).toBe(true);
  });

  it('classe une tablette tactile en paysage (1024) comme allégée', () => {
    // Le vrai correctif : 1024 ≥ 768 → l'ancien code la voyait comme desktop.
    expect(
      isLowPowerDevice({
        mobileUserAgent: false,
        touch: true,
        largestViewportSide: 1024,
      })
    ).toBe(true);
  });

  it('classe un desktop non tactile (1920) comme rendu complet', () => {
    expect(
      isLowPowerDevice({
        mobileUserAgent: false,
        touch: false,
        largestViewportSide: 1920,
      })
    ).toBe(false);
  });

  it('garde le filet petit écran : < 768 est allégé même sans tactile', () => {
    expect(
      isLowPowerDevice({
        mobileUserAgent: false,
        touch: false,
        largestViewportSide: 600,
      })
    ).toBe(true);
  });

  it('traite un grand écran tactile (> 1280) comme desktop', () => {
    // Écran de bureau tactile / tout-en-un : assez puissant pour le rendu complet.
    expect(
      isLowPowerDevice({
        mobileUserAgent: false,
        touch: true,
        largestViewportSide: 1920,
      })
    ).toBe(false);
  });

  it('capte une tablette à la limite haute (1280 tactile)', () => {
    expect(
      isLowPowerDevice({
        mobileUserAgent: false,
        touch: true,
        largestViewportSide: 1280,
      })
    ).toBe(true);
  });
});
