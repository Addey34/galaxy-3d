import { describe, expect, it, vi } from 'vitest';
import { createIntentLoader } from './intentLoader';

/** Une promesse qu'on résout ou rejette à la main : l'ordre des résolutions est le sujet du test. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createIntentLoader : le dernier geste gagne', () => {
  it('rend la valeur d’une demande unique', async () => {
    const loader = createIntentLoader(async (id) => `visite ${id}`);
    expect(await loader.request('a')).toEqual({
      status: 'ready',
      value: 'visite a',
    });
  });

  it('dit « inconnue » quand le chargeur répond null', async () => {
    const loader = createIntentLoader(async () => null);
    expect(await loader.request('x')).toEqual({ status: 'unknown' });
  });

  it('une résolution tardive d’une ancienne demande est périmée, la dernière gagne', async () => {
    const first = deferred<string | null>();
    const second = deferred<string | null>();
    const load = vi
      .fn<(id: string) => Promise<string | null>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const loader = createIntentLoader(load);
    const a = loader.request('a');
    const b = loader.request('b');
    // L'ancienne demande se résout APRÈS la nouvelle : elle ne doit rien démarrer.
    second.resolve('B');
    first.resolve('A');
    expect(await b).toEqual({ status: 'ready', value: 'B' });
    expect(await a).toEqual({ status: 'stale' });
  });

  it('même si l’ancienne se résout avant, elle est périmée dès qu’une autre est prise', async () => {
    const first = deferred<string | null>();
    const second = deferred<string | null>();
    const loader = createIntentLoader(
      vi
        .fn<(id: string) => Promise<string | null>>()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise)
    );
    const a = loader.request('a');
    const b = loader.request('b');
    first.resolve('A');
    expect(await a).toEqual({ status: 'stale' });
    second.resolve('B');
    expect(await b).toEqual({ status: 'ready', value: 'B' });
  });

  it('une annulation périme la demande en vol : une résolution tardive ne démarre rien', async () => {
    const pending = deferred<string | null>();
    const loader = createIntentLoader(() => pending.promise);
    const request = loader.request('a');
    loader.cancel();
    pending.resolve('A');
    expect(await request).toEqual({ status: 'stale' });
  });

  it('un refus est rendu comme tel, puis NON mémorisé : la demande suivante relance le chargement', async () => {
    const load = vi
      .fn<(id: string) => Promise<string | null>>()
      .mockRejectedValueOnce(new Error('réseau coupé'))
      .mockResolvedValueOnce('A');
    const loader = createIntentLoader(load);
    const refused = await loader.request('a');
    expect(refused.status).toBe('failed');
    expect(await loader.request('a')).toEqual({ status: 'ready', value: 'A' });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('un refus d’une demande déjà remplacée est périmé, pas annoncé', async () => {
    const first = deferred<string | null>();
    const loader = createIntentLoader(
      vi
        .fn<(id: string) => Promise<string | null>>()
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce('B')
    );
    const a = loader.request('a');
    const b = loader.request('b');
    first.reject(new Error('refusé'));
    expect(await a).toEqual({ status: 'stale' });
    expect(await b).toEqual({ status: 'ready', value: 'B' });
  });
});
