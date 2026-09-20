import { describe, expect, it } from 'vitest';
import {
  EARTHQUAKE_MIN_MAGNITUDE,
  EARTHQUAKE_WINDOW_DAYS,
  earthquakeQueryKey,
  earthquakeQueryUrl,
  earthquakeWindow,
  fetchEarthquakes,
  parseUsgsEarthquakes,
  USGS_CATALOG_START,
} from './usgsEarthquakes';

const DAY_MS = 86_400_000;
const NOW = new Date('2026-09-20T12:00:00Z');

/** Réponse GeoJSON réduite à ce que la couche lit, à la forme exacte du service. */
const feature = (
  id: string,
  mag: number,
  lon: number,
  lat: number,
  depth: number,
  time: number,
  place = ''
): unknown => ({
  type: 'Feature',
  id,
  properties: { mag, place, time, url: `https://earthquake.usgs.gov/${id}` },
  geometry: { type: 'Point', coordinates: [lon, lat, depth] },
});

describe('parseUsgsEarthquakes', () => {
  it('lit l’ordre GeoJSON [longitude, latitude, profondeur]', () => {
    // Tōhoku 2011, coordonnées publiées par l'USGS. Une inversion lon/lat placerait
    // l'épicentre à 142° N, une latitude qui n'existe pas — mais une inversion sur un site
    // proche de l'équateur passerait inaperçue, d'où l'assertion sur les deux champs.
    const [quake] = parseUsgsEarthquakes({
      features: [
        feature(
          'official20110311054624120_30',
          9.1,
          142.373,
          38.297,
          29,
          Date.parse('2011-03-11T05:46:24Z'),
          '2011 Great Tohoku Earthquake, Japan'
        ),
      ],
    });
    expect(quake.latitudeDeg).toBe(38.297);
    expect(quake.longitudeDeg).toBe(142.373);
    expect(quake.depthKm).toBe(29);
    expect(quake.magnitude).toBe(9.1);
    expect(quake.id).toBe('official20110311054624120_30');
    expect(quake.timeMs).toBe(Date.parse('2011-03-11T05:46:24Z'));
  });

  it('ignore une ligne incomplète sans perdre les autres', () => {
    const quakes = parseUsgsEarthquakes({
      features: [
        { id: 'a', properties: { mag: null, time: 1 }, geometry: null },
        {
          id: 'b',
          properties: { mag: 5, time: null },
          geometry: { coordinates: [1, 2, 3] },
        },
        feature('c', 5.2, 10, 20, 5, 1_700_000_000_000),
      ],
    });
    expect(quakes.map((q) => q.id)).toEqual(['c']);
  });

  it('refuse une coordonnée hors bornes plutôt que de la peindre quelque part', () => {
    const quakes = parseUsgsEarthquakes({
      features: [feature('x', 5, 200, 95, 1, 1_700_000_000_000)],
    });
    expect(quakes).toEqual([]);
  });

  it('rend un tableau vide sur une réponse absente ou malformée', () => {
    expect(parseUsgsEarthquakes(null)).toEqual([]);
    expect(parseUsgsEarthquakes({})).toEqual([]);
    expect(parseUsgsEarthquakes({ features: 'nope' })).toEqual([]);
  });
});

describe('fenêtre et clé', () => {
  it('couvre les jours qui PRÉCÈDENT la scène', () => {
    const sim = new Date('2026-09-18T00:00:00Z');
    const window = earthquakeWindow(sim, NOW);
    expect(window).not.toBeNull();
    expect(window!.to).toBe(sim.getTime());
    expect(window!.from).toBe(sim.getTime() - EARTHQUAKE_WINDOW_DAYS * DAY_MS);
  });

  it('borne la fenêtre à l’instant RÉEL : aucun séisme au futur', () => {
    const window = earthquakeWindow(new Date('2030-01-01T00:00:00Z'), NOW);
    expect(window!.to).toBe(NOW.getTime());
  });

  it('ne demande rien avant le début du catalogue', () => {
    const before = new Date(USGS_CATALOG_START - DAY_MS);
    expect(earthquakeWindow(before, NOW)).toBeNull();
    expect(earthquakeQueryKey(before, NOW)).toBeNull();
  });

  it('donne une clé par JOUR de scène, pas par frame', () => {
    const morning = new Date('2026-09-18T01:00:00Z');
    const evening = new Date('2026-09-18T23:00:00Z');
    expect(earthquakeQueryKey(morning, NOW)).toBe('2026-09-18');
    expect(earthquakeQueryKey(morning, NOW)).toBe(
      earthquakeQueryKey(evening, NOW)
    );
    expect(earthquakeQueryKey(new Date('2026-09-19T01:00:00Z'), NOW)).toBe(
      '2026-09-19'
    );
  });
});

describe('earthquakeQueryUrl', () => {
  it('demande du GeoJSON borné, sur l’hôte déclaré dans la CSP', () => {
    const url = new URL(
      earthquakeQueryUrl({
        from: Date.parse('2026-09-11T00:00:00Z'),
        to: Date.parse('2026-09-18T00:00:00Z'),
      })
    );
    expect(url.host).toBe('earthquake.usgs.gov');
    expect(url.pathname).toBe('/fdsnws/event/1/query');
    expect(url.searchParams.get('format')).toBe('geojson');
    expect(url.searchParams.get('starttime')).toBe('2026-09-11T00:00:00');
    expect(url.searchParams.get('endtime')).toBe('2026-09-18T00:00:00');
    expect(Number(url.searchParams.get('minmagnitude'))).toBe(
      EARTHQUAKE_MIN_MAGNITUDE
    );
    // Sans limite, le service peut rendre 20 000 lignes puis refuser au-delà par un 400.
    expect(Number(url.searchParams.get('limit'))).toBeGreaterThan(0);
  });
});

describe('fetchEarthquakes', () => {
  const window = { from: 0, to: DAY_MS };

  it('dégrade à un lot vide hors ligne', async () => {
    const offline = (): Promise<Response> =>
      Promise.reject(new TypeError('Failed to fetch'));
    await expect(
      fetchEarthquakes(window, offline as unknown as typeof fetch)
    ).resolves.toEqual([]);
  });

  it('dégrade à un lot vide sur une réponse non OK', async () => {
    const failing = (): Promise<Response> =>
      Promise.resolve({ ok: false } as Response);
    await expect(
      fetchEarthquakes(window, failing as unknown as typeof fetch)
    ).resolves.toEqual([]);
  });

  it('relaie une ANNULATION au lieu de la confondre avec un échec', async () => {
    // Le socle daté distingue « abandonné » de « échoué » : confondre les deux mettrait en
    // backoff une requête que lui-même vient d'annuler en voyageant dans le temps.
    const aborting = (): Promise<Response> =>
      Promise.reject(new DOMException('aborted', 'AbortError'));
    await expect(
      fetchEarthquakes(window, aborting as unknown as typeof fetch)
    ).rejects.toThrow(DOMException);
  });
});
