import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { flattenBodies } from '@/config/catalog';
import { NAVIGABLE_TARGETS } from '@/config/navigable';
import plan from '@/config/flybyEncounters.json';
import { LOCALES } from '@/i18n/locales';
import { bodyLandingPages } from './bodyLandingPage';
import { docPath } from './documentPage';
import recordFile from './flybyEvents.json';
import {
  checkFlybyRecord,
  flybyListsByObject,
  flybyPages,
  flybySceneHref,
  flybySlug,
  isPredicted,
  type FlybyPageInputs,
  type FlybyRecord,
} from './flybyPages';

/**
 * LES PAGES DES SURVOLS (2026-10-12), confrontées au relevé LIVRÉ et au plan des rencontres dont
 * il dérive : aucune rencontre ne disparaît sans raison, la mesure fine ne contredit pas la
 * mesure grossière, et une page ne relie que ce qui existe.
 */
const ORIGIN = 'https://example.test';
const record = recordFile as FlybyRecord;
const ROOT = resolve(import.meta.dirname, '../..');
const inputs: FlybyPageInputs = {
  record,
  config: CELESTIAL_CONFIG,
  navigable: NAVIGABLE_TARGETS,
  origin: ORIGIN,
};
const pagesOf = Object.fromEntries(
  LOCALES.map((locale) => [locale, flybyPages(inputs, locale)])
);
const page = (slug: string, locale: (typeof LOCALES)[number] = 'en') =>
  pagesOf[locale]!.find((p) => p.slug === `flybys/${slug}`)!;

/** La rencontre du plan qu'un survol mesuré raffine : même sonde, même corps, à un jour près. */
const planned = (probe: string, body: string, at: string) =>
  plan.encounters.find(
    (e) =>
      e.probe === probe &&
      e.planet === body &&
      Math.abs(Date.parse(e.closestAt) - Date.parse(at)) < 86_400_000
  );

describe('le relevé des survols contre le plan des rencontres', () => {
  it('chaque rencontre du plan est un survol ou une exclusion nommée, jamais rien', () => {
    expect(record.events.length + record.excluded.length).toBe(
      plan.encounters.length
    );
    for (const event of record.events)
      expect(
        planned(event.probe, event.body, event.closestAt),
        flybySlug(event)
      ).toBeDefined();
    for (const excluded of record.excluded)
      expect(['departure', 'edge', 'bound', 'phase', 'unresolved']).toContain(
        excluded.reason
      );
  });

  it('la mesure à la seconde est au plus aussi loin que celle du plan, et près de sa date', () => {
    // Le plan échantillonne la MÊME trajectoire toutes les 10 min (30 au-delà de 20 jours) :
    // le point le plus proche trouvé à la seconde ne peut pas être plus loin que le sien, à
    // l'arrondi au km près, ni à plus d'un pas de lui.
    for (const event of record.events) {
      const enc = planned(event.probe, event.body, event.closestAt)!;
      expect(event.closestKm, flybySlug(event)).toBeLessThanOrEqual(
        enc.closestKm + 1
      );
      expect(
        Math.abs(Date.parse(event.closestAt) - Date.parse(enc.closestAt)),
        flybySlug(event)
      ).toBeLessThanOrEqual(30 * 60_000);
    }
  });

  it('une phase en orbite déclarée par la fiche de la sonde n’a pas de page', () => {
    for (const event of record.events) {
      const fiche = JSON.parse(
        readFileSync(
          resolve(ROOT, `src/registry/spacecraft/${event.probe}.json`),
          'utf8'
        )
      ) as { satelliteOf?: { body: string; from: string; to: string }[] };
      const at = Date.parse(event.closestAt);
      expect(
        (fiche.satelliteOf ?? []).some(
          (p) =>
            p.body === event.body &&
            Date.parse(p.from) <= at &&
            at < Date.parse(p.to)
        ),
        flybySlug(event)
      ).toBe(false);
    }
  });

  it('refuse un relevé hors d’ordre, à chemin double ou sans méthode', () => {
    const [a, b] = record.events;
    expect(() => checkFlybyRecord({ ...record, events: [b!, a!] })).toThrow(
      /hors d'ordre/
    );
    expect(() => checkFlybyRecord({ ...record, events: [a!, a!] })).toThrow(
      /même chemin/
    );
    expect(() =>
      checkFlybyRecord({
        ...record,
        events: [{ ...a!, measuredFrom: 'ailleurs' as 'centre' }],
      })
    ).toThrow(/méthode/);
    expect(() =>
      checkFlybyRecord({
        ...record,
        events: [{ ...a!, closestAt: a!.closestAt.slice(0, 16) }],
      })
    ).toThrow(/hors format/);
  });
});

describe('les pages', () => {
  it('l’index plus une page par survol, dans chaque langue', () => {
    for (const locale of LOCALES)
      expect(pagesOf[locale]!.length).toBe(record.events.length + 1);
  });

  it('dit « prédiction » exactement pour les survols postérieurs à leur lecture', () => {
    const predicted = record.events.filter(isPredicted);
    // Bornes : le relevé porte des deux sortes, sinon la règle ne serait pas exercée.
    expect(predicted.length).toBeGreaterThan(0);
    expect(predicted.length).toBeLessThan(record.events.length);
    for (const event of record.events) {
      const slug = flybySlug(event).replace('flybys/', '');
      expect(page(slug, 'fr').body.includes('prédiction'), slug).toBe(
        isPredicted(event)
      );
      expect(page(slug).body.includes('prediction'), slug).toBe(
        isPredicted(event)
      );
    }
  });

  it('dit la mesure par différence exactement là où elle a eu lieu', () => {
    for (const event of record.events) {
      const slug = flybySlug(event).replace('flybys/', '');
      expect(page(slug).body.includes('does not serve this body'), slug).toBe(
        event.measuredFrom === 'difference'
      );
    }
  });

  it('ouvre la scène sur une sonde qui a sa page, à l’instant publié, en Explo', () => {
    for (const event of record.events) {
      expect(NAVIGABLE_TARGETS.has(event.probe), event.probe).toBe(true);
      expect(flattenBodies(CELESTIAL_CONFIG).has(event.body), event.body).toBe(
        true
      );
      const href = flybySceneHref(event, 'fr');
      expect(href).toBe(
        `/fr/${event.probe}/?mode=explo&date=${event.closestAt}`
      );
    }
  });
});

describe('les liens retour', () => {
  it('chaque survol figure sur la page de sa sonde ET sur celle de son corps', () => {
    for (const locale of LOCALES) {
      const lists = flybyListsByObject(inputs, locale);
      for (const event of record.events) {
        const href = docPath(flybySlug(event), locale);
        expect(lists.get(event.probe), href).toContain(`href="${href}"`);
        expect(lists.get(event.body), href).toContain(`href="${href}"`);
      }
      // Rien de plus : autant de liens que deux fois le nombre de survols.
      const links = [...lists.values()].join('').match(/<li>/g)?.length;
      expect(links).toBe(record.events.length * 2);
    }
  });

  it('la page d’un corps porte sa liste, et un corps jamais survolé n’en a pas', () => {
    const pages = bodyLandingPages(
      CELESTIAL_CONFIG,
      ORIGIN,
      'fr',
      new Map(),
      flybyListsByObject(inputs, 'fr')
    );
    const neptune = pages.find((p) => p.body === 'neptune')!;
    expect(neptune.events).toContain('/fr/flybys/voyager2-neptune-1989-08-25/');
    const titan = pages.find((p) => p.body === 'titan')!;
    expect(titan.events).toBe('');
  });
});
