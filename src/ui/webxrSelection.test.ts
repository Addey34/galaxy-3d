import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { computeTeleportTarget } from './webxrSelection';

describe('computeTeleportTarget', () => {
  it('lands at viewDistance from the body, along the player-to-body approach direction', () => {
    const bodyPos = new THREE.Vector3(10, 0, 0);
    const playerOffset = new THREE.Vector3(0, 0, 0); // le joueur regarde le corps depuis -X
    const target = computeTeleportTarget(bodyPos, 3, playerOffset);

    expect(target.distanceTo(bodyPos)).toBeCloseTo(3);
    // Le joueur reste du même côté (approche depuis -X) plutôt que de traverser le corps.
    expect(target.x).toBeLessThan(bodyPos.x);
  });

  it('falls back to an arbitrary direction when the player is already at the body', () => {
    const bodyPos = new THREE.Vector3(5, 5, 5);
    const target = computeTeleportTarget(bodyPos, 2, bodyPos.clone());

    expect(target.distanceTo(bodyPos)).toBeCloseTo(2);
    expect(Number.isFinite(target.x)).toBe(true);
  });

  it('scales with the given viewDistance', () => {
    const bodyPos = new THREE.Vector3(0, 0, 0);
    const playerOffset = new THREE.Vector3(0, 0, 10);
    const near = computeTeleportTarget(bodyPos, 1, playerOffset);
    const far = computeTeleportTarget(bodyPos, 5, playerOffset);

    expect(near.distanceTo(bodyPos)).toBeCloseTo(1);
    expect(far.distanceTo(bodyPos)).toBeCloseTo(5);
  });
});
