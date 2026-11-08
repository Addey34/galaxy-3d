import { describe, expect, it } from 'vitest';

import {
  BACKOFF_CAP_MS,
  HttpStatusError,
  MAX_ATTEMPTS,
  MAX_SERVER_DELAY_MS,
  MAX_TRACKED_FAILURES,
  PermanentFetchError,
  classifyTransportFailure,
  mayRequest,
  nextRetryDelay,
  parseRetryAfter,
  recordFailure,
  rememberFailure,
  type FailureRecord,
} from './fetchRetry';

describe('classifyTransportFailure', () => {
  it('une annulation n’est pas un échec', () => {
    const abort = new DOMException('x', 'AbortError');
    expect(classifyTransportFailure(abort)).toBe('abort');
  });
  it('coupure réseau (TypeError de fetch), 408, 425, 429 et 5xx : passagers', () => {
    expect(classifyTransportFailure(new TypeError('Failed to fetch'))).toBe(
      'transient'
    );
    for (const s of [408, 425, 429, 500, 502, 503, 504])
      expect(classifyTransportFailure(new HttpStatusError(s))).toBe(
        'transient'
      );
  });
  it('404, 410, 403 et une réponse d’un autre type : définitifs', () => {
    for (const s of [400, 403, 404, 410])
      expect(classifyTransportFailure(new HttpStatusError(s))).toBe(
        'permanent'
      );
    expect(classifyTransportFailure(new PermanentFetchError('html'))).toBe(
      'permanent'
    );
  });
});

describe('parseRetryAfter', () => {
  it('secondes entières', () => {
    expect(parseRetryAfter('120', 0)).toBe(120_000);
  });
  it('date HTTP, relative à l’instant donné, jamais négative', () => {
    const base = Date.parse('Sun, 08 Nov 2026 10:00:00 GMT');
    expect(parseRetryAfter('Sun, 08 Nov 2026 10:02:00 GMT', base)).toBe(
      120_000
    );
    expect(parseRetryAfter('Sun, 08 Nov 2026 09:00:00 GMT', base)).toBe(0);
  });
  it('absent ou illisible : null', () => {
    expect(parseRetryAfter(null, 0)).toBeNull();
    expect(parseRetryAfter('', 0)).toBeNull();
    expect(parseRetryAfter('bientôt', 0)).toBeNull();
  });
  it('3 599 s et 7 200 s : lus tels quels, sans plafond d’une heure', () => {
    expect(parseRetryAfter('3599', 0)).toBe(3_599_000);
    expect(parseRetryAfter('7200', 0)).toBe(7_200_000);
  });
  it('une date HTTP à deux heures donne deux heures, au cent près', () => {
    const base = Date.parse('Sun, 08 Nov 2026 10:00:00 GMT');
    expect(parseRetryAfter('Sun, 08 Nov 2026 12:00:00 GMT', base)).toBe(
      7_200_000
    );
    expect(parseRetryAfter('Sun, 08 Nov 2026 12:00:00.000 GMT', base)).toBe(
      7_200_000
    );
  });
  it('négatif, décimal ou signé : null (pas une date)', () => {
    for (const bad of ['-5', '+5', '1.5', '1e3', '0x10'])
      expect(parseRetryAfter(bad, 0), bad).toBeNull();
  });
  it('une valeur démesurée reste finie, bornée à un an', () => {
    const huge = parseRetryAfter('9'.repeat(400), 0);
    expect(Number.isFinite(huge)).toBe(true);
    expect(huge).toBe(MAX_SERVER_DELAY_MS);
    const farDate = parseRetryAfter('Fri, 31 Dec 9999 23:59:59 GMT', 0);
    expect(farDate).toBe(MAX_SERVER_DELAY_MS);
  });
});

describe('nextRetryDelay', () => {
  it('double de 2 s jusqu’au plafond de 60 s', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((n) => nextRetryDelay(n))).toEqual([
      2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000,
    ]);
  });
  it('un délai serveur plus long que le plafond est respecté, un plus court ne raccourcit pas', () => {
    expect(nextRetryDelay(1, 300_000)).toBe(300_000);
    expect(nextRetryDelay(3, 1000)).toBe(8000);
    expect(BACKOFF_CAP_MS).toBe(60_000);
  });
  it('jamais avant l’échéance du serveur : 3 599 s et 7 200 s passent intacts', () => {
    expect(nextRetryDelay(1, 3_599_000)).toBe(3_599_000);
    expect(nextRetryDelay(1, 7_200_000)).toBe(7_200_000);
  });
  it('valeurs invalides ou infinies : on retombe sur le retard exponentiel', () => {
    for (const bad of [Number.NaN, -1, null])
      expect(nextRetryDelay(2, bad)).toBe(4000);
    expect(nextRetryDelay(2, Infinity)).toBe(MAX_SERVER_DELAY_MS);
    expect(Number.isFinite(nextRetryDelay(2, Infinity))).toBe(true);
  });
});

describe('recordFailure / mayRequest', () => {
  it('passager : retard exponentiel, puis permanent à l’épuisement des essais', () => {
    let rec: FailureRecord | undefined;
    const kinds: string[] = [];
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      rec = recordFailure(rec, 'transient', 1000);
      kinds.push(rec.kind);
    }
    expect(kinds).toEqual([
      'transient',
      'transient',
      'transient',
      'transient',
      'permanent',
    ]);
    expect(mayRequest(rec, Number.MAX_SAFE_INTEGER)).toBe(false);
  });
  it('rien avant le retard, redemandable après', () => {
    const rec = recordFailure(undefined, 'transient', 1000);
    expect(mayRequest(rec, 2999)).toBe(false);
    expect(mayRequest(rec, 3000)).toBe(true);
  });
  it('un 503 avec Retry-After de 7 200 s reste passager et garde son échéance', () => {
    const rec = recordFailure(undefined, 'transient', 1000, 7_200_000);
    expect(rec.kind).toBe('transient');
    expect(rec.retryAt).toBe(1000 + 7_200_000);
    expect(mayRequest(rec, 1000 + 7_199_999)).toBe(false);
    expect(mayRequest(rec, 1000 + 7_200_000)).toBe(true);
  });
  it('définitif d’emblée pour un 404', () => {
    const rec = recordFailure(undefined, 'permanent', 0);
    expect(rec.kind).toBe('permanent');
    expect(mayRequest(rec, 1e12)).toBe(false);
  });
  it('rien enregistré : demandable', () => {
    expect(mayRequest(undefined, 0)).toBe(true);
  });
});

describe('rememberFailure', () => {
  const rec = (n: number): FailureRecord => ({
    kind: 'transient',
    attempts: n,
    retryAt: 0,
  });
  it('borne le magasin et oublie les plus anciens d’abord', () => {
    const store = new Map<string, FailureRecord>();
    for (let i = 0; i < MAX_TRACKED_FAILURES + 10; i++)
      rememberFailure(store, `k${i}`, rec(1));
    expect(store.size).toBe(MAX_TRACKED_FAILURES);
    expect(store.has('k0')).toBe(false);
    expect(store.has('k9')).toBe(false);
    expect(store.has('k10')).toBe(true);
    expect(store.has(`k${MAX_TRACKED_FAILURES + 9}`)).toBe(true);
  });
  it('un échec réinscrit passe en queue : il survit à l’oubli des anciens', () => {
    const store = new Map<string, FailureRecord>();
    rememberFailure(store, 'vieux', rec(1));
    for (let i = 0; i < MAX_TRACKED_FAILURES - 1; i++)
      rememberFailure(store, `k${i}`, rec(1));
    rememberFailure(store, 'vieux', rec(2)); // réinscrit : devient le plus récent
    rememberFailure(store, 'dernier', rec(1)); // déborde d’une entrée
    expect(store.get('vieux')?.attempts).toBe(2);
    expect(store.has('k0')).toBe(false);
  });
});
