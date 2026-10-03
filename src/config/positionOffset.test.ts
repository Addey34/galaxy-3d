import { describe, expect, it } from 'vitest';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { flattenBodies } from '@/config/catalog';
import summary from '@/config/horizons-validation-summary.json';
import {
  diametersOff,
  measuredWindows,
  type AccuracyRow,
} from '@/core/positionProvenance';

/**
 * LE RAYON QUI DIT « DESSINÉ HORS DE SA PLACE » (ligne 22.10, 2026-10-03).
 *
 * La fiche compare l'écart mesuré au DIAMÈTRE du corps (`core/positionProvenance.ts`), avec le
 * rayon que le script de validation écrit dans la même ligne du résumé. Deux façons de se taire
 * ou de mentir sans que rien ne rougisse : une ligne sans rayon (la phrase disparaîtrait en
 * silence), ou un rayon différent de celui que la fiche affiche (la phrase serait calculée sur
 * un autre corps que celui qu'on lit). Les deux sont tenues ici, sur le résumé LIVRÉ.
 */
const rows = (summary as { rows: AccuracyRow[] }).rows;
const configs = flattenBodies(CELESTIAL_CONFIG);
const measured = rows.filter((r) => r.n > 0 && r.km?.mean != null);

describe('le rayon des lignes mesurées', () => {
  it('chaque corps du catalogue a son rayon dans chacune de ses lignes', () => {
    const missing = measured
      .filter((r) => configs.has(r.body))
      .filter((r) => !(typeof r.radiusKm === 'number' && r.radiusKm > 0))
      .map((r) => `${r.body} ${r.provider} ${r.windowFrom}`);
    expect(missing).toEqual([]);
  });

  it('ce rayon est celui que la fiche affiche', () => {
    const differ = measured
      .filter((r) => configs.has(r.body))
      .filter((r) => r.radiusKm !== configs.get(r.body)?.realData?.radiusKm)
      .map(
        (r) =>
          `${r.body} : ${r.radiusKm} dans le résumé, ${configs.get(r.body)?.realData?.radiusKm} au catalogue`
      );
    expect(differ).toEqual([]);
  });

  it('seuls les objets d’instrument en sont dépourvus, et leur fiche n’a pas de bloc position', () => {
    // `ui/positionProvenance.ts` ne remplit le bloc que pour un corps du catalogue : une sonde ou
    // un interstellaire sans rayon ne peut donc jamais demander la phrase.
    const without = new Set(
      measured
        .filter((r) => !(typeof r.radiusKm === 'number' && r.radiusKm > 0))
        .map((r) => r.body)
    );
    for (const body of without) expect(configs.has(body)).toBe(false);
  });
});

describe('le témoin : la Terre vers 9998 av. J.-C.', () => {
  it('est dessinée à plus de cent diamètres de sa place réelle', () => {
    const windows = measuredWindows(rows, 'earth', 'astronomy-engine', false);
    const deepest = windows.reduce((a, b) => (a.from < b.from ? a : b));
    expect(new Date(deepest.from).getUTCFullYear()).toBe(-9997);
    expect(diametersOff(deepest)).toBeGreaterThan(100);
  });
});
