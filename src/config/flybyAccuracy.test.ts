import { describe, expect, it } from 'vitest';
import { eclipticToScene } from '@/core/frames';
import {
  horizonsManifest,
  horizonsServiceFromDisk,
} from '@/core/horizonsTestFixture';
import plan from './flybyEncounters.json';

/**
 * LES SONDES PENDANT LEURS RENCONTRES PLANÉTAIRES, CONTRE HORIZONS (ligne 45.10, 2026-10-11).
 *
 * La validation à 48 dates (`pnpm ephemeris:validate`) ne tombe jamais sur un survol, qui dure
 * quelques heures : elle annonçait 0,1 km pour JUICE, que la scène plaçait à 20 000 km de sa
 * vraie position au survol de la Terre du 2024-08-20, de l'autre côté de la planète. Ce test
 * confronte la position que le service RÉEL compose (planète dessinée + segment de survol,
 * propagé à deux corps entre ses ancres, hyperbole comprise) aux vecteurs qu'Horizons sert
 * relativement au CENTRE de la planète (`flybyEncounters.json`, écrit par
 * `pnpm ephemeris:flybys --write`, jamais à la main).
 *
 * La borne se rapporte à la distance VRAIE à la planète, parce que c'est ce qui se voit.
 * MESURÉ le 2026-10-11 sur 71 rencontres de 14 sondes : 61 hors de la borne avant (jusqu'à
 * 3 732 % de la distance, OSIRIS-REx au retour de 2023), aucune après les 65 segments
 * (66 720 octets en tout). Falsifié : un segment retiré rend sa rencontre rouge (dernier cas).
 */

const KM_PER_AU = 149_597_870.7;
const service = horizonsServiceFromDisk();

/** L'écart de la sonde servie à la vérité, relativement à la planète DESSINÉE. */
function worstShare(
  probe: string,
  planet: string,
  reference: readonly { date: string; km: readonly number[] }[]
) {
  let worst = { share: 0, km: 0, date: '' };
  for (const { date, km } of reference) {
    const when = new Date(date);
    const served = service.getHeliocentricAU(probe, when);
    const drawn = service.getHeliocentricAU(planet, when);
    if (!served || !drawn)
      throw new Error(`${probe} ${date} : position absente`);
    const truth = eclipticToScene(
      km[0] / KM_PER_AU,
      km[1] / KM_PER_AU,
      km[2] / KM_PER_AU
    );
    const errKm = served.sub(drawn).distanceTo(truth) * KM_PER_AU;
    const share = errKm / (truth.length() * KM_PER_AU);
    if (share > worst.share) worst = { share, km: errKm, date };
  }
  return worst;
}

const bodies = horizonsManifest.bodies as Record<
  string,
  {
    file: string;
    center?: string;
    segmentOf?: string;
    stepDays: number;
    flyby?: boolean;
  }
>;

describe('Rencontres planétaires des sondes contre Horizons', () => {
  it('la référence a été capturée sur les fichiers héliocentriques livrés', () => {
    for (const [probe, file] of Object.entries(plan.files))
      expect(bodies[probe]?.file, probe).toBe(file);
  });

  it('chaque segment du plan est livré, et seuls ceux-là', () => {
    const planned = plan.encounters.flatMap((e) =>
      e.segment ? [{ ...e.segment, probe: e.probe, planet: e.planet }] : []
    );
    for (const segment of planned) {
      const entry = bodies[segment.name];
      expect(entry, segment.name).toBeDefined();
      expect(entry?.segmentOf).toBe(segment.probe);
      expect(entry?.center).toBe(segment.planet);
      expect(entry?.stepDays).toBeCloseTo(segment.stepMinutes / 1440, 12);
    }
    // Le drapeau `flyby` et le séparateur `--` (réservé à ces segments, cf. `--flybys` du
    // générateur) désignent exactement les mêmes fichiers : ceux du plan.
    const planNames = planned.map((s) => s.name).sort();
    const flagged = Object.keys(bodies).filter((name) => bodies[name]?.flyby);
    const named = Object.keys(bodies).filter((name) => name.includes('--'));
    expect(flagged.sort()).toEqual(planNames);
    expect(named.sort()).toEqual(planNames);
  });

  it('une rencontre que le relevé ne corrige pas dit pourquoi', () => {
    for (const e of plan.encounters) {
      if ('note' in e) expect(e.reference, e.probe).toHaveLength(0);
      else
        expect(e.reference.length, `${e.probe} ${e.planet}`).toBeGreaterThan(0);
    }
  });

  for (const e of plan.encounters.filter(
    (encounter) => !('note' in encounter)
  )) {
    it(`${e.probe} au plus près de ${e.planet} le ${e.closestAt.slice(0, 10)} : sous ${plan.maxShare * 100} % de la distance`, () => {
      const worst = worstShare(e.probe, e.planet, e.reference);
      expect(
        worst.share,
        `pire écart ${worst.km.toFixed(1)} km (${(worst.share * 100).toFixed(2)} %) le ${worst.date}`
      ).toBeLessThan(plan.maxShare);
    });
  }

  it('sans son segment, un survol retombe hors de la borne (la garde mord)', () => {
    const e = plan.encounters.find(
      (encounter) => encounter.segment?.name === 'juice--earth-2024-08-20'
    );
    if (!e?.segment) throw new Error('survol témoin absent du plan');
    const loaded = (service as unknown as { bodies: Map<string, unknown> })
      .bodies;
    const segment = loaded.get(e.segment.name);
    loaded.delete(e.segment.name);
    try {
      expect(worstShare(e.probe, e.planet, e.reference).share).toBeGreaterThan(
        1
      );
    } finally {
      loaded.set(e.segment.name, segment);
    }
  });
});
