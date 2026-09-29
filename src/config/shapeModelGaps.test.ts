import { describe, expect, it } from 'vitest';

import {
  SHAPE_COLLECTIONS_SEARCHED,
  SHAPE_MODEL_GAPS,
  shapeGapLine,
} from './shapeModelGaps';
import { CELESTIAL_CONFIG } from './bodies';
import { flattenBodies } from './catalog';

/**
 * LE MANQUE DE FORME, ÉCRIT DONC VÉRIFIÉ.
 *
 * Une recherche de sources ne vaut que si son résultat reste vrai. Ces gardes empêchent les deux
 * façons dont une telle liste pourrit : un corps qui GAGNE un modèle et reste déclaré manquant,
 * et un corps qui devrait y être et n'y est pas.
 *
 * Le repère est celui de `pnpm inventory:gaps` : les corps SANS modèle et plus petits que le plus
 * grand corps qui en a un. Au-dessus de ce repère, une sphère texturée est le bon rendu et le
 * manque n'en est pas un.
 */

const catalogue = new Map(flattenBodies(CELESTIAL_CONFIG));

/** Les corps qui livrent un modèle, et le rayon du plus grand d'entre eux. */
function modelledBodies(): { names: Set<string>; largestRadiusKm: number } {
  const names = new Set<string>();
  let largest = 0;
  for (const [name, cfg] of catalogue) {
    if (!cfg.model) continue;
    names.add(name);
    const radius = cfg.realData?.radiusKm ?? 0;
    if (radius > largest) largest = radius;
  }
  return { names, largestRadiusKm: largest };
}

describe('corps sans modèle de forme : la recherche est écrite', () => {
  it('ne déclare AUCUN corps qui livre déjà un modèle', () => {
    // C'est la garde qui aurait dû exister avant Mimas : il était dans cette liste, et il en est
    // sorti le jour où son modèle a été livré. Sans elle, la liste aurait menti en silence.
    const { names } = modelledBodies();
    for (const gap of SHAPE_MODEL_GAPS)
      expect(
        names.has(gap.body),
        `${gap.body} livre un modèle et n'a donc plus sa place ici`
      ).toBe(false);
  });

  it('déclare EXACTEMENT les corps que l’inventaire signale', () => {
    const { names, largestRadiusKm } = modelledBodies();
    const flagged = [...catalogue]
      .filter(([name, cfg]) => {
        if (names.has(name)) return false;
        const radius = cfg.realData?.radiusKm;
        return radius !== undefined && radius < largestRadiusKm;
      })
      .map(([name]) => name);
    expect([...SHAPE_MODEL_GAPS].map((g) => g.body).sort()).toEqual(
      flagged.sort()
    );
  });

  it('cite le rayon que le catalogue publie, pas un autre', () => {
    for (const gap of SHAPE_MODEL_GAPS) {
      const cfg = catalogue.get(gap.body);
      expect(cfg, gap.body).toBeDefined();
      expect(cfg!.realData?.radiusKm, gap.body).toBe(gap.radiusKm);
    }
  });

  it('distingue les deux causes, et les quatre lunes de Pluton ont la leur', () => {
    // « Aucun maillage publié » et « la mission ne les a pas modelées » ne se rouvriront pas de
    // la même façon : la seconde bouge si New Horizons publie plus tard.
    const pluto = SHAPE_MODEL_GAPS.filter(
      (g) => g.reason === 'mission-derived-set-excludes-it'
    ).map((g) => g.body);
    expect(pluto.sort()).toEqual(['hydra', 'kerberos', 'nix', 'styx']);
    for (const gap of SHAPE_MODEL_GAPS)
      expect(shapeGapLine(gap).length, gap.body).toBeGreaterThan(10);
  });

  it('garde la trace des collections interrogées', () => {
    // Pour que la prochaine recherche parte d'où celle-ci s'arrête, au lieu de tout refaire.
    expect(SHAPE_COLLECTIONS_SEARCHED.length).toBeGreaterThanOrEqual(4);
    expect(SHAPE_COLLECTIONS_SEARCHED.join(' ')).toContain('STOOKE');
    expect(SHAPE_COLLECTIONS_SEARCHED.join(' ')).toContain('nh_derived');
  });
});
