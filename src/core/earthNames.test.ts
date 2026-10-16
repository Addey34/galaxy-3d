import { describe, expect, it } from 'vitest';
import {
  earthNameIn,
  earthNamesToLabel,
  metresPerPixelAt,
  webMapZoom,
  WEB_MAP_EQUATOR_M,
  type EarthName,
} from './earthNames';

const sea: EarthName = {
  name: 'Mediterranean Sea',
  kind: 'sea',
  lat: 34.3,
  lon: 17.4,
  minZoom: 2,
  maxZoom: 7.5,
  names: { fr: 'mer Méditerranée', es: 'Mediterráneo', pt: 'Mar Mediterrâneo' },
};
const city: EarthName = {
  name: 'Paris',
  kind: 'admin-0 capital',
  lat: 48.9,
  lon: 2.4,
  minZoom: 1.7,
  names: { es: 'París' },
};
const peak: EarthName = {
  name: 'Mount Everest',
  kind: 'mountain',
  lat: 28,
  lon: 86.9,
  minZoom: 4,
};

describe('noms de la Terre (lot 53)', () => {
  it('un niveau de zoom est défini par sa résolution à l’équateur', () => {
    // Le niveau 0 : la circonférence sur une tuile de 256 px.
    expect(webMapZoom(WEB_MAP_EQUATOR_M / 256)).toBeCloseTo(0, 12);
    // Chaque niveau divise la résolution par deux.
    expect(webMapZoom(WEB_MAP_EQUATOR_M / 256 / 2 ** 10)).toBeCloseTo(10, 12);
    expect(webMapZoom(0)).toBe(Number.POSITIVE_INFINITY);
  });

  it('les mètres par pixel suivent l’altitude et le champ', () => {
    // 90° de champ : la hauteur visible vaut deux fois l'altitude.
    expect(metresPerPixelAt(1000, 90, 1000)).toBeCloseTo(2, 12);
    expect(metresPerPixelAt(2000, 90, 1000)).toBeCloseTo(4, 12);
    expect(metresPerPixelAt(0, 45, 900)).toBe(0);
  });

  it('applique la règle publiée : paraît dès min, s’efface après max', () => {
    const names = [city, sea, peak];
    expect(earthNamesToLabel(names, 1, 40)).toEqual([]);
    expect(earthNamesToLabel(names, 2, 40)).toEqual([city, sea]);
    expect(earthNamesToLabel(names, 5, 40)).toEqual([city, sea, peak]);
    // La mer s'efface au-delà de 7,5, la ville et le sommet restent.
    expect(earthNamesToLabel(names, 8, 40)).toEqual([city, peak]);
    // Le plafond garde les premiers du fichier.
    expect(earthNamesToLabel(names, 5, 1)).toEqual([city]);
  });

  it('écrit le nom dans la langue de l’interface, l’anglais sinon', () => {
    expect(earthNameIn(sea, 'fr')).toBe('mer Méditerranée');
    expect(earthNameIn(sea, 'pt-BR')).toBe('Mar Mediterrâneo');
    expect(earthNameIn(city, 'fr')).toBe('Paris');
    expect(earthNameIn(city, 'es')).toBe('París');
    expect(earthNameIn(peak, 'es')).toBe('Mount Everest');
    expect(earthNameIn(sea, 'en')).toBe('Mediterranean Sea');
  });
});
