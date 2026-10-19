import { describe, expect, it } from 'vitest';
import {
  resolvePresetCells,
  resolvePresetField,
  resolvePresetWeather,
} from './displayPreset';
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

describe('resolvePresetWeather', () => {
  const layers = [
    { id: 'clouds', initial: true },
    { id: 'precip', initial: false },
    { id: 'wind', initial: false },
  ];

  it("rend l'état de démarrage de chaque couche quand il n'y a pas de préréglage", () => {
    expect(resolvePresetWeather(undefined, layers)).toEqual([
      { id: 'clouds', on: true },
      { id: 'precip', on: false },
      { id: 'wind', on: false },
    ]);
  });

  it('allume et éteint ce que la fiche nomme, et ramène le reste au démarrage', () => {
    const preset = { weather: { on: ['precip'], off: ['clouds'] } };
    expect(resolvePresetWeather(preset, layers)).toEqual([
      { id: 'clouds', on: false },
      { id: 'precip', on: true },
      { id: 'wind', on: false },
    ]);
  });

  it("ne dépend pas du préréglage d'avant : une fiche sans météo remet le démarrage", () => {
    expect(resolvePresetWeather({ kinds: {} }, layers)).toEqual(
      resolvePresetWeather(undefined, layers)
    );
  });
});

describe('resolvePresetField', () => {
  const categories = ['main-belt', 'neo', 'comet', 'tno'];

  it('laisse toutes les catégories visibles sans préréglage', () => {
    expect(resolvePresetField(undefined, categories).every((c) => c.on)).toBe(true); // prettier-ignore
  });

  it('éteint les seules catégories nommées', () => {
    const out = resolvePresetField({ field: { neo: false, comet: false } }, categories); // prettier-ignore
    expect(out.filter((c) => !c.on).map((c) => c.id)).toEqual(['neo', 'comet']);
  });
});
