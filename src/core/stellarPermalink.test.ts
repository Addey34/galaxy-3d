import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  parseStellarAddress,
  resolveStar,
  serializeStellarAddress,
  snapYears,
  solarIdentity,
  starSlug,
} from './stellarPermalink';

const file = JSON.parse(
  readFileSync('public/assets/sky/neighbours.json', 'utf-8')
) as { stars: Array<[string, ...unknown[]]> };
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
