import { readFileSync } from 'node:fs';
import { shippedNeighbours } from './neighboursTestFixture';
import { describe, expect, it } from 'vitest';
import {
  parseStellarAddress,
  parseSystemAddress,
  resolveStar,
  serializeStellarAddress,
  serializeSystemAddress,
  snapYears,
  solarIdentity,
  starSlug,
} from './stellarPermalink';

const file = shippedNeighbours();
const names = file.stars.map((row) => row[0]);

describe('starSlug', () => {
  it('retire les accents, les apostrophes et la ponctuation', () => {
    expect(starSlug("Barnard's Star")).toBe('barnards-star');
    expect(starSlug('Barnard’s Star')).toBe('barnards-star');
    expect(starSlug('Gl 54.1')).toBe('gl-54-1');
    expect(starSlug('  Proxima Centauri ')).toBe('proxima-centauri');
    expect(starSlug('Épsilon Eridani')).toBe('epsilon-eridani');
  });

  it('donne un identifiant distinct et bien formé à chacune des étoiles livrées', () => {
    const slugs = names.map(starSlug);
    expect(slugs).toHaveLength(names.length);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});

describe('parseStellarAddress', () => {
  it('ne demande rien sans `view=neighbourhood`, même avec `star` et `t` (un lien ancien ne rouvre pas la vue)', () => {
    expect(parseStellarAddress('')).toBeNull();
    expect(parseStellarAddress('?star=proxima-centauri&t=500')).toBeNull();
    expect(parseStellarAddress('?view=other&star=proxima-centauri')).toBeNull();
  });

  it('lit la vue seule, l’étoile et le décalage', () => {
    expect(parseStellarAddress('?view=neighbourhood')).toEqual({});
    expect(
      parseStellarAddress('?view=neighbourhood&star=Proxima-Centauri&t=-300')
    ).toEqual({ star: 'proxima-centauri', years: -300 });
  });

  it("distingue un identifiant ABSENT (undefined) d'un identifiant MAL FORMÉ (null)", () => {
    expect(parseStellarAddress('?view=neighbourhood')?.star).toBeUndefined();
    expect(
      parseStellarAddress('?view=neighbourhood&star=../../x')?.star
    ).toBeNull();
    expect(parseStellarAddress('?view=neighbourhood&star=')?.star).toBeNull();
    expect(
      parseStellarAddress(`?view=neighbourhood&star=${'a'.repeat(65)}`)?.star
    ).toBeNull();
  });

  it('ignore un décalage illisible ou hors de la fenêtre de ±10 000 ans', () => {
    for (const bad of ['abc', 'NaN', 'Infinity', '10001', '-10001', '']) {
      expect(
        parseStellarAddress(`?view=neighbourhood&t=${bad}`)?.years
      ).toBeUndefined();
    }
    expect(parseStellarAddress('?view=neighbourhood&t=10000')?.years).toBe(
      10000
    );
  });
});

describe('serializeStellarAddress', () => {
  it('écrit les trois clés et conserve les autres dans leur ordre', () => {
    expect(
      serializeStellarAddress('?mode=educ&date=2026-11-23T10:00:00Z', {
        star: 'barnards-star',
        years: 1200,
      })
    ).toBe(
      '?mode=educ&date=2026-11-23T10%3A00%3A00Z&view=neighbourhood&star=barnards-star&t=1200'
    );
  });

  it("n'écrit pas un décalage nul ni une étoile absente", () => {
    expect(serializeStellarAddress('', { years: 0 })).toBe(
      '?view=neighbourhood'
    );
    expect(serializeStellarAddress('', { star: null })).toBe(
      '?view=neighbourhood'
    );
  });

  it('arrondit le décalage à l’année', () => {
    expect(serializeStellarAddress('', { years: 99.6 })).toBe(
      '?view=neighbourhood&t=100'
    );
  });

  it('`null` retire la vue et ses deux clés, et seulement elles', () => {
    expect(
      serializeStellarAddress(
        '?mode=educ&view=neighbourhood&star=wolf-359&t=-100&date=2026-01-01',
        null
      )
    ).toBe('?mode=educ&date=2026-01-01');
    expect(serializeStellarAddress('?view=neighbourhood', null)).toBe('');
  });

  it('boucle sans perte : ce qui est écrit est relu à l’identique', () => {
    for (const years of [-9900, -100, 0, 100, 9900]) {
      const star = starSlug("Barnard's Star");
      const query = serializeStellarAddress('?date=2026-11-23', {
        star,
        years,
      });
      const read = parseStellarAddress(query);
      expect(read?.star).toBe(star);
      expect(read?.years ?? 0).toBe(years);
    }
  });
});

describe('la visite guidée dans l’adresse (GAL-UNIVERSE-005)', () => {
  it('lit la visite et son étape, et ne les lit pas sans la vue', () => {
    expect(
      parseStellarAddress('?view=neighbourhood&visit=neighbours&step=3')
    ).toEqual({ visit: 'neighbours', step: 3 });
    expect(parseStellarAddress('?visit=neighbours&step=3')).toBeNull();
    // Sans visite, une étape seule ne signifie rien : elle n'est pas lue.
    expect(parseStellarAddress('?view=neighbourhood&step=3')).toEqual({});
  });

  it('distingue une visite ABSENTE (undefined) d’une visite MAL FORMÉE (null), et ignore une étape illisible', () => {
    expect(parseStellarAddress('?view=neighbourhood')?.visit).toBeUndefined();
    for (const bad of ['../x', 'A B', '', 'x'.repeat(65)])
      expect(
        parseStellarAddress(
          `?view=neighbourhood&visit=${encodeURIComponent(bad)}`
        )?.visit,
        bad
      ).toBeNull();
    for (const bad of ['-1', '1.5', 'abc', '100', '1e1', ''])
      expect(
        parseStellarAddress(`?view=neighbourhood&visit=v&step=${bad}`)?.step,
        bad
      ).toBeUndefined();
  });

  it('écrit la visite avec son étape (0 par défaut), jamais une étape seule, et `null` les retire', () => {
    expect(
      serializeStellarAddress('?date=2026-01-01', {
        visit: 'neighbours',
        step: 2,
      })
    ).toBe('?date=2026-01-01&view=neighbourhood&visit=neighbours&step=2');
    expect(serializeStellarAddress('', { visit: 'neighbours' })).toBe(
      '?view=neighbourhood&visit=neighbours&step=0'
    );
    expect(serializeStellarAddress('', { step: 4 })).toBe(
      '?view=neighbourhood'
    );
    expect(
      serializeStellarAddress(
        '?mode=educ&view=neighbourhood&visit=neighbours&step=2&date=2026-01-01',
        null
      )
    ).toBe('?mode=educ&date=2026-01-01');
  });

  it('boucle sans perte', () => {
    for (const step of [0, 1, 6, 99]) {
      const read = parseStellarAddress(
        serializeStellarAddress('', {
          visit: 'neighbours',
          step,
          star: 'sirius',
          years: 500,
        })
      );
      expect(read).toEqual({
        visit: 'neighbours',
        step,
        star: 'sirius',
        years: 500,
      });
    }
  });

  it('l’identité solaire ne retient ni la visite ni l’étape', () => {
    expect(
      solarIdentity('/neptune/', '?view=neighbourhood&visit=v&step=2&mode=educ')
    ).toBe(solarIdentity('/neptune/', '?mode=educ'));
  });
});

describe('l’exploration d’un système dans l’adresse (GAL-UNIVERSE-006)', () => {
  it('lit `explore=1` et la planète, jamais sans la vue, et la planète jamais sans `explore`', () => {
    expect(
      parseStellarAddress(
        '?view=neighbourhood&star=proxima-centauri&explore=1&planet=proxima-cen-b'
      )
    ).toEqual({
      star: 'proxima-centauri',
      explore: true,
      planet: 'proxima-cen-b',
    });
    expect(parseStellarAddress('?star=x&explore=1')).toBeNull();
    expect(parseStellarAddress('?view=neighbourhood&star=x&planet=y')).toEqual({
      star: 'x',
    });
    expect(
      parseStellarAddress('?view=neighbourhood&star=x&explore=yes')
    ).toEqual({ star: 'x' });
  });

  it('distingue une planète MAL FORMÉE (null) d’une planète absente', () => {
    expect(
      parseStellarAddress('?view=neighbourhood&star=x&explore=1&planet=%3Cb%3E')
        ?.planet
    ).toBeNull();
    expect(
      parseStellarAddress('?view=neighbourhood&star=x&explore=1')?.planet
    ).toBeUndefined();
  });

  it('n’écrit l’exploration qu’avec une étoile, et `null` retire tout', () => {
    expect(
      serializeStellarAddress('?mode=educ', {
        star: 'barnards-star',
        explore: true,
        planet: 'barnard-b',
      })
    ).toBe(
      '?mode=educ&view=neighbourhood&star=barnards-star&explore=1&planet=barnard-b'
    );
    expect(
      serializeStellarAddress('', { explore: true, planet: 'barnard-b' })
    ).toBe('?view=neighbourhood');
    expect(
      serializeStellarAddress(
        '?view=neighbourhood&star=a&explore=1&planet=b&mode=educ',
        null
      )
    ).toBe('?mode=educ');
  });

  it('boucle sans perte, et l’identité solaire ne retient pas l’exploration', () => {
    const address = { star: 'gl-71', explore: true, planet: 'tau-cet-g' };
    expect(parseStellarAddress(serializeStellarAddress('', address))).toEqual(
      address
    );
    expect(
      solarIdentity(
        '/neptune/',
        '?view=neighbourhood&star=a&explore=1&planet=b'
      )
    ).toBe(solarIdentity('/neptune/', ''));
  });
});

describe('resolveStar', () => {
  const systems = [
    ['Rigil Kentaurus', 'Toliman', 'Proxima Centauri'],
    ["Barnard's Star"],
  ];

  it("trouve le système par n'importe laquelle de ses étoiles", () => {
    expect(resolveStar('proxima-centauri', systems)).toBe(0);
    expect(resolveStar('toliman', systems)).toBe(0);
    expect(resolveStar('barnards-star', systems)).toBe(1);
  });

  it('rend -1 pour une étoile inconnue', () => {
    expect(resolveStar('vega', systems)).toBe(-1);
  });
});

describe('snapYears', () => {
  const window = { min: -9900, max: 9900 };

  it('tombe sur le pas du curseur, dans la fenêtre', () => {
    expect(snapYears(137, window, 100)).toBe(100);
    expect(snapYears(-151, window, 100)).toBe(-200);
    expect(snapYears(0, window, 100)).toBe(0);
  });

  it('borne à la fenêtre de la vue (une scène de 2026 s’arrête à +9 900 ans)', () => {
    expect(snapYears(10000, window, 100)).toBe(9900);
    expect(snapYears(-10000, window, 100)).toBe(-9900);
  });
});

describe('solarIdentity', () => {
  it('ne retient ni la vue, ni la date, ni le cadrage : ils changent sans que le Système solaire change', () => {
    const solar = solarIdentity(
      '/neptune/',
      '?mode=explo&date=2026-09-15T11:00:00Z'
    );
    expect(
      solarIdentity(
        '/neptune/',
        '?mode=explo&date=2026-09-15T11:00:09Z&az=-135&pol=61&dist=0.035&view=neighbourhood&star=wolf-359&t=-300'
      )
    ).toBe(solar);
    expect(solar).toBe('/neptune/?mode=explo');
  });

  it('distingue un autre corps, un autre mode ou une autre couche (un vrai mouvement du Système solaire)', () => {
    const base = solarIdentity('/neptune/', '?mode=explo&date=2026-09-15');
    expect(solarIdentity('/titan/', '?mode=explo&date=2026-09-15')).not.toBe(
      base
    );
    expect(solarIdentity('/neptune/', '?mode=educ&date=2026-09-15')).not.toBe(
      base
    );
    expect(solarIdentity('/neptune/', '?mode=explo&layers=clouds.on')).not.toBe(
      base
    );
  });

  it("rend le chemin seul quand il n'y a rien d'autre", () => {
    expect(solarIdentity('/', '?view=neighbourhood')).toBe('/');
  });
});

describe('l’adresse d’un système choisi dans le ciel (GAL-UNIVERSE-007)', () => {
  const sky = JSON.parse(
    readFileSync('public/assets/sky/exoplanets.json', 'utf-8')
  ) as { systems: Array<[string, ...unknown[]]> };

  it('chaque hôte du ciel a un identifiant distinct et bien formé', () => {
    const slugs = sky.systems.map((s) => starSlug(s[0]));
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('lit l’hôte et la planète, jamais sans `view=system`, et distingue un hôte mal formé', () => {
    expect(
      parseSystemAddress('?view=system&host=trappist-1&planet=trappist-1-e')
    ).toEqual({ host: 'trappist-1', planet: 'trappist-1-e' });
    expect(parseSystemAddress('?host=trappist-1')).toBeNull();
    expect(parseSystemAddress('?view=neighbourhood&host=x')).toBeNull();
    expect(parseSystemAddress('?view=system&host=%3Cb%3E')).toEqual({
      host: null,
    });
    expect(parseSystemAddress('?view=system')).toEqual({ host: null });
  });

  it('boucle sans perte, garde les autres clés, `null` retire la vue, l’identité solaire ne la retient pas', () => {
    const query = serializeSystemAddress('?mode=educ&date=2026-01-01', {
      host: 'hr-8799',
      planet: 'hr-8799-b',
    });
    expect(query).toBe(
      '?mode=educ&date=2026-01-01&view=system&host=hr-8799&planet=hr-8799-b'
    );
    expect(parseSystemAddress(query)).toEqual({
      host: 'hr-8799',
      planet: 'hr-8799-b',
    });
    expect(serializeSystemAddress(query, null)).toBe(
      '?mode=educ&date=2026-01-01'
    );
    expect(solarIdentity('/neptune/', query)).toBe(
      solarIdentity('/neptune/', '?mode=educ')
    );
  });
});

describe('le volume étendu dans l’adresse (GAL-UNIVERSE-008)', () => {
  it('lit `vol` (25, 50 ou 100) et ignore toute autre valeur', () => {
    expect(parseStellarAddress('?view=neighbourhood&vol=50')?.vol).toBe(50);
    expect(
      parseStellarAddress('?view=neighbourhood&vol=5')?.vol
    ).toBeUndefined();
    expect(
      parseStellarAddress('?view=neighbourhood&vol=75')?.vol
    ).toBeUndefined();
    expect(
      parseStellarAddress('?view=neighbourhood&vol=abc')?.vol
    ).toBeUndefined();
  });

  it('lit `vstar` quand il a la forme d’un jeton, et le dit (null) sinon', () => {
    expect(
      parseStellarAddress('?view=neighbourhood&vstar=129.vega')?.vstar
    ).toBe('129.vega');
    expect(
      parseStellarAddress('?view=neighbourhood&vstar=8.5164707970261890560')
        ?.vstar
    ).toBe('8.5164707970261890560');
    expect(
      parseStellarAddress('?view=neighbourhood&vstar=vega')?.vstar
    ).toBeNull();
    expect(
      parseStellarAddress('?view=neighbourhood&vstar=1.<script>')?.vstar
    ).toBeNull();
  });

  it('sans la vue, `vol` et `vstar` ne signifient rien', () => {
    expect(parseStellarAddress('?vol=100&vstar=129.vega')).toBeNull();
  });

  it('écrit `vol` et `vstar`, jamais 5 pc, et les efface avec la vue', () => {
    const written = serializeStellarAddress('?body=earth', {
      vol: 100,
      vstar: '129.vega',
    });
    const params = new URLSearchParams(written);
    expect(params.get('vol')).toBe('100');
    expect(params.get('vstar')).toBe('129.vega');
    expect(
      new URLSearchParams(
        serializeStellarAddress('?body=earth', { vol: 5 })
      ).get('vol')
    ).toBeNull();
    const closed = new URLSearchParams(serializeStellarAddress(written, null));
    expect(closed.get('vol')).toBeNull();
    expect(closed.get('vstar')).toBeNull();
    expect(closed.get('body')).toBe('earth');
  });
});
