import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { bodyDynamics, MEAN_MOTION_PROPAGATION } from '@/config/gravity';
import { HorizonsEphemerisService } from './HorizonsEphemerisService';
import {
  EPHEMERIDES_DIR,
  horizonsManifest,
  horizonsServiceFromDisk,
  type HorizonsManifestEntry,
} from './horizonsTestFixture';
import {
  MEAN_MOTION_SAMPLE_COUNT,
  medianMeanMotionScale,
} from './meanMotionScale';
import { planBodyWindow } from './ephemerisWindow';

const SCENE_DATE = new Date('2026-09-23T00:00:00Z');
const dynamics = bodyDynamics(CELESTIAL_CONFIG);

type PublishedEntry = HorizonsManifestEntry & { meanMotionScale?: number };
const entryOf = (name: string) =>
  horizonsManifest.bodies[name] as PublishedEntry;

function samplesOf(name: string): Float64Array {
  const file = readFileSync(EPHEMERIDES_DIR + entryOf(name).file);
  return new Float64Array(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
  );
}

/** Le service construit sur un corps, avec une entrée de manifeste choisie. */
function serviceWith(
  name: string,
  manifest: PublishedEntry,
  samples: Float64Array
): HorizonsEphemerisService {
  const loaded = new Map<string, unknown>([
    [name, { manifest, samples, dynamics: dynamics[name] }],
  ]);
  type Ctor = new (bodies: Map<string, unknown>) => HorizonsEphemerisService;
  return new (HorizonsEphemerisService as unknown as Ctor)(loaded);
}

describe('facteur d’échelle du temps de propagation, publié au manifeste', () => {
  it('est publié pour CHAQUE corps qui déclare la propagation au rythme moyen', () => {
    expect(MEAN_MOTION_PROPAGATION.size).toBeGreaterThan(0);
    for (const name of MEAN_MOTION_PROPAGATION) {
      const entry = entryOf(name);
      // Sans ce champ, le lecteur devrait recalculer le facteur sur le fichier ENTIER, ce
      // qu'un chargement par fenêtre ne lui permet plus (lot 17, décision D5).
      expect(entry, name).toBeDefined();
      expect(typeof entry.meanMotionScale, name).toBe('number');
      expect(entry.meanMotionScale, name).toBeGreaterThan(0);
    }
  });

  it('n’est publié pour AUCUN autre corps', () => {
    for (const [name, entry] of Object.entries(horizonsManifest.bodies)) {
      if (MEAN_MOTION_PROPAGATION.has(name)) continue;
      expect(
        (entry as PublishedEntry).meanMotionScale,
        `${name} porte un facteur orphelin`
      ).toBeUndefined();
    }
  });

  it('vaut EXACTEMENT ce que le binaire livré donne, au bit près', () => {
    // La confrontation qui rend le champ digne de confiance : il est DÉRIVÉ du fichier, et
    // un fichier régénéré sans relancer `pnpm ephemeris:meanmotion` rend ce test rouge.
    for (const name of MEAN_MOTION_PROPAGATION) {
      const entry = entryOf(name);
      const body = dynamics[name];
      expect(body?.periodDays, name).toBeDefined();
      const recomputed = medianMeanMotionScale(
        samplesOf(name),
        entry.sampleCount,
        body!.mu,
        body!.periodDays!
      );
      expect(entry.meanMotionScale, name).toBe(recomputed);
    }
  });

  it('prélève les DEUX extrémités du fichier, ce qu’une fenêtre ne peut pas offrir', () => {
    expect(MEAN_MOTION_SAMPLE_COUNT).toBe(257);
    // 256 intervalles sur `count - 1` : le dernier prélèvement est le dernier échantillon.
    const count = entryOf('enceladus').sampleCount;
    const lastPick = Math.floor(
      ((MEAN_MOTION_SAMPLE_COUNT - 1) * (count - 1)) /
        (MEAN_MOTION_SAMPLE_COUNT - 1)
    );
    expect(lastPick).toBe(count - 1);
  });

  it('change réellement la position : ce n’est pas un champ décoratif', () => {
    // Falsification intégrée : forcer le facteur à 1 doit DÉPLACER le corps. Sans elle, le
    // test précédent passerait encore si le lecteur cessait de lire le champ.
    for (const name of MEAN_MOTION_PROPAGATION) {
      const entry = entryOf(name);
      const samples = samplesOf(name);
      const withScale = serviceWith(name, entry, samples);
      const withoutScale = serviceWith(
        name,
        { ...entry, meanMotionScale: 1 },
        samples
      );
      const a = withScale.getHeliocentricAU(name, SCENE_DATE);
      const b = withoutScale.getHeliocentricAU(name, SCENE_DATE);
      expect(a, name).not.toBeNull();
      expect(b, name).not.toBeNull();
      expect(a!.distanceTo(b!), name).toBeGreaterThan(0);
    }
  });

  it('rend la fenêtre et le fichier entier IDENTIQUES sur ces sept corps', () => {
    // La raison d'être de la phase : avant la publication du facteur, Encelade sortait à
    // 27 mètres de sa vraie position dès que le service ne tenait qu'une fenêtre.
    const full = horizonsServiceFromDisk();
    for (const name of MEAN_MOTION_PROPAGATION) {
      const entry = entryOf(name);
      const window = planBodyWindow(
        {
          startJdTdb: entry.startJdTdb,
          stepDays: entry.stepDays,
          sampleCount: entry.sampleCount,
        },
        { date: SCENE_DATE }
      );
      expect(window, name).not.toBeNull();
      const file = readFileSync(EPHEMERIDES_DIR + entry.file);
      const slice = file.subarray(window!.byteStart, window!.byteEnd + 1);
      const windowed = serviceWith(
        name,
        {
          ...entry,
          startJdTdb: entry.startJdTdb + window!.firstIndex * entry.stepDays,
          sampleCount: window!.lastIndex - window!.firstIndex + 1,
        },
        new Float64Array(
          slice.buffer.slice(
            slice.byteOffset,
            slice.byteOffset + slice.byteLength
          )
        )
      );
      const expected = full.getHeliocentricAU(name, SCENE_DATE)!;
      const actual = windowed.getHeliocentricAU(name, SCENE_DATE);
      expect(actual, name).not.toBeNull();
      expect(actual!.x, name).toBe(expected.x);
      expect(actual!.y, name).toBe(expected.y);
      expect(actual!.z, name).toBe(expected.z);
    }
  });
});
