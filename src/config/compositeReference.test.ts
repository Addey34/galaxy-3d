import { describe, expect, it } from 'vitest';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { eclipticToScene } from '@/core/frames';
import { impulseInInterval } from '@/core/HorizonsEphemerisService';
import {
  horizonsManifest,
  horizonsServiceFromDisk,
} from '@/core/horizonsTestFixture';
import reference from './compositeReferenceVectors.json';

/**
 * DIMORPHOS COMPOSÉ, SOUS SON DIAMÈTRE (2026-10-05).
 *
 * La scène place Dimorphos en ajoutant sa position relative à celle de Didymos, chacune lue
 * dans son binaire livré. Ce test confronte cette somme aux vecteurs qu'Horizons sert pour
 * Dimorphos vu du Soleil (`compositeReferenceVectors.json`, écrit par
 * `node scripts/capture-composite-reference.mjs`, jamais à la main), et exige l'écart sous le
 * DIAMÈTRE de Dimorphos à chaque instant.
 *
 * Ce qui le tient : Didymos au pas d'un jour (au pas de 4 jours, 15,85 km au pire), Dimorphos au
 * pas d'un jour, et le saut de vitesse de l'impact de DART publié au manifeste (`impulses`) :
 * sans lui, l'intervalle qui contient l'impact fond une orbite d'avant et une orbite d'après.
 * Falsifié des trois façons, cf. `docs/ARCHITECTURE.md` § « La position composée d'un
 * satellite de petit corps ».
 */

const KM_PER_AU = 149_597_870.7;
const service = horizonsServiceFromDisk();
const radiusKm =
  CELESTIAL_CONFIG.bodies.didymos?.satellites?.dimorphos?.realData?.radiusKm;

function compositeErrorKm(date: string, au: number[]): number {
  const when = new Date(date);
  const parent = service.getHeliocentricAU('didymos', when);
  const own = service.getParentRelativeAU('dimorphos', 'didymos', when);
  if (!parent || !own) throw new Error(`${date} : position absente`);
  const truth = eclipticToScene(au[0], au[1], au[2]);
  return parent.add(own).distanceTo(truth) * KM_PER_AU;
}

describe('Dimorphos composé contre Horizons', () => {
  it('lit son rayon dans la fiche', () => {
    expect(radiusKm).toBeGreaterThan(0);
  });

  it('le manifeste publie le saut de vitesse de l’impact, DANS un intervalle', () => {
    const entry = horizonsManifest.bodies.dimorphos as Parameters<
      typeof impulseInInterval
    >[0];
    expect(entry.impulses).toHaveLength(1);
    const [jd] = entry.impulses!;
    const index = Math.floor((jd - entry.startJdTdb) / entry.stepDays);
    expect(impulseInInterval(entry, index)).not.toBeNull();
    // Un nœud n'est pas un intervalle : un saut posé dessus n'en coupe aucun.
    expect(
      impulseInInterval({ ...entry, impulses: [entry.startJdTdb + 10] }, 9)
    ).toBeNull();
  });

  for (const series of ['impactDay', 'span'] as const) {
    it(`${series} : écart sous le diamètre à chaque instant`, () => {
      const errors = reference[series].map(({ date, au }) => ({
        date,
        km: compositeErrorKm(date, au),
      }));
      expect(errors.length).toBeGreaterThan(40);
      const worst = errors.reduce((a, b) => (b.km > a.km ? b : a));
      expect(
        worst.km,
        `pire écart ${worst.km.toFixed(3)} km le ${worst.date}`
      ).toBeLessThan(2 * radiusKm!);
    });
  }
});
