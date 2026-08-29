import { describe, expect, it } from 'vitest';
import { applyDeadzone, stepSnapTurn, SNAP_TURN_DEG } from './webxrLocomotion';

describe('applyDeadzone', () => {
  it('zeroes out axes below the threshold', () => {
    expect(applyDeadzone(0.05, 0.05, 0.15)).toEqual({ x: 0, y: 0 });
  });

  it('passes through axes at or above the threshold', () => {
    expect(applyDeadzone(0.5, -0.2, 0.15)).toEqual({ x: 0.5, y: -0.2 });
  });
});

describe('stepSnapTurn', () => {
  it('does nothing while the axis is within the deadzone', () => {
    const result = stepSnapTurn(0.05, true);
    expect(result).toEqual({ yawDeltaRad: 0, armed: true });
  });

  it('turns once when crossing the deadzone while armed', () => {
    const result = stepSnapTurn(0.8, true);
    expect(result.armed).toBe(false);
    expect(result.yawDeltaRad).toBeCloseTo(
      (SNAP_TURN_DEG * Math.PI) / 180
    );
  });

  it('turns the other way for a negative axis', () => {
    const result = stepSnapTurn(-0.8, true);
    expect(result.yawDeltaRad).toBeCloseTo(
      -(SNAP_TURN_DEG * Math.PI) / 180
    );
  });

  it('does not repeat while held past the deadzone (not re-armed)', () => {
    const result = stepSnapTurn(0.8, false);
    expect(result).toEqual({ yawDeltaRad: 0, armed: false });
  });

  it('re-arms once the axis returns inside the deadzone', () => {
    const held = stepSnapTurn(0.8, false);
    expect(held.armed).toBe(false);
    const released = stepSnapTurn(0.05, held.armed);
    expect(released.armed).toBe(true);
  });
});
