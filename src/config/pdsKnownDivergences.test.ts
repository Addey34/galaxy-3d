import { describe, expect, it } from 'vitest';
import {
  resolveKnownDivergence,
  type DivergentRow,
} from '../../scripts/pds-known-divergences.mjs';

const LID = 'urn:nasa:pds:context:investigation:mission.hayabusa';
const ITOKAWA = 'urn:nasa:pds:context:target:asteroid.25143_itokawa';
const SKY = 'urn:nasa:pds:context:target:calibration_field.sky';

const row = (over: Partial<DivergentRow>): DivergentRow => ({
  lid: LID,
  name: 'Hayabusa Mission',
  start: '2003-05-09',
  end: '2010-06-13',
  refs: [ITOKAWA],
  ...over,
});

describe('divergences connues du registre du PDS', () => {
  it('garde la fiche déclarée quand la différence est celle qui a été lue, dans les deux ordres', () => {
    const wide = row({ name: 'HAYABUSA', refs: [ITOKAWA, SKY] });
    const narrow = row({});
    expect(resolveKnownDivergence(wide, narrow)).toBe(narrow);
    expect(resolveKnownDivergence(narrow, wide)).toBe(narrow);
  });

  it("n'ouvre aucune exception pour un identifiant que la table ne nomme pas", () => {
    const other = 'urn:nasa:pds:context:investigation:mission.autre';
    expect(
      resolveKnownDivergence(
        row({ lid: other, name: 'A' }),
        row({ lid: other, name: 'B' })
      )
    ).toBeNull();
  });

  it("refuse dès que la différence n'est plus celle qui a été lue (falsifié)", () => {
    const wide = row({ name: 'HAYABUSA', refs: [ITOKAWA, SKY] });
    // une date de fin qui diverge
    expect(resolveKnownDivergence(wide, row({ end: '2011-01-01' }))).toBeNull();
    // la fiche gardée cite un corps que l'autre ne cite pas
    expect(
      resolveKnownDivergence(
        row({ name: 'HAYABUSA', refs: [SKY] }),
        row({ refs: [ITOKAWA] })
      )
    ).toBeNull();
    // aucune des deux ne porte le nom déclaré
    expect(
      resolveKnownDivergence(
        row({ name: 'HAYABUSA' }),
        row({ name: 'Hayabusa (autre)' })
      )
    ).toBeNull();
  });
});
