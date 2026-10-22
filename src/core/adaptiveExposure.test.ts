import { describe, expect, it } from 'vitest';

import {
  ADAPTATION_REFERENCE_ALBEDO,
  adaptiveExposureFor,
  MAX_ADAPTATION,
  stepAdaptation,
} from './adaptiveExposure';
import { publishedAlbedo } from '@/config/displayAlbedo';

describe('exposition adaptative au corps suivi', () => {
  it('ne touche ni un corps clair, ni un corps hors de la règle', () => {
    expect(adaptiveExposureFor(ADAPTATION_REFERENCE_ALBEDO)).toBe(1);
    expect(adaptiveExposureFor(1)).toBe(1);
    expect(adaptiveExposureFor(undefined)).toBe(1);
    expect(adaptiveExposureFor(0)).toBe(1);
    expect(adaptiveExposureFor(Number.NaN)).toBe(1);
  });

  it('monte dans le rapport des albédos, et plus haut que la borne jamais', () => {
    expect(adaptiveExposureFor(0.2)).toBeCloseTo(1.5, 10);
    expect(adaptiveExposureFor(0.12)).toBeCloseTo(2.5, 10);
    expect(adaptiveExposureFor(0.05)).toBe(MAX_ADAPTATION);
  });

  it('rend plus sombre un corps plus clair : jamais', () => {
    for (const a of [0.31, 0.5, 0.9, 1.2])
      expect(adaptiveExposureFor(a)).toBeGreaterThanOrEqual(1);
  });

  it('lit l’albédo PUBLIÉ de la Lune et de Mercure, pas un nombre recopié', () => {
    // 0,12 et 0,142 : lus dans le relevé des sources par `scripts/measure-display-albedo.mjs`.
    expect(adaptiveExposureFor(publishedAlbedo('moon'))).toBeGreaterThan(2);
    expect(adaptiveExposureFor(publishedAlbedo('mercury'))).toBeGreaterThan(
      1.5
    );
    // Hors règle (atmosphère) : aucune adaptation.
    expect(adaptiveExposureFor(publishedAlbedo('earth'))).toBe(1);
  });

  it('transite sans dépendre de la cadence d’images', () => {
    let a = 1;
    for (let i = 0; i < 60; i++) a = stepAdaptation(a, 2, 1 / 60);
    let b = 1;
    for (let i = 0; i < 144; i++) b = stepAdaptation(b, 2, 1 / 144);
    expect(a).toBeCloseTo(b, 6);
    // 63 % du chemin à la constante de temps.
    expect(a).toBeCloseTo(1 + (1 - Math.exp(-1 / 0.6)), 6);
  });

  it('ne bouge pas sans temps écoulé', () => {
    expect(stepAdaptation(1.3, 2, 0)).toBe(1.3);
    expect(stepAdaptation(1.3, 2, -1)).toBe(1.3);
  });
});
