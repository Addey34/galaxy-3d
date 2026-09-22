import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorizonsEphemerisService } from './HorizonsEphemerisService';
import {
  isPlausibleHeliocentricPosition,
  isPlausibleRelativePosition,
} from './ephemerisPlausibility';
import { allBodies } from '@/config/catalog';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { SMALL_BODIES } from '@/config/smallBodies';
import { bodyDynamics } from '@/config/gravity';
import * as THREE from 'three';

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
          return {
            ok: true,
            json: async () => JSON.parse(bytes.toString('utf8')),
          };
        }
        const buffer = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        );
        return { ok: true, arrayBuffer: async () => buffer };
      })
    );

    // Même table de dynamique qu'en production. Sans elle, un satellite plus rapide que le pas est
    // interpolé par une cubique, qui ne signifie rien : au lot 12, Déimos (1,26 jour) au pas de
    // 8 jours ressortait à 215 000 km de Mars à la date testée, alors que le chemin réel le place
    // à 10 km de Horizons. Au pas de 4 jours, la même erreur passait par hasard.
    const service = await HorizonsEphemerisService.load(
      'https://example.test/assets/ephemerides/manifest.json',
      bodyDynamics(CELESTIAL_CONFIG)
    );

    const manifest = JSON.parse(
      readFileSync(join(EPHEMERIS_DIR, 'manifest.json'), 'utf8')
    ) as {
      bodies: Record<
        string,
        { startJdTdb: number; stepDays: number; sampleCount: number }
      >;
    };

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
        const relative = service.getParentRelativeAU(
          name,
          catalogueBody.parentName,
          date
        );
        expect(
          relative,
          `${name}: no sample at mid-coverage date`
        ).not.toBeNull();
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

/**
 * Le garde-fou attrape-t-il une position qui s'EFFONDRE vers la planete ?
 *
 * `isPlausibleRelativePosition` ne verifiait qu'une borne SUPERIEURE. Une source ramenant un
 * satellite trop PRES de sa planete passait donc sans etre vue, et c'est exactement ce qui
 * est arrive : l'interpolation cubique d'un binaire sous-echantillonne faisait varier la
 * distance Encelade-Saturne d'un facteur 11,4, tres en dessous du periastre, sans jamais
 * declencher le repli. Le garde-fou existait, ne regardait que dans une direction, et a
 * laisse passer precisement le defaut qu'il etait cense attraper. Verifie : en retirant
 * l'interpolation dynamique, Encelade retombe a 4,28e-4 UA et la borne basse le rejette.
 *
 * Deux assertions complementaires, et la seconde compte autant que la premiere : une
 * position effondree DOIT etre rejetee, et aucune position reelle des binaires livres ne
 * doit l'etre. Un garde-fou trop serre serait pire que pas de garde-fou du tout, puisqu'il
 * enverrait des donnees correctes sur le repli.
 */
describe('borne basse de plausibilite relative', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const satelliteWithElements = [...allBodies(CELESTIAL_CONFIG)].find(
    ({ config }) => config.relativeOrbitalElements !== undefined
  );

  it('rejette une position effondree vers la planete', () => {
    expect(satelliteWithElements).toBeDefined();
    const config = satelliteWithElements!.config;
    const elements = config.relativeOrbitalElements!;
    const periapsis = elements.semiMajorAxisAU * (1 - elements.eccentricity);

    // Un dixieme du periastre : l'ordre de grandeur reellement observe sur Encelade.
    expect(
      isPlausibleRelativePosition(
        new THREE.Vector3(periapsis / 10, 0, 0),
        config
      )
    ).toBe(false);
    // La position nominale, elle, reste acceptee.
    expect(
      isPlausibleRelativePosition(
        new THREE.Vector3(elements.semiMajorAxisAU, 0, 0),
        config
      )
    ).toBe(true);
  });

  it('accepte toutes les positions reelles sur toute la couverture des binaires', async () => {
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
          return {
            ok: true,
            json: async () => JSON.parse(bytes.toString('utf8')),
          };
        }
        const buffer = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        );
        return { ok: true, arrayBuffer: async () => buffer };
      })
    );

    // Meme configuration qu'en production : sans la table de dynamique, le service
    // retomberait sur l'interpolation cubique et produirait justement les positions
    // effondrees que la borne basse rejette desormais.
    const service = await HorizonsEphemerisService.load(
      'https://example.test/assets/ephemerides/manifest.json',
      bodyDynamics(CELESTIAL_CONFIG)
    );

    const manifest = JSON.parse(
      readFileSync(join(EPHEMERIS_DIR, 'manifest.json'), 'utf8')
    ) as {
      bodies: Record<
        string,
        { startJdTdb: number; stepDays: number; sampleCount: number }
      >;
    };
    const catalogueBodies = new Map(
      [...allBodies(CELESTIAL_CONFIG)].map((b) => [b.name, b] as const)
    );

    const JD_TO_MS = 86_400_000;
    const JD_UNIX_EPOCH = 2_440_587.5;
    let checked = 0;

    for (const [name, body] of Object.entries(manifest.bodies)) {
      const entry = catalogueBodies.get(name);
      if (!entry?.parentName) continue;
      if (entry.config.frame !== 'parentRelative') continue;
      if (!entry.config.relativeOrbitalElements) continue;

      // 400 dates sur TOUTE la couverture, la ou le test precedent n'en regardait qu'une
      // seule au milieu : un defaut d'interpolation ne se manifeste pas partout.
      for (let i = 1; i < 400; i++) {
        const jd =
          body.startJdTdb + (body.stepDays * (body.sampleCount - 2) * i) / 400;
        const relative = service.getParentRelativeAU(
          name,
          entry.parentName,
          new Date((jd - JD_UNIX_EPOCH) * JD_TO_MS)
        );
        if (!relative) continue;
        checked++;
        expect(
          isPlausibleRelativePosition(relative, entry.config),
          `${name}: distance ${relative.length().toExponential(4)} UA hors bornes`
        ).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(5_000);
  });
});

/**
 * Même question pour la borne HÉLIOCENTRIQUE, qui n'était vérifiée qu'à la date du milieu de
 * chaque fichier. Elle bornait la distance par le demi-grand axe seul, ce qui ne vaut que
 * pour une orbite presque circulaire : un binaire exact de Sedna aurait été refusé à toutes
 * les dates, un de Halley autour de chaque périhélie (lot 11, mesuré sur les vecteurs Horizons
 * à un jour), et le corps renvoyé en silence sur ses éléments képlériens.
 */
describe('borne héliocentrique de plausibilité', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const catalogue = new Map(
    allBodies(CELESTIAL_CONFIG).map((b) => [b.name, b.config] as const)
  );

  it('borne un corps excentrique par son périhélie et son aphélie', () => {
    const halley = catalogue.get('halley')!;
    const sedna = catalogue.get('sedna')!;
    const q = (cfg: typeof halley) =>
      cfg.orbitalElements!.semiMajorAxisAU *
      (1 - cfg.orbitalElements!.eccentricity);

    // Au périhélie, et à la distance où se trouve Sedna au XXIe siècle.
    expect(
      isPlausibleHeliocentricPosition(
        new THREE.Vector3(q(halley), 0, 0),
        halley
      )
    ).toBe(true);
    expect(
      isPlausibleHeliocentricPosition(new THREE.Vector3(85, 0, 0), sedna)
    ).toBe(true);
    // Un dixième du périhélie reste refusé : la borne s'élargit, elle ne disparaît pas.
    expect(
      isPlausibleHeliocentricPosition(
        new THREE.Vector3(q(halley) / 10, 0, 0),
        halley
      )
    ).toBe(false);
  });

  it('accepte toutes les positions réelles des binaires héliocentriques', async () => {
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
          return {
            ok: true,
            json: async () => JSON.parse(bytes.toString('utf8')),
          };
        }
        const buffer = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        );
        return { ok: true, arrayBuffer: async () => buffer };
      })
    );
    const service = await HorizonsEphemerisService.load(
      'https://example.test/assets/ephemerides/manifest.json',
      bodyDynamics(CELESTIAL_CONFIG)
    );
    const manifest = JSON.parse(
      readFileSync(join(EPHEMERIS_DIR, 'manifest.json'), 'utf8')
    ) as {
      bodies: Record<
        string,
        { startJdTdb: number; stepDays: number; sampleCount: number }
      >;
    };

    const JD_TO_MS = 86_400_000;
    const JD_UNIX_EPOCH = 2_440_587.5;
    const bodies = new Set<string>();
    for (const [name, body] of Object.entries(manifest.bodies)) {
      const config = catalogue.get(name);
      if (!config || config.frame === 'parentRelative') continue;
      bodies.add(name);
      // Pas plus fin qu'un pas de Halley près du périhélie : 2 000 dates sur la couverture.
      for (let i = 1; i < 2_000; i++) {
        const jd =
          body.startJdTdb +
          (body.stepDays * (body.sampleCount - 2) * i) / 2_000;
        const helio = service.getHeliocentricAU(
          name,
          new Date((jd - JD_UNIX_EPOCH) * JD_TO_MS)
        );
        expect(helio, `${name}: pas d'échantillon`).not.toBeNull();
        expect(
          isPlausibleHeliocentricPosition(helio!, config),
          `${name}: ${helio!.length().toFixed(3)} UA refusé à JD ${jd.toFixed(1)}`
        ).toBe(true);
      }
    }
    // Les corps qui ont motivé la garde doivent y passer, sinon elle ne dit rien.
    expect(bodies).toContain('sedna');
    expect(bodies).toContain('halley');
  });
});
