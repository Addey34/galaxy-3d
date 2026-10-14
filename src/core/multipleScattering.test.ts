import { describe, expect, it } from 'vitest';
import { skyScattering, zenithSkyLuminance } from './atmosphereScattering';
import {
  MULTIPLE_SCATTERING_LUT_SIZE,
  multipleScatteringTable,
  sampleMultipleScattering,
  sharedMultipleScatteringTable,
  transmittanceTable,
} from './multipleScattering';

const sky = skyScattering('bruneton-2017');
const table = sharedMultipleScatteringTable(sky);
const N = MULTIPLE_SCATTERING_LUT_SIZE;

/**
 * UNE RÉFÉRENCE CALCULÉE AUTREMENT : toute la sphère (pas de symétrie), une transmittance vers le
 * Soleil MARCHÉE à chaque point (pas de table), d'autres pas. Le canal vert d'une case.
 * 20 pas par marche : à 60 elle ne bouge que de 0,3 % au plus (mesuré sur les quatre cases) et
 * coûtait 11,3 s sur le coureur de la CI, au-delà des 5 s d'un test.
 */
function reference(h: number, muS: number): number {
  const g = sky.bottomRadiusKm;
  const top = g + sky.thicknessKm;
  const dens = (alt: number) => [
    Math.exp(-alt / sky.rayleighScaleHeightKm),
    Math.exp(-alt / sky.mieScaleHeightKm),
    Math.max(0, 1 - Math.abs(alt - sky.ozonePeakKm) / sky.ozoneHalfWidthKm),
  ];
  const ext = (d: number[]) =>
    sky.rayleighScatteringPerKm[1] * d[0]! +
    sky.mieExtinctionPerKm * d[1]! +
    sky.ozoneAbsorptionPerKm[1] * d[2]!;
  const scat = (d: number[]) =>
    sky.rayleighScatteringPerKm[1] * d[0]! + sky.mieScatteringPerKm * d[1]!;
  const sun = [Math.sqrt(1 - muS * muS), muS, 0];
  const exit = (p: number[], d: number[], radius: number) => {
    const b = p[0]! * d[0]! + p[1]! * d[1]! + p[2]! * d[2]!;
    const c = p[0]! ** 2 + p[1]! ** 2 + p[2]! ** 2 - radius * radius;
    const disc = b * b - c;
    return disc < 0 ? [-1, -1] : [-b - Math.sqrt(disc), -b + Math.sqrt(disc)];
  };
  const sunT = (p: number[]) => {
    if (exit(p, sun, g)[0]! > 0) return 0;
    const len = exit(p, sun, top)[1]!;
    let depth = 0;
    const steps = 20;
    for (let k = 0; k < steps; k += 1) {
      const t = ((k + 0.5) * len) / steps;
      const q = p.map((v, i) => v + sun[i]! * t);
      depth += ext(dens(Math.hypot(...q) - g)) * (len / steps);
    }
    return Math.exp(-depth);
  };
  const p0 = [0, g + h, 0];
  // 48 × 48 : convergé à 3 % près sur la case la plus lente (mesuré de 16 à 64).
  const n = 48;
  let L = 0;
  let f = 0;
  for (let a = 0; a < n; a += 1)
    for (let b = 0; b < n; b += 1) {
      const theta = (2 * Math.PI * (a + 0.5)) / n;
      const cp = 1 - (2 * (b + 0.5)) / n;
      const sp = Math.sqrt(1 - cp * cp);
      const d = [sp * Math.cos(theta), cp, sp * Math.sin(theta)];
      const ground = exit(p0, d, g);
      const hit = ground[0]! > 0;
      const len = hit ? ground[0]! : exit(p0, d, top)[1]!;
      const steps = 20;
      const ds = len / steps;
      let tr = 1;
      let l = 0;
      let ff = 0;
      for (let k = 0; k < steps; k += 1) {
        const t = (k + 0.5) * ds;
        const p = p0.map((v, i) => v + d[i]! * t);
        const de = dens(Math.hypot(...p) - g);
        const half = Math.exp(-ext(de) * ds * 0.5);
        tr *= half;
        l += (tr * sunT(p) * scat(de) * ds) / (4 * Math.PI);
        ff += tr * scat(de) * ds;
        tr *= half;
      }
      if (hit) {
        const q = p0.map((v, i) => v + d[i]! * len);
        const cs = (q[0]! * sun[0]! + q[1]! * sun[1]!) / Math.hypot(...q);
        l += (tr * sunT(q) * (Math.max(0, cs) * sky.groundAlbedo)) / Math.PI;
      }
      L += (l * 4 * Math.PI) / (n * n);
      f += (ff * 4 * Math.PI) / (n * n);
    }
  return L / (4 * Math.PI) / (1 - f / (4 * Math.PI));
}

describe('multiple scattering table', () => {
  it('is an RGBA table of N × N cells, finite and never negative', () => {
    expect(table).toHaveLength(N * N * 4);
    for (let i = 0; i < table.length; i += 1) {
      expect(Number.isFinite(table[i])).toBe(true);
      expect(table[i]).toBeGreaterThanOrEqual(0);
      if (i % 4 === 3) expect(table[i]).toBe(1);
    }
  });

  it('agrees with a reference computed another way, within 8 %', () => {
    for (const [row, col] of [
      [0, N - 1],
      [4, 20],
      [20, 16],
      [N - 1, 24],
    ] as const) {
      const h = ((row + 0.5) / N) * sky.thicknessKm;
      const muS = (2 * (col + 0.5)) / N - 1;
      const ours = table[(row * N + col) * 4 + 1]!;
      const ref = reference(h, muS);
      expect(
        Math.abs(ours / ref - 1),
        `h ${h.toFixed(1)} km, μs ${muS.toFixed(3)} : ${ours.toExponential(3)} contre ${ref.toExponential(3)}`
      ).toBeLessThan(0.08);
    }
  });

  it('grows with the height of the Sun, and vanishes in the deep night of the ground', () => {
    let previous = -1;
    for (const mu of [-0.1, 0, 0.2, 0.5, 1]) {
      const g = sampleMultipleScattering(table, sky, 1, mu)[1];
      expect(g).toBeGreaterThan(previous);
      previous = g;
    }
    expect(sampleMultipleScattering(table, sky, 0, -0.3)[1]).toBeLessThan(1e-9);
  });

  it('is blue-dominated at noon, as Rayleigh scattering is', () => {
    const [r, g, b] = sampleMultipleScattering(table, sky, 1, 1);
    expect(b).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(r);
  });

  it('is computed once per model', () => {
    expect(sharedMultipleScatteringTable(skyScattering('bruneton-2017'))).toBe(
      table
    );
    expect(multipleScatteringTable(sky)).not.toBe(table);
  });
});

describe('transmittance table', () => {
  it('matches Beer-Lambert straight up from the ground', () => {
    const t = transmittanceTable(sky).lookup(sky.bottomRadiusKm, 1, [0, 0, 0]);
    const H = sky.rayleighScaleHeightKm;
    const Hm = sky.mieScaleHeightKm;
    const top = sky.thicknessKm;
    // Profondeurs exactes : H(1 − e^{−60/H}), idem Mie, ozone en tente de 15 km de demi-base.
    const depth =
      sky.rayleighScatteringPerKm[1] * H * (1 - Math.exp(-top / H)) +
      sky.mieExtinctionPerKm * Hm * (1 - Math.exp(-top / Hm)) +
      sky.ozoneAbsorptionPerKm[1] * sky.ozoneHalfWidthKm;
    expect(t[1] / Math.exp(-depth)).toBeCloseTo(1, 2);
  });

  it('is zero along a line of sight that meets the ground', () => {
    expect(
      transmittanceTable(sky).lookup(sky.bottomRadiusKm + 1, -0.5, [1, 1, 1])
    ).toEqual([0, 0, 0]);
  });
});

describe('zenith luminance with multiple scattering', () => {
  const R = 6371;
  const psi = (h: number, mu: number) =>
    sampleMultipleScattering(table, sky, h, mu)[1];
  const lum = (elevationDeg: number, withMultiple: boolean) =>
    zenithSkyLuminance(
      sky,
      R,
      R,
      Math.sin((elevationDeg * Math.PI) / 180),
      2.5,
      undefined,
      withMultiple ? psi : undefined
    );

  it('brightens the daytime sky by about a quarter (measured: +26 % at 60°)', () => {
    const ratio = lum(60, true) / lum(60, false);
    expect(ratio).toBeGreaterThan(1.2);
    expect(ratio).toBeLessThan(1.35);
  });

  it('alone lights the zenith once the shadow of the Earth covers all the air above', () => {
    // Soleil à −8° : l'ombre monte au zénith jusqu'à R(1/cos 8° − 1) ≈ 62,6 km, plus que les
    // 60 km de l'air du modèle.
    expect(lum(-8, false)).toBe(0);
    expect(lum(-8, true)).toBeGreaterThan(0);
  });

  it('weighs more at twilight, when single scattering is in the shadow', () => {
    expect(lum(-4, true) / lum(-4, false)).toBeGreaterThan(
      lum(60, true) / lum(60, false)
    );
  });
});
