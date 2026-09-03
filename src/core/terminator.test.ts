import { describe, expect, it } from 'vitest';
import {
  ASTRONOMICAL_TWILIGHT_DOT,
  CIVIL_TWILIGHT_DOT,
  TERMINATOR_GLSL,
  TERMINATOR_WRAP_ATMOSPHERE,
  TERMINATOR_WRAP_ATMOSPHERE_SHELL,
  TERMINATOR_WRAP_CLOUDS,
  TERMINATOR_WRAP_STORM,
  TERMINATOR_WRAP_VACUUM,
  terminatorDay,
  terminatorLight,
  terminatorNight,
  twilightWrapAtAltitude,
} from './terminator';

const sinDeg = (deg: number): number => Math.sin((deg * Math.PI) / 180);

describe('terminator constants', () => {
  it('expresses every width as the sine of a real twilight angle', () => {
    // Le point du module : aucune de ces valeurs n'est réglée à l'œil. Si l'une d'elles
    // devient un nombre arbitraire, c'est le retour au problème d'origine (six couches,
    // six conventions, des bandes visibles au terminateur).
    expect(ASTRONOMICAL_TWILIGHT_DOT).toBeCloseTo(sinDeg(18), 12);
    expect(CIVIL_TWILIGHT_DOT).toBeCloseTo(sinDeg(6), 12);
    expect(TERMINATOR_WRAP_ATMOSPHERE).toBe(ASTRONOMICAL_TWILIGHT_DOT);
  });

  it('keeps an airless body visibly sharper than one with an atmosphere', () => {
    // Physique : sans diffusion, pas de crépuscule. Le wrap non nul de la Lune est un
    // adoucissement assumé, il doit rester nettement plus serré que celui de la Terre.
    expect(TERMINATOR_WRAP_VACUUM).toBeLessThan(TERMINATOR_WRAP_ATMOSPHERE / 2);
  });
});

describe('twilightWrapAtAltitude', () => {
  it('widens the twilight with altitude, from the real horizon dip', () => {
    // Un point à l'altitude h voit le Soleil jusqu'à acos( R / (R+h) ) sous l'horizon du
    // sol. C'est ce qui fait que les nuages rougeoient quand le sol est déjà dans l'ombre.
    const ground = twilightWrapAtAltitude(0);
    expect(ground).toBeCloseTo(TERMINATOR_WRAP_ATMOSPHERE, 12);
    expect(TERMINATOR_WRAP_CLOUDS).toBeGreaterThan(ground);
    expect(TERMINATOR_WRAP_STORM).toBeGreaterThan(TERMINATOR_WRAP_CLOUDS);
    expect(TERMINATOR_WRAP_ATMOSPHERE_SHELL).toBeGreaterThan(
      TERMINATOR_WRAP_STORM
    );
  });

  it('matches the closed-form horizon dip, not a fudge factor', () => {
    // ~10 km au-dessus d'une Terre de 6371 km : l'horizon s'abaisse d'environ 3.2°.
    const dipDeg = (Math.acos(6371 / (6371 + 10)) * 180) / Math.PI;
    expect(dipDeg).toBeCloseTo(3.22, 1);
    expect(TERMINATOR_WRAP_CLOUDS).toBeCloseTo(
      TERMINATOR_WRAP_ATMOSPHERE + sinDeg(dipDeg),
      10
    );
  });

  it('never returns a narrower width than the ground for a negative altitude', () => {
    expect(twilightWrapAtAltitude(-100)).toBeCloseTo(
      TERMINATOR_WRAP_ATMOSPHERE,
      12
    );
  });
});

describe('terminatorLight (direct illumination of a lit surface)', () => {
  const w = TERMINATOR_WRAP_ATMOSPHERE;

  it('leaves the lit side as exact Lambert', () => {
    // Le wrap linéaire précédent surexposait TOUT le disque (+11 % à raw = 0.5) : le jour
    // était délavé. Au-delà de +w la courbe doit rendre le dot brut, à l'identique.
    for (const raw of [w, 0.5, 0.75, 1])
      expect(terminatorLight(raw, w)).toBeCloseTo(raw, 12);
  });

  it('reaches zero with a zero slope, not a hard edge', () => {
    // La cause du « noir d'un coup » : le wrap linéaire touchait 0 avec une pente non
    // nulle → cassure de dérivée = arête franche. Ici l'extinction est tangente.
    expect(terminatorLight(-w, w)).toBe(0);
    const eps = 1e-4;
    const slopeNearEnd = (terminatorLight(-w + eps, w) - 0) / eps;
    const slopeMidBand =
      (terminatorLight(-w / 2 + eps, w) - terminatorLight(-w / 2, w)) / eps;
    expect(slopeNearEnd).toBeLessThan(0.01);
    expect(slopeMidBand).toBeGreaterThan(slopeNearEnd * 10);
  });

  it('stays continuous and monotonic across the whole band', () => {
    let previous = -1;
    for (let raw = -1; raw <= 1.0001; raw += 0.005) {
      const value = terminatorLight(raw, w);
      expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = value;
    }
  });

  it('joins the Lambert branch tangentially (C1, no visible crease)', () => {
    // wrap·s² − raw = wrap·(s−1)² ≥ 0, nul seulement en s = 1 : le max lui-même est C1.
    // Sans ça, le raccord anguleux se verrait comme une ligne claire au bord du jour.
    const eps = 1e-5;
    const before = (terminatorLight(w, w) - terminatorLight(w - eps, w)) / eps;
    const after = (terminatorLight(w + eps, w) - terminatorLight(w, w)) / eps;
    expect(before).toBeCloseTo(after, 3);
    expect(after).toBeCloseTo(1, 3);
  });

  it('keeps the geometric terminator dim enough not to flood the night side', () => {
    // Le garde-fou qui rend l'élargissement à 18° sûr : un wrap LINÉAIRE éclairerait la
    // bande à w/(1+w) ≈ 0.237. La queue quadratique ne donne que w/4.
    expect(terminatorLight(0, w)).toBeCloseTo(w / 4, 12);
    expect(terminatorLight(0, w)).toBeLessThan(w / (1 + w) / 3);
  });
});

describe('terminatorDay (day fraction of an overlaid layer)', () => {
  it('shares its extinction point with terminatorLight for the same width', () => {
    // C'EST le point qui aligne les couches : à largeur égale, calque et surface
    // s'éteignent au même instant. Toute divergence ici ramène les bandes visibles.
    for (const w of [TERMINATOR_WRAP_VACUUM, TERMINATOR_WRAP_ATMOSPHERE, 0.5]) {
      expect(terminatorDay(-w, w)).toBe(0);
      expect(terminatorLight(-w, w)).toBe(0);
      expect(terminatorDay(w, w)).toBeCloseTo(1, 12);
    }
  });

  it('is flat at both ends (smootherstep, not smoothstep)', () => {
    // Dérivée seconde nulle aux deux bornes : le raccord avec les paliers plats est
    // imperceptible. Un smoothstep cubique laisse un coude visible en début de rampe.
    const w = TERMINATOR_WRAP_ATMOSPHERE;
    const eps = 1e-3;
    expect(terminatorDay(-w + eps, w)).toBeLessThan(1e-4);
    expect(1 - terminatorDay(w - eps, w)).toBeLessThan(1e-4);
    expect(terminatorDay(0, w)).toBeCloseTo(0.5, 12);
  });

  it('keeps a high-altitude layer lit after the ground below it goes dark', () => {
    // Le résultat observable de tout ce module : à l'instant où le sol s'éteint
    // (dot = -TERMINATOR_WRAP_ATMOSPHERE), les nuages et les sommets d'orage sont
    // encore éclairés, et le halo atmosphérique plus encore.
    const groundOut = -TERMINATOR_WRAP_ATMOSPHERE;
    expect(terminatorLight(groundOut, TERMINATOR_WRAP_ATMOSPHERE)).toBe(0);
    const clouds = terminatorDay(groundOut, TERMINATOR_WRAP_CLOUDS);
    const storm = terminatorDay(groundOut, TERMINATOR_WRAP_STORM);
    const shell = terminatorDay(groundOut, TERMINATOR_WRAP_ATMOSPHERE_SHELL);
    expect(clouds).toBeGreaterThan(0);
    expect(storm).toBeGreaterThan(clouds);
    expect(shell).toBeGreaterThan(storm);
  });
});

describe('terminatorNight (layers that appear at night)', () => {
  it('starts exactly at sunset and never bleeds onto the day side', () => {
    // La crainte qui avait fait reculer le seuil à -0.12 (~27 min de retard) : au-dessus
    // du seuil le clamp force 0 EXACTEMENT, quel que soit le seuil.
    const onset = 0;
    const ramp = CIVIL_TWILIGHT_DOT;
    for (const raw of [1, 0.5, 0.2, 0.05, 1e-6])
      expect(terminatorNight(raw, onset, ramp)).toBe(0);
    expect(terminatorNight(onset, onset, ramp)).toBe(0);
    expect(terminatorNight(-ramp, onset, ramp)).toBeCloseTo(1, 12);
    expect(terminatorNight(-1, onset, ramp)).toBe(1);
  });

  it('rises monotonically through the ramp', () => {
    let previous = -1;
    for (let raw = 0.2; raw >= -0.5; raw -= 0.005) {
      const value = terminatorNight(raw, 0, CIVIL_TWILIGHT_DOT);
      expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = value;
    }
  });

  it('overlaps the surface twilight instead of switching over', () => {
    // Au crépuscule les deux coexistent réellement : sol encore faiblement éclairé ET
    // villes allumées. Les lumières atteignent leur plein régime (6°) bien avant que le
    // sol ne s'éteigne (18°) — aucune des deux couches ne saute.
    const lightsFullAt = -CIVIL_TWILIGHT_DOT;
    expect(lightsFullAt).toBeGreaterThan(-TERMINATOR_WRAP_ATMOSPHERE);
    expect(
      terminatorLight(lightsFullAt, TERMINATOR_WRAP_ATMOSPHERE)
    ).toBeGreaterThan(0);
  });
});

describe('GLSL mirror', () => {
  // Le GLSL ne peut pas être exécuté hors d'un contexte WebGL : la seule protection réelle
  // est l'adjacence dans le fichier. Ces assertions attrapent au moins une suppression ou
  // un renommage accidentel, et le glissement le plus probable — une borne ou un
  // coefficient édité d'un seul côté.
  it('declares the three shared functions', () => {
    for (const signature of [
      'float terminatorLight( float raw, float wrap )',
      'float terminatorDay( float raw, float wrap )',
      'float terminatorNight( float raw, float onset, float rampWidth )',
    ])
      expect(TERMINATOR_GLSL).toContain(signature);
  });

  it('keeps the same coefficients as the JS mirror', () => {
    expect(TERMINATOR_GLSL).toContain('t * ( t * 6.0 - 15.0 ) + 10.0');
    expect(TERMINATOR_GLSL).toContain('( raw + wrap ) / ( 2.0 * wrap )');
    expect(TERMINATOR_GLSL).toContain('max( raw, wrap * s * s )');
    expect(TERMINATOR_GLSL).toContain('( raw - onset ) / -rampWidth');
  });
});
