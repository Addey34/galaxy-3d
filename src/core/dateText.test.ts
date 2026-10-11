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

  /**
   * LE CACHE NE DOIT PAS MÉLANGER DEUX FORMATS. Deux appels qui ne diffèrent que par leurs
   * options, ou que par leur langue, doivent rendre deux résultats différents : une clé de cache
   * trop grossière rendrait le mois court là où on demande le mois long, et le défaut ne se
   * verrait qu'à l'écran.
   */
  it('cache les formateurs sans confondre deux formats', () => {
    const date = new Date(Date.UTC(1997, 9, 15));
    const long = formatDateText(date, LONG_DAY, 'fr', INTL.fr);
    const short = formatDateText(
      date,
      { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' },
      'fr',
      INTL.fr
    );
    expect(long).toBe('15 octobre 1997');
    expect(short).not.toBe(long);
    // Même options, autre langue : le cache doit les séparer.
    expect(formatDateText(date, LONG_DAY, 'en', INTL.en)).toBe(
      'October 15, 1997'
    );
    // Et deux appels identiques restent identiques, cache chaud.
    expect(formatDateText(date, LONG_DAY, 'fr', INTL.fr)).toBe(long);
  });

  /**
   * L'ORDRE D'ÉCRITURE DES OPTIONS NE DOIT PAS CHANGER LA CLÉ. Sans le tri, deux objets
   * équivalents produiraient deux entrées de cache, ce qui n'est pas faux mais annule le gain.
   */
  it('reconnaît deux jeux d’options équivalents écrits dans un autre ordre', () => {
    const date = new Date(Date.UTC(2026, 7, 12));
    const a = formatDateText(
      date,
      { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' },
      'fr',
      INTL.fr
    );
    const b = formatDateText(
      date,
      { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' },
      'fr',
      INTL.fr
    );
    expect(a).toBe(b);
  });

  it('déclare exactement les langues qui demandent un ordinal', () => {
    expect([...ORDINAL_FIRST_DAY_LOCALES].sort()).toEqual(['fr', 'pt-BR']);
  });
});

/**
 * UNE DATE QUI AFFICHE LE JOUR PASSE PAR CE MODULE, PARTOUT (2026-10-11). La règle de l'ordinal
 * avait un seul propriétaire, et deux endroits l'ignoraient encore : la page d'une sonde
 * (« précalculée du 7 août 2011 au 1 septembre 2028 ») et le cartouche d'une capture. Ce
 * balayage refuse tout `toLocaleDateString` ou `Intl.DateTimeFormat` dont les options
 * demandent le jour (`day`, `dateStyle`) hors de `core/dateText.ts`. Un mois seul (« octobre
 * 2026 ») ne pose pas la question et reste libre.
 */
describe('aucune date qui affiche le jour ne contourne la règle de l’ordinal', () => {
  it('balaie tout le code livré', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = join(__dirname, '..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name))
          files.push(path);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(100);
    const offenders: string[] = [];
    for (const file of files) {
      if (file.endsWith(join('core', 'dateText.ts'))) continue;
      const text = readFileSync(file, 'utf8');
      const call = /(toLocaleDateString\(|new Intl\.DateTimeFormat\()/g;
      for (let m = call.exec(text); m; m = call.exec(text)) {
        const options = text.slice(m.index, m.index + 240);
        if (/\bday\s*:|dateStyle\s*:/.test(options))
          offenders.push(
            `${file.slice(root.length + 1)}:${text.slice(0, m.index).split('\n').length}`
          );
      }
    }
    expect(offenders).toEqual([]);
  });
});
