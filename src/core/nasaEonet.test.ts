import { describe, expect, it } from 'vitest';
import {
  EONET_COVERAGE_START,
  EONET_WINDOW_DAYS,
  eonetRepresentativePoint,
  fetchNaturalEvents,
  naturalEventQueryKey,
  naturalEventQueryUrl,
  naturalEventWindow,
  parseEonetEvents,
} from './nasaEonet';

const DAY_MS = 86_400_000;
const NOW = new Date('2026-09-20T12:00:00Z');

describe('naturalEventQueryUrl', () => {
  it('passe TOUJOURS status=all', () => {
    // Piège du format : `status` omis ne rend que les événements OUVERTS. Une scène en 2011
    // recevrait alors les incendies encore en cours aujourd'hui, et rien de 2011.
    const url = new URL(
      naturalEventQueryUrl({
        from: Date.parse('2011-02-10T00:00:00Z'),
        to: Date.parse('2011-03-12T00:00:00Z'),
      })
    );
    expect(url.host).toBe('eonet.gsfc.nasa.gov');
    expect(url.pathname).toBe('/api/v3/events');
    expect(url.searchParams.get('status')).toBe('all');
    expect(url.searchParams.get('start')).toBe('2011-02-10');
    expect(url.searchParams.get('end')).toBe('2011-03-12');
  });
});

describe('fenêtre et clé', () => {
  it('couvre les jours qui précèdent la scène et s’arrête à l’instant réel', () => {
    const sim = new Date('2026-09-18T00:00:00Z');
    const window = naturalEventWindow(sim, NOW)!;
    expect(window.to).toBe(sim.getTime());
    expect(window.from).toBe(sim.getTime() - EONET_WINDOW_DAYS * DAY_MS);
    expect(naturalEventWindow(new Date('2030-01-01T00:00:00Z'), NOW)!.to).toBe(
      NOW.getTime()
    );
  });

  it('ne demande rien avant le début de la couverture', () => {
    const before = new Date(EONET_COVERAGE_START - DAY_MS);
    expect(naturalEventWindow(before, NOW)).toBeNull();
    expect(naturalEventQueryKey(before, NOW)).toBeNull();
  });
});

describe('eonetRepresentativePoint', () => {
  it('lit un Point dans l’ordre GeoJSON [longitude, latitude]', () => {
    expect(eonetRepresentativePoint('Point', [-122.4, 37.8])).toEqual({
      longitudeDeg: -122.4,
      latitudeDeg: 37.8,
    });
  });

  it('moyenne l’anneau d’un Polygon', () => {
    const point = eonetRepresentativePoint('Polygon', [
      [
        [10, 20],
        [12, 20],
        [12, 22],
        [10, 22],
      ],
    ]);
    expect(point).toEqual({ longitudeDeg: 11, latitudeDeg: 21 });
  });

  it('refuse une géométrie qu’elle ne sait pas lire', () => {
    expect(eonetRepresentativePoint('LineString', [[0, 0]])).toBeNull();
    expect(eonetRepresentativePoint('Polygon', [[]])).toBeNull();
    expect(eonetRepresentativePoint('Point', ['a', 'b'])).toBeNull();
  });
});

describe('parseEonetEvents', () => {
  const storm = {
    id: 'EONET_6789',
    title: 'Hurricane Test',
    closed: null,
    categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
    geometry: [
      { date: '2026-09-10T00:00:00Z', type: 'Point', coordinates: [-60, 15] },
      { date: '2026-09-12T00:00:00Z', type: 'Point', coordinates: [-65, 18] },
      { date: '2026-09-14T00:00:00Z', type: 'Point', coordinates: [-70, 22] },
    ],
  };

  it('retient le relevé qui décrit la SCÈNE, pas le dernier connu', () => {
    // Un ouragan se déplace : peindre sa dernière position pour une scène antérieure le
    // placerait à des centaines de kilomètres de là où il était.
    const [event] = parseEonetEvents(
      { events: [storm] },
      new Date('2026-09-12T12:00:00Z')
    );
    expect(event.longitudeDeg).toBe(-65);
    expect(event.latitudeDeg).toBe(18);
    expect(event.reportedMs).toBe(Date.parse('2026-09-12T00:00:00Z'));
    expect(event.startMs).toBe(Date.parse('2026-09-10T00:00:00Z'));
  });

  it('garde l’intervalle OUVERT quand EONET n’a pas clos l’événement', () => {
    const [event] = parseEonetEvents(
      { events: [storm] },
      new Date('2026-09-14T12:00:00Z')
    );
    expect(event.closedMs).toBeNull();
  });

  it('lit la date de clôture quand elle existe', () => {
    const [event] = parseEonetEvents(
      { events: [{ ...storm, closed: '2026-09-16T00:00:00Z' }] },
      new Date('2026-09-14T12:00:00Z')
    );
    expect(event.closedMs).toBe(Date.parse('2026-09-16T00:00:00Z'));
  });

  it('ignore un événement sans géométrie lisible', () => {
    expect(
      parseEonetEvents({ events: [{ ...storm, geometry: [] }] }, NOW)
    ).toEqual([]);
    expect(parseEonetEvents(null, NOW)).toEqual([]);
    expect(parseEonetEvents({}, NOW)).toEqual([]);
  });
});

describe('fetchNaturalEvents', () => {
  const window = { from: 0, to: DAY_MS };

  it('dégrade à un lot vide hors ligne', async () => {
    const offline = (): Promise<Response> =>
      Promise.reject(new TypeError('Failed to fetch'));
    await expect(
      fetchNaturalEvents(window, NOW, offline as unknown as typeof fetch)
    ).resolves.toEqual([]);
  });

  it('relaie une annulation', async () => {
    const aborting = (): Promise<Response> =>
      Promise.reject(new DOMException('aborted', 'AbortError'));
    await expect(
      fetchNaturalEvents(window, NOW, aborting as unknown as typeof fetch)
    ).rejects.toThrow(DOMException);
  });
});
