import { describe, expect, it } from 'vitest';
import { eclipticToScene } from '@/core/frames';
import {
  horizonsManifest,
  horizonsServiceFromDisk,
} from '@/core/horizonsTestFixture';
import reference from './segmentReferenceVectors.json';

/**
 * BEPICOLOMBO AUTOUR DE MERCURE, CONTRE HORIZONS (2026-10-06).
 *
 * Sur la phase où la sonde tourne autour de Mercure, la scène la place à Mercure plus un
 * SEGMENT relatif livré en ancres de 12 h, propagé à deux corps entre elles, et propagé d'un
 * seul côté dans l'intervalle d'une manœuvre (`impulses`, détectées par le générateur dans un
 * tirage au pas de 10 min). Ce test confronte la position composée par le service RÉEL aux
 * vecteurs qu'Horizons sert pour la sonde vue du Soleil (`segmentReferenceVectors.json`, écrit
 * par `node scripts/capture-segment-reference.mjs`, jamais à la main).
 *
 * Bornes en part de la distance à Mercure, parce que c'est ce qui se voit (une orbite de
 * 3 000 km, ou une approche à 200 000 km). MESURÉ le 2026-10-06 : 56,3 km au pire autour des
 * manœuvres (1,83 %, le 2026-11-26), 10,0 km ailleurs (0,34 %). Falsifié deux fois : sans les
 * manœuvres au manifeste, 2 528 km (80,6 % de la distance, le 2027-02-16) ; segment ignoré,
 * c'est-à-dire le fichier au pas d'un jour, 49 634 km.
 */

const KM_PER_AU = 149_597_870.7;
const service = horizonsServiceFromDisk();

function errors(series: readonly { date: string; au: number[] }[]) {
  return series.map(({ date, au }) => {
    const when = new Date(date);
    const probe = service.getHeliocentricAU('bepicolombo', when);
    const mercury = service.getHeliocentricAU('mercury', when);
    if (!probe || !mercury) throw new Error(`${date} : position absente`);
    const truth = eclipticToScene(au[0], au[1], au[2]);
    const km = probe.distanceTo(truth) * KM_PER_AU;
    const fromMercuryKm = truth.distanceTo(mercury) * KM_PER_AU;
    return { date, km, share: km / fromMercuryKm };
  });
}

describe('BepiColombo composé autour de Mercure contre Horizons', () => {
  it('la référence a été capturée sur le segment livré', () => {
    expect(reference.segmentFile).toBe(
      horizonsManifest.bodies['bepicolombo-mercury']?.file
    );
  });

  for (const [series, maxShare] of [
    ['manoeuvres', 0.03],
    ['span', 0.005],
  ] as const) {
    it(`${series} : écart sous ${maxShare * 100} % de la distance à Mercure`, () => {
      const measured = errors(reference[series]);
      expect(measured.length).toBeGreaterThan(80);
      const worst = measured.reduce((a, b) => (b.share > a.share ? b : a));
      expect(
        worst.share,
        `pire écart ${worst.km.toFixed(1)} km (${(worst.share * 100).toFixed(2)} %) le ${worst.date}`
      ).toBeLessThan(maxShare);
    });
  }
});
