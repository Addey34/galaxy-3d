import { describe, expect, it } from 'vitest';
import {
  discoveryStanding,
  nextSatelliteDiscovery,
  refutedStanding,
  satellitesKnownAt,
  type DiscoveryClaim,
  type RefutedClaim,
  type SatelliteDiscovery,
} from './discovery';

const at = (iso: string): Date => new Date(`${iso}T12:00:00Z`);
const meta = { url: 'https://example.test/', retrieved: '2026-10-01' };

/** Les formes RÉELLES des affirmations livrées, une par cas que la mesure a imposé. */
const titan: DiscoveryClaim[] = [
  {
    ...meta,
    source: 'jpl-sats',
    form: 'years',
    years: [1655],
    who: 'C. Huygens',
  },
];
const janus: DiscoveryClaim[] = [
  { ...meta, source: 'jpl-sats', form: 'years', years: [1966, 1980] },
];
const pluto: DiscoveryClaim[] = [
  { ...meta, source: 'sbdb', form: 'day', day: '1930-01-23' },
  { ...meta, source: 'nssdca', form: 'day', day: '1930-02-18' },
];
const halley: DiscoveryClaim[] = [
  {
    ...meta,
    source: 'sbdb',
    form: 'day',
    day: '1758-12-25',
    role: 'predictedReturn',
  },
  { ...meta, source: 'nasa-science', form: 'ancientObservations' },
];

describe('discoveryStanding', () => {
  it('une année seule vaut l’année ENTIÈRE, sans inventer de jour', () => {
    expect(discoveryStanding(titan, at('1654-12-31'))).toBe('notYetKnown');
    expect(discoveryStanding(titan, at('1655-01-01'))).toBe(
      'withinPublishedDates'
    );
    expect(discoveryStanding(titan, at('1655-12-31'))).toBe(
      'withinPublishedDates'
    );
    expect(discoveryStanding(titan, at('1656-01-01'))).toBe('known');
  });

  it('deux années d’une même ligne (Janus) bornent l’intervalle, aucune n’est choisie', () => {
    expect(discoveryStanding(janus, at('1965-06-01'))).toBe('notYetKnown');
    expect(discoveryStanding(janus, at('1972-06-01'))).toBe(
      'withinPublishedDates'
    );
    expect(discoveryStanding(janus, at('1981-01-01'))).toBe('known');
  });

  it('deux sources qui divergent (Pluton) : entre les deux, la réponse dépend de la source', () => {
    expect(discoveryStanding(pluto, at('1930-01-22'))).toBe('notYetKnown');
    expect(discoveryStanding(pluto, at('1930-02-01'))).toBe(
      'withinPublishedDates'
    );
    expect(discoveryStanding(pluto, at('1930-02-19'))).toBe('known');
  });

  it('une affirmation d’observations anciennes l’emporte sur une date de retour prédit (Halley)', () => {
    expect(discoveryStanding(halley, at('1066-04-24'))).toBe(
      'knownSinceAntiquity'
    );
  });

  it('« Prehistoric » est connu de toute date', () => {
    const jupiter: DiscoveryClaim[] = [
      { ...meta, source: 'nssdca', form: 'prehistoric' },
    ];
    expect(discoveryStanding(jupiter, at('0100-01-01'))).toBe(
      'knownSinceAntiquity'
    );
  });

  it('sans affirmation, rien à dire', () => {
    expect(discoveryStanding([], at('2000-01-01'))).toBeNull();
  });

  it('une date hors 0..9999 se classe par son signe', () => {
    const late = new Date(Date.UTC(10_000, 0, 1));
    expect(discoveryStanding(titan, late)).toBe('known');
  });
});

/** Un extrait RÉEL de la section de Jupiter, plus Thémisto et ses deux années. */
const jupiterMoons: SatelliteDiscovery[] = [
  { name: 'Io', years: [1610], who: 'Galileo', ref: 'IAU WGPSN', body: 'io' },
  { name: 'Europa', years: [1610], who: 'Galileo', ref: 'IAU WGPSN' },
  { name: 'Ganymede', years: [1610], who: 'Galileo', ref: 'IAU WGPSN' },
  { name: 'Callisto', years: [1610], who: 'Galileo', ref: 'IAU WGPSN' },
  { name: 'Amalthea', years: [1892], who: 'E.E. Barnard', ref: 'IAU WGPSN' },
  { name: 'Themisto', years: [1975, 2000], who: null, ref: null },
];

describe('satellitesKnownAt', () => {
  it('compte ce que la question du réservoir de vision demande : 1609, 1610, 1611', () => {
    expect(satellitesKnownAt(jupiterMoons, at('1609-06-01'))).toEqual({
      atLeast: 0,
      atMost: 0,
      total: 6,
    });
    // L'année même : on ne sait pas quel jour, donc une BORNE.
    expect(satellitesKnownAt(jupiterMoons, at('1610-06-01'))).toEqual({
      atLeast: 0,
      atMost: 4,
      total: 6,
    });
    expect(satellitesKnownAt(jupiterMoons, at('1611-06-01'))).toEqual({
      atLeast: 4,
      atMost: 4,
      total: 6,
    });
  });

  it('Thémisto, vue en 1975 puis retrouvée en 2000, n’est comptée sûre qu’après 2000', () => {
    const between = satellitesKnownAt(jupiterMoons, at('1990-01-01'));
    expect(between.atLeast).toBe(5);
    expect(between.atMost).toBe(6);
    expect(satellitesKnownAt(jupiterMoons, at('2001-01-01')).atLeast).toBe(6);
  });
});

describe('nextSatelliteDiscovery', () => {
  it('rend l’année suivante et TOUS les satellites qu’elle apporte', () => {
    const next = nextSatelliteDiscovery(jupiterMoons, at('1609-06-01'));
    expect(next?.year).toBe(1610);
    expect(next?.satellites.map((s) => s.name)).toEqual([
      'Io',
      'Europa',
      'Ganymede',
      'Callisto',
    ]);
  });

  it('classe une ligne à deux années par sa PREMIÈRE', () => {
    expect(nextSatelliteDiscovery(jupiterMoons, at('1900-01-01'))?.year).toBe(
      1975
    );
  });

  it('rend null quand tout est déjà vu', () => {
    expect(nextSatelliteDiscovery(jupiterMoons, at('2026-01-01'))).toBeNull();
  });
});

describe('une croyance réfutée à une date', () => {
  const venus: RefutedClaim = {
    subject: 'satellite',
    source: 'arxiv-0906.2781',
    url: 'https://arxiv.org/abs/0906.2781',
    retrieved: '2026-10-02',
    reported: { year: 1645, who: 'F. Fontana' },
    later: { who: 'G. Cassini' },
    notFound: { on: '2009-06-15', radiusKm: 0.3 },
    cite: 'Sheppard & Trujillo',
  };
  it('ne dit rien avant le premier signalement', () => {
    expect(refutedStanding(venus, at('1644-12-31'))).toBe('notYetReported');
  });
  it('ne prétend pas savoir le jour d’un signalement daté à l’année', () => {
    expect(refutedStanding(venus, at('1645-06-01'))).toBe('reportedThatYear');
  });
  it('dit le signalement, puis la recherche à partir du jour où elle est publique', () => {
    expect(refutedStanding(venus, at('1700-01-01'))).toBe('reported');
    expect(refutedStanding(venus, at('2009-06-14'))).toBe('reported');
    expect(refutedStanding(venus, at('2009-06-15'))).toBe('searched');
  });
});
