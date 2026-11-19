import * as THREE from 'three';
import { Body, GeoVector, MakeTime, RotationAxis } from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { DATED_ROTATION_BODIES } from '@/config/datedRotation';
import { OrbitalMechanics } from './OrbitalMechanics';
import { EphemerisService } from './EphemerisService';
import { primeMeridianEquatorial } from './bodyRotation';
import { localDirectionToGeographic } from './frames';
import { forEachBody } from '@/config/catalog';

/**
 * LA PHASE DE ROTATION DES CORPS À MODÈLE IAU (GAL-IMMERSION-001).
 *
 * Défaut mesuré : la Lune et Mars n'intégraient que `rotationSpeed · Δt` depuis le chargement,
 * donc tournaient au bon rythme d'une phase arbitraire. À l'instant de l'alunissage d'Apollo 11
 * le point subsolaire rendu était faux de 15,4° (63,6° quatre jours plus tard), et le site de la
 * mer de la Tranquillité passait côté nuit alors que le Soleil y était à 10,7° au-dessus de
 * l'horizon. La référence ci-dessous n'emprunte rien au rendu ni à `frames.ts` : le repère fixe
 * IAU `Rz(W) · Rx(90° - δ0) · Rz(90° + α0)` appliqué aux vecteurs équatoriaux.
 */

const D = Math.PI / 180;
type V = { x: number; y: number; z: number };
const rz = (a: number, v: V): V => ({
  x: Math.cos(a) * v.x + Math.sin(a) * v.y,
  y: -Math.sin(a) * v.x + Math.cos(a) * v.y,
  z: v.z,
});
const rx = (a: number, v: V): V => ({
  x: v.x,
  y: Math.cos(a) * v.y + Math.sin(a) * v.z,
  z: -Math.sin(a) * v.y + Math.cos(a) * v.z,
});
const unit = (v: V): V => {
  const n = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / n, y: v.y / n, z: v.z / n };
};

/** Direction EQJ -> repère fixe IAU du corps. */
function toBodyFixed(body: Body, date: Date, eqj: V): V {
  const ax = RotationAxis(body, MakeTime(date));
  return rz(
    ax.spin * D,
    rx(Math.PI / 2 - ax.dec * D, rz(Math.PI / 2 + ax.ra * 15 * D, eqj))
  );
}

const lonDeg = (v: V): number => Math.atan2(v.y, v.x) / D;
const wrap180 = (x: number): number => ((((x + 180) % 360) + 360) % 360) - 180;

describe('méridien origine IAU (core/bodyRotation)', () => {
  it('coïncide avec le repère fixe défini par les trois rotations de l’UAI', () => {
    for (const body of [Body.Moon, Body.Mars]) {
      for (const iso of [
        '1969-07-20T20:17:40Z',
        '2000-01-01T12:00:00Z',
        '2026-11-19T06:30:00Z',
      ]) {
        const date = new Date(iso);
        const ax = RotationAxis(body, MakeTime(date));
        const p = primeMeridianEquatorial(ax.ra * 15, ax.dec, ax.spin);
        // La direction du méridien origine, ramenée dans le repère fixe, vaut (1, 0, 0).
        const fixed = toBodyFixed(body, date, p);
        expect(fixed.x).toBeCloseTo(1, 12);
        expect(fixed.y).toBeCloseTo(0, 12);
        expect(fixed.z).toBeCloseTo(0, 12);
      }
    }
  });

  it('place le Soleil à 10,7° au-dessus du site d’Apollo 11 à l’alunissage', () => {
    const date = new Date('1969-07-20T20:17:40Z');
    const t = MakeTime(date);
    const sun = GeoVector(Body.Sun, t, false);
    const moon = GeoVector(Body.Moon, t, false);
    const toSun = unit({
      x: sun.x - moon.x,
      y: sun.y - moon.y,
      z: sun.z - moon.z,
    });
    // Base fixe construite UNIQUEMENT depuis `primeMeridianEquatorial` et le pôle.
    const ax = RotationAxis(Body.Moon, t);
    const x = primeMeridianEquatorial(ax.ra * 15, ax.dec, ax.spin);
    const z = { x: ax.north.x, y: ax.north.y, z: ax.north.z };
    const y = {
      x: z.y * x.z - z.z * x.y,
      y: z.z * x.x - z.x * x.z,
      z: z.x * x.y - z.y * x.x,
    };
    const lat = 0.674 * D;
    const lon = 23.473 * D;
    const site = {
      x:
        x.x * Math.cos(lat) * Math.cos(lon) +
        y.x * Math.cos(lat) * Math.sin(lon) +
        z.x * Math.sin(lat),
      y:
        x.y * Math.cos(lat) * Math.cos(lon) +
        y.y * Math.cos(lat) * Math.sin(lon) +
        z.y * Math.sin(lat),
      z:
        x.z * Math.cos(lat) * Math.cos(lon) +
        y.z * Math.cos(lat) * Math.sin(lon) +
        z.z * Math.sin(lat),
    };
    const dot = site.x * toSun.x + site.y * toSun.y + site.z * toSun.z;
    expect(Math.asin(dot) / D).toBeCloseTo(10.7, 1);
  });

  it('montre la Terre à moins de 8,5° du méridien 0 de la Lune (libration)', () => {
    for (let k = 0; k < 40; k += 1) {
      const date = new Date(Date.UTC(2026, 0, 1) + k * 17.3 * 86_400_000);
      const t = MakeTime(date);
      const moon = GeoVector(Body.Moon, t, false);
      const earth = toBodyFixed(
        Body.Moon,
        date,
        unit({ x: -moon.x, y: -moon.y, z: -moon.z })
      );
      expect(Math.abs(lonDeg(earth))).toBeLessThan(8.5);
    }
  });
});

/** Un corps de scène minimal qui reproduit la chaîne de `CelestialObject` : tilt puis rotation Y. */
class FakeSurfaceBody {
  readonly group = new THREE.Group();
  private readonly tilt = new THREE.Group();
  private readonly mesh = new THREE.Group();
  constructor() {
    this.group.add(this.tilt);
    this.tilt.add(this.mesh);
  }
  setAxisDirection(v: THREE.Vector3): void {
    this.tilt.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v);
  }
  getTiltQuaternion(out = new THREE.Quaternion()): THREE.Quaternion {
    return this.tilt.getWorldQuaternion(out);
  }
  setSurfaceRotation(radians: number): void {
    this.mesh.rotation.y = radians;
  }
  /** Longitude/latitude RENDUES (convention carte) d'une direction monde. */
  geographicOf(worldDirection: THREE.Vector3): {
    latitudeDeg: number;
    longitudeDeg: number;
  } {
    this.group.updateWorldMatrix(true, true);
    const local = worldDirection
      .clone()
      .applyQuaternion(
        this.mesh.getWorldQuaternion(new THREE.Quaternion()).invert()
      );
    return localDirectionToGeographic(local);
  }
}

describe('OrbitalMechanics.syncDatedSurfaceRotations', () => {
  const ephemeris = new EphemerisService();

  function harness(): { mechanics: OrbitalMechanics; moon: FakeSurfaceBody } {
    const mechanics = Object.create(
      OrbitalMechanics.prototype
    ) as OrbitalMechanics;
    const moon = new FakeSurfaceBody();
    Object.defineProperty(mechanics, 'config', { value: CELESTIAL_CONFIG });
    Object.defineProperty(mechanics, 'ephemeris', { value: ephemeris });
    Object.defineProperty(mechanics, 'bodies', { value: { moon } });
    return { mechanics, moon };
  }

  it('ne retient que des corps dont la carte est vérifiée, par classification', () => {
    const listed: string[] = [];
    forEachBody(CELESTIAL_CONFIG, ({ name, config }) => {
      if (config.astroBody && DATED_ROTATION_BODIES.has(config.astroBody))
        listed.push(name);
    });
    expect(listed.sort()).toEqual(['mars', 'moon']);
  });

  it.each([
    '1969-07-20T20:17:40Z',
    '1969-07-24T12:00:00Z',
    '2000-01-06T18:14:00Z',
    '2026-11-20T06:00:00Z',
  ])('la face tournée vers la Terre est celle du modèle IAU, %s', (iso) => {
    const date = new Date(iso);
    const { mechanics, moon } = harness();
    // Position de la Lune rendue : la chaîne de scène réelle (héliocentrique, repère Three.js).
    moon.group.position.copy(ephemeris.getHeliocentricAU(Body.Moon, date));
    mechanics.syncAxesFromEphemeris(date);
    mechanics.syncDatedSurfaceRotations(date);

    const earth = ephemeris.getHeliocentricAU(Body.Earth, date);
    const toEarth = earth.sub(moon.group.position).normalize();
    const rendered = moon.geographicOf(toEarth);

    const t = MakeTime(date);
    const g = GeoVector(Body.Moon, t, false);
    const reference = toBodyFixed(
      Body.Moon,
      date,
      unit({ x: -g.x, y: -g.y, z: -g.z })
    );
    expect(wrap180(rendered.longitudeDeg - lonDeg(reference))).toBeCloseTo(
      0,
      1
    );
    expect(rendered.latitudeDeg).toBeCloseTo(Math.asin(reference.z) / D, 1);
  });

  it('place le point subsolaire d’Apollo 11 côté jour (10,7° d’altitude)', () => {
    const date = new Date('1969-07-20T20:17:40Z');
    const { mechanics, moon } = harness();
    moon.group.position.copy(ephemeris.getHeliocentricAU(Body.Moon, date));
    mechanics.syncAxesFromEphemeris(date);
    mechanics.syncDatedSurfaceRotations(date);

    const toSun = moon.group.position.clone().negate().normalize();
    const subsolar = moon.geographicOf(toSun);
    const lat = 0.674 * D;
    const lon = 23.473 * D;
    const sl = subsolar.latitudeDeg * D;
    const sn = subsolar.longitudeDeg * D;
    const sin =
      Math.sin(lat) * Math.sin(sl) +
      Math.cos(lat) * Math.cos(sl) * Math.cos(lon - sn);
    expect(Math.asin(sin) / D).toBeCloseTo(10.7, 0);
  });
});
