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
    detail?: boolean;
    impulses?: number[];
  }
>;

describe('Rencontres planétaires des sondes contre Horizons', () => {
  it('la référence a été capturée sur les fichiers héliocentriques livrés', () => {
    for (const [probe, file] of Object.entries(plan.files))
      expect(bodies[probe]?.file, probe).toBe(file);
  });

  it('chaque segment du plan est livré, et seuls ceux-là', () => {
    // Une phase autour d'un petit corps porte ses DÉTAILS (quelques heures au pas de quelques
    // minutes, ligne 45.10) : chacun est un segment livré de plus, marqué `detail`.
    const planned = plan.encounters.flatMap((e) =>
      e.segment
        ? [
            { ...e.segment, probe: e.probe, planet: e.planet },
            ...('details' in e.segment && e.segment.details
              ? e.segment.details.map((d) => ({
                  ...d,
                  kind: 'detail',
                  probe: e.probe,
                  planet: e.planet,
                }))
              : []),
          ]
        : []
    );
    for (const segment of planned) {
      const entry = bodies[segment.name];
      expect(entry, segment.name).toBeDefined();
      expect(entry?.segmentOf).toBe(segment.probe);
      expect(entry?.center).toBe(segment.planet);
      expect(entry?.stepDays).toBeCloseTo(segment.stepMinutes / 1440, 12);
      // Les poussées que l'outil a trouvées sont publiées telles quelles (mises en orbite).
      expect(entry?.impulses ?? []).toEqual(
        'impulses' in segment ? segment.impulses : []
      );
    }
    // Le séparateur `--` est réservé aux segments du plan (cf. `--flybys` du générateur) ; le
    // drapeau `flyby` aux SURVOLS, une phase en orbite (`kind: 'orbit'`) n'en porte pas.
    const planNames = planned.map((s) => s.name).sort();
    const flybyNames = planned
      .filter((s) => s.kind === 'flyby')
      .map((s) => s.name)
      .sort();
    const flagged = Object.keys(bodies).filter((name) => bodies[name]?.flyby);
    const detailed = Object.keys(bodies).filter((name) => bodies[name]?.detail);
    expect(detailed.sort()).toEqual(
      planned
        .filter((s) => s.kind === 'detail')
        .map((s) => s.name)
        .sort()
    );
    const named = Object.keys(bodies).filter((name) => name.includes('--'));
    expect(flagged.sort()).toEqual(flybyNames);
    expect(named.sort()).toEqual(planNames);
    expect(planned.filter((s) => s.kind === 'orbit').length).toBeGreaterThan(0);
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

  /**
   * Juno autour de Jupiter (pas 2) ne tient la borne au pas de 12 h QUE par le terme J2 de la
   * propagation : sans lui, ses périjoves (4 000 km des nuages) sortent de la borne. Mesuré le
   * 2026-10-11 : 1,58 % au pire en deux corps sur six mois de 2024, 0,16 % avec J2.
   */
  it('sans l’aplatissement de Jupiter, Juno en orbite sort de la borne', () => {
    const e = plan.encounters.find(
      (encounter) =>
        encounter.segment?.kind === 'orbit' && encounter.probe === 'juno'
    );
    if (!e?.segment) throw new Error('phase en orbite de Juno absente du plan');
    const loaded = (
      service as unknown as {
        bodies: Map<string, { dynamics?: { oblateness?: unknown } }>;
      }
    ).bodies;
    const dynamics = loaded.get(e.segment.name)!.dynamics!;
    const flat = dynamics.oblateness;
    expect(flat).toBeDefined();
    delete dynamics.oblateness;
    try {
      expect(worstShare(e.probe, e.planet, e.reference).share).toBeGreaterThan(
        plan.maxShare
      );
    } finally {
      dynamics.oblateness = flat;
    }
  });

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

  /**
   * Le prélèvement d'OSIRIS-REx sur Bennu (2020-10-20) ne tient qu'avec son segment de DÉTAIL,
   * au pas d'une minute : sans lui, la phase au pas de 3 h laisse la sonde à des dizaines de
   * mètres d'un corps de 500 m (ligne 45.10, mesuré le 2026-10-11).
   */
  it('sans son détail, le prélèvement d’OSIRIS-REx sort de la borne (la garde mord)', () => {
    const e = plan.encounters.find(
      (encounter) =>
        encounter.probe === 'osiris-rex' &&
        encounter.closestAt.startsWith('2020-10-20')
    );
    const name = 'osiris-rex--bennu-2020-10-20-2020-10-20-19h43';
    if (!e?.segment || !('details' in e.segment))
      throw new Error('phase du prélèvement absente du plan');
    const loaded = (service as unknown as { bodies: Map<string, unknown> })
      .bodies;
    const detail = loaded.get(name);
    expect(detail).toBeDefined();
    loaded.delete(name);
    try {
      expect(worstShare(e.probe, e.planet, e.reference).share).toBeGreaterThan(
        plan.maxShare
      );
    } finally {
      loaded.set(name, detail);
    }
  });

  it('une sonde près d’un petit corps se mesure contre le corps DESSINÉ, et le dit', () => {
    // Horizons ne sert Ryugu ni Lutetia comme centre : la vérité est la sonde MOINS le corps
    // par la solution du fichier qui le dessine, et le segment en porte la commande.
    const aroundSmall = plan.encounters.filter(
      (e) => e.segment && 'relativeTo' in e.segment
    );
    expect(aroundSmall.length).toBeGreaterThanOrEqual(10);
    for (const e of aroundSmall)
      expect(bodies[e.segment!.name]?.center).toBe(e.planet);
  });
});
