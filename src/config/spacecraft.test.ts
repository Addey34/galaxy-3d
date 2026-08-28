import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorizonsEphemerisService } from '@/core/HorizonsEphemerisService';
import { SPACECRAFT_MISSIONS } from './spacecraft';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EPHEMERIS_DIR = join(PROJECT_ROOT, 'public/assets/ephemerides');

interface ManifestBody {
  center?: string;
  startJdTdb: number;
  stepDays: number;
  sampleCount: number;
}

const manifest = JSON.parse(
  readFileSync(join(EPHEMERIS_DIR, 'manifest.json'), 'utf8')
) as { bodies: Record<string, ManifestBody> };

describe('SPACECRAFT_MISSIONS ↔ ephemerides manifest', () => {
  it.each(SPACECRAFT_MISSIONS.map((m) => m.name))(
    'manifest has a heliocentric entry for "%s"',
    (name) => {
      const entry = manifest.bodies[name];
      expect(entry, `${name}: missing from manifest.json`).toBeDefined();
      expect(entry.center, `${name}.center in manifest.json`).toBe('sun');
    }
  );
});

/**
 * Charge le VRAI manifeste + binaires committés (offline, `fetch` simulé lisant le disque —
 * même pattern que `core/ephemerisPlausibility.test.ts`) et vérifie deux invariants métier :
 * une sonde a une position plausible en milieu de couverture, et n'en a AUCUNE avant son
 * lancement (`getHeliocentricAU` renvoie `null` hors couverture — cf. HorizonsEphemerisService).
 */
describe('spacecraft ephemerides stay within plausible bounds', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('every mission has a plausible heliocentric position mid-coverage, and none before launch', async () => {
    vi.stubGlobal('window', {
      location: {
        href: 'https://example.test/assets/ephemerides/manifest.json',
        origin: 'https://example.test',
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const path = new URL(url.toString()).pathname.split('/').pop()!;
        const bytes = readFileSync(join(EPHEMERIS_DIR, path));
        if (path.endsWith('.json')) {
          return { ok: true, json: async () => JSON.parse(bytes.toString('utf8')) };
        }
        const buffer = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        );
        return { ok: true, arrayBuffer: async () => buffer };
      })
    );

    const service = await HorizonsEphemerisService.load(
      'https://example.test/assets/ephemerides/manifest.json'
    );

    const JD_TO_MS = 86_400_000;
    const JD_UNIX_EPOCH = 2_440_587.5;

    for (const mission of SPACECRAFT_MISSIONS) {
      const entry = manifest.bodies[mission.name];
      const midJd =
        entry.startJdTdb + (entry.stepDays * (entry.sampleCount - 2)) / 2;
      const midDate = new Date((midJd - JD_UNIX_EPOCH) * JD_TO_MS);

      const helio = service.getHeliocentricAU(mission.name, midDate);
      expect(helio, `${mission.name}: no sample at mid-coverage date`).not.toBeNull();
      const distanceAU = helio!.length();
      // Bornes larges : Parker plonge sous l'orbite de Mercure, Voyager 1 dépasse 150 UA.
      expect(
        distanceAU,
        `${mission.name}: implausible heliocentric distance ${distanceAU.toFixed(3)} AU`
      ).toBeGreaterThan(0.05);
      expect(
        distanceAU,
        `${mission.name}: implausible heliocentric distance ${distanceAU.toFixed(3)} AU`
      ).toBeLessThan(250);

      const beforeLaunch = service.getHeliocentricAU(
        mission.name,
        new Date('1970-01-01T00:00:00Z')
      );
      expect(
        beforeLaunch,
        `${mission.name}: should have no position before launch`
      ).toBeNull();
    }
  });
});
