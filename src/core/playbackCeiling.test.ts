import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { flattenBodies } from '@/config/catalog';
import { bodyDynamics } from '@/config/gravity';
import { HorizonsEphemerisService } from './HorizonsEphemerisService';
import { EPHEMERIDES_DIR, horizonsManifest } from './horizonsTestFixture';
import { MAX_SIMULATION_SCALE } from '@/ui/speedSlider';
import { bytesPerSimulatedDay, sustainableTimeScale } from './playbackBudget';

/**
 * LE PLAFOND DE VITESSE VIENT D'UN DÉBIT RÉELLEMENT MESURÉ (phase 17D, § 9b option (c)).
 *
 * Les deux modules purs sont gardés ailleurs (`playbackBudget.test.ts`,
 * `transferRate.test.ts`). Ce fichier exerce le CHEMIN DE PRODUCTION : le service charge ses
 * fenêtres depuis les binaires réellement livrés, à travers son propre `fetch` et son propre
 * en-tête `Range`, et ce qu'il a compté en chemin doit être ce que l'hôte a servi. Un compteur
 * branché au mauvais endroit rendrait un débit crédible et faux, et c'est exactement le genre
 * de défaut qu'une relecture ne voit pas.
 *
 * L'horloge est INJECTÉE : sans cela le test mesurerait la machine, et il serait vert ou rouge
 * selon la charge du disque.
 */
const MANIFEST_URL = 'https://example.test/assets/ephemerides/manifest.json';
const MS_PER_CALL = 10;

/** Une date que tous les corps couvrent, et une où les sondes n'existent pas encore. */
const TODAY = new Date('2026-09-23T00:00:00Z');
const BEFORE_SPACECRAFT = new Date('1969-07-20T00:00:00Z');

const PERIODS: Record<string, number> = {};
for (const [name, cfg] of flattenBodies(CELESTIAL_CONFIG)) {
  const period = cfg.realData?.orbitPeriodDays;
  if (period !== undefined && period > 0) PERIODS[name] = period;
}

const fileCache = new Map<string, Buffer>();
function fileOf(name: string): Buffer {
  let file = fileCache.get(name);
  if (!file) {
    file = readFileSync(EPHEMERIDES_DIR + horizonsManifest.bodies[name].file);
    fileCache.set(name, file);
  }
  return file;
}

function bodyOfUrl(url: string): string {
  const file = url.split('/').pop() ?? '';
  const found = Object.entries(horizonsManifest.bodies).find(
    ([, entry]) => entry.file === file
  );
  if (!found) throw new Error('fichier inconnu du manifeste : ' + file);
  return found[0];
}

interface Served {
  body: string;
  bytes: number;
}

/**
 * Un hôte qui honore `Range` comme Firebase (vérifié en production le 2026-09-24 : 206,
 * `Content-Range: bytes 0-95/880992`), et une horloge qui avance de 10 ms par appel.
 */
function stubServer(log: Served[]): void {
  const server = async (
    input: unknown,
    init?: RequestInit
  ): Promise<unknown> => {
    const url = String(input);
    if (url.endsWith('manifest.json'))
      return { ok: true, json: async () => horizonsManifest };
    const body = bodyOfUrl(url);
    const file = fileOf(body);
    const header = (init?.headers as Record<string, string> | undefined)?.[
      'Range'
    ];
    const match = header ? /^bytes=([0-9]+)-([0-9]+)$/.exec(header) : null;
    const start = match ? Number(match[1]) : 0;
    const end = match
      ? Math.min(Number(match[2]), file.byteLength - 1)
      : file.byteLength - 1;
    const view = file.subarray(start, end + 1);
    log.push({ body, bytes: view.byteLength });
    return {
      ok: true,
      status: match ? 206 : 200,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'content-range' && match
            ? 'bytes ' + start + '-' + end + '/' + file.byteLength
            : null,
      },
      arrayBuffer: async () =>
        view.buffer.slice(
          view.byteOffset,
          view.byteOffset + view.byteLength
        ) as ArrayBuffer,
    };
  };
  vi.stubGlobal('window', {
    location: { href: 'https://example.test/', origin: 'https://example.test' },
  });
  vi.stubGlobal('fetch', server as unknown as typeof fetch);
}

/**
 * Une seule requête à la fois, et une horloge qui avance de 10 ms à chaque lecture : le temps
 * OCCUPÉ vaut alors exactement 10 ms par requête, donc le débit attendu est calculable à la
 * main et le test n'a rien à supposer.
 */
async function loadMetered(
  date: Date,
  log: Served[]
): Promise<HorizonsEphemerisService> {
  stubServer(log);
  let tick = 0;
  return HorizonsEphemerisService.load(
    MANIFEST_URL,
    bodyDynamics(CELESTIAL_CONFIG),
    {
      scene: { date, leadDays: 0, orbitPeriodDays: PERIODS },
      retryDelaysMs: [],
      concurrency: 1,
      now: () => (tick += MS_PER_CALL),
    }
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('le débit mesuré par le service (phase 17D)', () => {
  it("compte les octets que l'hôte a SERVIS, sur le temps occupé", async () => {
    const log: Served[] = [];
    const service = await loadMetered(TODAY, log);
    const served = log.reduce((sum, entry) => sum + entry.bytes, 0);
    // 10 ms de temps occupé par requête, par construction de l'horloge injectée.
    const expected = (served * 1_000) / (log.length * MS_PER_CALL);
    expect(service.observedBytesPerSecond).not.toBeNull();
    expect(service.observedBytesPerSecond!).toBeCloseTo(expected, 6);
    // Et ce n'est pas un compteur vide qui passerait par chance : la fenêtre de démarrage pèse
    // moins d'un mégaoctet pour des fichiers qui totalisent 38 Mo.
    expect(served).toBeGreaterThan(100_000);
    expect(served).toBeLessThan(2_000_000);
  });

  it('ne compte PAS un corps hors couverture, qui ne fait aucune requête', async () => {
    const log: Served[] = [];
    const service = await loadMetered(BEFORE_SPACECRAFT, log);
    const bodies = Object.keys(horizonsManifest.bodies).length;
    // Les sondes n'existent pas en 1969 : elles sont inscrites sans la moindre requête.
    expect(log.length).toBeLessThan(bodies);
    const served = log.reduce((sum, entry) => sum + entry.bytes, 0);
    const expected = (served * 1_000) / (log.length * MS_PER_CALL);
    // Si ces corps entraient dans la mesure, le temps occupé serait plus grand et le débit
    // plus petit : le lien passerait pour lent à cause de requêtes qui n'ont jamais existé.
    expect(service.observedBytesPerSecond!).toBeCloseTo(expected, 6);
  });

  it('le budget ne compte que les corps que la date fait demander', async () => {
    const log: Served[] = [];
    const service = await loadMetered(TODAY, log);
    const today = service.budgetGrids(TODAY);
    const then = service.budgetGrids(BEFORE_SPACECRAFT);
    // 62 sur 64 au 2026-09-23, et c'est la mesure qui l'a dit, pas moi : Cassini et Rosetta
    // sont des missions CLOSES, leur couverture s'arrête avant cette date. Elles ne demandent
    // donc aucun octet et n'ont rien à faire dans le budget.
    expect(Object.keys(horizonsManifest.bodies).length).toBe(64);
    expect(today.length).toBe(62);
    expect(then.length).toBeLessThan(today.length);
    expect(bytesPerSimulatedDay(then)).toBeLessThan(
      bytesPerSimulatedDay(today)
    );
  });

  it('un débit mesuré haut ne plafonne rien, un lien à 2 Mbit/s plafonne', async () => {
    const log: Served[] = [];
    const service = await loadMetered(TODAY, log);
    const grids = service.budgetGrids(TODAY);
    const budget = {
      perSimulatedDay: bytesPerSimulatedDay(grids),
      bodyCount: grids.length,
      maxTimeScale: MAX_SIMULATION_SCALE,
    };
    // Le débit du test est celui d'un disque local : il n'a aucune raison de plafonner.
    expect(
      sustainableTimeScale({
        bytesPerSecond: service.observedBytesPerSecond,
        ...budget,
      })
    ).toBeNull();
    // Et le même budget, sur un lien à 2 Mbit/s, plafonne sous la vitesse maximale.
    const slow = sustainableTimeScale({ bytesPerSecond: 250_000, ...budget });
    expect(slow).not.toBeNull();
    expect(slow!).toBeLessThan(MAX_SIMULATION_SCALE);
  });
});
