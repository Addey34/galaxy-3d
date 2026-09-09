import { describe, expect, it } from 'vitest';
import {
  bodyFromPathname,
  formatPermalinkDate,
  parsePermalink,
  serializePermalink,
} from './permalink';

const validBodies = new Set(['earth', 'mars']);

describe('permalink state', () => {
  it('parses valid mode, body and UTC date', () => {
    const state = parsePermalink(
      '?mode=explo&body=Mars&date=2026-11-20T18%3A00%3A00Z',
      validBodies
    );

    expect(state.mode).toBe('explo');
    expect(state.body).toBe('mars');
    expect(state.date?.toISOString()).toBe('2026-11-20T18:00:00.000Z');
  });

  it('ignores invalid values instead of selecting an unknown body', () => {
    const state = parsePermalink(
      '?mode=unknown&body=pluto&date=not-a-date',
      validBodies
    );

    expect(state).toEqual({
      mode: undefined,
      body: undefined,
      date: undefined,
    });
  });

  it('parses a complete view (azimuth/polar/distance) and rejects a partial one', () => {
    const complete = parsePermalink('?az=45.5&pol=60&dist=12.34', validBodies);
    expect(complete.view).toEqual({
      azimuthDeg: 45.5,
      polarDeg: 60,
      distance: 12.34,
    });

    const partial = parsePermalink('?az=45.5&pol=60', validBodies);
    expect(partial.view).toBeUndefined();

    const zeroDistance = parsePermalink('?az=0&pol=0&dist=0', validBodies);
    expect(zeroDistance.view).toBeUndefined();
  });

  it('round-trips a view through serialize → parse', () => {
    const search = serializePermalink({
      view: { azimuthDeg: -123.456, polarDeg: 88.9, distance: 0.0007 },
    });
    const state = parsePermalink(search, validBodies);
    expect(state.view?.azimuthDeg).toBeCloseTo(-123.5, 5);
    expect(state.view?.polarDeg).toBeCloseTo(88.9, 5);
    expect(state.view?.distance).toBeCloseTo(0.0007, 5);
  });

  it('drops the view when a new state omits it, even if the URL had one', () => {
    const search = serializePermalink(
      { mode: 'explo' },
      '?az=1&pol=2&dist=3&mode=educ'
    );
    expect(search).not.toContain('az=');
    expect(search).not.toContain('pol=');
    expect(search).not.toContain('dist=');
  });

  it('serializes a stable state and preserves unrelated parameters', () => {
    const date = new Date('2026-11-20T18:00:00.000Z');
    expect(formatPermalinkDate(date)).toBe('2026-11-20T18:00:00Z');
    expect(
      serializePermalink(
        { mode: 'explo', body: 'mars', date },
        '?utm_source=share&mode=educ'
      )
    ).toBe(
      '?utm_source=share&mode=explo&body=mars&date=2026-11-20T18%3A00%3A00Z'
    );
  });
});

/**
 * LE CHEMIN COMME SOURCE D'ÉTAT — les pages d'atterrissage par corps.
 *
 * `/jupiter` est un vrai fichier statique (`dist/jupiter/index.html`), pas une route : Firebase
 * le sert avant la réécriture SPA. Il ne peut donc pas porter `?body=` dans son URL, et un
 * script en ligne pour l'injecter est exclu — la CSP du projet est `script-src 'self'` sans
 * `unsafe-inline`. Le chemin doit donc être lu comme un état à part entière.
 */
describe('permalink — corps nommé par le chemin', () => {
  const bodies = new Set(['jupiter', 'titan', 'earth']);

  it('lit le corps depuis le chemin, quelle que soit sa forme', () => {
    for (const path of ['/jupiter', '/jupiter/', 'jupiter', '/JUPITER'])
      expect(bodyFromPathname(path, bodies)).toBe('jupiter');
  });

  it('ne nomme aucun corps pour tout le reste', () => {
    // La racine, une autre page statique, un segment inconnu, un chemin à deux segments :
    // aucun ne doit sélectionner un corps par accident.
    for (const path of ['/', '', '/privacy.html', '/jupitre', '/a/jupiter'])
      expect(bodyFromPathname(path, bodies)).toBeUndefined();
  });

  it('applique le corps du chemin quand la query n’en donne pas', () => {
    expect(parsePermalink('', bodies, '/titan').body).toBe('titan');
    expect(parsePermalink('?mode=explo', bodies, '/titan')).toEqual(
      expect.objectContaining({ mode: 'explo', body: 'titan' })
    );
  });

  it('laisse la QUERY primer sur le chemin', () => {
    // Depuis `/jupiter`, naviguer vers Titan écrit `?body=titan` : c'est Titan qu'un lien
    // partagé doit rouvrir, pas la page d'atterrissage d'où l'on vient.
    expect(parsePermalink('?body=titan', bodies, '/jupiter').body).toBe(
      'titan'
    );
    // `overview` est une valeur explicite de la query : elle doit pouvoir ANNULER le chemin,
    // sinon on ne pourrait plus partager la vue d'ensemble depuis une page de corps.
    expect(parsePermalink('?body=overview', bodies, '/jupiter').body).toBe(
      'overview'
    );
  });

  it('n’écrit pas `body=` quand le chemin le dit déjà', () => {
    // Sans cette omission, ouvrir `/jupiter` réécrivait aussitôt l'URL en
    // `/jupiter?body=jupiter` : deux URL pour un même contenu, et une adresse qui a l'air
    // cassée juste après le chargement.
    expect(serializePermalink({ body: 'jupiter' }, '', '/jupiter')).toBe('');
    // Mais un corps DIFFÉRENT du chemin doit bien être écrit.
    expect(serializePermalink({ body: 'titan' }, '', '/jupiter')).toBe(
      '?body=titan'
    );
    // Et sans chemin (la racine), rien ne change du comportement d'origine.
    expect(serializePermalink({ body: 'jupiter' }, '')).toBe('?body=jupiter');
  });
});
