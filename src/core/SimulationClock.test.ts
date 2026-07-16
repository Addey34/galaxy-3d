import { describe, expect, it } from 'vitest';
import { SimulationClock } from './SimulationClock';

const MS_PER_DAY = 86_400_000;

describe('SimulationClock', () => {
  it('starts at the present with no offset', () => {
    const clock = new SimulationClock();
    clock.syncToRealTime();
    expect(Math.abs(clock.date.getTime() - Date.now())).toBeLessThan(1_000);
    expect(clock.offsetDays).toBeCloseTo(0, 3);
    expect(clock.timeScale).toBe(1);
  });

  it('addDays shifts the simulated date forward by whole days', () => {
    const clock = new SimulationClock();
    const before = clock.date.getTime();
    clock.addDays(3);
    expect(clock.offsetDays).toBeCloseTo(3, 2);
    expect(clock.date.getTime() - before).toBeCloseTo(3 * MS_PER_DAY, -3);
  });

  it('addHours accumulates into the offset', () => {
    const clock = new SimulationClock();
    clock.addHours(12);
    expect(clock.offsetDays).toBeCloseTo(0.5, 2);
  });

  it('resetOffset returns to the present', () => {
    const clock = new SimulationClock();
    clock.addDays(10);
    clock.resetOffset();
    expect(clock.offsetDays).toBeCloseTo(0, 3);
  });

  it('setTimeScale changes speed without jumping the date', () => {
    const clock = new SimulationClock();
    clock.addDays(2);
    const dateBefore = clock.date.getTime();
    clock.setTimeScale(3600);
    expect(clock.timeScale).toBe(3600);
    // La date simulée reste au même instant à la bascule (pas de saut).
    expect(Math.abs(clock.date.getTime() - dateBefore)).toBeLessThan(1_000);
  });
});
