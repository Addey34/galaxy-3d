import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import index from './placeObservationIndex.json';
import {
  classifyPlace,
  resolvePlaceObservations,
  type PlaceObservationResult,
} from './placeObservations';
import { cardEn } from '@/i18n/dict-card-en';
import { cardEs } from '@/i18n/dict-card-es';
import { cardFr } from '@/i18n/dict-card-fr';
import { cardPtBR } from '@/i18n/dict-card-pt-BR';
import { matchFormation, statusKey } from '@/ui/placesBlock';
import type { NamedFeature } from '@/core/gazetteer';

/**
 * LE CONTRAT DE COUVERTURE (GAL-SCIENCE-022A). Une clé absente d'un morceau n'est PAS un zéro :
 * `shard.observed[id] ?? []` le faisait, et une formation jamais évaluée affichait « aucune
 * empreinte ne la touche ». Un zéro exige une preuve positive (`zeroIds`). Aucune fixture ici ne
 * touche aux données publiées ; les scénarios sur la donnée réelle ne font que la LIRE.
 */
const ROOT = resolve(import.meta.dirname, '../..');

const LINE = [0, 2, '2020-01-01', '2020-02-01', 'https://example.org/a'];
const INSTRUMENT = {
  host: 'H',
  id: 'I',
  mission: 'Mission',
  instrument: 'Instrument',
};
/** Deux morceaux : k = id % 2. Observés : 4 (k 0) et 7 (k 1). Zéro prouvé : 9 (k 1). */
const cover = (extra: Record<string, unknown> = {}) =>
  ({
    formations: 3,
    observed: 2,
    instruments: 1,
    products: 1,
    globalExcluded: 0,
    shards: 2,
    bytes: 1,
    zeroIds: [9],
    ...extra,
  }) as Parameters<typeof classifyPlace>[0];
const shard1 = () => ({ instruments: [INSTRUMENT], observed: { '7': [LINE] } });
const shard0 = () => ({ instruments: [INSTRUMENT], observed: { '4': [LINE] } });

const status = (r: PlaceObservationResult) =>
  r.status === 'unavailable' ? `unavailable/${r.reason}` : r.status;

describe('classifyPlace : les quatre états', () => {
  it('observed : des observations attestées, non vides', () => {
    const r = classifyPlace(cover(), shard1(), 7);
    expect(r.status).toBe('observed');
    if (r.status === 'observed') {
      expect(r.observations).toHaveLength(1);
      expect(r.observations[0]!.instrument.mission).toBe('Mission');
      expect(r.observations[0]!.count).toBe(2);
    }
  });

  it('zero-proven : seulement avec une PREUVE (zeroIds)', () => {
    expect(status(classifyPlace(cover(), shard1(), 9))).toBe('zero-proven');
  });

  it('not-evaluated : une clé absente n’est JAMAIS un zéro prouvé', () => {
    // 11 est absent du morceau ET de zeroIds : aucune preuve de croisement.
    expect(status(classifyPlace(cover(), shard1(), 11))).toBe('not-evaluated');
    // Le même identifiant, absent d'un morceau vide : toujours pas un zéro.
    expect(
      status(classifyPlace(cover(), { instruments: [], observed: {} }, 11))
    ).toBe('not-evaluated');
  });

  it('zeroIds absent vaut l’ensemble vide, jamais « tout est zéro »', () => {
    const noZero = cover();
    delete (noZero as { zeroIds?: unknown }).zeroIds;
    expect(status(classifyPlace(noZero, shard1(), 9))).toBe('not-evaluated');
    expect(status(classifyPlace(noZero, shard1(), 7))).toBe('observed');
  });

  it('un identifiant d’un autre morceau n’est pas pris pour un zéro', () => {
    expect(status(classifyPlace(cover(), shard0(), 4))).toBe('observed');
    expect(status(classifyPlace(cover(), shard0(), 10))).toBe('not-evaluated');
  });
});

describe('classifyPlace : données invalides (jamais devinées)', () => {
  const invalid = (r: PlaceObservationResult) =>
    expect(status(r)).toBe('unavailable/invalid-data');

  it('refuse un identifiant qui n’est pas un entier positif', () => {
    invalid(classifyPlace(cover(), shard1(), 0));
    invalid(classifyPlace(cover(), shard1(), 1.5));
    invalid(classifyPlace(cover(), shard1(), Number.NaN));
  });

  it('refuse un morceau qui n’est pas un objet, ou sans instruments / observed', () => {
    invalid(classifyPlace(cover(), null, 7));
    invalid(classifyPlace(cover(), [], 7));
    invalid(classifyPlace(cover(), { observed: {} }, 7));
    invalid(classifyPlace(cover(), { instruments: [] }, 7));
    invalid(classifyPlace(cover(), { instruments: [{}], observed: {} }, 7));
  });

  it('refuse une observation VIDE : un zéro n’est pas une liste vide', () => {
    invalid(
      classifyPlace(
        cover(),
        { instruments: [INSTRUMENT], observed: { '7': [] } },
        7
      )
    );
  });

  it('refuse un identifiant rangé dans le mauvais morceau', () => {
    invalid(
      classifyPlace(
        cover(),
        { instruments: [INSTRUMENT], observed: { '8': [LINE] } },
        7
      )
    );
  });

  it('refuse une ligne malformée : instrument inconnu, compte nul, dates inversées', () => {
    const bad = (line: unknown[]) =>
      classifyPlace(
        cover(),
        { instruments: [INSTRUMENT], observed: { '7': [line] } },
        7
      );
    invalid(bad([5, 2, '2020-01-01', '2020-02-01', 'https://x']));
    invalid(bad([0, 0, '2020-01-01', '2020-02-01', 'https://x']));
    invalid(bad([0, 1, '2020-03-01', '2020-02-01', 'https://x']));
    invalid(bad([0, 1, '2020-01-01', '', 'https://x']));
    invalid(bad([0, 1, '2020-01-01']));
    // Sans date des deux côtés : permis (Viking n'en publie aucune).
    expect(status(bad([0, 1, '', '', 'https://x']))).toBe('observed');
  });

  it('refuse un identifiant à la fois observé ET zéro prouvé', () => {
    invalid(classifyPlace(cover({ zeroIds: [7] }), shard1(), 7));
    // Même quand la formation demandée est une AUTRE du même morceau.
    invalid(classifyPlace(cover({ zeroIds: [7] }), shard1(), 11));
  });

  it('refuse des zeroIds en double, non entiers, ou qui ne sont pas une liste', () => {
    invalid(classifyPlace(cover({ zeroIds: [9, 9] }), shard1(), 9));
    invalid(classifyPlace(cover({ zeroIds: [9.5] }), shard1(), 9));
    invalid(classifyPlace(cover({ zeroIds: [-3] }), shard1(), 9));
    invalid(classifyPlace(cover({ zeroIds: '9' }), shard1(), 9));
  });

  it('refuse un nombre de morceaux invalide', () => {
    invalid(classifyPlace(cover({ shards: 0 }), shard1(), 7));
  });
});

describe('resolvePlaceObservations : disponibilité', () => {
  const idx = {
    provider: {},
    frozenAt: '2026-09-29',
    complete: true,
    bodies: { moon: cover() },
  };
  const deps = (over: Record<string, unknown> = {}) =>
    ({
      index: idx,
      readShard: async () => shard1(),
      ...over,
    }) as unknown as Parameters<typeof resolvePlaceObservations>[0];

  it('index indisponible', async () => {
    expect(
      status(await resolvePlaceObservations(deps({ index: null }), 'moon', 7))
    ).toBe('unavailable/index-unavailable');
  });

  it('corps non couvert, sans rien lire', async () => {
    let read = 0;
    const r = await resolvePlaceObservations(
      deps({
        readShard: async () => {
          read++;
          return shard1();
        },
      }),
      'titan',
      7
    );
    expect(status(r)).toBe('unavailable/body-not-covered');
    expect(read).toBe(0);
  });

  it('échec de lecture du morceau (réseau, HTTP)', async () => {
    const r = await resolvePlaceObservations(
      deps({
        readShard: async () => {
          throw new Error('HTTP 503');
        },
      }),
      'moon',
      7
    );
    expect(status(r)).toBe('unavailable/shard-unavailable');
  });

  it('morceau invalide ou incomplet : invalid-data, pas un zéro', async () => {
    const r = await resolvePlaceObservations(
      deps({ readShard: async () => ({ instruments: [] }) }),
      'moon',
      7
    );
    expect(status(r)).toBe('unavailable/invalid-data');
  });

  it('lit le bon morceau : id % shards', async () => {
    const asked: number[] = [];
    await resolvePlaceObservations(
      deps({
        readShard: async (_b: string, k: number) => {
          asked.push(k);
          return k === 1 ? shard1() : shard0();
        },
      }),
      'moon',
      7
    );
    expect(asked).toEqual([1]);
  });
});

describe('la donnée publiée, lue sans être modifiée', () => {
  const bodies = Object.entries(index.bodies) as [
    string,
    (typeof index.bodies)['moon'],
  ][];

  it('ne déclare aucun zeroIds : aucun zéro n’est affirmé sans preuve', () => {
    for (const [body, c] of bodies)
      expect(
        (c as { zeroIds?: unknown }).zeroIds ?? [],
        `${body} : un zéro prouvé doit être justifié par le tirage`
      ).toEqual([]);
  });

  for (const [body, c] of bodies) {
    it(`${body} : chaque formation du gazetteer est « observed », comme avant`, () => {
      const names = JSON.parse(
        readFileSync(
          resolve(ROOT, `public/assets/gazetteer/${body}.json`),
          'utf8'
        )
      ) as { iauId: number }[];
      const raw = new Map<number, unknown>();
      for (let k = 0; k < c.shards; k++) {
        const p = resolve(
          ROOT,
          `public/assets/place-observations/${body}/${k}.json`
        );
        expect(existsSync(p)).toBe(true);
        raw.set(k, JSON.parse(readFileSync(p, 'utf8')));
      }
      const counts: Record<string, number> = {};
      for (const f of names) {
        const r = classifyPlace(c, raw.get(f.iauId % c.shards), f.iauId);
        counts[status(r)] = (counts[status(r)] ?? 0) + 1;
      }
      expect(counts).toEqual({ observed: names.length });
      // Une formation inconnue du tirage : jamais « aucune empreinte ».
      const absent = 999_999_999;
      expect(status(classifyPlace(c, raw.get(absent % c.shards), absent))).toBe(
        'not-evaluated'
      );
    });
  }
});

describe('le message d’un état non évalué', () => {
  it('choisit une phrase distincte par état', () => {
    expect(statusKey({ status: 'zero-proven' })).toBe('bi.places.none');
    expect(statusKey({ status: 'not-evaluated' })).toBe(
      'bi.places.notEvaluated'
    );
    expect(statusKey({ status: 'unavailable', reason: 'invalid-data' })).toBe(
      'bi.places.unavailable'
    );
  });

  it('existe dans les quatre langues, sans prétendre que la formation est récente', () => {
    const all = { en: cardEn, fr: cardFr, es: cardEs, 'pt-BR': cardPtBR };
    for (const [lang, d] of Object.entries(all)) {
      const text = (d as Record<string, string>)['bi.places.notEvaluated'];
      expect(text, lang).toBeTruthy();
      expect(text, lang).not.toMatch(
        /gel|frozen|congel|congela|após|despu|after|depuis/i
      );
      expect(text, lang).not.toBe(
        (d as Record<string, string>)['bi.places.none']
      );
    }
    expect(cardFr['bi.places.notEvaluated']).toBe(
      'Cette formation n’a pas été évaluée dans le jeu de données ODE actuellement publié.'
    );
  });
});

describe('matchFormation : recherche insensible aux diacritiques', () => {
  const f = (name: string, iauId: number) => ({ name, iauId }) as NamedFeature;
  const names = [
    f('Na Hye-sok', 16512),
    f('Tycho', 1),
    f('Ada', 2),
    f('Adá', 3),
  ];

  it('trouve « Na Hye-sok » comme « Na Hye-sŏk », sans renommer la donnée', () => {
    expect(matchFormation(names, 'Na Hye-sok')?.iauId).toBe(16512);
    expect(matchFormation(names, 'Na Hye-sŏk')?.iauId).toBe(16512);
    expect(matchFormation(names, 'na hye-sŏk')?.iauId).toBe(16512);
    expect(matchFormation(names, '  NA HYE SOK ')?.iauId).toBe(16512);
    expect(names[0]!.name).toBe('Na Hye-sok');
  });

  it('une correspondance exacte l’emporte ; une repliée ambiguë ne se devine pas', () => {
    expect(matchFormation(names, 'Ada')?.iauId).toBe(2);
    expect(matchFormation(names, 'Adá')?.iauId).toBe(3);
    // « ada » replié correspond à Ada ET Adá, mais « ada » est exactement Ada.
    expect(matchFormation(names, 'ada')?.iauId).toBe(2);
    expect(matchFormation(names, 'ădă')).toBeNull();
  });

  it('un nom inconnu ou vide ne correspond à rien', () => {
    expect(matchFormation(names, 'Nulle part')).toBeNull();
    expect(matchFormation(names, '   ')).toBeNull();
  });
});
