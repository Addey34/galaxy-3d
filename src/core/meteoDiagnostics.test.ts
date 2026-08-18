import { describe, expect, it } from 'vitest';
import { describeMeteoGrid } from './meteoDiagnostics';

describe('describeMeteoGrid', () => {
  it('expose les bornes et le nombre de points sans modifier la grille', () => {
    expect(
      describeMeteoGrid({
        step: 4,
        latMin: -90,
        nLat: 46,
        nLon: 90,
      })
    ).toEqual({
      step: 4,
      latMin: -90,
      latMax: 90,
      nLat: 46,
      nLon: 90,
      sampleCount: 4140,
      longitudeSpan: 360,
    });
  });
});