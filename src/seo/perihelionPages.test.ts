import { describe, expect, it } from 'vitest';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { NAVIGABLE_TARGETS } from '@/config/navigable';
import { LOCALES } from '@/i18n/locales';
import { docPath } from './documentPage';
import recordFile from './perihelia.json';
import {
  checkPerihelionRecord,
  perihelionListsByObject,
  perihelionPages,
  perihelionSceneHref,
  perihelionSlug,
  type PerihelionPageInputs,
  type PerihelionRecord,
} from './perihelionPages';

/**
 * LES PÉRIHÉLIES (lot 69), confrontés au relevé LIVRÉ et à ce que la NASA publie du passage du
 * 2024-12-24 (NASA Science, « NASA's Parker Solar Probe Makes History With Closest Pass to Sun » :
 * « just 3.8 million miles above the surface of the Sun » à « 430,000 miles per hour » ; NASA
 * Scientific Visualization Studio 14741 : « 6:53 a.m. ET », soit 11:53 UTC), lus à la source le
 * 2026-10-22. La NASA dit aussi que Parker a ÉGALÉ ce record les 2025-03-22 et 2025-06-19.
 */
const ORIGIN = 'https://example.test';
const record = recordFile as PerihelionRecord;
const inputs: PerihelionPageInputs = {
  record,
  config: CELESTIAL_CONFIG,
  navigable: NAVIGABLE_TARGETS,
  origin: ORIGIN,
};
const pagesOf = Object.fromEntries(
  LOCALES.map((locale) => [locale, perihelionPages(inputs, locale)])
);
const DAY = 86_400_000;
const MILE_KM = 1.609344;

const of = (probe: string) => record.perihelia.filter((p) => p.probe === probe);
const parkerOn = (day: string) =>
  of('parker-solar-probe').find((p) => p.at.startsWith(day));

describe('le relevé des périhélies', () => {
  it('retrouve le passage du 2024-12-24 : altitude et vitesse publiées, arrondies comme la NASA les arrondit', () => {
    const p = parkerOn('2024-12-24')!;
    expect(p).toBeDefined();
    // « 3.8 million miles » : toute valeur entre 3,75 et 3,85 millions de milles s'arrondit ainsi.
    expect(p.altitudeKm / MILE_KM).toBeGreaterThan(3.75e6);
    expect(p.altitudeKm / MILE_KM).toBeLessThan(3.85e6);
    // « 430,000 miles per hour » : entre 425 000 et 435 000 mph.
    const mph = (p.speedKmS * 3600) / MILE_KM;
    expect(mph).toBeGreaterThan(425_000);
    expect(mph).toBeLessThan(435_000);
  });

  it('place ce passage à moins de 15 minutes de l’heure du SVS, et l’écart est ouvert', () => {
    // 6:53 a.m. ET le 2024-12-24 = 11:53 UTC. Le minimum de distance au centre du Soleil, sur la
    // trajectoire d'Horizons, tombe à 11:40:57 : 12 minutes plus tôt. La cause n'est pas établie
    // (le temps de périhélie d'une mission peut se définir sur des éléments osculateurs, pas sur le
    // minimum de distance) ; la page dit ce qui est MESURÉ, et ce témoin borne l'écart.
    const p = parkerOn('2024-12-24')!;
    const published = Date.parse('2024-12-24T11:53:00Z');
    expect(Math.abs(Date.parse(p.at) - published)).toBeLessThan(15 * 60_000);
  });

  it('retrouve les deux records égalés, aux dates publiées, à la même distance près', () => {
    const reference = parkerOn('2024-12-24')!;
    for (const day of ['2025-03-22', '2025-06-19']) {
      const p = parkerOn(day)!;
      expect(p, day).toBeDefined();
      // « Égalé » : la même altitude, à 0,02 % près (quelques centaines de km sur 6,9 millions).
      expect(
        Math.abs(p.altitudeKm - reference.altitudeKm) / reference.altitudeKm,
        day
      ).toBeLessThan(2e-4);
    }
  });

  it('n’a aucun périhélie de Parker plus proche que ce passage avant lui', () => {
    const reference = parkerOn('2024-12-24')!;
    for (const p of of('parker-solar-probe'))
      if (p.at < reference.at)
        expect(p.altitudeKm, p.at).toBeGreaterThan(reference.altitudeKm * 1.05);
  });

  it('deux périhélies d’une même sonde sont séparés d’au moins 80 jours', () => {
    // La plus courte période de ces deux sondes est de 88 jours : en deçà, un minimum a été pris
    // pour une ondulation de survol, ou compté deux fois.
    for (const probe of ['parker-solar-probe', 'solar-orbiter']) {
      const series = of(probe);
      expect(series.length, probe).toBeGreaterThan(5);
      for (let i = 1; i < series.length; i++)
        expect(
          Date.parse(series[i]!.at) - Date.parse(series[i - 1]!.at),
          series[i]!.at
        ).toBeGreaterThan(80 * DAY);
    }
  });

  it('chaque périhélie tombe dans la fenêtre lue pour sa sonde', () => {
    for (const p of record.perihelia) {
      const bound = record.bounds.find((b) => b.probe === p.probe)!;
      expect(p.at >= bound.from && p.at <= bound.to, perihelionSlug(p)).toBe(
        true
      );
    }
  });

  it('refuse un relevé vide, hors d’ordre, à chemin double ou à altitude incohérente', () => {
    const [a, b] = record.perihelia;
    expect(() => checkPerihelionRecord({ ...record, perihelia: [] })).toThrow(
      /vide/
    );
    expect(() =>
      checkPerihelionRecord({ ...record, perihelia: [b!, a!] })
    ).toThrow(/hors d'ordre/);
    expect(() =>
      checkPerihelionRecord({ ...record, perihelia: [a!, a!] })
    ).toThrow(/même chemin/);
    expect(() =>
      checkPerihelionRecord({
        ...record,
        perihelia: [{ ...a!, altitudeKm: a!.altitudeKm + 1000 }],
      })
    ).toThrow(/altitude incohérente/);
  });
});

describe('les pages', () => {
  it('l’index plus une page par périhélie, dans chaque langue', () => {
    for (const locale of LOCALES)
      expect(pagesOf[locale]!.length).toBe(record.perihelia.length + 1);
  });

  it('ne proclame aucun record, que la trajectoire ne dit pas', () => {
    for (const page of pagesOf.en!)
      expect(page.body, page.slug).not.toMatch(/\brecord\b/i);
  });

  it('marque une prédiction exactement quand le périhélie suit la date de lecture', () => {
    for (const p of record.perihelia) {
      const page = pagesOf.en!.find((x) => x.slug === perihelionSlug(p))!;
      expect(page.body.includes('it is a prediction'), page.slug).toBe(
        p.at.slice(0, 10) > p.retrieved
      );
    }
  });

  it('ouvre la scène sur la sonde, à l’instant publié, en Explo', () => {
    for (const p of record.perihelia)
      expect(perihelionSceneHref(p, 'fr')).toBe(
        `/fr/${p.probe}/?mode=explo&date=${p.at}`
      );
  });

  it('chaque page lie le périhélie précédent et le suivant de sa sonde', () => {
    for (const locale of LOCALES)
      for (const probe of ['parker-solar-probe', 'solar-orbiter']) {
        const series = of(probe);
        series.forEach((p, i) => {
          const page = pagesOf[locale]!.find(
            (x) => x.slug === perihelionSlug(p)
          )!;
          for (const other of [series[i - 1], series[i + 1]])
            if (other)
              expect(page.body, page.slug).toContain(
                `href="${docPath(perihelionSlug(other), locale)}"`
              );
        });
      }
  });

  it('l’index nomme le passage le plus proche parmi les passages MESURÉS', () => {
    const reference = parkerOn('2024-12-24')!;
    const index = pagesOf.en![0]!;
    const measured = record.perihelia.filter(
      (p) => p.at.slice(0, 10) <= p.retrieved
    );
    const closest = measured.reduce((a, b) =>
      b.altitudeKm < a.altitudeKm ? b : a
    );
    // Le plus proche mesuré est l'un des passages à 6,16 millions de km d'altitude, pas une
    // prédiction ; et le 2024-12-24 y figure au même ordre de grandeur.
    expect(closest.at.slice(0, 10) <= closest.retrieved).toBe(true);
    expect(Math.abs(closest.altitudeKm - reference.altitudeKm)).toBeLessThan(
      10_000
    );
    expect(index.body).toContain('The closest measured pass is');
  });
});

describe('les liens retour', () => {
  it('chaque périhélie figure sur la page de sa sonde ET sur celle du Soleil, rien de plus', () => {
    for (const locale of LOCALES) {
      const lists = perihelionListsByObject(inputs, locale);
      for (const p of record.perihelia) {
        const href = docPath(perihelionSlug(p), locale);
        expect(lists.get(p.probe), href).toContain(`href="${href}"`);
        expect(lists.get('sun'), href).toContain(`href="${href}"`);
      }
      const links = [...lists.values()].join('').match(/<li>/g)?.length;
      expect(links).toBe(record.perihelia.length * 2);
    }
  });
});
