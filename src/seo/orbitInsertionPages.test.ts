import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { flattenBodies } from '@/config/catalog';
import { NAVIGABLE_TARGETS } from '@/config/navigable';
import plan from '@/config/flybyEncounters.json';
import spacecraftOrder from '@/registry/spacecraft/order.json';
import { LOCALES } from '@/i18n/locales';
import { docPath } from './documentPage';
import recordFile from './orbitInsertions.json';
import {
  checkOrbitInsertionRecord,
  orbitInsertionListsByObject,
  orbitInsertionPages,
  orbitInsertionSceneHref,
  orbitInsertionSlug,
  type OrbitInsertionPageInputs,
  type OrbitInsertionRecord,
} from './orbitInsertionPages';

/**
 * LES MISES EN ORBITE (lot 49), confrontées au relevé LIVRÉ, au plan des rencontres dont il
 * dérive et aux phases en orbite que les fiches des sondes DÉCLARENT : deux sources écrites
 * séparément, qui doivent dire la même chose.
 */
const ORIGIN = 'https://example.test';
const record = recordFile as OrbitInsertionRecord;
const ROOT = resolve(import.meta.dirname, '../..');
const inputs: OrbitInsertionPageInputs = {
  record,
  config: CELESTIAL_CONFIG,
  navigable: NAVIGABLE_TARGETS,
  origin: ORIGIN,
};
const pagesOf = Object.fromEntries(
  LOCALES.map((locale) => [locale, orbitInsertionPages(inputs, locale)])
);
const DAY = 86_400_000;

const phasesOf = (probe: string) =>
  (
    JSON.parse(
      readFileSync(
        resolve(ROOT, `src/registry/spacecraft/${probe}.json`),
        'utf8'
      )
    ) as { satelliteOf?: { body: string; from: string; to: string }[] }
  ).satelliteOf ?? [];

/**
 * Les phases déclarées qui ne sont PAS une orbite autour de leur corps, avec leur raison. Une
 * seule : JWST est placé dans le système de la Terre pendant sa phase autour du point de Lagrange
 * L2, ce qui n'est pas une orbite autour de la Terre.
 */
const NOT_AN_ORBIT = new Set(['jwst/earth']);

describe('le relevé des mises en orbite', () => {
  it('chaque mise en orbite tombe dans une rencontre du plan, c’est-à-dire dans la sphère d’influence', () => {
    for (const insertion of record.insertions) {
      const at = Date.parse(insertion.at);
      expect(
        plan.encounters.some(
          (e) =>
            e.probe === insertion.probe &&
            e.planet === insertion.body &&
            Date.parse(e.from) <= at &&
            at <= Date.parse(e.to)
        ),
        orbitInsertionSlug(insertion)
      ).toBe(true);
    }
  });

  it('chaque phase en orbite déclarée par une fiche a sa mise en orbite, ou une raison', () => {
    for (const probe of spacecraftOrder.order) {
      for (const phase of phasesOf(probe)) {
        const pair = `${probe}/${phase.body}`;
        if (NOT_AN_ORBIT.has(pair)) continue;
        const insertion = record.insertions.find(
          (i) => i.probe === probe && i.body === phase.body
        );
        const excluded = record.excluded.find(
          (e) => e.probe === probe && e.body === phase.body
        );
        expect(insertion ?? excluded, pair).toBeDefined();
        if (!insertion) continue;
        // Mesurée sur la trajectoire, la mise en orbite tombe dans la phase déclarée, ou au plus
        // deux jours avant son début écrit à la main (Mars Express : la veille).
        const at = Date.parse(insertion.at);
        expect(at, pair).toBeGreaterThanOrEqual(
          Date.parse(phase.from) - 2 * DAY
        );
        expect(at, pair).toBeLessThan(Date.parse(phase.to));
      }
    }
  });

  it('une manœuvre détectée par une autre méthode encadre chaque mise en orbite', () => {
    // Témoin indépendant : le résidu à deux corps de `pnpm ephemeris:flybys`. Mesuré au plus à
    // 34 min (Cassini, dont la combustion a duré plus d'une heure). Une capture sans manœuvre
    // serait balistique, et devrait être regardée avant d'être publiée.
    for (const insertion of record.insertions) {
      expect(insertion.manoeuvre, orbitInsertionSlug(insertion)).not.toBeNull();
      expect(
        Math.abs(insertion.manoeuvre!.minutesFromInsertion),
        orbitInsertionSlug(insertion)
      ).toBeLessThanOrEqual(60);
    }
  });

  it('la sonde est liée : sa vitesse est sous la libération à sa distance', () => {
    // Pas « à peine » sous elle : une trajectoire modélise une manœuvre comme une impulsion, et
    // l'énergie y SAUTE sous zéro au lieu de glisser (Rosetta : 73 % de la libération à la
    // première seconde liée, la manœuvre détectée tombant 2 min après).
    const G = 6.6743e-20;
    const bodies = flattenBodies(CELESTIAL_CONFIG);
    for (const insertion of record.insertions) {
      const mass = bodies.get(insertion.body)!.realData!.massKg!;
      const escape = Math.sqrt((2 * G * mass) / insertion.distanceKm);
      expect(insertion.speedKmS, orbitInsertionSlug(insertion)).toBeLessThan(
        escape
      );
    }
  });

  it('refuse un relevé hors d’ordre, à chemin double, sans méthode ou à raison inconnue', () => {
    const [a, b] = record.insertions;
    expect(() =>
      checkOrbitInsertionRecord({ ...record, insertions: [b!, a!] })
    ).toThrow(/hors d'ordre/);
    expect(() =>
      checkOrbitInsertionRecord({ ...record, insertions: [a!, a!] })
    ).toThrow(/même chemin/);
    expect(() =>
      checkOrbitInsertionRecord({
        ...record,
        insertions: [{ ...a!, measuredFrom: 'ailleurs' as 'centre' }],
      })
    ).toThrow(/méthode/);
    expect(() =>
      checkOrbitInsertionRecord({
        ...record,
        excluded: [
          { probe: 'juno', body: 'io', reason: 'oubli' as 'coverage' },
        ],
      })
    ).toThrow(/raison/);
  });
});

describe('les pages', () => {
  it('l’index plus une page par mise en orbite, dans chaque langue', () => {
    for (const locale of LOCALES)
      expect(pagesOf[locale]!.length).toBe(record.insertions.length + 1);
  });

  it('l’index nomme chaque arrivée écartée', () => {
    for (const locale of LOCALES) {
      const index = pagesOf[locale]![0]!;
      for (const e of record.excluded) {
        const probe = NAVIGABLE_TARGETS.get(e.probe)!.displayName![locale]!;
        expect(index.body, `${locale} ${e.probe}`).toContain(probe);
      }
    }
  });

  it('dit la sensibilité à la masse exactement quand la fiche publie son incertitude', () => {
    for (const insertion of record.insertions) {
      const page = pagesOf.en!.find(
        (p) => p.slug === orbitInsertionSlug(insertion)
      )!;
      expect(
        page.body.includes('published with an uncertainty'),
        page.slug
      ).toBe(insertion.massRelativeUncertainty !== null);
    }
  });

  it('ouvre la scène sur la sonde, à l’instant publié, en Explo', () => {
    for (const insertion of record.insertions)
      expect(orbitInsertionSceneHref(insertion, 'fr')).toBe(
        `/fr/${insertion.probe}/?mode=explo&date=${insertion.at}`
      );
  });
});

describe('les liens retour', () => {
  it('chaque mise en orbite figure sur la page de sa sonde ET sur celle de son corps, rien de plus', () => {
    for (const locale of LOCALES) {
      const lists = orbitInsertionListsByObject(inputs, locale);
      for (const insertion of record.insertions) {
        const href = docPath(orbitInsertionSlug(insertion), locale);
        expect(lists.get(insertion.probe), href).toContain(`href="${href}"`);
        expect(lists.get(insertion.body), href).toContain(`href="${href}"`);
      }
      const links = [...lists.values()].join('').match(/<li>/g)?.length;
      expect(links).toBe(record.insertions.length * 2);
    }
  });
});
