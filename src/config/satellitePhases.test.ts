import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { HorizonsEphemerisService } from '@/core/HorizonsEphemerisService';
import {
  deriveSatellitePhases,
  hillRadiusAU,
  type PhaseCandidate,
} from '@/core/satellitePhases';
import { placeInstrument, spacecraftPlacer } from '@/core/instrumentPlacement';
import { scaleToScene } from '@/core/overlayScale';
import { gravitationalParameter } from '@/core/twoBodyPropagation';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { educationalSurfaceClampAU } from '@/core/educationalScale';
import { bodyDynamics } from '@/config/gravity';
import { SPACECRAFT_MISSIONS } from '@/config/spacecraft';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EPHEMERIS_DIR = join(ROOT, 'public/assets/ephemerides');
const REGISTRY_DIR = join(ROOT, 'src/registry/spacecraft');
const WRITE = process.env['GALAXY_WRITE_SATELLITE_PHASES'] === '1';
const DAY_MS = 86_400_000;

/**
 * LES PHASES DE SATELLITE DES SONDES SONT DÉRIVÉES DES FICHIERS LIVRÉS, JAMAIS SAISIES.
 *
 * Ce test recalcule, depuis les binaires Horizons commités, les phases que chaque fiche
 * `src/registry/spacecraft/*.json` déclare dans `satelliteOf`, et échoue au moindre écart.
 * `pnpm spacecraft:phases` (qui pose `GALAXY_WRITE_SATELLITE_PHASES=1`) réécrit les fiches à
 * partir de la même dérivation : régénérer un binaire de sonde sans relancer cette commande
 * rougit ici, nommément.
 */
describe('phases de satellite des sondes', () => {
  let service: HorizonsEphemerisService;
  let manifest: {
    bodies: Record<
      string,
      { startJdTdb: number; stepDays: number; sampleCount: number }
    >;
  };

  beforeAll(async () => {
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
        if (path.endsWith('.json'))
          return {
            ok: true,
            json: async () => JSON.parse(bytes.toString('utf8')),
          };
        const buffer = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        );
        return { ok: true, arrayBuffer: async () => buffer };
      })
    );
    service = await HorizonsEphemerisService.load(
      'https://example.test/assets/ephemerides/manifest.json',
      bodyDynamics(CELESTIAL_CONFIG)
    );
    manifest = JSON.parse(
      readFileSync(join(EPHEMERIS_DIR, 'manifest.json'), 'utf8')
    );
  });
  afterAll(() => vi.unstubAllGlobals());

  /** Corps héliocentriques massifs qui ont un fichier : les seuls repères possibles. */
  const candidates = (): PhaseCandidate[] =>
    Object.entries(CELESTIAL_CONFIG.bodies)
      .filter(
        ([name, cfg]) =>
          cfg.kind !== 'star' &&
          cfg.kind !== 'skybox' &&
          cfg.frame !== 'parentRelative' &&
          (cfg.realData?.massKg ?? 0) > 0 &&
          manifest.bodies[name] !== undefined
      )
      .map(([name, cfg]) => ({
        name,
        mu: gravitationalParameter(cfg.realData!.massKg!),
        position: (date: Date) => service.getHeliocentricAU(name, date),
        surfaceClampAU: educationalSurfaceClampAU(cfg),
      }));

  const coverageMs = (name: string): [number, number] => {
    const entry = manifest.bodies[name]!;
    const from = (entry.startJdTdb - 2440587.5) * DAY_MS;
    return [from, from + entry.stepDays * (entry.sampleCount - 1) * DAY_MS];
  };

  const iso = (ms: number): string =>
    new Date(ms).toISOString().replace('.000Z', 'Z');

  it('chaque fiche déclare exactement les phases que ses fichiers donnent', () => {
    const all = candidates();
    // Borne qui porte l'intention : sans candidats, toutes les fiches vides passeraient.
    expect(all.map((c) => c.name)).toEqual(
      expect.arrayContaining(['earth', 'jupiter', 'saturn', 'mercury', 'bennu'])
    );
    const mismatches: string[] = [];
    for (const mission of SPACECRAFT_MISSIONS) {
      const [from, to] = coverageMs(mission.name);
      const derived = deriveSatellitePhases(
        (date) => service.getHeliocentricAU(mission.name, date),
        all,
        from,
        to
      );
      const expected = derived.map((p) => ({
        body: p.body,
        from: iso(p.fromMs),
        to: iso(p.toMs),
      }));
      const declared = mission.satelliteOf.map((p) => ({
        body: p.body,
        from: iso(p.fromMs),
        to: iso(p.toMs),
      }));
      if (JSON.stringify(expected) === JSON.stringify(declared)) continue;
      mismatches.push(
        `${mission.name} : déclaré ${JSON.stringify(declared)}, dérivé ${JSON.stringify(expected)}`
      );
      if (WRITE) {
        const path = join(REGISTRY_DIR, `${mission.name}.json`);
        const record = JSON.parse(readFileSync(path, 'utf8')) as Record<
          string,
          unknown
        >;
        const rebuilt: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(record)) {
          if (key === 'satelliteOf') continue;
          if (key === 'coverage' && expected.length > 0)
            rebuilt['satelliteOf'] = expected;
          rebuilt[key] = value;
        }
        writeFileSync(path, `${JSON.stringify(rebuilt, null, 2)}\n`);
      }
    }
    expect(mismatches).toEqual([]);
  }, 120_000);

  it('les sondes qui ont orbité un corps du catalogue en ont bien une phase', () => {
    // Les mises en orbite publiées, à la journée près de ce que les fichiers donnent :
    // insertion de Juno achevée le 2016-07-05 à 03 h 53 UTC (publiée au 4 juillet, heure de
    // Californie), de Cassini le 2004-07-01 ; JWST ne quitte jamais la
    // Terre ; OSIRIS-REx arrive à Bennu le 2018-12-03 et Hayabusa2 à Ryugu le 2018-06-27 (dans
    // leur sphère de Hill dès le 2018-12-01 et le 2018-06-22).
    const phase = (name: string) =>
      SPACECRAFT_MISSIONS.find((m) => m.name === name)!.satelliteOf.map(
        (p) => `${p.body} ${iso(p.fromMs).slice(0, 10)}`
      );
    expect(phase('juno')).toEqual(['jupiter 2016-07-05']);
    expect(phase('cassini')).toEqual(['saturn 2004-07-01']);
    expect(phase('jwst')[0]).toMatch(/^earth 2021-12-2/);
    expect(phase('osiris-rex')).toEqual(['bennu 2018-12-01']);
    expect(phase('hayabusa2')).toEqual(['ryugu 2018-06-22']);
    // Un survol n'en donne pas : Voyager 1 passe à Jupiter et Saturne sans y orbiter.
    expect(phase('voyager1')).toEqual([]);
    expect(phase('voyager2')).toEqual([]);
    expect(phase('new-horizons')).toEqual([]);
  });

  it('pendant une phase, la sonde reste hors de la sphère Éducatif de son corps', () => {
    // Le défaut d'origine, mesuré au 2026-09-22 : JWST à 0,16 unité du centre de la Terre
    // (rayon 1), Juno dans Jupiter, BepiColombo dans Mercure. Échantillonné tous les deux jours.
    const inside: string[] = [];
    const out = new THREE.Vector3();
    for (const mission of SPACECRAFT_MISSIONS)
      for (const phase of mission.satelliteOf) {
        const parent = CELESTIAL_CONFIG.bodies[phase.body]!;
        for (let t = phase.fromMs; t <= phase.toMs; t += 2 * DAY_MS) {
          const date = new Date(t);
          const probe = service.getHeliocentricAU(mission.name, date)!;
          const parentAU = service.getHeliocentricAU(phase.body, date)!;
          placeInstrument(out, probe, { parent, parentHelioAU: parentAU }, 0);
          const center = scaleToScene(
            new THREE.Vector3(),
            parentAU.x,
            parentAU.y,
            parentAU.z,
            0
          );
          if (out.distanceTo(center) <= parent.radius)
            inside.push(`${mission.name} ${iso(t)}`);
        }
      }
    expect(inside).toEqual([]);
  }, 60_000);

  it('une phase reste au voisinage de son corps, et son entrée ne fait pas sauter la sonde au loin', () => {
    // Une phase va du premier au dernier jour lié : entre les deux, la sonde peut sortir un peu
    // de la sphère de Hill. Mesuré : JWST 1,16 rayon de Hill (halo autour de L2, qui est à un
    // rayon de Hill par définition), BepiColombo 1,25 (approche finale). Autour d'un astéroïde
    // dont la sphère de Hill tient sur la surface agrandie, la borne est cette surface même :
    // OSIRIS-REx s'éloigne à 51 rayons de Hill de Bennu (quelques milliers de kilomètres), et
    // reste posée à sa surface Éducatif, jusqu'à 5,9 millions de kilomètres.
    // Et le changement de repère fait sauter la sonde, une fois, à l'entrée et à la sortie :
    // du centre de la sphère agrandie (où la compression héliocentrique la cachait) à sa place
    // dans le système du corps. Mesuré : au plus 3,69 rayons Éducatif du corps (Juno au dernier
    // jour de son fichier), 3,54 pour BepiColombo à l'entrée, 2,20 aux bords des deux phases
    // autour d'astéroïdes. Un fondu continu entre les deux repères ramènerait l'écart de
    // dizaines d'unités décrit dans `core/satellitePhases.ts`.
    const report: string[] = [];
    const out = new THREE.Vector3();
    const before = new THREE.Vector3();
    for (const mission of SPACECRAFT_MISSIONS)
      for (const phase of mission.satelliteOf) {
        const parent = CELESTIAL_CONFIG.bodies[phase.body]!;
        const mu = gravitationalParameter(parent.realData!.massKg!);
        let worstHill = 0;
        for (let t = phase.fromMs; t <= phase.toMs; t += DAY_MS) {
          const date = new Date(t);
          const probe = service.getHeliocentricAU(mission.name, date)!;
          const parentAU = service.getHeliocentricAU(phase.body, date)!;
          worstHill = Math.max(
            worstHill,
            probe.distanceTo(parentAU) / hillRadiusAU(parentAU.length(), mu)
          );
        }
        const clampAU = educationalSurfaceClampAU(parent);
        let worstClamp = 0;
        for (let t = phase.fromMs; t <= phase.toMs; t += DAY_MS) {
          const date = new Date(t);
          worstClamp = Math.max(
            worstClamp,
            service
              .getHeliocentricAU(mission.name, date)!
              .distanceTo(service.getHeliocentricAU(phase.body, date)!) /
              clampAU
          );
        }
        if (worstHill > 2.1 && worstClamp > 1)
          report.push(
            `${mission.name}/${phase.body} Hill ${worstHill.toFixed(3)}`
          );
        for (const edge of [phase.fromMs, phase.toMs]) {
          const date = new Date(edge);
          const probe = service.getHeliocentricAU(mission.name, date);
          const parentAU = service.getHeliocentricAU(phase.body, date);
          if (!probe || !parentAU) continue;
          placeInstrument(before, probe, null, 0);
          placeInstrument(out, probe, { parent, parentHelioAU: parentAU }, 0);
          const jump = out.distanceTo(before) / parent.radius;
          if (jump > 4)
            report.push(
              `${mission.name}/${phase.body} ${iso(edge)} saut ${jump.toFixed(2)} rayons`
            );
        }
      }
    expect(report).toEqual([]);
  }, 60_000);

  it('au 2026-09-22, le placeur que l’application câble sort JWST, Juno et BepiColombo de leur corps', () => {
    // Le constat de l'utilisateur, mesuré avant correction : JWST à 0,16 unité du centre de la
    // Terre (rayon 1), Juno à 0,56 du centre de Jupiter (rayon 4), BepiColombo à 0,19 du centre
    // de Mercure (rayon 0,38). BepiColombo n'est liée à Mercure que le 2026-10-13 : elle y reste
    // ce jour-là, et le test le dit plutôt que de l'omettre.
    const date = new Date('2026-09-22T00:00:00Z');
    const place = spacecraftPlacer(
      SPACECRAFT_MISSIONS,
      CELESTIAL_CONFIG.bodies,
      (name, d) => service.getHeliocentricAU(name, d)
    );
    const distance = (probe: string, body: string): number => {
      const parent = service.getHeliocentricAU(body, date)!;
      const out = place(
        new THREE.Vector3(),
        probe,
        service.getHeliocentricAU(probe, date)!,
        date,
        0
      );
      return (
        out.distanceTo(
          scaleToScene(new THREE.Vector3(), parent.x, parent.y, parent.z, 0)
        ) / CELESTIAL_CONFIG.bodies[body]!.radius
      );
    };
    expect(distance('jwst', 'earth')).toBeGreaterThan(1);
    expect(distance('juno', 'jupiter')).toBeGreaterThan(1);
    expect(distance('bepicolombo', 'mercury')).toBeLessThan(1);
  });
});
