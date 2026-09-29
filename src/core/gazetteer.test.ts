import { describe, expect, it } from 'vitest';

import {
  MAX_FEATURE_LABELS,
  MIN_FEATURE_SIZE_PX,
  apparentSizePx,
  featuresToLabel,
  iauLongitudeToSceneLongitude,
  type NamedFeature,
} from './gazetteer';
import {
  geographicToLocalDirection,
  localDirectionToGeographic,
} from './frames';

const feature = (over: Partial<NamedFeature> = {}): NamedFeature => ({
  name: 'X',
  code: 'CR',
  type: 'Crater',
  lat: 0,
  lon: 0,
  diameterKm: 100,
  approved: '2000-01-01',
  origin: '',
  iauId: 1,
  ...over,
});

describe('iauLongitudeToSceneLongitude', () => {
  it('laisse intacte la moitié qui est déjà dans la convention de la scène', () => {
    for (const lon of [0, 0.5, 45, 179.9])
      expect(iauLongitudeToSceneLongitude(lon)).toBeCloseTo(lon, 10);
    // 180 est la COUTURE : le même méridien s'écrit 180 ou −180, et on rend la forme
    // canonique de l'intervalle semi-ouvert, celle que le mesh rend aussi.
    expect(iauLongitudeToSceneLongitude(180)).toBeCloseTo(-180, 10);
  });

  it('replie la moitié au-delà de 180, sans jamais MIROITER', () => {
    // C'est la faute qui ne se verrait pas : les deux conventions sont EST, donc 330° est
    // −30°, et surtout PAS +30°. Un miroir poserait chaque nom à l'opposé de sa formation,
    // sans rien déformer et sans qu'aucune capture isolée ne le montre.
    expect(iauLongitudeToSceneLongitude(330)).toBeCloseTo(-30, 10);
    expect(iauLongitudeToSceneLongitude(181)).toBeCloseTo(-179, 10);
    expect(iauLongitudeToSceneLongitude(359.5)).toBeCloseTo(-0.5, 10);
  });

  it('accepte une longitude hors bornes sans produire d’absurdité', () => {
    expect(iauLongitudeToSceneLongitude(360)).toBeCloseTo(0, 10);
    expect(iauLongitudeToSceneLongitude(-30)).toBeCloseTo(-30, 10);
    expect(iauLongitudeToSceneLongitude(720 + 45)).toBeCloseTo(45, 10);
  });

  it('place un nom du côté que la scène appelle EST', () => {
    // Le croisement qui compte vraiment : la direction rendue pour 90° est doit être opposée,
    // en x et z, à celle de 270° est (soit −90°). Sans cela, la conversion serait cohérente
    // avec elle-même et fausse contre le mesh.
    const east = geographicToLocalDirection(
      0,
      iauLongitudeToSceneLongitude(90)
    );
    const west = geographicToLocalDirection(
      0,
      iauLongitudeToSceneLongitude(270)
    );
    expect(east.x).toBeCloseTo(-west.x, 10);
    expect(east.z).toBeCloseTo(-west.z, 10);
    // Et l'aller-retour complet : la longitude que la scène REND pour une longitude de l'UAI
    // doit redonner celle-ci. C'est le croisement qui prouve la conversion, pas un signe que
    // j'aurais deviné sur la paramétrisation du mesh.
    for (const iau of [0, 45, 90, 179, 180, 181, 270, 330, 359.5]) {
      const back = localDirectionToGeographic(
        geographicToLocalDirection(0, iauLongitudeToSceneLongitude(iau))
      ).longitudeDeg;
      expect(back, `UAI ${iau}`).toBeCloseTo(
        iauLongitudeToSceneLongitude(iau),
        8
      );
    }
  });
});

describe('apparentSizePx', () => {
  it('croît quand on approche, et s’annule sur une géométrie impossible', () => {
    const near = apparentSizePx(100, 1737, 2, 900, 50);
    const far = apparentSizePx(100, 1737, 20, 900, 50);
    expect(near).toBeGreaterThan(far);
    expect(apparentSizePx(100, 0, 2, 900, 50)).toBe(0);
    expect(apparentSizePx(100, 1737, 0, 900, 50)).toBe(0);
  });

  it('rend la moitié de la hauteur pour un objet qui remplit un demi-champ', () => {
    // Témoin analytique : à la distance d, un objet de diamètre 2·d·tan(fov/4) sous-tend
    // exactement la moitié du champ, donc la moitié des pixels.
    const radiusKm = 1000;
    const radii = 3;
    const distance = radiusKm * radii;
    const fovDeg = 60;
    const diameter = 2 * distance * Math.tan((fovDeg * Math.PI) / 180 / 4);
    expect(apparentSizePx(diameter, radiusKm, radii, 800, fovDeg)).toBeCloseTo(
      400,
      6
    );
  });
});

describe('featuresToLabel', () => {
  const moonRadius = 1737.4;

  it('écarte ce qui serait plus petit que son propre libellé', () => {
    const tiny = feature({ diameterKm: 1 });
    expect(featuresToLabel([tiny], moonRadius, 4, 900, 50)).toEqual([]);
    // Et le garde dès qu'on est assez près pour que ça vaille quelque chose.
    const close = featuresToLabel([tiny], moonRadius, 0.02, 900, 50);
    expect(close).toHaveLength(1);
  });

  it('garde une formation dont l’UAI ne publie PAS le diamètre', () => {
    // Les grandes taches d'albédo de Titan n'ont pas de diamètre publié. Les juger sur une
    // taille inconnue reviendrait à les taire, c'est-à-dire à perdre exactement les noms que
    // l'on voit le mieux.
    const albedo = feature({ diameterKm: 0, code: 'AL' });
    expect(featuresToLabel([albedo], moonRadius, 50, 900, 50)).toHaveLength(1);
  });

  it('ne dépasse JAMAIS le plafond, même au ras du sol', () => {
    const many = Array.from({ length: 500 }, (_, i) =>
      feature({ name: `F${i}`, diameterKm: 200 })
    );
    expect(
      featuresToLabel(many, moonRadius, 0.001, 900, 50).length
    ).toBeLessThanOrEqual(MAX_FEATURE_LABELS);
  });

  it('prend les plus GRANDES quand la place manque', () => {
    const sorted = Array.from({ length: MAX_FEATURE_LABELS + 10 }, (_, i) =>
      feature({ name: `F${i}`, diameterKm: 1000 - i })
    );
    const kept = featuresToLabel(sorted, moonRadius, 0.5, 900, 50);
    expect(kept).toHaveLength(MAX_FEATURE_LABELS);
    expect(kept[0]!.name).toBe('F0');
    expect(kept.at(-1)!.name).toBe(`F${MAX_FEATURE_LABELS - 1}`);
  });

  it('déclare un seuil qui a un sens en pixels', () => {
    expect(MIN_FEATURE_SIZE_PX).toBeGreaterThan(8);
    expect(MAX_FEATURE_LABELS).toBeGreaterThan(5);
  });
});
