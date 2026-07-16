import { describe, expect, it } from 'vitest';
import { Body, GeoVector } from 'astronomy-engine';
import { EphemerisService } from './EphemerisService';
import { equatorialToScene } from './frames';

const eph = new EphemerisService();
const date = new Date('2026-07-16T12:00:00Z');

describe('EphemerisService.getParentRelativeAU', () => {
  it('reproduit le géocentrique pour la Lune (parent = Terre)', () => {
    const rel = eph.getParentRelativeAU(Body.Moon, Body.Earth, date);
    const geo = GeoVector(Body.Moon, date, false);
    const expected = equatorialToScene(geo.x, geo.y, geo.z);
    expect(rel.x).toBeCloseTo(expected.x, 10);
    expect(rel.y).toBeCloseTo(expected.y, 10);
    expect(rel.z).toBeCloseTo(expected.z, 10);
  });

  it('est antisymétrique : rel(a,b) = -rel(b,a)', () => {
    const ab = eph.getParentRelativeAU(Body.Moon, Body.Earth, date);
    const ba = eph.getParentRelativeAU(Body.Earth, Body.Moon, date);
    expect(ab.x).toBeCloseTo(-ba.x, 10);
    expect(ab.y).toBeCloseTo(-ba.y, 10);
    expect(ab.z).toBeCloseTo(-ba.z, 10);
  });
});
