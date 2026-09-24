import { describe, expect, it } from 'vitest';
import {
  applyCeiling,
  formatQuantity,
  speedLabel,
  MAX_SIMULATION_SCALE,
  scaleFromSlider,
  sliderFromMagnitude,
  SPEED_CENTER_DEADZONE,
  SPEED_SLIDER_CENTER,
  SPEED_SLIDER_MAX,
} from './speedSlider';

/**
 * LE CURSEUR NE PROMET PAS CE QU'IL NE PEUT PAS TENIR (phase 17D, § 9b option (c)).
 *
 * Deux propriétés portent la phase : la poignée REVIENT au plafond au lieu de rester au-delà
 * (sinon deux positions rendraient la même vitesse et la course mentirait), et le plafond
 * s'applique à la MAGNITUDE et non au signe, remonter le temps coûtant exactement les mêmes
 * octets que le parcourir.
 */
describe('scaleFromSlider', () => {
  it('rend le temps réel au centre et dans sa zone morte', () => {
    expect(scaleFromSlider(SPEED_SLIDER_CENTER)).toBe(1);
    expect(scaleFromSlider(SPEED_SLIDER_CENTER + SPEED_CENTER_DEADZONE)).toBe(
      1
    );
    expect(scaleFromSlider(SPEED_SLIDER_CENTER - SPEED_CENTER_DEADZONE)).toBe(
      1
    );
  });

  it('rend la vitesse maximale aux deux bords, avec le bon signe', () => {
    expect(scaleFromSlider(SPEED_SLIDER_MAX)).toBe(MAX_SIMULATION_SCALE);
    expect(scaleFromSlider(0)).toBe(-MAX_SIMULATION_SCALE);
  });

  it('borne une position absurde au lieu de la propager', () => {
    expect(scaleFromSlider(1e6)).toBe(MAX_SIMULATION_SCALE);
    expect(scaleFromSlider(-1e6)).toBe(-MAX_SIMULATION_SCALE);
  });
});

describe('sliderFromMagnitude', () => {
  it('est l’inverse de scaleFromSlider', () => {
    // Aller-retour sur toute la demi-course : c'est cette identité qui fait qu'une poignée
    // ramenée au plafond désigne bien la vitesse du plafond.
    for (
      let value = SPEED_SLIDER_CENTER;
      value <= SPEED_SLIDER_MAX;
      value += 1
    ) {
      const scale = scaleFromSlider(value);
      const back = SPEED_SLIDER_CENTER + sliderFromMagnitude(Math.abs(scale));
      expect(scaleFromSlider(back)).toBe(scale);
    }
  });

  it('rend le centre pour le temps réel et le bord pour le maximum', () => {
    expect(sliderFromMagnitude(1)).toBe(0);
    expect(
      SPEED_SLIDER_CENTER + sliderFromMagnitude(MAX_SIMULATION_SCALE)
    ).toBe(SPEED_SLIDER_MAX);
  });
});

describe('applyCeiling', () => {
  it('ne touche à rien sans plafond', () => {
    const asked = applyCeiling(SPEED_SLIDER_MAX, null);
    expect(asked.scale).toBe(MAX_SIMULATION_SCALE);
    expect(asked.sliderValue).toBe(SPEED_SLIDER_MAX);
    expect(asked.limited).toBe(false);
  });

  it('ne touche à rien quand la vitesse demandée tient sous le plafond', () => {
    const half = Math.round(MAX_SIMULATION_SCALE / 2);
    const value = SPEED_SLIDER_CENTER + sliderFromMagnitude(half / 4);
    const result = applyCeiling(value, half);
    expect(result.limited).toBe(false);
    expect(result.sliderValue).toBe(value);
  });

  it('ramène la vitesse ET la poignée au plafond', () => {
    const cap = 1_000_000;
    const result = applyCeiling(SPEED_SLIDER_MAX, cap);
    expect(result.limited).toBe(true);
    expect(result.scale).toBe(cap);
    expect(result.sliderValue).toBeLessThan(SPEED_SLIDER_MAX);
    // La poignée désigne exactement la vitesse appliquée : pas d'écart entre ce qu'on voit et
    // ce qui tourne.
    expect(scaleFromSlider(result.sliderValue)).toBe(cap);
  });

  it('plafonne la MAGNITUDE et garde le sens du temps', () => {
    const cap = 1_000_000;
    const backwards = applyCeiling(0, cap);
    expect(backwards.limited).toBe(true);
    expect(backwards.scale).toBe(-cap);
    expect(backwards.sliderValue).toBeGreaterThan(0);
    expect(backwards.sliderValue).toBeLessThan(SPEED_SLIDER_CENTER);
    expect(scaleFromSlider(backwards.sliderValue)).toBe(-cap);
  });

  it('un plafond au-dessus du maximum ne limite rien', () => {
    const result = applyCeiling(SPEED_SLIDER_MAX, MAX_SIMULATION_SCALE * 2);
    expect(result.limited).toBe(false);
    expect(result.scale).toBe(MAX_SIMULATION_SCALE);
  });

  it('un plafond au temps réel laisse encore avancer la scène', () => {
    const result = applyCeiling(SPEED_SLIDER_MAX, 1);
    expect(result.scale).toBe(1);
    expect(result.sliderValue).toBe(SPEED_SLIDER_CENTER);
    expect(result.limited).toBe(true);
  });

  it('ignore un plafond absurde plutôt que de figer la scène', () => {
    expect(applyCeiling(SPEED_SLIDER_MAX, 0).limited).toBe(false);
    expect(applyCeiling(SPEED_SLIDER_MAX, -5).limited).toBe(false);
    expect(applyCeiling(SPEED_SLIDER_MAX, Number.NaN).limited).toBe(false);
  });
});

/**
 * LE LIBELLÉ EST DU TEXTE PUBLIÉ, DONC IL SE RELIT DANS LES DEUX LANGUES.
 *
 * Défaut trouvé le 2026-09-24 en relisant le rendu français à 1280 et 390 px : `toFixed` écrit
 * un POINT, donc l'interface française annonçait « 5.5 mois/s ». Antérieur à la phase 17D, mais
 * le plafond de vitesse rend une valeur décimale systématique, donc il se voyait désormais à
 * chaque lien lent.
 */
describe('le libellé de vitesse', () => {
  it('écrit la décimale avec la virgule en français, le point en anglais', () => {
    expect(formatQuantity(5.5, 'fr')).toBe('5,5');
    expect(speedLabel(2_592_000 * 5.5, 'fr')).toContain('5,5 mois/s');
    expect(formatQuantity(5.5, 'en')).toBe('5.5');
    expect(speedLabel(2_592_000 * 5.5, 'en')).toContain('5.5 mo/s');
  });

  it("n'écrit aucune décimale au-dessus de dix, dans les deux langues", () => {
    for (const locale of ['fr', 'en'] as const) {
      expect(formatQuantity(42.4, locale)).toBe('42');
      expect(formatQuantity(1234, locale)).toBe('1230');
      expect(formatQuantity(3, locale)).toBe('3');
    }
  });

  it('dit le temps réel et le sens du temps', () => {
    expect(speedLabel(1, 'fr')).toContain('1:1');
    expect(speedLabel(-86_400, 'fr')).toContain('(passé)');
    expect(speedLabel(-86_400, 'en')).toContain('(past)');
  });
});
