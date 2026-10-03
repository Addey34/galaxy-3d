import { describe, expect, it } from 'vitest';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { LANDING_PAGE_BODIES, NAVIGABLE_TARGETS } from '@/config/navigable';
import { bodyFact } from '@/core/bodyFacts';
import { messages } from '@/i18n/allDictionaries';
import { LOCALES } from '@/i18n/locales';
import { bodyLandingPages } from './bodyLandingPage';
import {
  instrumentLandingPages,
  type InstrumentPageInputs,
} from './instrumentLandingPage';

/**
 * LES PAGES DES QUATORZE OBJETS D'INSTRUMENT (2026-10-03).
 *
 * Le générateur est pur ; ce fichier lui passe une archive du PDS et une couverture d'éphémérides
 * de forme RÉELLE (celle des fichiers livrés), et vérifie ce que la page affirme.
 */
const ORIGIN = 'https://example.test';
const inputs: InstrumentPageInputs = {
  archives: new Map([
    [
      'voyager1',
      {
        status: 'declared',
        archive: {
          hosts: [
            {
              lid: 'urn:nasa:pds:context:instrument_host:spacecraft.vg1',
              name: 'VOYAGER 1',
            },
          ],
          investigations: [
            {
              lid: 'urn:nasa:pds:context:investigation:mission.voyager',
              name: 'Voyager',
              start: '1972-07-01',
              end: null,
            },
          ],
          instruments: [
            {
              lid: 'urn:nasa:pds:context:instrument:vg1.mag',
              name: 'Fluxgate Magnetometer for VG1',
              host: 'urn:nasa:pds:context:instrument_host:spacecraft.vg1',
            },
          ],
        },
      },
    ],
    ['parker-solar-probe', { status: 'absent' }],
  ]),
  archiveRetrieved: '2026-09-30',
  coverage: new Map([['voyager1', { from: '1977-09-06', to: '2099-12-31' }]]),
};

describe('les pages des objets d’instrument', () => {
  for (const locale of LOCALES)
    it(`une page par objet, au titre du dictionnaire, en ${locale}`, () => {
      const pages = instrumentLandingPages(
        NAVIGABLE_TARGETS,
        inputs,
        ORIGIN,
        locale
      );
      expect(pages.length).toBe(NAVIGABLE_TARGETS.size);
      expect(pages.length).toBe(14);
      for (const page of pages) {
        expect(page.title).toBe(
          messages[locale]['title.instrument'].replace(
            '{name}',
            page.displayName
          )
        );
        expect(page.heading).toBe(page.title);
        expect(page.canonical).toBe(`${ORIGIN}/${page.slug}/`);
      }
    });

  it('cite chaque fait par sa source, avec la précision de la fiche', () => {
    const [voyager] = instrumentLandingPages(
      new Map([['voyager1', NAVIGABLE_TARGETS.get('voyager1')!]]),
      inputs,
      ORIGIN
    );
    const launch = voyager!.facts.find((f) => f.label === 'Launch date');
    expect(launch?.value).toBe('September 5, 1977');
    expect(launch?.source).toBeDefined();
    expect(voyager!.sources.length).toBeGreaterThan(0);
    for (const fact of voyager!.facts) expect(fact.source).toBeDefined();
  });

  it('dit les instruments que le PDS déclare, et l’absence quand il n’en déclare aucun', () => {
    const pages = instrumentLandingPages(NAVIGABLE_TARGETS, inputs, ORIGIN);
    const voyager = pages.find((p) => p.body === 'voyager1')!;
    expect(voyager.extra).toContain('Fluxgate Magnetometer for VG1');
    expect(voyager.extra).toContain('Voyager');
    expect(voyager.extra).toContain('September 6, 1977');
    const parker = pages.find((p) => p.body === 'parker-solar-probe')!;
    expect(parker.extra).toContain(messages.en['bi.instruments.absent']);
    // Un interstellaire n'embarque rien : aucun bloc d'instruments.
    const oumuamua = pages.find((p) => p.body === 'oumuamua')!;
    expect(oumuamua.extra).not.toContain(messages.en['bi.instruments.label']);
  });

  it('n’affirme une orbite ouverte que pour des objets dont l’excentricité dépasse 1', () => {
    // La phrase d'introduction d'un interstellaire le dit : « excentricité supérieure à 1 ».
    for (const [name, cfg] of NAVIGABLE_TARGETS) {
      if (cfg.kind !== 'interstellar') continue;
      const e = bodyFact(cfg, 'eccentricity');
      expect(e.status, name).toBe('value');
      if (e.status === 'value' && e.value.kind === 'number')
        expect(e.value.value, name).toBeGreaterThan(1);
    }
  });

  it('n’écrit aucun tiret cadratin, dans aucune langue', () => {
    for (const locale of LOCALES)
      for (const page of instrumentLandingPages(
        NAVIGABLE_TARGETS,
        inputs,
        ORIGIN,
        locale
      ))
        expect(
          page.title + page.summary + page.description + page.extra,
          `${page.slug}`
        ).not.toContain('—');
  });
});

describe('une seule liste des adresses qui ont une page', () => {
  it('égale exactement les pages que les générateurs produisent', () => {
    const generated = new Set([
      ...bodyLandingPages(CELESTIAL_CONFIG, ORIGIN).map((p) => p.body),
      ...instrumentLandingPages(NAVIGABLE_TARGETS, inputs, ORIGIN).map(
        (p) => p.body
      ),
    ]);
    expect([...generated].sort()).toEqual([...LANDING_PAGE_BODIES].sort());
  });
});
