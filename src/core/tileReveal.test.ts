import { describe, expect, it } from 'vitest';
import { REVEAL_MAX_WAIT_MS, shouldReveal } from './tileReveal';

const base = { heldSinceMs: 1000, nowMs: 1100, missing: 12, inFlight: 12 };

describe('révélation groupée des carreaux', () => {
  it('retient le groupe tant qu’il manque des carreaux et qu’il en vient', () => {
    expect(shouldReveal(base)).toBe(false);
  });

  it('montre le groupe dès que l’ensemble voulu est posé', () => {
    expect(shouldReveal({ ...base, missing: 0 })).toBe(true);
  });

  it('montre le groupe quand plus rien n’est en vol (carreau en échec)', () => {
    expect(shouldReveal({ ...base, inFlight: 0 })).toBe(true);
  });

  it('ne retient jamais plus de REVEAL_MAX_WAIT_MS', () => {
    const at = (ms: number) =>
      shouldReveal({ ...base, nowMs: base.heldSinceMs + ms });
    expect(at(REVEAL_MAX_WAIT_MS - 1)).toBe(false);
    expect(at(REVEAL_MAX_WAIT_MS)).toBe(true);
  });
});
