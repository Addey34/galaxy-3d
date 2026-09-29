import { describe, expect, it } from 'vitest';

import {
  INTERSTELLAR_ACCURACY,
  accuracyNear,
  relativeError,
} from './interstellarAccuracy';
import { INTERSTELLAR_OBJECTS, interstellarWindow } from './interstellar';
import summary from './horizons-validation-summary.json';

/**
 * L'ÉCART DES OBJETS INTERSTELLAIRES, ÉCRIT, DONC VÉRIFIÉ.
 *
 * Un manque écrit avec sa raison ne vaut que si la raison reste vraie. Ces gardes empêchent les
 * trois façons dont un relevé recopié pourrit : un objet qui disparaît du catalogue et reste ici,
 * un objet ajouté au catalogue et oublié ici, et des chiffres qui cessent de décrire ce que le
 * relevé de validation committé mesure.
 */

/** Écart médian SERVI, en km, tel que le relevé de validation le publie. */
function servedMedianKm(body: string): number | null {
  const row = summary.rows.find(
    (r) => r.body === body && r.provider === 'kepler' && r.n >= 48
  );
  return row?.km?.median ?? null;
}

describe('écart mesuré des objets interstellaires', () => {
  it('couvre EXACTEMENT les objets du catalogue', () => {
    expect(INTERSTELLAR_ACCURACY.map((a) => a.body).sort()).toEqual(
      INTERSTELLAR_OBJECTS.map((o) => o.name).sort()
    );
  });

  it('déclare l’époque que les éléments livrés portent vraiment', () => {
    for (const record of INTERSTELLAR_ACCURACY) {
      const object = INTERSTELLAR_OBJECTS.find((o) => o.name === record.body);
      expect(object, record.body).toBeDefined();
      expect(
        object!.elements.epoch.toISOString().slice(0, 10),
        record.body
      ).toBe(record.elementsEpoch);
    }
  });

  it('mesure sur la MÊME fenêtre que le relevé de validation, ±20 ans autour du périhélie', () => {
    // Les deux mesures doivent parler du même intervalle, sans quoi les comparer n'a aucun sens.
    for (const record of INTERSTELLAR_ACCURACY) {
      const object = INTERSTELLAR_OBJECTS.find((o) => o.name === record.body)!;
      const window = interstellarWindow(object);
      const halfDays =
        (window.to.getTime() - window.from.getTime()) / 2 / 86_400_000;
      const extremes = record.points.map((p) => p.daysFromPerihelion);
      expect(Math.min(...extremes), record.body).toBe(-7300);
      expect(Math.max(...extremes), record.body).toBe(7300);
      // ±20 ans, à la tolérance des années bissextiles.
      expect(Math.abs(halfDays - 7300), record.body).toBeLessThan(15);
    }
  });

  it('est le plus PETIT au périhélie et croît avec la distance', () => {
    // C'est le fait qui change la lecture des millions de kilomètres du relevé : ils décrivent
    // les BORDS de la fenêtre, là où l'objet est à 100 UA et où il n'y a rien à voir.
    for (const record of INTERSTELLAR_ACCURACY) {
      const atPerihelion = record.points.find(
        (p) => p.daysFromPerihelion === 0
      )!;
      const farthest = record.points.at(-1)!;
      expect(atPerihelion.errorKm, record.body).toBeLessThan(farthest.errorKm);
      // Et de beaucoup : au moins deux ordres de grandeur pour chacun.
      expect(
        farthest.errorKm / atPerihelion.errorKm,
        record.body
      ).toBeGreaterThan(50);
    }
  });

  it('reste SOUS-PIXEL en relatif, ce qui est la raison de ne pas le combler', () => {
    for (const record of INTERSTELLAR_ACCURACY)
      for (const point of record.points)
        expect(
          relativeError(point),
          `${record.body} à ${point.daysFromPerihelion} j`
        ).toBeLessThan(0.005);
  });

  it('encadre l’écart médian que le relevé committé publie', () => {
    // Le relevé tire 48 dates sur la fenêtre ; sa médiane doit tomber entre le plus petit et le
    // plus grand des écarts mesurés ici. Si l'un des deux dérive, ils cessent de se recouper.
    for (const record of INTERSTELLAR_ACCURACY) {
      const median = servedMedianKm(record.body);
      expect(median, record.body).not.toBeNull();
      const errors = record.points.map((p) => p.errorKm);
      expect(Number(median), record.body).toBeGreaterThan(Math.min(...errors));
      expect(Number(median), record.body).toBeLessThan(Math.max(...errors));
    }
  });

  it('rend le point mesuré le plus proche d’un instant', () => {
    expect(accuracyNear('borisov', 0)?.errorKm).toBe(3081);
    expect(accuracyNear('borisov', 20)?.daysFromPerihelion).toBe(30);
    expect(accuracyNear('borisov', -5000)?.daysFromPerihelion).toBe(-3650);
    expect(accuracyNear('inconnu', 0)).toBeUndefined();
  });
});
