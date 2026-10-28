import { describe, expect, it } from 'vitest';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { NAVIGABLE_TARGETS } from '@/config/navigable';
import { LOCALES } from '@/i18n/locales';
import witnessFile from '../../scripts/juno-perijove-witnesses.json';
import { docPath } from './documentPage';
import recordFile from './perijoves.json';
import {
  checkPerijoveRecord,
  perijoveListsByObject,
  perijovePages,
  perijoveSceneHref,
  perijoveSlug,
  type PerijovePageInputs,
  type PerijoveRecord,
} from './perijovePages';

/**
 * LES PÉRIJOVES DE JUNO, confrontés au relevé LIVRÉ et au tableau « Juno Orbits » de NASA Science
 * (colonne « Date (UTC) », lue le 2026-10-28) : PJ1 le 27 août 2016 « about 2,600 miles (4,200
 * kilometers) above the planet's swirling cloud tops », PJ57 le 30 décembre 2023 et PJ58 le 3
 * février 2024 (survols à basse altitude d'Io), PJ76 le 14 septembre 2025.
 */
const ORIGIN = 'https://example.test';
const record = recordFile as PerijoveRecord;
const inputs: PerijovePageInputs = {
  record,
  config: CELESTIAL_CONFIG,
  navigable: NAVIGABLE_TARGETS,
  origin: ORIGIN,
};
const pagesOf = Object.fromEntries(
  LOCALES.map((locale) => [locale, perijovePages(inputs, locale)])
);
const DAY = 86_400_000;
const pj = (n: number) => record.perijoves.find((p) => p.pj === n)!;
const gapToDay = (n: number, day: string) =>
  Math.abs(Date.parse(pj(n).at) - Date.parse(`${day}T12:00:00Z`));

describe('le relevé des périjoves', () => {
  it('porte les numéros de la NASA : PJ1, PJ57, PJ58 et PJ76 tombent à un jour de son tableau', () => {
    const published: Record<number, string> = {
      1: '2016-08-27',
      57: '2023-12-30',
      58: '2024-02-03',
      76: '2025-09-14',
    };
    for (const [n, day] of Object.entries(published))
      expect(gapToDay(Number(n), day), `PJ${n}`).toBeLessThanOrEqual(DAY);
  });

  it('confronte tous les numéros jusqu’à witnessedUpTo au fichier de témoins', () => {
    const witnesses = witnessFile.perijoves as Record<string, string>;
    expect(Object.keys(witnesses)).toHaveLength(record.witnessedUpTo);
    for (const [n, day] of Object.entries(witnesses))
      expect(gapToDay(Number(n), day), `PJ${n}`).toBeLessThanOrEqual(
        DAY + 12 * 3_600_000
      );
  });

  it('retrouve l’altitude de PJ1 à 100 km près de la valeur de la NASA (4 200 km), sans la confondre', () => {
    // Deux grandeurs voisines (rayon équatorial contre sommet des nuages à la latitude du passage).
    expect(Math.abs(pj(1).altitudeKm - 4200)).toBeLessThan(100);
  });

  it('assume un écart négatif : à haute latitude Juno passe sous le rayon équatorial', () => {
    expect(record.perijoves.some((p) => p.altitudeKm < 0)).toBe(true);
  });

  it('numérote sans trou à partir de PJ1 et sépare deux périjoves de plus de 30 jours', () => {
    record.perijoves.forEach((p, i) => expect(p.pj).toBe(i + 1));
    for (let i = 1; i < record.perijoves.length; i++)
      expect(
        Date.parse(record.perijoves[i].at) -
          Date.parse(record.perijoves[i - 1].at)
      ).toBeGreaterThan(30 * DAY);
  });

  it('refuse un relevé vide, hors d’ordre, mal numéroté ou incohérent', () => {
    const copy = () => structuredClone(record);
    const empty = copy();
    empty.perijoves = [];
    expect(() => checkPerijoveRecord(empty)).toThrow();
    const swapped = copy();
    [swapped.perijoves[1], swapped.perijoves[2]] = [
      swapped.perijoves[2],
      swapped.perijoves[1],
    ];
    expect(() => checkPerijoveRecord(swapped)).toThrow();
    const renumbered = copy();
    renumbered.perijoves[4].pj = 99;
    expect(() => checkPerijoveRecord(renumbered)).toThrow(/numéro/);
    const skewed = copy();
    skewed.perijoves[3].altitudeKm += 500;
    expect(() => checkPerijoveRecord(skewed)).toThrow(/incohérent/);
  });
});

describe('les pages des périjoves', () => {
  it('sont servies dans les quatre langues : un index et une page par périjove', () => {
    for (const locale of LOCALES)
      expect(pagesOf[locale]).toHaveLength(record.perijoves.length + 1);
  });

  it('portent le numéro, l’instant, et disent que l’écart n’est pas l’altitude de la NASA', () => {
    const page = pagesOf.en.find((d) => d.slug === perijoveSlug(pj(57)))!;
    expect(page.title).toContain('perijove 57');
    expect(page.body).toContain(pj(57).at.slice(11, 19));
    expect(page.body).toContain('not the altitude above the clouds');
    expect(page.body).toContain('table of orbits');
  });

  it('dit que le numéro prolonge la série au-delà du tableau de la NASA', () => {
    const last = pagesOf.en.find(
      (d) => d.slug === perijoveSlug(record.perijoves.at(-1)!)
    )!;
    expect(last.body).toContain(`stops at PJ${record.witnessedUpTo}`);
    const checked = pagesOf.en.find((d) => d.slug === perijoveSlug(pj(10)))!;
    expect(checked.body).not.toContain('stops at PJ');
  });

  it('marque une prédiction exactement quand l’instant suit la date de lecture', () => {
    for (const p of record.perijoves) {
      const page = pagesOf.en.find((d) => d.slug === perijoveSlug(p))!;
      expect(page.body.includes('it is a prediction'), p.at).toBe(
        p.at.slice(0, 10) > p.retrieved
      );
    }
  });

  it('lie le précédent et le suivant, dans les quatre langues', () => {
    for (const locale of LOCALES) {
      const page = pagesOf[locale].find(
        (d) => d.slug === perijoveSlug(pj(57))
      )!;
      expect(page.body).toContain(docPath(perijoveSlug(pj(56)), locale));
      expect(page.body).toContain(docPath(perijoveSlug(pj(58)), locale));
    }
  });

  it('ouvre la scène de Juno à l’instant mesuré, en Explo', () => {
    const href = perijoveSceneHref(pj(57), 'en');
    expect(href).toContain('mode=explo');
    expect(href).toContain(`date=${pj(57).at}`);
  });

  it('liste les périjoves sur les pages de Juno et de Jupiter', () => {
    for (const locale of LOCALES) {
      const lists = perijoveListsByObject(inputs, locale);
      expect([...lists.keys()].sort()).toEqual(['juno', 'jupiter']);
      expect(lists.get('juno')).toContain(docPath(perijoveSlug(pj(1)), locale));
    }
  });
});
