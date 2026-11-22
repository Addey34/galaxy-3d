import { describe, expect, it } from 'vitest';
import { maskElements, restoreElements } from './stellarMask';

function fake(initial: Record<string, string> = {}) {
  const attrs = new Map(Object.entries(initial));
  return {
    attrs,
    hasAttribute: (n: string) => attrs.has(n),
    getAttribute: (n: string) => attrs.get(n) ?? null,
    setAttribute: (n: string, v: string) => void attrs.set(n, v),
    removeAttribute: (n: string) => void attrs.delete(n),
  };
}

describe('masquage de la scène solaire', () => {
  it('masque tout, puis rétablit l’état initial de chaque élément', () => {
    const interactive = fake();
    const alreadyInert = fake({ inert: '' });
    const masked = maskElements([interactive, alreadyInert]);
    for (const e of [interactive, alreadyInert]) {
      expect(e.attrs.has('data-stellar-hidden')).toBe(true);
      expect(e.attrs.has('inert')).toBe(true);
    }
    restoreElements(masked);
    expect(interactive.attrs.has('inert')).toBe(false);
    expect(interactive.attrs.has('data-stellar-hidden')).toBe(false);
    expect(alreadyInert.attrs.get('inert')).toBe('');
    expect(alreadyInert.attrs.has('data-stellar-hidden')).toBe(false);
  });

  it('rend la valeur d’origine de l’attribut inert', () => {
    const e = fake({ inert: 'true' });
    restoreElements(maskElements([e]));
    expect(e.attrs.get('inert')).toBe('true');
  });
});
