import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  LOCALES,
  LOCALE_ENDONYM,
  LOCALE_PATH,
  HTML_LANG,
  INTL_LOCALE,
  negotiateLocale,
} from './locales';

/**
 * LA LANGUE QU'ON SERT À QUI, ET LE SÉLECTEUR QUI LA MONTRE.
 *
 * `negotiateLocale` remplace un `navigator.language.slice(0, 2)` qui rendait `pt` pour `pt-BR`,
 * c'est-à-dire rien du tout : le piège P4 du plan du lot 20, nommé avant d'être écrit. Ce test
 * fixe les cas qui décident, y compris la DÉCISION (et non le repli technique) de servir du
 * portugais du Brésil à un navigateur portugais du Portugal.
 *
 * Il garde aussi le sélecteur d'`index.html` : quatre segments, exactement les langues livrées.
 * Une langue ajoutée au code sans son segment serait invisible, et un segment sans langue
 * enverrait `setLocale` sur une valeur qu'il refuse — en silence, puisqu'il retourne alors sans
 * rien faire.
 */

const INDEX = readFileSync(
  resolve(import.meta.dirname, '../..', 'index.html'),
  'utf-8'
);

describe('négociation de la langue', () => {
  it('reconnaît une étiquette complète, casse comprise', () => {
    expect(negotiateLocale(['pt-BR'])).toBe('pt-BR');
    expect(negotiateLocale(['pt-br'])).toBe('pt-BR');
    expect(negotiateLocale(['PT-BR'])).toBe('pt-BR');
    expect(negotiateLocale(['fr'])).toBe('fr');
  });

  it('retombe sur la sous-étiquette primaire', () => {
    expect(negotiateLocale(['es-MX'])).toBe('es');
    expect(negotiateLocale(['es-419'])).toBe('es');
    expect(negotiateLocale(['fr-CA'])).toBe('fr');
    expect(negotiateLocale(['en-GB'])).toBe('en');
  });

  it('sert le brésilien à un navigateur portugais du Portugal, et c’est une décision', () => {
    // Écrit ici parce que ce n'est pas neutre : c'est la seule variante livrée, et elle reste
    // largement compréhensible. Le jour où `pt-PT` est livré, ce test doit CHANGER, pas casser.
    expect(negotiateLocale(['pt-PT'])).toBe('pt-BR');
    expect(negotiateLocale(['pt-AO'])).toBe('pt-BR');
  });

  it('respecte l’ordre des préférences du navigateur', () => {
    expect(negotiateLocale(['de', 'es', 'fr'])).toBe('es');
    expect(negotiateLocale(['ja-JP', 'pt-BR'])).toBe('pt-BR');
  });

  it('retombe sur l’anglais quand rien ne correspond', () => {
    expect(negotiateLocale(['de', 'it', 'zh-CN'])).toBe('en');
    expect(negotiateLocale([])).toBe('en');
    expect(negotiateLocale(undefined)).toBe('en');
    expect(negotiateLocale(null)).toBe('en');
    expect(negotiateLocale('es-CL')).toBe('es');
  });

  it('déclare une convention par langue, sans trou', () => {
    for (const locale of LOCALES) {
      expect(HTML_LANG[locale], locale).toBeTruthy();
      expect(INTL_LOCALE[locale], locale).toBeTruthy();
      expect(LOCALE_ENDONYM[locale], locale).toBeTruthy();
      expect(LOCALE_PATH[locale], locale).toBeDefined();
      // La locale `Intl` doit être acceptée par le moteur, sinon chaque nombre formaté jette.
      expect(() =>
        new Intl.NumberFormat(INTL_LOCALE[locale]).format(1.5)
      ).not.toThrow();
    }
    // L'anglais est à la RACINE : ses URL sont indexées depuis le 2026-09-10.
    expect(LOCALE_PATH.en).toBe('');
    // Les autres portent un segment en minuscules, utilisable tel quel dans une URL.
    for (const locale of LOCALES.filter((candidate) => candidate !== 'en')) {
      expect(LOCALE_PATH[locale]).toMatch(/^[a-z-]+$/);
    }
  });

  it('écrit la virgule décimale là où la langue l’écrit', () => {
    // Le curseur de vitesse annonçait « 5.5 mois/s » en français avant le 2026-09-24 ; la même
    // faute vaudrait pour l'espagnol et le portugais, qui écrivent eux aussi la virgule.
    const format = (locale: string): string =>
      new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(5.5);
    expect(format(INTL_LOCALE.fr)).toBe('5,5');
    expect(format(INTL_LOCALE.es)).toBe('5,5');
    expect(format(INTL_LOCALE['pt-BR'])).toBe('5,5');
    expect(format(INTL_LOCALE.en)).toBe('5.5');
  });
});

describe('sélecteur de langue d’index.html', () => {
  const segments = [
    ...INDEX.matchAll(/<button[^>]*class="lang-btn"[^>]*>/g),
  ].map((match) => match[0]);

  it('porte exactement les langues livrées', () => {
    const declared = segments.map(
      (tag) => /data-locale="([^"]+)"/.exec(tag)?.[1]
    );
    expect(declared).toEqual([...LOCALES]);
  });

  it('déclare la langue de chaque segment, pour la prononciation', () => {
    // Sans `lang`, un lecteur d'écran prononce « Español » avec la voix de la page : c'est
    // inintelligible, et c'est précisément la personne qui cherche sa langue qui l'entend.
    for (const tag of segments) {
      const locale = /data-locale="([^"]+)"/.exec(tag)?.[1];
      expect(tag, tag).toContain(`lang="${locale}"`);
    }
  });

  it('ne fige aucun libellé accessible dans le HTML', () => {
    // L'endonyme est posé par `ui/langSwitch` depuis `LOCALE_ENDONYM`, propriétaire unique.
    for (const tag of segments) expect(tag).not.toContain('aria-label=');
  });
});
