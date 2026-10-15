import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { flattenBodies } from '@/config/catalog';
import { NAVIGABLE_TARGETS } from '@/config/navigable';
import plan from '@/config/flybyEncounters.json';
import manifest from '../../public/assets/ephemerides/manifest.json';
import { jdTdbFromDate } from '@/core/timeScale';
import { LOCALES } from '@/i18n/locales';
import { docPath } from './documentPage';
import recordFile from './surfaceContacts.json';
import {
  checkSurfaceContactRecord,
  surfaceContactListsByObject,
  surfaceContactPages,
  surfaceContactSceneHref,
  surfaceContactSlug,
  type RestContact,
  type SurfaceContactPageInputs,
  type SurfaceContactRecord,
} from './surfaceContactPages';

/**
 * LES CONTACTS (lot 49, pas 3), confrontés au relevé LIVRÉ, au plan des rencontres dont il
 * dérive, au fichier de trajectoire que la scène dessine, et à un TÉMOIN d'une autre nature que
 * le critère de chaque contact.
 */
const ORIGIN = 'https://example.test';
const record = recordFile as SurfaceContactRecord;
const ROOT = resolve(import.meta.dirname, '../..');
const inputs: SurfaceContactPageInputs = {
  record,
  config: CELESTIAL_CONFIG,
  navigable: NAVIGABLE_TARGETS,
  origin: ORIGIN,
};
const pagesOf = Object.fromEntries(
  LOCALES.map((locale) => [locale, surfaceContactPages(inputs, locale)])
);
const bodies = flattenBodies(CELESTIAL_CONFIG);
const fiche = (id: string) =>
  JSON.parse(
    readFileSync(resolve(ROOT, `src/registry/entities/${id}.json`), 'utf8')
  ) as { elements?: { model?: { extentRatio?: number } } };
type GridEntry = { startJdTdb: number; stepDays: number; sampleCount: number };
const grids = manifest.bodies as unknown as Record<string, GridEntry>;
const gridEnd = (e: GridEntry) =>
  e.startJdTdb + e.stepDays * (e.sampleCount - 1);
const jd = (iso: string) => jdTdbFromDate(new Date(iso));
/**
 * La fin du segment planifié d'une rencontre : au ras de la fin d'une trajectoire, la fenêtre
 * s'arrête avec la marge du plan (Cassini : 10:31 UT) et le segment va jusqu'au dernier
 * échantillon du fichier (10:45).
 */
const segmentEnd = (e: { segment?: { to?: string } }) =>
  e.segment?.to ? Date.parse(`${e.segment.to.replace(' ', 'T')}Z`) : 0;

describe('le relevé des contacts', () => {
  it('porte les trois formes, pour que chaque règle soit exercée', () => {
    expect(new Set(record.contacts.map((c) => c.kind))).toEqual(
      new Set(['rest', 'touch', 'entry'])
    );
  });

  it('chaque contact s’ouvre dans une rencontre du plan, et la scène dessine la sonde à cet instant', () => {
    for (const contact of record.contacts) {
      const at = Date.parse(contact.sceneAt);
      expect(
        plan.encounters.some(
          (e) =>
            e.probe === contact.probe &&
            e.planet === contact.body &&
            Date.parse(e.from) <= at &&
            at <= Math.max(Date.parse(e.to), segmentEnd(e))
        ),
        surfaceContactSlug(contact)
      ).toBe(true);
      const grid = grids[contact.probe]!;
      expect(jd(contact.sceneAt), contact.probe).toBeGreaterThanOrEqual(
        grid.startJdTdb
      );
      expect(jd(contact.sceneAt), contact.probe).toBeLessThanOrEqual(
        gridEnd(grid)
      );
    }
  });

  it('au repos, la vitesse est celle d’un point de la surface (témoin : la période de la fiche)', () => {
    for (const contact of record.contacts) {
      if (contact.kind === 'entry') continue;
      expect(contact.at, surfaceContactSlug(contact)).toBe(contact.sceneAt);
      expect(contact.rotationSpeedKmS, contact.body).not.toBeNull();
      expect(contact.speedKmS).toBeGreaterThan(0);
      expect(contact.speedKmS).toBeLessThanOrEqual(contact.rotationSpeedKmS!);
      // Sous le plus grand rayon du corps : une sonde immobile à 10 km du centre de 67P serait
      // une trajectoire figée, pas un contact.
      const radius = bodies.get(contact.body)!.realData!.radiusKm!;
      const largest =
        radius * (fiche(contact.body).elements?.model?.extentRatio ?? 1);
      expect(contact.distanceKm, contact.body).toBeLessThan(largest);
    }
  });

  it('au niveau de 1 bar, la trajectoire a ralenti, et la scène s’arrête juste avant', () => {
    for (const contact of record.contacts) {
      if (contact.kind !== 'entry') continue;
      // Témoin : une chute libre traverserait le niveau à sa vitesse de pointe. Mesuré pour
      // Cassini : 0,55 km/s contre 31 km/s, onze minutes plus tôt et 665 km plus haut.
      expect(contact.relativeSpeedKmS).toBeLessThan(
        contact.peak.relativeSpeedKmS / 10
      );
      expect(contact.peak.at < contact.at).toBe(true);
      expect(contact.peak.altitudeKm).toBeGreaterThan(0);
      expect(Date.parse(contact.at) - Date.parse(contact.sceneAt)).toBe(60_000);
      // La trajectoire servie traverse la planète : le fichier livré s'arrête AVANT le niveau.
      expect(gridEnd(grids[contact.probe]!)).toBeLessThan(jd(contact.at));
    }
  });

  it('refuse un relevé hors d’ordre, à chemin double, à forme incohérente ou à raison inconnue', () => {
    const [a, b] = record.contacts;
    expect(() =>
      checkSurfaceContactRecord({ ...record, contacts: [b!, a!] })
    ).toThrow(/hors d'ordre/);
    expect(() =>
      checkSurfaceContactRecord({ ...record, contacts: [a!, a!] })
    ).toThrow(/même chemin/);
    const rest = record.contacts.find(
      (c): c is RestContact => c.kind === 'rest'
    )!;
    expect(() =>
      checkSurfaceContactRecord({
        ...record,
        contacts: [{ ...rest, restSeconds: 6 }],
      })
    ).toThrow(/incohérente/);
    expect(() =>
      checkSurfaceContactRecord({
        ...record,
        excluded: [
          { probe: 'juno', body: 'io', reason: 'oubli' as 'unresolved' },
        ],
      })
    ).toThrow(/raison/);
  });
});

describe('les pages', () => {
  it('l’index plus une page par contact, dans chaque langue', () => {
    for (const locale of LOCALES)
      expect(pagesOf[locale]!.length).toBe(record.contacts.length + 1);
  });

  it('l’index nomme chaque séjour écarté', () => {
    for (const locale of LOCALES) {
      const index = pagesOf[locale]![0]!;
      for (const e of record.excluded) {
        const probe = NAVIGABLE_TARGETS.get(e.probe)!.displayName![locale]!;
        expect(index.body, `${locale} ${e.probe}`).toContain(probe);
      }
    }
  });

  it('dit la vitesse de rotation au repos, et le ralentissement au niveau de 1 bar', () => {
    for (const contact of record.contacts) {
      const page = pagesOf.en!.find(
        (p) => p.slug === surfaceContactSlug(contact)
      )!;
      expect(
        page.body.includes('a point on the equator moves at'),
        page.slug
      ).toBe(contact.kind !== 'entry');
      expect(
        page.body.includes('has slowed down in the atmosphere'),
        page.slug
      ).toBe(contact.kind === 'entry');
      expect(page.body.includes('one minute before'), page.slug).toBe(
        contact.kind === 'entry'
      );
    }
  });

  it('ouvre la scène sur la sonde, à l’instant de la scène, en Explo', () => {
    for (const contact of record.contacts)
      expect(surfaceContactSceneHref(contact, 'fr')).toBe(
        `/fr/${contact.probe}/?mode=explo&date=${contact.sceneAt}`
      );
  });
});

describe('les liens retour', () => {
  it('chaque contact figure sur la page de sa sonde ET sur celle de son corps, rien de plus', () => {
    for (const locale of LOCALES) {
      const lists = surfaceContactListsByObject(inputs, locale);
      for (const contact of record.contacts) {
        const href = docPath(surfaceContactSlug(contact), locale);
        expect(lists.get(contact.probe), href).toContain(`href="${href}"`);
        expect(lists.get(contact.body), href).toContain(`href="${href}"`);
      }
      const links = [...lists.values()].join('').match(/<li>/g)?.length;
      expect(links).toBe(record.contacts.length * 2);
    }
  });
});
