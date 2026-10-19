import { describe, expect, it } from 'vitest';
import { resolvePresetCells } from './displayPreset';
import { defaultDisplay } from '@/ui/defaultDisplay';

const base = { label: false, object: true, orbit: false };

describe('resolvePresetCells', () => {
  it('garde la règle de départ pour une case que le préréglage ne nomme pas', () => {
    const cells = resolvePresetCells(
      { kinds: { moon: { orbit: true } } },
      'io',
      'moon',
      base
    );
    expect(cells).toEqual({ label: false, object: true, orbit: true });
  });

  it("n'écarte rien pour une autre catégorie", () => {
    const cells = resolvePresetCells(
      { kinds: { moon: { orbit: true } } },
      'mars',
      'planet',
      base
    );
    expect(cells).toEqual(base);
  });

  it("laisse l'écart nommé pour un objet l'emporter sur celui de sa catégorie", () => {
    const preset = {
      kinds: { moon: { label: false, orbit: false } },
      bodies: { moon: { orbit: true } },
    };
    expect(resolvePresetCells(preset, 'moon', 'moon', base)).toEqual({
      label: false,
      object: true,
      orbit: true,
    });
    expect(resolvePresetCells(preset, 'io', 'moon', base).orbit).toBe(false);
  });

  it('part de la vraie règle du tableau', () => {
    const rule = defaultDisplay('voyager1', 'spacecraft');
    const cells = resolvePresetCells(
      { kinds: { spacecraft: { label: true, object: true, orbit: true } } },
      'voyager1',
      'spacecraft',
      rule
    );
    expect(rule).toEqual({ label: false, object: false, orbit: false });
    expect(cells).toEqual({ label: true, object: true, orbit: true });
  });
});
