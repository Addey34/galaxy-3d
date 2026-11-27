/**
 * LES ÉDITIONS D'UNE SURFACE (GAL-ATMOSPHERES-001) : les observations datées d'une même couche, dérivées
 * des fiches du registre (`editions` des textures) et de l'édition par défaut de chaque corps
 * (`textureEditions`). Pur, sans entrée/sortie : le greffon `deriveRegistryText` (Node) l'appelle pour
 * servir `virtual:surface-edition-catalogue`, et les tests l'importent tels quels. Imports relatifs seulement.
 *
 * Ce que ce module NE fait pas : interpoler entre deux observations. Une atmosphère n'est connue qu'aux
 * dates observées ; entre elles, rien n'est montré d'autre qu'une observation, datée.
 */

export interface SurfaceEdition {
  readonly edition: string;
  /** Intervalle de la première rotation observée, en UTC. */
  readonly from: string;
  readonly to: string;
  readonly colorNature: string;
  /** Part de la surface complétée (0 à 1). */
  readonly filledShare: number;
  /** Largeur de la source, en pixels, et paliers livrés. */
  readonly sourcePixelWidth: number;
  readonly tiers: readonly string[];
  readonly sourcePage: string;
}

export interface BodySurfaceEditions {
  readonly layer: string;
  readonly defaultEdition: string;
  /** Du plus ancien au plus récent. */
  readonly editions: readonly SurfaceEdition[];
}

interface RecordLike {
  readonly type?: string;
  readonly shipped?: boolean;
  readonly body?: string;
  readonly layer?: string;
  readonly editions?: readonly {
    readonly edition: string;
    readonly observed: { readonly from: string; readonly to: string };
    readonly colorNature: string;
    readonly filledShare: number;
    readonly sourcePixelWidth: number;
    readonly tiers: readonly string[];
    readonly sourcePage: string;
  }[];
}

/**
 * Les éditions par corps. Refuse une couche dont l'édition par défaut n'est pas dans la liste (le client
 * annoncerait une observation qu'il ne sait pas décrire), ou une édition en double.
 */
export function buildSurfaceEditions(
  records: readonly RecordLike[],
  defaults: Readonly<Record<string, Readonly<Record<string, string>>>>
): Record<string, BodySurfaceEditions> {
  const out: Record<string, BodySurfaceEditions> = {};
  for (const r of records) {
    if (r.type !== 'texture' || !r.shipped || !r.body || !r.layer) continue;
    if (!r.editions?.length) continue;
    const defaultEdition = defaults[r.body]?.[r.layer];
    const names = r.editions.map((e) => e.edition);
    if (new Set(names).size !== names.length)
      throw new Error(`éditions : doublon pour ${r.body}/${r.layer}`);
    if (!defaultEdition || !names.includes(defaultEdition))
      throw new Error(
        `éditions : ${r.body}/${r.layer} n'a pas son édition par défaut dans la liste`
      );
    out[r.body] = {
      layer: r.layer,
      defaultEdition,
      editions: [...r.editions]
        .sort((a, b) => a.observed.from.localeCompare(b.observed.from))
        .map((e) => ({
          edition: e.edition,
          from: e.observed.from,
          to: e.observed.to,
          colorNature: e.colorNature,
          filledShare: e.filledShare,
          sourcePixelWidth: e.sourcePixelWidth,
          tiers: [...e.tiers],
          sourcePage: e.sourcePage,
        })),
    };
  }
  return out;
}
