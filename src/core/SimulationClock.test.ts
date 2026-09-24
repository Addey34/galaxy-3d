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

  it('holdAt fige la date SANS dette : la reprise ne rattrape pas l’attente', () => {
    // Lot 17, décision D3 : l'horloge attend ses octets. Si `holdAt` posait la date sans
    // ré-ancrer l'offset, la première synchronisation d'après rendrait d'un coup tout le
    // temps réel écoulé pendant l'attente, multiplié par la vitesse — à un an par seconde,
    // une attente d'une seconde ferait sauter la scène d'un an, c'est-à-dire exactement le
    // saut que ce lot interdit.
    const clock = new SimulationClock();
    clock.setTimeScale(31_557_600);
    const held = new Date('2030-01-01T00:00:00Z');

    // La borne est mesurée AVANT le gel : tout ce que la date a gagné doit s'expliquer par du
    // temps réel écoulé depuis, et par rien d'autre. Prendre le repère après le gel rendrait
    // la garde dépendante de l'ordonnanceur, donc non reproductible.
    const start = Date.now();
    clock.holdAt(held);
    expect(clock.date.getTime()).toBe(held.getTime());
    clock.syncToRealTime();
    const realElapsed = Date.now() - start;
    const drift = clock.date.getTime() - held.getTime();

    expect(drift).toBeGreaterThanOrEqual(0);
    expect(drift).toBeLessThanOrEqual(realElapsed * 31_557_600);
  });
});
