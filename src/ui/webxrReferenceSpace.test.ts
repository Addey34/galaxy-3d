import { beforeAll, describe, expect, it } from 'vitest';
import { computeOffsetReferenceSpace, createPlayerState } from './webxrReferenceSpace';

/**
 * `XRRigidTransform` est une API navigateur, absente de l'environnement Node de Vitest
 * (`vite.config.ts` : `environment: 'node'`). Stub minimal fidèle à la vraie forme (position/
 * orientation en lecture seule) — suffisant pour les assertions, aucun comportement WebXR réel
 * requis ici.
 */
beforeAll(() => {
  (globalThis as { XRRigidTransform?: unknown }).XRRigidTransform = class {
    position: { x: number; y: number; z: number; w: number };
    orientation: { x: number; y: number; z: number; w: number };
    constructor(
      position: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
      orientation: { x: number; y: number; z: number; w: number } = {
        x: 0,
        y: 0,
        z: 0,
        w: 1,
      }
    ) {
      this.position = { ...position, w: 1 };
      this.orientation = orientation;
    }
  };
});

/** Faux XRReferenceSpace : enregistre le transform reçu au lieu de vraiment décaler quoi que ce soit. */
function fakeBaseSpace(): {
  space: XRReferenceSpace;
  lastTransform: () => XRRigidTransform | undefined;
} {
  let received: XRRigidTransform | undefined;
  const space = {
    getOffsetReferenceSpace: (t: XRRigidTransform) => {
      received = t;
      return space;
    },
  } as unknown as XRReferenceSpace;
  return { space, lastTransform: () => received };
}

describe('computeOffsetReferenceSpace', () => {
  it('offsets by the inverse of the player position', () => {
    const { space, lastTransform } = fakeBaseSpace();
    const state = createPlayerState();
    state.offset.set(5, 0, -3);

    computeOffsetReferenceSpace(space, state);
    const t = lastTransform()!;
    expect(t.position.x).toBeCloseTo(-5);
    expect(t.position.y).toBeCloseTo(0);
    expect(t.position.z).toBeCloseTo(3);
  });

  it('encodes yaw as a quaternion rotation around the Y axis', () => {
    const { space, lastTransform } = fakeBaseSpace();
    const state = createPlayerState();
    state.yaw = Math.PI / 2;

    computeOffsetReferenceSpace(space, state);
    const t = lastTransform()!;
    // Rotation autour de Y seul : composantes X/Z du quaternion nulles.
    expect(t.orientation.x).toBeCloseTo(0);
    expect(t.orientation.z).toBeCloseTo(0);
    expect(t.orientation.y).toBeCloseTo(Math.sin(Math.PI / 4));
    expect(t.orientation.w).toBeCloseTo(Math.cos(Math.PI / 4));
  });

  it('returns identity-ish transform for the default (zero) player state', () => {
    const { space, lastTransform } = fakeBaseSpace();
    const state = createPlayerState();

    computeOffsetReferenceSpace(space, state);
    const t = lastTransform()!;
    expect(t.position.x).toBeCloseTo(0);
    expect(t.position.y).toBeCloseTo(0);
    expect(t.position.z).toBeCloseTo(0);
    expect(t.orientation.w).toBeCloseTo(1);
  });
});
