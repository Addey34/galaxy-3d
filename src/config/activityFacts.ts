/**
 * LES FAITS QU'UNE ACTIVITÉ CITE, lus dans le catalogue (lot 58) : le lecteur que
 * `core/activityValues.ts` reçoit en argument, et la provenance que la fiche imprimée affiche.
 * Rien n'est recopié : la valeur est celle que la fiche de la Terre affiche, la source celle que
 * `config/factProvenance.test.ts` confronte déjà au relevé des faits.
 */
import type { CelestialConfig, FactProvenance } from '@/types';
import type { EditionReader, FactReader } from '@/core/activityValues';
import { flattenBodies } from './catalog';
import { SURFACE_VARIANTS, type SurfaceTileset } from './surfaceTilesets';

export function catalogueFactReader(config: CelestialConfig): FactReader {
  const bodies = flattenBodies(config);
  return (body, fact) => {
    const value = bodies.get(body)?.realData?.[fact];
    if (typeof value !== 'number') return undefined;
    // `axialTilt` est en RADIANS dans le catalogue (la scène le lit tel quel) : la fiche le
    // déclare en degrés (`{"$deg": …}`), c'est en degrés qu'une activité le cite. Une période
    // est en jours dans la fiche comme dans le catalogue.
    return fact === 'axialTilt' ? (value * 180) / Math.PI : value;
  };
}

export function catalogueFactProvenance(
  config: CelestialConfig,
  body: string,
  fact: 'axialTilt' | 'orbitPeriodDays' | 'radiusKm' | 'distanceAU'
): FactProvenance | undefined {
  return flattenBodies(config).get(body)?.realData?.sources?.[fact];
}

/** L'édition annuelle `edition` de l'imagerie d'un corps, quel que soit le fond qui la porte. */
export function editionTileset(
  body: string,
  edition: number
): SurfaceTileset | undefined {
  for (const editions of SURFACE_VARIANTS.get(body)?.values() ?? [])
    for (const tileset of editions)
      if (tileset.edition === edition) return tileset;
  return undefined;
}

/** Lit l'intervalle de l'édition dans sa fiche de tuiles : rien n'est recopié dans l'activité. */
export const catalogueEditionReader: EditionReader = (body, edition) => {
  const tileset = editionTileset(body, edition);
  return tileset
    ? { from: tileset.acquired.from, to: tileset.acquired.to }
    : undefined;
};
