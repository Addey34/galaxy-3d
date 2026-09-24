import { beforeEach, describe, expect, it } from 'vitest';
import {
  EPHEMERIS_CACHE_NAME,
  EphemerisStore,
  parseStoreKey,
  shouldReplace,
  spanByteLength,
  spanSatisfies,
  storeKey,
  type EphemerisCacheLike,
  type HeldSpan,
} from './ephemerisStore';
import { BYTES_PER_SAMPLE, byteRangeForIndices } from './ephemerisWindow';

/**
 * LE MAGASIN DE L'APPAREIL (lot 17, phase 17E).
 *
 * Ce qui se joue ici n'est pas du confort : ce module décide de NE PAS demander des octets.
 * Une erreur d'inclusion place un corps à un autre instant, en silence, ce qui est exactement
 * le défaut que les lots 15 et 17C existent pour empêcher. Les gardes visent donc d'abord les
 * bords : la tranche trop courte d'un échantillon, l'entrée tronquée, la clé étrangère.
 */

const FILE = 'mimas.3e663dcf7b70.bin';

/** Une fenêtre telle que `ephemerisWindow` la rend, pour comparer sur le même objet. */
function windowOf(firstIndex: number, lastIndex: number) {
  return {
    firstIndex,
    lastIndex,
    ...byteRangeForIndices(firstIndex, lastIndex),
  };
}

/** Un cache en mémoire, à l'image du `Cache` du navigateur. */
function fakeCache(): EphemerisCacheLike & { size(): number } {
  const entries = new Map<string, ArrayBuffer>();
  const absolute = (key: string): string => `https://example.test${key}`;
  return {
    async keys() {
      return [...entries.keys()].map((url) => ({ url: absolute(url) }));
    },
    async match(request: string) {
      const bytes = entries.get(request);
      return bytes === undefined ? undefined : new Response(bytes);
    },
    async put(request: string, response: Response) {
      entries.set(request, await response.arrayBuffer());
    },
    async delete(request: string) {
      const key = request.startsWith('https://')
        ? request.slice('https://example.test'.length)
        : request;
      return entries.delete(key);
    },
    size: () => entries.size,
  };
}

const bytesFor = (span: {
  firstIndex: number;
  lastIndex: number;
}): ArrayBuffer => new ArrayBuffer(spanByteLength(span));

describe('clés du magasin', () => {
  it('fait l’aller-retour d’une tranche', () => {
    const key = storeKey(FILE, { firstIndex: 12, lastIndex: 40 });
    expect(parseStoreKey(key)).toEqual({
      file: FILE,
      span: { firstIndex: 12, lastIndex: 40 },
    });
  });

  it('lit une clé rendue absolue par le cache', () => {
    const key = `https://example.test${storeKey(FILE, { firstIndex: 0, lastIndex: 3 })}`;
    expect(parseStoreKey(key)?.span).toEqual({ firstIndex: 0, lastIndex: 3 });
  });

  it('refuse ce qui n’est pas à nous', () => {
    // Le cache peut contenir autre chose ; le confondre avec une tranche ferait lire des
    // octets qui ne décrivent aucune grille.
    expect(
      parseStoreKey('/assets/ephemerides/mimas.3e663dcf7b70.bin')
    ).toBeNull();
    expect(parseStoreKey('/__ephemeris-store/manifest.json')).toBeNull();
    // Ce nom-ci est celui d'un VRAI fichier du manifeste : sans cela le refus viendrait du
    // nom et non de la tranche, et la garde serait tautologique (le piège de 17C, recommis
    // ici puis attrapé par sa propre falsification).
    expect(parseStoreKey(`/__ephemeris-store/${FILE}?samples=3-1`)).toBeNull();
  });
});

describe('ce qu’une tranche satisfait', () => {
  it('ne rend « fichier entier » que pour le fichier entier', () => {
    expect(spanSatisfies({ firstIndex: 0, lastIndex: 99 }, 'full', 100)).toBe(
      true
    );
    expect(spanSatisfies({ firstIndex: 0, lastIndex: 98 }, 'full', 100)).toBe(
      false
    );
    expect(spanSatisfies({ firstIndex: 1, lastIndex: 99 }, 'full', 100)).toBe(
      false
    );
  });

  it('exige l’inclusion, pas le chevauchement', () => {
    const held = { firstIndex: 10, lastIndex: 20 };
    expect(spanSatisfies(held, windowOf(12, 18), 100)).toBe(true);
    expect(spanSatisfies(held, windowOf(10, 20), 100)).toBe(true);
    // Un seul échantillon de trop d'un côté : la lecture sortirait de ce qu'on tient.
    expect(spanSatisfies(held, windowOf(9, 20), 100)).toBe(false);
    expect(spanSatisfies(held, windowOf(10, 21), 100)).toBe(false);
  });
});

describe('ce qu’on garde', () => {
  it('écrit quand rien n’est là', () => {
    expect(shouldReplace(null, { firstIndex: 0, lastIndex: 5 })).toBe(true);
  });

  it('n’écrase JAMAIS une tranche qui contient déjà la nouvelle', () => {
    // C'est la garde du hors-ligne : sans elle, la première fenêtre de 96 octets venue
    // remplacerait le fichier entier qu'un « préparer le hors-ligne » vient de ranger.
    const whole = { firstIndex: 0, lastIndex: 999 };
    expect(shouldReplace(whole, { firstIndex: 500, lastIndex: 501 })).toBe(
      false
    );
    expect(shouldReplace(whole, whole)).toBe(false);
  });

  it('écrit une tranche plus large ou disjointe', () => {
    const held = { firstIndex: 10, lastIndex: 20 };
    expect(shouldReplace(held, { firstIndex: 0, lastIndex: 99 })).toBe(true);
    expect(shouldReplace(held, { firstIndex: 40, lastIndex: 50 })).toBe(true);
  });
});

describe('EphemerisStore', () => {
  let cache: ReturnType<typeof fakeCache>;
  let store: EphemerisStore;

  beforeEach(() => {
    cache = fakeCache();
    store = new EphemerisStore(cache);
  });

  /**
   * Écrit comme le SERVICE écrit : l'inventaire se lit d'abord, une seule fois, et la tranche
   * tenue est PASSÉE à `write`. Le test exerce ainsi le vrai patron d'appel ; écrire `null` en
   * dur ne dirait rien de la règle d'inclusion, qui est justement ce que ces gardes tiennent.
   */
  const writeLikeService = async (
    file: string,
    span: HeldSpan,
    bytes: ArrayBuffer
  ): Promise<boolean> => {
    const { spans } = await store.inventory();
    return store.write(file, span, bytes, spans.get(file) ?? null);
  };

  it('range une tranche et la relit', async () => {
    const span = { firstIndex: 4, lastIndex: 9 };
    expect(await writeLikeService(FILE, span, bytesFor(span))).toBe(true);

    const inventory = await store.inventory();
    expect(inventory.spans.get(FILE)).toEqual(span);
    expect(inventory.bytes).toBe(6 * BYTES_PER_SAMPLE);

    const held = await store.readSpan(FILE, span);
    expect(held?.firstIndex).toBe(4);
    expect(held?.bytes.byteLength).toBe(6 * BYTES_PER_SAMPLE);
  });

  it('refuse d’écrire des octets qui ne font pas la taille de leur tranche', async () => {
    // Des octets à la mauvaise taille sont un défaut de déploiement, pas de transport : les
    // ranger ferait croire l'appareil prêt alors qu'il lirait un autre instant.
    const span = { firstIndex: 0, lastIndex: 9 };
    expect(await writeLikeService(FILE, span, new ArrayBuffer(8))).toBe(false);
    expect((await store.inventory()).spans.size).toBe(0);
  });

  it('SUPPRIME une entrée tronquée au lieu de la lire', async () => {
    const span = { firstIndex: 0, lastIndex: 9 };
    await cache.put(storeKey(FILE, span), new Response(new ArrayBuffer(16)));
    expect(await store.readSpan(FILE, span)).toBeNull();
    expect(await cache.match(storeKey(FILE, span))).toBeUndefined();
  });

  it('ne garde qu’UNE entrée par fichier', async () => {
    const small = { firstIndex: 10, lastIndex: 12 };
    const wide = { firstIndex: 0, lastIndex: 99 };
    await writeLikeService(FILE, small, bytesFor(small));
    await writeLikeService(FILE, wide, bytesFor(wide));
    expect(cache.size()).toBe(1);
    expect((await store.inventory()).spans.get(FILE)).toEqual(wide);

    // …et une tranche déjà contenue n'écrit rien du tout.
    expect(await writeLikeService(FILE, small, bytesFor(small))).toBe(false);
    expect((await store.inventory()).spans.get(FILE)).toEqual(wide);
  });

  it('retire ce que le manifeste courant ne nomme plus, et garde le reste', async () => {
    const other = 'mercury.ac5d5b6267d2.bin';
    const span = { firstIndex: 0, lastIndex: 1 };
    await writeLikeService(FILE, span, bytesFor(span));
    await writeLikeService(other, span, bytesFor(span));
    await store.writeManifest({ hello: 'world' });

    expect(await store.prune(new Set([FILE]))).toBe(1);
    const inventory = await store.inventory();
    expect([...inventory.spans.keys()]).toEqual([FILE]);
    // Le manifeste n'est pas une tranche : la purge ne doit pas l'emporter avec les orphelins.
    expect(await store.readManifest()).toEqual({ hello: 'world' });
  });

  // Les DEUX ordres d'insertion, et ce n'est pas du zèle : avec la seule ordre « petite puis
  // large », l'ordre d'itération du cache donne déjà la bonne réponse, et la garde prouverait
  // « la dernière vue » au lieu de « la plus large ». Sa propre falsification l'a dit.
  it.each([
    ['la plus large arrivée en DERNIER', false],
    ['la plus large arrivée en PREMIER', true],
  ])(
    'choisit %s et retire le DOUBLON laissé par un arrêt en cours d’écriture',
    async (_cas, wideFirst) => {
      const small = { firstIndex: 10, lastIndex: 12 };
      const wide = { firstIndex: 0, lastIndex: 99 };
      const order = wideFirst ? [wide, small] : [small, wide];
      for (const span of order)
        await cache.put(storeKey(FILE, span), new Response(bytesFor(span)));

      const inventory = await store.inventory();
      expect(inventory.spans.get(FILE)).toEqual(wide);
      // Les octets annoncés sont ceux de la tranche RETENUE, pas la somme des deux.
      expect(inventory.bytes).toBe(spanByteLength(wide));

      expect(await store.prune(new Set([FILE]))).toBe(1);
      expect(cache.size()).toBe(1);
      expect(await store.readSpan(FILE, wide)).not.toBeNull();
    }
  );

  it('se vide entièrement quand on lui rend la place', async () => {
    const span = { firstIndex: 0, lastIndex: 1 };
    await writeLikeService(FILE, span, bytesFor(span));
    await store.writeManifest({ hello: 'world' });
    expect(await store.clear()).toBe(2);
    expect(cache.size()).toBe(0);
  });

  it('n’existe pas quand le navigateur n’a pas de cache', async () => {
    // Node, jsdom, navigation privée stricte : l'application redemande alors ses fenêtres,
    // comme avant cette phase. Ce n'est pas une panne, et rien ne doit lever.
    expect(typeof caches).toBe('undefined');
    expect(await EphemerisStore.open(EPHEMERIS_CACHE_NAME)).toBeNull();
  });
});
