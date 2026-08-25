import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorizonsEphemerisService } from './HorizonsEphemerisService';
import {
  isPlausibleHeliocentricPosition,
  isPlausibleRelativePosition,
} from './OrbitalMechanics';
import { allBodies } from '@/config/catalog';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { SMALL_BODIES } from '@/config/smallBodies';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EPHEMERIS_DIR = join(PROJECT_ROOT, 'public/assets/ephemerides');

/**
 * Régression pour un bug réel : `scripts/generate-horizons-ephemerides.mjs` demandait certains
 * corps avec un COMMAND se terminant par ';' (ex. '699;' pour Saturne). Ce suffixe force
 * Horizons à chercher dans la base des PETITS corps plutôt que la table des corps majeurs — et
 * '699;' matchait silencieusement l'astéroïde "699 Hela" au lieu de Saturne. La requête HTTP
 * réussissait, la réponse était un CSV valide et bien formé : rien ne plantait, rien ne
 * loggait une erreur. Le seul signal était une position fausse. Douze corps étaient touchés :
 * Saturne, Mars, Neptune, Pluton, Encelade, Rhéa, Titan, Japet, Phobos, Déimos, Triton, Charon.
 *
 * Ce test charge le VRAI manifeste et les VRAIS binaires committés (offline, via un fetch
 * simulé qui lit le disque) et vérifie que chaque position échantillonnée reste dans la
 * fenêtre de plausibilité que `OrbitalMechanics` applique lui-même à l'exécution — donc que
 * la donnée committée est correcte, pas seulement que le pipeline ne plante pas.
 */
describe('committed Horizons ephemerides stay within plausible bounds', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('every heliocentric and parent-relative sample matches its catalogue body', async () => {
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

    const manifest = JSON.parse(
      readFileSync(join(EPHEMERIS_DIR, 'manifest.json'), 'utf8')
    ) as { bodies: Record<string, { startJdTdb: number; stepDays: number; sampleCount: number }> };

    const catalogueBodies = new Map(
      [
        ...allBodies(CELESTIAL_CONFIG),
        ...allBodies({ bodies: SMALL_BODIES }),
      ].map((b) => [b.name, b] as const)
    );

    // Milieu de la couverture (les extrémités interpolent avec un seul voisin, hors-sujet ici).
    const JD_TO_MS = 86_400_000;
    const JD_UNIX_EPOCH = 2_440_587.5;

    for (const [name, body] of Object.entries(manifest.bodies)) {
      const catalogueBody = catalogueBodies.get(name);
      if (!catalogueBody) continue; // Petits corps du dataset SBDB, hors catalogue nommé.

      const midJd =
        body.startJdTdb + (body.stepDays * (body.sampleCount - 2)) / 2;
      const date = new Date((midJd - JD_UNIX_EPOCH) * JD_TO_MS);

      if (catalogueBody.config.frame === 'parentRelative') {
        if (!catalogueBody.parentName) continue;
        const relative = service.getParentRelativeAU(name, catalogueBody.parentName, date);
        expect(relative, `${name}: no sample at mid-coverage date`).not.toBeNull();
        expect(
          isPlausibleRelativePosition(relative!, catalogueBody.config),
          `${name}: relative position ${relative!.toArray()} (magnitude ${relative!.length().toFixed(6)} AU) implausible for its published orbital elements — wrong Horizons target?`
        ).toBe(true);
      } else {
        const helio = service.getHeliocentricAU(name, date);
        expect(helio, `${name}: no sample at mid-coverage date`).not.toBeNull();
        expect(
          isPlausibleHeliocentricPosition(helio!, catalogueBody.config),
          `${name}: heliocentric distance ${helio!.length().toFixed(3)} AU implausible vs realData.distanceAU — wrong Horizons target?`
        ).toBe(true);
      }
    }
  });
});
