import { describe, expect, it } from 'vitest';
import {
  formatDateText,
  formatIsoDay,
  LONG_DAY,
  ORDINAL_FIRST_DAY_LOCALES,
} from './dateText';
import { LOCALES, type Locale } from '@/i18n/locales';

/** L'étiquette `Intl` employée par les pages d'éclipse, FIXÉE par langue. */
const INTL: Record<Locale, string> = {
  en: 'en-US',
  fr: 'fr-FR',
  es: 'es',
  'pt-BR': 'pt-BR',
};

describe('formatIsoDay', () => {
  it('écrit le premier du mois en ordinal là où la langue le demande', () => {
    expect(formatIsoDay('1972-07-01', 'fr', INTL.fr)).toBe('1er juillet 1972');
    expect(formatIsoDay('1972-07-01', 'pt-BR', INTL['pt-BR'])).toBe(
      '1º de julho de 1972'
    );
  });

  /**
   * ET NE TOUCHE À RIEN AILLEURS. L'espagnol écrit bien « 1 de julio » et l'anglais place le jour
   * après le mois : une retouche y serait une faute, pas une amélioration.
   */
  it('laisse l’espagnol et l’anglais tels que Intl les écrit', () => {
    expect(formatIsoDay('1972-07-01', 'es', INTL.es)).toBe(
      '1 de julio de 1972'
    );
    expect(formatIsoDay('1972-07-01', 'en', INTL.en)).toBe('July 1, 1972');
  });

  it('ne retouche que le PREMIER du mois, jamais un autre jour', () => {
    for (const locale of LOCALES) {
      const text = formatIsoDay('1997-10-15', locale, INTL[locale]);
      expect(text, `${locale} / 15 octobre`).not.toMatch(/1er|1º/);
      expect(text).toContain('15');
    }
    // Et pas davantage le 11 ou le 21, qui commencent par le même chiffre.
    expect(formatIsoDay('1997-10-11', 'fr', INTL.fr)).toBe('11 octobre 1997');
    expect(formatIsoDay('1997-10-21', 'fr', INTL.fr)).toBe('21 octobre 1997');
  });

  it('lit le jour en UTC, sans dépendre du fuseau de la machine', () => {
    // Un `new Date('1972-07-01')` suivi d'un formatage en heure locale rendrait le 30 juin à
    // l'ouest de Greenwich. Le découpage de la chaîne l'interdit.
    expect(formatIsoDay('1972-07-01', 'en', INTL.en)).toContain('1972');
    expect(formatIsoDay('1972-07-01', 'en', INTL.en)).toContain('July 1');
  });
});

describe('formatDateText', () => {
  /**
   * LE CAS QU'UNE EXPRESSION RÉGULIÈRE ANCRÉE MANQUAIT. Le panneau des événements met le jour de
   * la semaine devant : « lun. 1 déc. 1997 ». Un `/^1 /` ne correspond pas, donc l'ordinal ne
   * serait pas appliqué, et seulement dans ce format.
   */
  it('écrit l’ordinal même quand le jour de la semaine le précède', () => {
    const text = formatDateText(
      new Date(Date.UTC(1997, 11, 1, 12, 0)),
      {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      },
      'fr',
      INTL.fr
    );
    expect(text).toContain('1er');
    expect(text).not.toMatch(/\b1 déc/);
  });

  it('ne change rien à la sortie d’Intl hors du premier du mois', () => {
    for (const locale of LOCALES) {
      const date = new Date(Date.UTC(2026, 7, 12));
      expect(formatDateText(date, LONG_DAY, locale, INTL[locale])).toBe(
        new Intl.DateTimeFormat(INTL[locale], LONG_DAY).format(date)
      );
    }
  });

  it('déclare exactement les langues qui demandent un ordinal', () => {
    expect([...ORDINAL_FIRST_DAY_LOCALES].sort()).toEqual(['fr', 'pt-BR']);
  });
});
