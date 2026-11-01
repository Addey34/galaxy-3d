import { describe, expect, it } from 'vitest';
import index from '../../public/assets/buildings/index.json';
import { parseBuildingSetIndex } from '@/config/buildingSets';
import { cardEn } from '@/i18n/dict-card-en';
import { cardEs } from '@/i18n/dict-card-es';
import { cardFr } from '@/i18n/dict-card-fr';
import { cardPtBR } from '@/i18n/dict-card-pt-BR';
import { centreOf, cityNameKey, CITY_FRAME_KM } from './citiesBlock';

/**
 * LE BLOC « VILLES EN 3D » : sa liste est celle de l'index PUBLIÉ par le cuiseur, donc ce qui peut
 * dériver est le nom, qui vit dans un dictionnaire. Une ville cuite sans nom dans une langue
 * afficherait une clé brute dans la fiche de la Terre : le test le refuse pour les quatre langues.
 */
const sets = parseBuildingSetIndex(index).sets;
const DICTIONARIES = {
  en: cardEn,
  fr: cardFr,
  es: cardEs,
  'pt-BR': cardPtBR,
} as Record<string, Record<string, string>>;

describe('les villes en 3D', () => {
  it('a au moins une ville, et chacune porte un nom dans les quatre langues', () => {
    expect(sets.length).toBeGreaterThan(0);
    const missing: string[] = [];
    for (const set of sets)
      for (const [locale, dict] of Object.entries(DICTIONARIES))
        if (!dict[cityNameKey(set.id)])
          missing.push(`${locale} / ${cityNameKey(set.id)}`);
    expect(missing, 'un nom par ville et par langue').toEqual([]);
  });

  it('ne garde aucun nom pour une ville qui n’est plus livrée', () => {
    const ids = new Set(sets.map((set) => cityNameKey(set.id)));
    const orphans = Object.keys(cardEn).filter(
      (key) => key.startsWith('bi.cities.name.') && !ids.has(key)
    );
    expect(orphans).toEqual([]);
  });

  it('plonge au centre de l’emprise de chaque ville', () => {
    for (const set of sets) {
      const { lon, lat } = centreOf(set.bboxLonLat);
      const [west, south, east, north] = set.bboxLonLat;
      expect(lon).toBeGreaterThan(west);
      expect(lon).toBeLessThan(east);
      expect(lat).toBeGreaterThan(south);
      expect(lat).toBeLessThan(north);
    }
    expect(centreOf([2, 48, 4, 50])).toEqual({ lon: 3, lat: 49 });
  });

  it('cadre une ville à quelques kilomètres, pas à l’échelle d’un pays', () => {
    expect(CITY_FRAME_KM).toBeGreaterThan(0);
    expect(CITY_FRAME_KM).toBeLessThan(20);
  });
});
