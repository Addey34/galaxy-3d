import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { equatorialToScene } from './frames';
import {
  SpkKernel,
  etSecondsFromDate,
  subtractStates,
  zeroState,
} from './SpkKernel';
import type { SpkState, SpkSegmentDescriptor } from './SpkKernel';
import { SpkPositionReader } from './SpkPositionReader';

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1)
    view.setUint8(offset + index, value.charCodeAt(index));
}

function syntheticSpk(type: 2 | 3): ArrayBuffer {
  const recordSize = type === 2 ? 5 : 8;
  const values = new ArrayBuffer(4 * 1024);
  const file = new DataView(values);
  writeAscii(file, 0, 'DAF/SPK ');
  file.setInt32(8, 2, true);
  file.setInt32(12, 6, true);
  file.setInt32(76, 2, true);
  file.setInt32(80, 2, true);
  writeAscii(file, 88, 'LTL-IEEE');

  const summary = new DataView(values, 1024, 1024);
  summary.setFloat64(0, 0, true);
  summary.setFloat64(8, 0, true);
  summary.setFloat64(16, 1, true);
  const descriptor = 24;
  summary.setFloat64(descriptor, -86_400, true);
  summary.setFloat64(descriptor + 8, 86_400, true);
  summary.setInt32(descriptor + 16, 801, true);
  summary.setInt32(descriptor + 20, 899, true);
  summary.setInt32(descriptor + 24, 1, true);
  summary.setInt32(descriptor + 28, type, true);
  summary.setInt32(descriptor + 32, 385, true);
  summary.setInt32(descriptor + 36, 384 + recordSize + 4, true);
  writeAscii(new DataView(values, 2048, 1024), 0, 'synthetic Triton segment');

  const data = new DataView(values, 3072, 1024);
  data.setFloat64(0, 0, true);
  data.setFloat64(8, 86_400, true);
  data.setFloat64(16, 100, true);
  data.setFloat64(24, 200, true);
  data.setFloat64(32, 300, true);
  if (type === 3) {
    data.setFloat64(40, 0.1, true);
    data.setFloat64(48, 0.2, true);
    data.setFloat64(56, 0.3, true);
  }
  const metadata = recordSize * 8;
  data.setFloat64(metadata, -86_400, true);
  data.setFloat64(metadata + 8, 172_800, true);
  data.setFloat64(metadata + 16, recordSize, true);
  data.setFloat64(metadata + 24, 1, true);
  return values;
}

describe('SpkKernel', () => {
  it('parses a DAF/SPK type 3 segment and preserves velocity', () => {
    const kernel = SpkKernel.parse(syntheticSpk(3));
    const state = kernel.getState(801, 899, 0);

    expect(kernel.segments[0]).toMatchObject({
      target: 801,
      center: 899,
      frame: 1,
      type: 3,
      name: 'synthetic Triton segment',
    });
    expect(state?.positionKm).toEqual([100, 200, 300]);
    expect(state?.velocityKmPerSecond).toEqual([0.1, 0.2, 0.3]);
  });

  it('differentiates a type 2 position polynomial', () => {
    const kernel = SpkKernel.parse(syntheticSpk(2));
    const state = kernel.getState(801, 899, 43_200);

    expect(state?.positionKm).toEqual([100, 200, 300]);
    expect(state?.velocityKmPerSecond).toEqual([0, 0, 0]);
  });

  it('converts J2000 equatorial kilometers into Galaxy AU scene coordinates', () => {
    const reader = new SpkPositionReader(SpkKernel.parse(syntheticSpk(3)), {
      triton: 801,
      neptune: 899,
    });
    const result = reader.getPositionAU(
      'triton',
      'neptune',
      new Date('2000-01-01T12:00:00Z')
    );
    const expected = equatorialToScene(
      100 / 149_597_870.7,
      200 / 149_597_870.7,
      300 / 149_597_870.7
    );

    expect(result?.x).toBeCloseTo(expected.x, 15);
    expect(result?.y).toBeCloseTo(expected.y, 15);
    expect(result?.z).toBeCloseTo(expected.z, 15);
    expect(reader.getPositionAU('unknown', 'neptune', new Date())).toBeNull();
  });

  it('returns a zero state when target equals center', () => {
    const kernel = SpkKernel.parse(syntheticSpk(3));
    const state = kernel.getState(801, 801, 0);
    expect(state?.positionKm).toEqual([0, 0, 0]);
    expect(state?.velocityKmPerSecond).toEqual([0, 0, 0]);
  });

  it('subtractStates composes two states sharing a common center', () => {
    const a: SpkState = {
      positionKm: [1000, 2000, 3000],
      velocityKmPerSecond: [1, 2, 3],
      frame: 1,
    };
    const b: SpkState = {
      positionKm: [10, 20, 30],
      velocityKmPerSecond: [0.1, 0.2, 0.3],
      frame: 1,
    };
    const composed = subtractStates(a, b);
    expect(composed?.positionKm).toEqual([990, 1980, 2970]);
    expect(composed?.velocityKmPerSecond).toEqual([0.9, 1.8, 2.7]);
    // Référentiels incompatibles → null (pas de composition muette).
    expect(subtractStates(a, { ...b, frame: 17 })).toBeNull();
    expect(subtractStates(a, null)).toBeNull();
  });

  it('zeroState is the identity state', () => {
    expect(zeroState()).toEqual({
      positionKm: [0, 0, 0],
      velocityKmPerSecond: [0, 0, 0],
      frame: 1,
    });
    expect(zeroState(2).frame).toBe(2);
  });

  it('constructs a kernel from one ranged segment', () => {
    const full = syntheticSpk(3);
    const parsed = SpkKernel.parse(full);
    const descriptor = parsed.segments[0];
    const start = (descriptor.initialAddress - 1) * 8;
    const end = descriptor.finalAddress * 8;
    const ranged = SpkKernel.fromSegment(
      descriptor,
      full.slice(start, end),
      true
    );

    expect(ranged.getState(801, 899, 0)?.positionKm).toEqual([100, 200, 300]);
  });
});

/**
 * Test d'intégration sur le vrai kernel NASA `sat441l.bsp` (609 Mo, gitignoré) : valide la
 * composition via centre commun sur des données réelles. Ignoré si le fichier est absent
 * (CI, cloneurs sans le kernel staged) — voir docs/SPK_DEPLOYMENT.md.
 */
describe('SpkKernel — vrai kernel sat441l.bsp (si présent)', () => {
  const kernelPath = resolve(
    __dirname,
    '../../public/assets/kernels/sat441l.bsp'
  );
  const present = existsSync(kernelPath);
  const maybe = present ? it : it.skip;

  maybe(
    'compose des positions lunaires réelles relatives à Saturne (699)',
    () => {
      const buf = readFileSync(kernelPath);
      const ab = buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength
      );
      const kernel = SpkKernel.parse(ab);
      const et = etSecondsFromDate(new Date('2026-08-11T00:00:00Z'));
      const dist = (s: { positionKm: readonly number[] }): number =>
        Math.hypot(s.positionKm[0], s.positionKm[1], s.positionKm[2]);

      // Le kernel stocke moon←barycentre(6) et Saturne(699)←barycentre(6) :
      // getState(moon, 699) doit composer et rester dans la plage orbitale connue.
      const titan = kernel.getState(606, 699, et);
      expect(titan, 'Titan doit être résolu par composition').not.toBeNull();
      expect(dist(titan!)).toBeGreaterThan(1_100_000); // ~1.19–1.26 M km
      expect(dist(titan!)).toBeLessThan(1_300_000);

      const enceladus = kernel.getState(602, 699, et);
      expect(enceladus).not.toBeNull();
      expect(dist(enceladus!)).toBeGreaterThan(220_000); // ~238 000 km
      expect(dist(enceladus!)).toBeLessThan(260_000);

      // Identité.
      expect(kernel.getState(699, 699, et)?.positionKm).toEqual([0, 0, 0]);
    }
  );

  // Reproduit le chemin de PRODUCTION (mode HTTP Range du worker) : on ne charge QUE les
  // deux segments nécessaires par tranche d'octets, on compose, et on vérifie l'égalité
  // exacte avec le kernel entier. Garantit que le déploiement Range résout bien les lunes.
  maybe('mode Range : composition par segment == kernel entier', () => {
    const buf = readFileSync(kernelPath);
    const ab = buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength
    );
    const full = SpkKernel.parse(ab);
    const et = etSecondsFromDate(new Date('2026-08-11T00:00:00Z'));

    // Descripteurs directs (moon←6 et Saturne←6) tels que le worker les trouverait.
    const descOf = (target: number, center: number): SpkSegmentDescriptor => {
      const d = full.segments.find(
        (s) =>
          s.target === target &&
          s.center === center &&
          et >= s.startEtSeconds &&
          et <= s.endEtSeconds &&
          (s.type === 2 || s.type === 3)
      );
      if (!d) throw new Error(`segment ${target}<-${center} introuvable`);
      return d;
    };
    // Charge un segment isolé par "range" d'octets (comme loadSegment via fetchRange).
    const loadRanged = (d: SpkSegmentDescriptor): SpkKernel => {
      const start = (d.initialAddress - 1) * 8;
      const end = d.finalAddress * 8;
      return SpkKernel.fromSegment(d, ab.slice(start, end), true);
    };

    const titanSeg = descOf(606, 6);
    const saturnSeg = descOf(699, 6);
    const ranged = subtractStates(
      loadRanged(titanSeg).getState(606, 6, et),
      loadRanged(saturnSeg).getState(699, 6, et)
    );
    const whole = full.getState(606, 699, et);
    expect(ranged).not.toBeNull();
    expect(ranged!.positionKm).toEqual(whole!.positionKm);
    expect(ranged!.velocityKmPerSecond).toEqual(whole!.velocityKmPerSecond);
  });
});
