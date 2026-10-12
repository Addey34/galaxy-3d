import { describe, expect, it } from 'vitest';
import { parseDayDomain, publishedDay } from './timeDomain';

/**
 * Réponse RÉELLE de DescribeDomains pour VIIRS SNPP True Color, lue le 2026-10-12
 * (`…/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/250m/all/all.xml`, 488 octets).
 */
const VIIRS_2026_10_12 =
  "<Domains xmlns:ows='http://www.opengis.net/ows/1.1'><SpaceDomain><BoundingBox maxx='180' " +
  "minx='-180' crs='urn:ogc:def:crs:OGC:2:84' miny='-90' maxy='90'/></SpaceDomain>" +
  '<DimensionDomain><ows:Identifier>time</ows:Identifier><Domain>2015-11-24/2022-07-27/P1D,' +
  '2022-08-10/2024-05-31/P1D,2024-06-04/2024-07-11/P1D,2024-07-16/2024-07-24/P1D,' +
  '2024-07-29/2024-11-03/P1D,2024-11-06/2026-04-28/P1D,2026-04-30/2026-07-10/P1D,' +
  '2026-07-16/2026-10-12/P1D</Domain><Size>8</Size></DimensionDomain></Domains>';

const at = (iso: string) => new Date(iso);

describe('jours publiés par une couche datée', () => {
  const ranges = parseDayDomain(VIIRS_2026_10_12);

  it('lit les huit intervalles de la réponse réelle', () => {
    expect(ranges).toHaveLength(8);
  });

  it('rend le jour UTC de la scène quand il est publié, à toute heure', () => {
    expect(publishedDay(ranges, at('2026-10-11T00:00:00Z'))).toBe('2026-10-11');
    expect(publishedDay(ranges, at('2026-10-11T23:59:59Z'))).toBe('2026-10-11');
    // Bornes incluses, aux deux bouts.
    expect(publishedDay(ranges, at('2015-11-24T12:00:00Z'))).toBe('2015-11-24');
    expect(publishedDay(ranges, at('2026-10-12T08:00:00Z'))).toBe('2026-10-12');
  });

  it('refuse un jour tombé dans un TROU, sans l’arrondir au voisin', () => {
    // Le 2022-08-01 a été mesuré : 404 sans en-tête CORS.
    expect(publishedDay(ranges, at('2022-08-01T12:00:00Z'))).toBeNull();
    expect(publishedDay(ranges, at('2022-07-28T00:00:00Z'))).toBeNull();
    expect(publishedDay(ranges, at('2026-04-29T00:00:00Z'))).toBeNull();
    // Les voisins immédiats du trou, eux, sont publiés.
    expect(publishedDay(ranges, at('2022-07-27T23:00:00Z'))).toBe('2022-07-27');
    expect(publishedDay(ranges, at('2022-08-10T01:00:00Z'))).toBe('2022-08-10');
  });

  it('refuse avant le premier jour et après le dernier', () => {
    expect(publishedDay(ranges, at('2015-11-23T23:59:59Z'))).toBeNull();
    expect(publishedDay(ranges, at('2026-10-13T00:00:00Z'))).toBeNull();
    expect(publishedDay(ranges, at('1610-01-07T00:00:00Z'))).toBeNull();
    expect(publishedDay(ranges, new Date(Number.NaN))).toBeNull();
  });

  it('accepte un jour isolé, sans période', () => {
    const single = parseDayDomain('<Domain>2020-01-05</Domain>');
    expect(publishedDay(single, at('2020-01-05T10:00:00Z'))).toBe('2020-01-05');
    expect(publishedDay(single, at('2020-01-06T10:00:00Z'))).toBeNull();
  });

  it('échoue sur une réponse qu’il ne comprend pas, plutôt que de la lire vide', () => {
    // Une liste vide éteindrait la couche en silence : le défaut serait le nôtre.
    expect(() => parseDayDomain('<Domains></Domains>')).toThrow(/<Domain>/);
    expect(() => parseDayDomain('<Domain></Domain>')).toThrow(/aucun/);
    expect(() =>
      parseDayDomain('<Domain>2020-01-01/2020-12-01/P1M</Domain>')
    ).toThrow(/non quotidien/);
    expect(() =>
      parseDayDomain('<Domain>2020-02-31/2020-03-05/P1D</Domain>')
    ).toThrow(/illisible/);
    expect(() =>
      parseDayDomain('<Domain>2020-03-05/2020-03-01/P1D</Domain>')
    ).toThrow(/illisible/);
  });
});
