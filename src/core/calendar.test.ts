import { describe, expect, it } from 'vitest';
import {
  GREGORIAN_REFORM_MS,
  displayedDate,
  fromJulianDate,
  julianMonthLength,
} from './calendar';

/** L'instant de 0 h UT d'un jour julien tel qu'Horizons le nomme (« 2299159.5 »). */
const atJd = (jd: number): number => (jd - 2_440_587.5) * 86_400_000;

/**
 * TÉMOINS : ce qu'Horizons imprime pour ces jours juliens, lu le 2026-10-02. Avant le 15 octobre
 * 1582, il imprime le calendrier JULIEN ; « B.C. n » est l'année astronomique 1 - n.
 */
const HORIZONS: [number, number, number, number][] = [
  // jour julien, année astronomique, mois, jour
  [2_299_159.5, 1582, 10, 4], // A.D. 1582-Oct-04, dernier jour julien
  [2_268_991.5, 1500, 2, 29], // A.D. 1500-Feb-29 : bissextile en julien, pas en grégorien
  [2_268_992.5, 1500, 3, 1], // A.D. 1500-Mar-01
  [1_721_423.5, 1, 1, 1], // A.D. 0001-Jan-01
  [1_721_057.5, 0, 1, 1], // B.C. 0001-Jan-01, l'année astronomique 0
  [1_507_231.5, -586, 7, 30], // B.C. 0587-Jul-30
  [625_000.5, -3001, 2, 28], // B.C. 3002-Feb-28
  [-1_930_000.5, -9997, 12, 13], // B.C. 9998-Dec-13, près du début de DE441
];

describe('le calendrier affiché', () => {
  it('rend la date julienne qu’Horizons imprime, avant la réforme', () => {
    for (const [jd, year, month, day] of HORIZONS)
      expect(displayedDate(atJd(jd)), String(jd)).toEqual({
        year,
        month,
        day,
        calendar: 'julian',
      });
  });

  it('passe du 4 octobre julien au 15 octobre grégorien, sans jour perdu ni compté deux fois', () => {
    expect(atJd(2_299_160.5)).toBe(GREGORIAN_REFORM_MS);
    expect(displayedDate(GREGORIAN_REFORM_MS)).toEqual({
      year: 1582,
      month: 10,
      day: 15,
      calendar: 'gregorian',
    });
    expect(displayedDate(GREGORIAN_REFORM_MS - 1).day).toBe(4);
  });

  it('retrouve l’instant d’une date julienne, à l’heure du jour courante', () => {
    const current = atJd(2_268_991.5) + 13 * 3_600_000 + 25 * 60_000;
    for (const [jd, year, month, day] of HORIZONS)
      expect(fromJulianDate({ year, month, day }, current), String(jd)).toBe(
        atJd(jd) + 13 * 3_600_000 + 25 * 60_000
      );
  });

  it('fait l’aller-retour sur toute la plage de l’horloge, jour par jour échantillonné', () => {
    for (let jd = -1_930_000.5; jd < 2_299_160.5; jd += 9_973) {
      const shown = displayedDate(atJd(jd));
      expect(fromJulianDate(shown, atJd(jd)), String(jd)).toBe(atJd(jd));
    }
  });

  it('refuse une date qui n’existe pas dans le calendrier julien', () => {
    expect(fromJulianDate({ year: 1501, month: 2, day: 29 }, 0)).toBeNull();
    expect(fromJulianDate({ year: 1500, month: 13, day: 1 }, 0)).toBeNull();
    expect(fromJulianDate({ year: 1500, month: 4, day: 31 }, 0)).toBeNull();
    expect(fromJulianDate({ year: 1500.5, month: 1, day: 1 }, 0)).toBeNull();
    // L'année 0 et l'année -584 sont bissextiles en julien.
    expect(julianMonthLength(0, 2)).toBe(29);
    expect(julianMonthLength(-584, 2)).toBe(29);
    expect(julianMonthLength(-583, 2)).toBe(28);
  });
});
