import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorizonsEphemerisService } from './HorizonsEphemerisService';

describe('HorizonsEphemerisService', () => {
  it('interpolates positions from Horizons position/velocity samples', async () => {
    const samples = new Float64Array([1, 2, 3, 1, 0, 0, 5, 2, 3, 1, 0, 0]);
    const binary = samples.buffer;
    const manifest = {
      version: 1,
      source: 'test',
      generatedAt: '2026-01-01T00:00:00Z',
      frame: 'ECLIPTIC_J2000',
      center: 'SUN',
      units: 'AU-D',
      bodies: {
        test: {
          file: 'test.000000000000.bin',
          target: 'test',
          startJdTdb: 2_451_545,
          stepDays: 4,
          sampleCount: 2,
        },
      },
    };

    vi.stubGlobal('window', {
      location: {
        href: 'https://example.test/',
        origin: 'https://example.test',
      },
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => manifest })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => binary,
        })
    );

    const service = await HorizonsEphemerisService.load(
      'https://example.test/manifest.json'
    );
    // J2000 TT + 2 jours : avec des tangentes constantes, x est exactement au milieu.
    const position = service.getHeliocentricAU(
      'test',
      new Date('2000-01-03T11:58:56.000Z')
    );
    expect(position).not.toBeNull();
    expect(position!.x).toBeCloseTo(3, 5);
    expect(position!.y).toBeCloseTo(3, 8);
    expect(position!.z).toBeCloseTo(-2, 8);

    vi.unstubAllGlobals();
  });

  it('subtracts a precise child state from its precise parent state', async () => {
    const childSamples = new Float64Array([2, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0])
      .buffer;
    const parentSamples = new Float64Array([1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0])
      .buffer;
    const manifest = {
      version: 1,
      source: 'test',
      generatedAt: '2026-01-01T00:00:00Z',
      frame: 'ECLIPTIC_J2000',
      center: 'SUN',
      units: 'AU-D',
      bodies: {
        child: {
          file: 'child.000000000000.bin',
          target: 'child',
          startJdTdb: 2_451_545,
          stepDays: 4,
          sampleCount: 2,
        },
        parent: {
          file: 'parent.000000000000.bin',
          target: 'parent',
          startJdTdb: 2_451_545,
          stepDays: 4,
          sampleCount: 2,
        },
      },
    };

    vi.stubGlobal('window', {
      location: {
        href: 'https://example.test/',
        origin: 'https://example.test',
      },
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => manifest })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => childSamples,
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => parentSamples,
        })
    );

    const service = await HorizonsEphemerisService.load(
      '/assets/ephemerides/manifest.json'
    );
    const relative = service.getParentRelativeAU(
      'child',
      'parent',
      new Date('2000-01-03T11:58:56.000Z')
    );

    expect(relative).not.toBeNull();
    expect(relative!.x).toBeCloseTo(1, 8);
    expect(relative!.y).toBeCloseTo(0, 8);
    expect(relative!.z).toBeCloseTo(0, 8);
    vi.unstubAllGlobals();
  });

  it('returns null outside the loaded coverage', async () => {
    vi.stubGlobal('window', { location: { href: 'https://example.test/' } });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    // Sans reprise : le calendrier par défaut attendrait 1 s puis 4 s avant de renoncer, ce
    // que ce test n'a pas à payer. La reprise elle-même est vérifiée plus bas.
    const service = await HorizonsEphemerisService.load(
      '/missing.json',
      {},
      { retryDelaysMs: [] }
    );
    expect(service.getHeliocentricAU('ceres', new Date())).toBeNull();
    expect(service.report.manifestFailed).toBe(true);
    vi.unstubAllGlobals();
  });

  it('reads a satellite file directly when the manifest declares its parent center', async () => {
    const childSamples = new Float64Array([
      0.01, 0, 0, 0, 0, 0, 0.01, 0, 0, 0, 0, 0,
    ]).buffer;
    const manifest = {
      version: 1,
      source: 'test',
      generatedAt: '2026-01-01T00:00:00Z',
      frame: 'ECLIPTIC_J2000',
      center: 'SUN',
      units: 'AU-D',
      bodies: {
        moon: {
          file: 'moon.000000000000.bin',
          target: 'moon',
          center: 'earth',
          startJdTdb: 2_451_545,
          stepDays: 4,
          sampleCount: 2,
        },
      },
    };

    vi.stubGlobal('window', {
      location: {
        href: 'https://example.test/',
        origin: 'https://example.test',
      },
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => manifest })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => childSamples,
        })
    );

    const service = await HorizonsEphemerisService.load(
      '/assets/ephemerides/manifest.json'
    );
    const relative = service.getParentRelativeAU(
      'moon',
      'earth',
      new Date('2000-01-03T11:58:56.000Z')
    );

    expect(relative?.x).toBeCloseTo(0.01, 8);
    expect(relative?.y).toBeCloseTo(0, 8);
    expect(relative?.z).toBeCloseTo(0, 8);
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});

/**
 * CE QUE LE LOT 15 A CORRIGÉ. Le chargement était un `Promise.all` tout-ou-rien : une seule
 * rejection rendait un service VIDE, donc tous les corps repartaient sur une source de repli,
 * sans un mot. Mesuré en production le 2026-09-22 sur un lien à 24 ko/s : 25 fichiers sur 64
 * arrivés, 39 perdus en « TypeError: Failed to fetch » après 706 s.
 *
 * Les gardes ci-dessous tiennent les trois décisions écrites au contrat
 * (`docs/ARCHITECTURE.md` § « Un chargement partiel se garde, se reprend et se dit ») : ce qui
 * arrive est GARDÉ, ce qui manque est NOMMÉ avec sa raison, et un échec de TRANSPORT est repris
 * là où un défaut de déploiement ne l'est pas.
 */
describe('HorizonsEphemerisService, partial load', () => {
  const SAMPLES = (x: number): ArrayBuffer =>
    new Float64Array([x, 0, 0, 0, 0, 0, x, 0, 0, 0, 0, 0]).buffer;

  const manifestOf = (...names: string[]): unknown => ({
    version: 1,
    source: 'test',
    generatedAt: '2026-01-01T00:00:00Z',
    frame: 'ECLIPTIC_J2000',
    center: 'SUN',
    units: 'AU-D',
    bodies: Object.fromEntries(
      names.map((name) => [
        name,
        {
          file: `${name}.000000000000.bin`,
          target: name,
          startJdTdb: 2_451_545,
          stepDays: 4,
          sampleCount: 2,
        },
      ])
    ),
  });

  const DATE = new Date('2000-01-03T11:58:56.000Z');

  /**
   * `fetch` simulé : le manifeste, puis un binaire par corps. `fail` décide du sort de chaque
   * corps — motif du patron de `src/config/satellitePhases.test.ts`, mais ici les réponses
   * sont fabriquées plutôt que lues sur le disque, pour pouvoir faire échouer à volonté.
   */
  function stubFetch(
    names: string[],
    fail: (name: string, attempt: number) => 'ok' | 'network' | number
  ): { calls: Map<string, number> } {
    const calls = new Map<string, number>();
    vi.stubGlobal('window', {
      location: {
        href: 'https://example.test/assets/ephemerides/manifest.json',
        origin: 'https://example.test',
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const file = new URL(url.toString()).pathname.split('/').pop()!;
        if (file === 'manifest.json')
          return { ok: true, json: async () => manifestOf(...names) };
        const name = file.split('.')[0];
        const attempt = (calls.get(name) ?? 0) + 1;
        calls.set(name, attempt);
        const verdict = fail(name, attempt);
        if (verdict === 'network') throw new TypeError('Failed to fetch');
        if (verdict !== 'ok') return { ok: false, status: verdict };
        return {
          ok: true,
          arrayBuffer: async () => SAMPLES(names.indexOf(name) + 1),
        };
      })
    );
    return { calls };
  }

  afterEach(() => vi.unstubAllGlobals());

  it('keeps the files that arrived when others fail, instead of voiding everything', async () => {
    stubFetch(['mercury', 'venus', 'juno'], (name) =>
      name === 'mercury' ? 'ok' : 'network'
    );

    const service = await HorizonsEphemerisService.load(
      'https://example.test/assets/ephemerides/manifest.json',
      {},
      { retryDelaysMs: [] }
    );

    // Avant le lot 15 : les trois étaient perdus. Mercure est là, et sert sa position.
    expect(service.getHeliocentricAU('mercury', DATE)).not.toBeNull();
    expect(service.getHeliocentricAU('venus', DATE)).toBeNull();
    expect(service.report.declared).toBe(3);
    expect(service.report.loaded).toEqual(['mercury']);
    expect(service.report.missing.map((m) => m.body)).toEqual([
      'venus',
      'juno',
    ]);
  });

  it('names the reason of each missing file, and whether retrying it makes sense', async () => {
    stubFetch(['mercury', 'venus', 'juno'], (name) => {
      if (name === 'mercury') return 'network'; // transport : reprenable
      if (name === 'venus') return 503; // serveur indisponible : reprenable
      return 404; // absent du déploiement : jamais reprenable
    });

    const service = await HorizonsEphemerisService.load(
      'https://example.test/assets/ephemerides/manifest.json',
      {},
      { retryDelaysMs: [] }
    );

    const missing = new Map(service.report.missing.map((m) => [m.body, m]));
    expect(missing.get('mercury')!.retryable).toBe(true);
    expect(missing.get('mercury')!.reason).toContain('Failed to fetch');
    expect(missing.get('venus')!.retryable).toBe(true);
    expect(missing.get('venus')!.reason).toContain('503');
    expect(missing.get('juno')!.retryable).toBe(false);
    expect(missing.get('juno')!.reason).toContain('404');
    expect(service.report.retryable).toBe(true);
  });

  /**
   * DÉFAUT TROUVÉ EN MESURANT, pas à la relecture. La première forme reprenait chaque FICHIER
   * selon le calendrier : avec 64 binaires tous coupés et six requêtes à la fois, cela ajoutait
   * 64 / 6 × 5 s, soit 53 s d'attente pure au démarrage (mesuré sur le build, service worker
   * bloqué : 85 s jusqu'au loader masqué, contre 24 s une fois la reprise portée sur le
   * PASSAGE). Le nombre de requêtes est le même ; c'est l'attente qui ne doit pas se multiplier.
   */
  it('waits once per pass, not once per missing file', async () => {
    const waits: number[] = [];
    const names = Array.from({ length: 30 }, (_, i) => `body${i}`);
    stubFetch(names, () => 'network');

    await HorizonsEphemerisService.load(
      'https://example.test/assets/ephemerides/manifest.json',
      {},
      {
        retryDelaysMs: [10, 40],
        wait: async (ms) => {
          waits.push(ms);
        },
      }
    );

    expect(waits).toEqual([10, 40]);
  });

  it('retries a transport failure on the declared schedule, and stops after it', async () => {
    const waits: number[] = [];
    const { calls } = stubFetch(['mercury'], (_name, attempt) =>
      attempt <= 2 ? 'network' : 'ok'
    );

    const service = await HorizonsEphemerisService.load(
      'https://example.test/assets/ephemerides/manifest.json',
      {},
      {
        retryDelaysMs: [10, 40],
        wait: async (ms) => {
          waits.push(ms);
        },
      }
    );

    expect(calls.get('mercury')).toBe(3);
    expect(waits).toEqual([10, 40]);
    expect(service.report.missing).toEqual([]);
    expect(service.getHeliocentricAU('mercury', DATE)).not.toBeNull();
  });

  it('never retries a deployment defect: a 404 costs exactly one request', async () => {
    const { calls } = stubFetch(['mercury'], () => 404);

    await HorizonsEphemerisService.load(
      'https://example.test/assets/ephemerides/manifest.json',
      {},
      { retryDelaysMs: [10, 40], wait: async () => undefined }
    );

    expect(calls.get('mercury')).toBe(1);
  });

  it('refuses bytes served at the wrong size, and does not retry them', async () => {
    vi.stubGlobal('window', {
      location: {
        href: 'https://example.test/assets/ephemerides/manifest.json',
        origin: 'https://example.test',
      },
    });
    let binaryCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const file = new URL(url.toString()).pathname.split('/').pop()!;
        if (file === 'manifest.json')
          return { ok: true, json: async () => manifestOf('mercury') };
        binaryCalls++;
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
      })
    );

    const service = await HorizonsEphemerisService.load(
      'https://example.test/assets/ephemerides/manifest.json',
      {},
      { retryDelaysMs: [10], wait: async () => undefined }
    );

    expect(binaryCalls).toBe(1);
    expect(service.report.missing[0].retryable).toBe(false);
    expect(service.report.missing[0].reason).toContain('expected 96');
  });

  /**
   * DÉFAUT TROUVÉ EN RELISANT MON PROPRE DIFF. Le passage se répète tant qu'UN échec est
   * reprenable, et il redemandait alors TOUT ce qui manquait, y compris les absences
   * définitives : un 404 mêlé à une panne de lien partait trois fois, alors que le contrat dit
   * qu'on ne le reprend jamais.
   */
  it('never asks again for a permanently missing file, even while retrying the others', async () => {
    const { calls } = stubFetch(['mercury', 'juno'], (name) =>
      name === 'juno' ? 404 : 'network'
    );

    const service = await HorizonsEphemerisService.load(
      'https://example.test/assets/ephemerides/manifest.json',
      {},
      { retryDelaysMs: [10, 40], wait: async () => undefined }
    );

    expect(calls.get('mercury')).toBe(3);
    expect(calls.get('juno')).toBe(1);
    // Il reste NOMMÉ comme manquant : ne plus le redemander n'est pas l'oublier.
    expect(service.report.missing.map((m) => m.body).sort()).toEqual([
      'juno',
      'mercury',
    ]);
    expect(
      service.report.missing.find((m) => m.body === 'juno')!.retryable
    ).toBe(false);
  });

  it('runs one load at a time, so a double click does not double the requests', async () => {
    let offline = true;
    const { calls } = stubFetch(['mercury'], () =>
      offline ? 'network' : 'ok'
    );

    const service = await HorizonsEphemerisService.load(
      'https://example.test/assets/ephemerides/manifest.json',
      {},
      { retryDelaysMs: [] }
    );
    expect(calls.get('mercury')).toBe(1);

    offline = false;
    await Promise.all([service.retryMissing(), service.retryMissing()]);
    expect(calls.get('mercury')).toBe(2);
  });

  it('retryMissing fills the gaps in place and tells the new state', async () => {
    let offline = true;
    stubFetch(['mercury', 'venus'], (name) =>
      name === 'mercury' || !offline ? 'ok' : 'network'
    );

    const service = await HorizonsEphemerisService.load(
      'https://example.test/assets/ephemerides/manifest.json',
      {},
      { retryDelaysMs: [] }
    );
    expect(service.getHeliocentricAU('venus', DATE)).toBeNull();

    const seen: number[] = [];
    service.onReportChange((report) => seen.push(report.missing.length));

    offline = false;
    const report = await service.retryMissing();

    expect(report.missing).toEqual([]);
    expect([...report.loaded].sort()).toEqual(['mercury', 'venus']);
    expect(service.getHeliocentricAU('venus', DATE)).not.toBeNull();
    expect(seen).toEqual([0]);
  });

  it('does not re-download a file it already has when retrying', async () => {
    let offline = true;
    const { calls } = stubFetch(['mercury', 'venus'], (name) =>
      name === 'mercury' || !offline ? 'ok' : 'network'
    );

    const service = await HorizonsEphemerisService.load(
      'https://example.test/assets/ephemerides/manifest.json',
      {},
      { retryDelaysMs: [] }
    );
    offline = false;
    await service.retryMissing();

    expect(calls.get('mercury')).toBe(1);
    expect(calls.get('venus')).toBe(2);
  });

  it('asks for at most the declared number of files at a time', async () => {
    const names = Array.from({ length: 20 }, (_, i) => `body${i}`);
    let inFlight = 0;
    let peak = 0;
    vi.stubGlobal('window', {
      location: {
        href: 'https://example.test/assets/ephemerides/manifest.json',
        origin: 'https://example.test',
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const file = new URL(url.toString()).pathname.split('/').pop()!;
        if (file === 'manifest.json')
          return { ok: true, json: async () => manifestOf(...names) };
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2));
        inFlight--;
        return { ok: true, arrayBuffer: async () => SAMPLES(1) };
      })
    );

    await HorizonsEphemerisService.load(
      'https://example.test/assets/ephemerides/manifest.json',
      {},
      { concurrency: 4 }
    );

    // 64 requêtes ouvertes ensemble sur un lien lent sont ce qui a tué 39 d'entre elles en
    // production : la borne est le correctif de CAUSE, pas de symptôme.
    expect(peak).toBe(4);
  });

  it('reports a complete load with nothing missing, so the notice stays silent', async () => {
    stubFetch(['mercury', 'venus'], () => 'ok');
    const service = await HorizonsEphemerisService.load(
      'https://example.test/assets/ephemerides/manifest.json'
    );
    expect(service.report).toEqual({
      declared: 2,
      manifestFailed: false,
      loaded: ['mercury', 'venus'],
      missing: [],
      retryable: false,
    });
  });
});
