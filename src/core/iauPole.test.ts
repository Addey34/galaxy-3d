import { describe, expect, it } from 'vitest';
import { Body, GeoVector, HelioVector } from 'astronomy-engine';
import snapshot from '@/config/factSources.snapshot.json';
import {
  angleBetween,
  centuriesFromJ2000,
  equatorialToEcliptic,
  iauPoleDeg,
  orbitNormalFromPositions,
  polynomial,
  spinAngularMomentum,
  type NutationAngles,
  type Vec3,
} from './iauPole';

/**
 * LA GARDE DE LA MÉTHODE, et elle est falsifiable : l'obliquité qu'on DÉRIVE du pôle publié
 * doit être celle que la NSSDCA PUBLIE, pour les neuf corps dont elle en publie une, plus la
 * Lune. Dix valeurs, dix chemins indépendants — le noyau de rotation de NAIF d'un côté, la
 * fiche NSSDCA de l'autre — et aucun nombre écrit à la main nulle part : les orbites viennent
 * d'astronomy-engine, qui place déjà ces corps dans la scène.
 *
 * Sans cette garde, trois erreurs silencieuses passaient : lire les arguments quadratiques du
 * système de Mars comme s'ils étaient linéaires (25,19° devenait 22,98), ignorer les termes
 * trigonométriques (la Lune perdait 3,2° de pôle), et prendre le pôle nord de l'UAI pour la
 * direction du moment cinétique (Uranus rendait 82,23° au lieu de 97,77). Chacune donne des
 * nombres plausibles ; seule la confrontation les rejette.
 */

const RAD_TO_DEG = 180 / Math.PI;
const rotations = snapshot.naifRotation as unknown as {
  systems: Record<string, NutationAngles>;
  bodies: Record<
    string,
    {
      naifId: number;
      system: number | null;
      rotation: {
        poleRaDeg: number[];
        poleDecDeg: number[];
        nutPrecRa: number[] | null;
        nutPrecDec: number[] | null;
        pmRateDegPerDay: number;
      } | null;
    }
  >;
};

const model = (body: string) => {
  const entry = rotations.bodies[body];
  if (!entry?.rotation) throw new Error(`${body} : aucun pôle relevé`);
  const angles = rotations.systems[String(entry.system)] ?? [];
  return {
    angles,
    rotation: {
      ...entry.rotation,
      nutPrecRa: entry.rotation.nutPrecRa ?? undefined,
      nutPrecDec: entry.rotation.nutPrecDec ?? undefined,
    },
  };
};

/** Normale de l'orbite, en écliptique, lue sur deux positions d'astronomy-engine. */
function orbitNormal(body: Body, date: Date, geocentric: boolean): Vec3 {
  const at = (d: Date) => {
    const v = geocentric ? GeoVector(body, d, false) : HelioVector(body, d);
    return [v.x, v.y, v.z] as Vec3;
  };
  const later = new Date(date.getTime() + 86_400_000);
  return equatorialToEcliptic(orbitNormalFromPositions(at(date), at(later)));
}

/** Normale de l'écliptique : l'orbite que le Soleil n'a pas (voir le cas `sun` ci-dessous). */
const ECLIPTIC_NORTH: Vec3 = [0, 0, 1];

/**
 * Obliquité MOYENNE sur vingt ans, échantillonnée tous les mois.
 *
 * Une moyenne, parce que c'en est une qui est publiée. Pour une planète l'échantillonnage ne
 * change rien, mais l'orbite de la Lune précesse en 18,6 ans : sa normale osculatrice balaie
 * ±0,15° autour de sa valeur moyenne, et un seul instant rendait 6,81° là où la fiche publie
 * 6,68. Le pôle est évalué à CHAQUE échantillon, parce qu'il précesse avec le nœud — c'est
 * précisément ce qui fait de l'obliquité lunaire une constante.
 */
function meanObliquityDeg(
  body: string,
  orbit: (date: Date) => Vec3,
  samples = 241
): number {
  const { rotation, angles } = model(body);
  let total = 0;
  for (let k = 0; k < samples; k++) {
    const date = new Date(Date.UTC(1990, k, 1, 12));
    const spin = equatorialToEcliptic(
      spinAngularMomentum(rotation, angles, centuriesFromJ2000(date))
    );
    total += angleBetween(spin, orbit(date)) * RAD_TO_DEG;
  }
  return total / samples;
}

describe('modèle de rotation de l’UAI', () => {
  it('évalue un polynôme du degré 0 vers le haut', () => {
    expect(polynomial([2, 3, 4], 0)).toBe(2);
    expect(polynomial([2, 3, 4], 2)).toBe(2 + 6 + 16);
    expect(polynomial([], 5)).toBe(0);
  });

  it('refuse plus d’amplitudes que d’arguments', () => {
    expect(() =>
      iauPoleDeg(
        {
          poleRaDeg: [0],
          poleDecDeg: [0],
          nutPrecRa: [1, 2],
          pmRateDegPerDay: 1,
        },
        [[10, 0]],
        0
      )
    ).toThrow(/amplitudes/);
  });

  it('retourne le pôle pour un corps rétrograde, pas pour un corps prograde', () => {
    const angles: NutationAngles = [];
    const pole = { poleRaDeg: [0], poleDecDeg: [90] };
    const direct = spinAngularMomentum(
      { ...pole, pmRateDegPerDay: 10 },
      angles,
      0
    );
    const retro = spinAngularMomentum(
      { ...pole, pmRateDegPerDay: -10 },
      angles,
      0
    );
    expect(direct[2]).toBeCloseTo(1, 12);
    expect(retro[2]).toBeCloseTo(-1, 12);
  });
});

describe('obliquité dérivée : confrontée aux onze obliquités publiées', () => {
  const orbits: Record<string, (date: Date) => Vec3> = {
    mercury: (d) => orbitNormal(Body.Mercury, d, false),
    venus: (d) => orbitNormal(Body.Venus, d, false),
    earth: (d) => orbitNormal(Body.Earth, d, false),
    mars: (d) => orbitNormal(Body.Mars, d, false),
    jupiter: (d) => orbitNormal(Body.Jupiter, d, false),
    saturn: (d) => orbitNormal(Body.Saturn, d, false),
    uranus: (d) => orbitNormal(Body.Uranus, d, false),
    neptune: (d) => orbitNormal(Body.Neptune, d, false),
    pluto: (d) => orbitNormal(Body.Pluto, d, false),
    moon: (d) => orbitNormal(Body.Moon, d, true),
    // Le Soleil n'orbite rien : les 7,25° que publie sa fiche sont l'inclinaison de son
    // équateur sur l'ÉCLIPTIQUE, pas sur une orbite. C'est une autre grandeur, et c'est pour
    // cela qu'elle est confrontée à une autre normale — pas exclue de la garde.
    sun: () => ECLIPTIC_NORTH,
  };

  it('couvre TOUTES les obliquités publiées par la NSSDCA', () => {
    const published = Object.entries(
      snapshot.nssdca.bodies as Record<string, Record<string, unknown>>
    )
      .filter(([, sheet]) => sheet.obliquityDeg !== undefined)
      .map(([name]) => name);
    expect(published.sort()).toEqual(Object.keys(orbits).sort());
  });

  it.each(Object.keys(orbits))('%s', (name) => {
    const published = (
      snapshot.nssdca.bodies as Record<string, { obliquityDeg?: number }>
    )[name].obliquityDeg;
    const derived = meanObliquityDeg(name, orbits[name]);
    // 0,12° : la précision que le rapport de l'UAI s'attribue lui-même est de 0,1°, et la fiche
    // NSSDCA arrondit au centième. Un écart plus grand n'est pas du bruit, c'est un modèle lu
    // de travers — les trois erreurs citées en tête donnent 0,9°, 3,2° et 15°.
    expect(Math.abs(derived - published!), `${name} : ${derived}`).toBeLessThan(
      0.12
    );
  });
});
