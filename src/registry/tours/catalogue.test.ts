import { describe, expect, it } from 'vitest';
import tourCatalogue from 'virtual:tour-catalogue';
import { TOUR_SCRIPTS } from '@/config/tourScripts';
import { TOUR_ORDER, toTourScript } from './index';
import { TOUR_RECORDS } from './all';
import { buildTourCatalogue, orderTourRecords } from './catalogue';
import { lazyTourIds, loadTourScript } from './lazy';

const title = (en: string) => ({ en, fr: en, es: en, 'pt-BR': en });
const fiche = (id: string) => ({ id, title: title(id) });

describe('buildTourCatalogue : dérivé des fiches, dans l’ordre déclaré', () => {
  it('rend l’identifiant et le titre, dans l’ordre de order.json', () => {
    expect(
      buildTourCatalogue([fiche('b'), fiche('a')], ['a', 'b']).map((e) => e.id)
    ).toEqual(['a', 'b']);
  });

  it('refuse un ordre qui oublie une fiche, en ajoute une, ou la répète', () => {
    expect(() => orderTourRecords([fiche('a'), fiche('b')], ['a'])).toThrow(
      /registre des visites/
    );
    expect(() => orderTourRecords([fiche('a')], ['a', 'z'])).toThrow(
      /registre des visites/
    );
    expect(() => orderTourRecords([fiche('a')], ['a', 'a'])).toThrow(
      /registre des visites/
    );
    expect(() => orderTourRecords([fiche('a'), fiche('a')], ['a'])).toThrow(
      /registre des visites/
    );
  });
});

describe('le catalogue livré au lecteur (module virtuel du greffon)', () => {
  it('est exactement celui des fiches : mêmes identifiants, mêmes titres, même ordre', () => {
    expect(tourCatalogue.map((entry) => entry.id)).toEqual(TOUR_ORDER);
    expect(tourCatalogue.map(({ id, title: t }) => ({ id, title: t }))).toEqual(
      TOUR_SCRIPTS.map(({ id, title: t }) => ({ id, title: t }))
    );
  });

  it('porte les titres dans les quatre langues, sans aucune étape ni légende (seulement les corps et lieux rejoints)', () => {
    for (const entry of tourCatalogue) {
      expect(Object.keys(entry).sort()).toEqual([
        'bodies',
        'id',
        'places',
        'title',
      ]);
      for (const locale of ['en', 'fr', 'es', 'pt-BR'] as const)
        expect(entry.title[locale].length).toBeGreaterThan(3);
    }
  });
});

describe('le chargeur différé d’une visite', () => {
  it('sert exactement les visites déclarées, dans l’ordre', () => {
    expect(lazyTourIds()).toEqual(TOUR_ORDER);
  });

  it('rend, pour chaque visite, le même script que la lecture exhaustive', async () => {
    for (const record of TOUR_RECORDS) {
      const lazy = await loadTourScript(record.id);
      expect(lazy, record.id).toEqual(toTourScript(record));
    }
  });

  it('rend null pour un identifiant inconnu, sans rien charger', async () => {
    expect(await loadTourScript('inconnue')).toBeNull();
    expect(await loadTourScript('')).toBeNull();
    expect(await loadTourScript('order')).toBeNull();
    expect(await loadTourScript('__proto__')).toBeNull();
    expect(await loadTourScript('../order')).toBeNull();
    expect(await loadTourScript('constructor')).toBeNull();
  });

  it('chaque fiche porte l’identifiant de son fichier (un renommage oublié casse ici)', () => {
    expect(TOUR_RECORDS.map((r) => r.id).sort()).toEqual(
      [...TOUR_ORDER].sort()
    );
  });
});

describe('les corps et lieux rejoints (GAL-OBSERVATION-001), lus dans les étapes', () => {
  const entry = (id: string) => tourCatalogue.find((e) => e.id === id)!;

  it('Apollo 11 rejoint la Lune et plonge vers la Station Tranquillité', () => {
    expect(entry('moon-tranquillity').bodies).toEqual(['moon']);
    expect(entry('moon-tranquillity').places).toContainEqual({
      body: 'moon',
      name: 'Statio Tranquillitatis',
    });
  });

  it('chaque visite rejoint au moins un corps, sans doublon, comme ses étapes le disent', () => {
    for (const record of TOUR_RECORDS) {
      const e = entry(record.id);
      const flyTo = record.steps
        .filter((s) => s.kind === 'flyTo')
        .map((s) => (s as { body: string }).body);
      expect(e.bodies.length, record.id).toBeGreaterThan(0);
      expect(new Set(e.bodies).size).toBe(e.bodies.length);
      expect([...new Set(flyTo)]).toEqual(e.bodies);
    }
  });
});
