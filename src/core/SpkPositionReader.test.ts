import { describe, expect, it } from 'vitest';
import { SpkPositionReader } from './SpkPositionReader';
import { equatorialToScene } from './frames';
import type { SpkKernel, SpkState } from './SpkKernel';

/** Stub minimal : renvoie un état fixe (km) pour une paire target/center donnée. */
function stubKernel(states: Record<string, SpkState | null>): SpkKernel {
  return {
    getState: (target: number, center: number) =>
      states[`${target}<-${center}`] ?? null,
  } as unknown as SpkKernel;
}

const BODY_IDS = { earth: 399, sun: 10, mars: 499 } as const;
const AU_KM = 149_597_870.7;

describe('SpkPositionReader', () => {
  it('returns the zero vector when target === center', () => {
    const reader = new SpkPositionReader(stubKernel({}), BODY_IDS);
    const p = reader.getPositionAU('earth', 'earth', new Date());
    expect(p?.x).toBe(0);
    expect(p?.y).toBe(0);
    expect(p?.z).toBe(0);
  });

  it('returns null for a body missing from the id table', () => {
    const reader = new SpkPositionReader(stubKernel({}), BODY_IDS);
    expect(reader.getPositionAU('pluto', 'sun', new Date())).toBeNull();
  });

  it('returns null when the kernel has no segment for the pair', () => {
    const reader = new SpkPositionReader(stubKernel({}), BODY_IDS);
    expect(reader.getPositionAU('earth', 'sun', new Date())).toBeNull();
  });

  it('returns null on a non-J2000 frame instead of silently mis-projecting', () => {
    const reader = new SpkPositionReader(
      stubKernel({
        '399<-10': {
          positionKm: [AU_KM, 0, 0],
          velocityKmPerSecond: [0, 0, 0],
          frame: 2, // != J2000_FRAME (1)
        },
      }),
      BODY_IDS
    );
    expect(reader.getPositionAU('earth', 'sun', new Date())).toBeNull();
  });

  it('converts a km state to AU and routes it through the same scene mapping as frames.ts', () => {
    const positionKm: readonly [number, number, number] = [
      AU_KM * 0.9,
      AU_KM * 0.2,
      AU_KM * 0.05,
    ];
    const reader = new SpkPositionReader(
      stubKernel({
        '499<-10': {
          positionKm,
          velocityKmPerSecond: [0, 0, 0],
          frame: 1,
        },
      }),
      BODY_IDS
    );
    const p = reader.getPositionAU('mars', 'sun', new Date());
    const expected = equatorialToScene(0.9, 0.2, 0.05);
    expect(p).not.toBeNull();
    expect(p!.x).toBeCloseTo(expected.x, 9);
    expect(p!.y).toBeCloseTo(expected.y, 9);
    expect(p!.z).toBeCloseTo(expected.z, 9);
  });
});
