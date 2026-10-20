/**
 * LES JEUX DE BÂTIMENTS (lot 63, étape C.3b) : ce que le cuiseur a publié, et quel jeu couvre un
 * lieu. Le cuiseur (`pnpm buildings:bake`) écrit, par jeu, un manifeste et, pour tous, un index ;
 * ce module les LIT et ne décide rien d'autre que « lequel couvre ce point ».
 *
 * Un point peut être couvert par plusieurs jeux (une source nationale ET une source mondiale) :
 * l'index les range dans l'ordre de PRIORITÉ où le cuiseur les a écrits, et le premier qui
 * couvre gagne. Les jeux ne sont jamais fusionnés (ODbL 4.4 d) : on en affiche un.
 */

/** Ce que l'application lit d'un manifeste de jeu (le reste est pour la légende, C.4). */
export interface BuildingSetManifest {
  id: string;
  /** Identifiant du corps (celui des fiches de tuiles), jamais un nom d'affichage. */
  body: string;
  title: string;
  zoom: number;
  /** Chemin du répertoire haché, relatif à l'origine du service de données. */
  directory: string;
  bboxLonLat: [number, number, number, number];
  /** Les tuiles qui existent (une tuile sans bâtiment n'est pas écrite) ; absent = pas de liste. */
  tiles?: { column: number; row: number }[];
  source: {
    name: string;
    license: string;
    licenseUrl: string;
    attribution: string;
    readFrom: string;
    readTo: string;
  };
}

export interface BuildingSetIndexEntry {
  id: string;
  body: string;
  bboxLonLat: [number, number, number, number];
  /** Adresse du manifeste, relative à l'origine du site. */
  manifest: string;
}

export interface BuildingSetIndex {
  sets: BuildingSetIndexEntry[];
}

const isBbox = (value: unknown): value is [number, number, number, number] =>
  Array.isArray(value) &&
  value.length === 4 &&
  value.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
  (value as number[])[0]! < (value as number[])[2]! &&
  (value as number[])[1]! < (value as number[])[3]!;

/** Lit l'index, ou explique pourquoi il est refusé : un fichier absent revient en HTML. */
export function parseBuildingSetIndex(json: unknown): BuildingSetIndex {
  const sets = (json as { sets?: unknown } | null)?.sets;
  if (!Array.isArray(sets))
    throw new Error('index des bâtiments sans « sets »');
  return {
    sets: sets.map((entry, i) => {
      const e = entry as Partial<BuildingSetIndexEntry>;
      if (
        typeof e.id !== 'string' ||
        typeof e.body !== 'string' ||
        typeof e.manifest !== 'string' ||
        !isBbox(e.bboxLonLat)
      )
        throw new Error(`index des bâtiments : entrée ${i} incomplète`);
      return {
        id: e.id,
        body: e.body,
        manifest: e.manifest,
        bboxLonLat: e.bboxLonLat,
      };
    }),
  };
}

/** Lit un manifeste de jeu, ou explique pourquoi il est refusé. */
export function parseBuildingSetManifest(json: unknown): BuildingSetManifest {
  const m = json as Partial<BuildingSetManifest> | null;
  const s = m?.source as Partial<BuildingSetManifest['source']> | undefined;
  if (
    !m ||
    typeof m.id !== 'string' ||
    typeof m.body !== 'string' ||
    typeof m.title !== 'string' ||
    typeof m.zoom !== 'number' ||
    typeof m.directory !== 'string' ||
    !isBbox(m.bboxLonLat) ||
    !s ||
    typeof s.attribution !== 'string' ||
    typeof s.license !== 'string'
  )
    throw new Error('manifeste de bâtiments incomplet');
  return m as BuildingSetManifest;
}

/**
 * Le jeu qui couvre un point, ou `null`. `marginDeg` élargit l'emprise : une tuile à la lisière
 * déborde, et la visée est le point sous la caméra, pas le centre de ce qui est regardé.
 */
export function setCovering(
  index: BuildingSetIndex,
  body: string,
  longitudeDeg: number,
  latitudeDeg: number,
  marginDeg = 0
): BuildingSetIndexEntry | null {
  for (const entry of index.sets) {
    if (entry.body !== body) continue;
    const [west, south, east, north] = entry.bboxLonLat;
    if (
      longitudeDeg >= west - marginDeg &&
      longitudeDeg <= east + marginDeg &&
      latitudeDeg >= south - marginDeg &&
      latitudeDeg <= north + marginDeg
    )
      return entry;
  }
  return null;
}
