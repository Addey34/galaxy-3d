import { describe, expect, it } from 'vitest';
import {
  bodyFromPathname,
  formatPermalinkDate,
  parsePermalink,
  pathnameForBody,
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

describe('permalink — le chemin suit la sélection', () => {
  const bodies = new Set(['jupiter', 'titan', 'earth']);

  it('donne à chaque corps le chemin indexable qui lui appartient déjà', () => {
    expect(pathnameForBody('jupiter', bodies)).toBe('/jupiter/');
    expect(pathnameForBody('TITAN', bodies)).toBe('/titan/');
    expect(pathnameForBody(' earth ', bodies)).toBe('/earth/');
  });

  it('garde le SLASH FINAL, qui n’est pas décoratif', () => {
    // Les pages sont servies en `/jupiter/` — c'est la forme du sitemap — et `/jupiter`
    // répond 301 vers elle, mesuré en production. Écrire la forme sans slash ferait payer une
    // redirection à chaque rechargement et à chaque partage de l'adresse.
    expect(pathnameForBody('jupiter', bodies).endsWith('/')).toBe(true);
  });

  it('ramène la vue d’ensemble à la racine, et pas à une seconde adresse', () => {
    // `/` EST la vue globale : l'URL canonique d'index.html, et la seule que le sitemap
    // annonce. Un `/all` répondrait (la réécriture SPA sert index.html pour tout chemin d'un
    // segment) mais créerait une seconde adresse pour un contenu identique.
    for (const nothing of [null, undefined, ''])
      expect(pathnameForBody(nothing, bodies)).toBe('/');
  });

  it('ne fabrique jamais un chemin pour un corps inconnu', () => {
    // Sinon une faute de frappe produirait une URL qui a l'air valide, se partage, et ne
    // rouvre rien : la réécriture SPA rend 200 pour n'importe quel segment.
    for (const unknown of ['jupitre', 'overview', 'privacy.html', '../etc'])
      expect(pathnameForBody(unknown, bodies)).toBe('/');
  });

  it('rend `?body=` redondant, donc absent de la query', () => {
    // LA propriété qui rend l'ensemble cohérent : le chemin nomme le corps, la query ne le
    // répète pas. Sans cela, naviguer vers Titan produirait `/titan/?body=titan` — deux
    // affirmations du même fait dans une seule adresse.
    const path = pathnameForBody('titan', bodies);
    expect(serializePermalink({ body: 'titan' }, '', path)).toBe('');
    // Et le reste de l'état continue de s'écrire normalement.
    expect(serializePermalink({ body: 'titan', mode: 'explo' }, '', path)).toBe(
      '?mode=explo'
    );
  });

  it('boucle : ce qui est écrit se relit à l’identique', () => {
    // Le contrat complet, aller-retour. Une asymétrie ici signifierait qu'une URL partagée ne
    // rouvre pas ce qu'elle décrit.
    for (const body of [...bodies, null]) {
      const path = pathnameForBody(body, bodies);
      const search = serializePermalink({ body: body ?? undefined }, '', path);
      expect(parsePermalink(search, bodies, path).body).toBe(body ?? undefined);
    }
  });
});

describe('permalink — la racine dit déjà « vue d’ensemble »', () => {
  const bodies = new Set(['jupiter', 'titan']);

  it('n’écrit pas `body=overview` sur la racine', () => {
    // Revenir au global depuis `/jupiter/` écrivait `/?body=overview` : une adresse qui
    // affirme deux fois la même chose, et qui n'est pas celle que le sitemap annonce.
    expect(serializePermalink({ body: 'overview' }, '', '/')).toBe('');
    expect(
      serializePermalink({ body: 'overview', mode: 'educ' }, '', '/')
    ).toBe('?mode=educ');
  });

  it('le garde là où il dit encore quelque chose', () => {
    // Depuis un chemin qui nomme un corps, `body=overview` n'est PAS redondant : il dit que
    // l'on a quitté ce corps sans quitter la page. Un lien partagé doit rouvrir la vue globale.
    expect(serializePermalink({ body: 'overview' }, '', '/jupiter/')).toBe(
      '?body=overview'
    );
    expect(parsePermalink('?body=overview', bodies, '/jupiter/').body).toBe(
      'overview'
    );
  });

  it('la racine nue se relit comme aucune sélection', () => {
    // Et c'est exactement l'état de démarrage : pas de corps suivi, donc la vue d'ensemble.
    expect(parsePermalink('', bodies, '/').body).toBeUndefined();
  });
});
