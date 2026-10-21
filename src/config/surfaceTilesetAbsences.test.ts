import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CELESTIAL_CONFIG } from './bodies';
import { flattenBodies, ILLUSTRATIVE_SURFACES } from './catalog';
import { SURFACE_TILESETS } from './surfaceTilesets';
import { TEXTURE_QUALITY_PIXELS } from '@/components/systems/TextureSystem';
import { pyramidWidthPx, WMTS_EQUIRECTANGULAR_2x1 } from '@/core/tilePyramid';

/**
 * LA PARITÉ DE L'IMAGERIE STREAMÉE (lot 64) : un corps à texture de surface mesurée a un jeu de
 * tuiles, ou une surface illustrative, ou une RAISON écrite dans
 * `scripts/surface-tileset-absences.json`. Rien n'est laissé de côté sans le dire.
 *
 * Chaque raison est confrontée au dépôt quand le dépôt peut la juger : « la pyramide n'est pas
 * plus fine » se recalcule contre la texture livrée, « corps à modèle de forme » exige le modèle.
 * Les autres portent la date de leur lecture, parce qu'une absence de source n'est pas éternelle.
 */
const ROOT = resolve(import.meta.dirname, '../..');
const FILE = JSON.parse(
  readFileSync(resolve(ROOT, 'scripts/surface-tileset-absences.json'), 'utf-8')
) as {
  absences: Record<
    string,
    {
      kind: string;
      verified: string;
      reason: string;
      layer?: string;
      maxLevel?: number;
    }
  >;
};

const KINDS = [
  'no-tiled-product',
  'pyramid-not-finer',
  'licence-undecided',
  'interval-underivable',
  'shape-model',
];

const BODIES = new Map([...flattenBodies(CELESTIAL_CONFIG)]);

/** Largeur de la meilleure texture de surface livrée, comme la garde des fiches la compte. */
function shippedPx(body: string): number {
  const tiers = BODIES.get(body)?.textureResolutions?.surface ?? [];
  return Math.max(0, ...tiers.map((tier) => TEXTURE_QUALITY_PIXELS[tier] ?? 0));
}

/** Les corps dont l'imagerie de surface est un sujet : ni étoile, ni fond d'étoiles. */
const SURFACE_BODIES = [...BODIES]
  .filter(
    ([, cfg]) =>
      cfg.kind !== 'star' &&
      cfg.kind !== 'skybox' &&
      (cfg.textureResolutions?.surface ?? []).length > 0
  )
  .map(([name]) => name);

describe('imagerie streamée : un jeu de tuiles ou une raison écrite', () => {
  it('couvre CHAQUE corps à texture de surface', () => {
    const orphans = SURFACE_BODIES.filter(
      (name) =>
        !SURFACE_TILESETS.has(name) &&
        !ILLUSTRATIVE_SURFACES.has(name) &&
        !(name in FILE.absences)
    );
    expect(
      orphans,
      `corps sans jeu de tuiles ni raison écrite : ${orphans.join(', ')}`
    ).toEqual([]);
  });

  it('ne garde aucune raison périmée, ni pour un corps inconnu', () => {
    for (const name of Object.keys(FILE.absences)) {
      expect(BODIES.has(name), `${name} absent du catalogue`).toBe(true);
      expect(
        SURFACE_TILESETS.has(name),
        `${name} a un jeu de tuiles : sa raison d'absence est périmée`
      ).toBe(false);
      expect(
        ILLUSTRATIVE_SURFACES.has(name),
        `${name} est illustratif : sa raison vit déjà dans sa fiche de texture`
      ).toBe(false);
    }
  });

  it('écrit pour chaque raison un genre connu, une date et un texte', () => {
    for (const [name, a] of Object.entries(FILE.absences)) {
      expect(KINDS, `${name} : genre inconnu`).toContain(a.kind);
      expect(a.verified, `${name} : date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(a.reason.length, `${name} : raison vide`).toBeGreaterThan(20);
    }
  });

  it('« pyramide pas plus fine » se recalcule contre la texture livrée', () => {
    for (const [name, a] of Object.entries(FILE.absences)) {
      if (a.kind !== 'pyramid-not-finer') continue;
      expect(a.maxLevel, `${name} : niveau maximal lu`).toBeGreaterThanOrEqual(
        0
      );
      const width = pyramidWidthPx(a.maxLevel!, WMTS_EQUIRECTANGULAR_2x1);
      expect(
        width,
        `${name} : la pyramide (${width} px) améliorerait la texture livrée (${shippedPx(name)} px) : écrire sa fiche`
      ).toBeLessThanOrEqual(shippedPx(name));
    }
  });

  it('« modèle de forme » exige un modèle de forme', () => {
    for (const [name, a] of Object.entries(FILE.absences)) {
      if (a.kind !== 'shape-model') continue;
      expect(
        BODIES.get(name)?.model,
        `${name} sans modèle de forme`
      ).toBeTruthy();
    }
  });
});
