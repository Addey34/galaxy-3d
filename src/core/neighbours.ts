/**
 * LES ÉTOILES VOISINES DU SOLEIL : le fichier livré et sa lecture. Pur, sans DOM ni Three.js.
 *
 * `public/assets/sky/neighbours.json` (`scripts/generate-neighbours.mjs`) liste les étoiles à 5 pc
 * ou moins, avec la distance et le mouvement de Gaia DR3 quand la mesure est sûre et ceux de HYG
 * sinon (`origin`). Une étoile devient une ligne du catalogue d'étoiles (`StarRow`) : elle a donc
 * gratuitement sa direction à n'importe quelle date par son mouvement propre (`starDirection`).
 *
 * LA DISTANCE N'EST JAMAIS DESSINÉE. Comme les autres couches du ciel, un repère est une direction
 * à l'infini ; la distance vit dans la fiche, en nombres exacts. C'est ce qui garde l'invariant du
 * produit (aucune taille ni position de scène inventée) : à 4,25 années-lumière, Proxima serait à
 * 9,4 millions d'unités de scène, hors de portée de la caméra de la scène solaire.
 */
import { LIGHT_YEARS_PER_PARSEC } from './exoplanets';
import type { StarRow } from './starCatalogue';

/** Une étoile du fichier, dans l'ordre de `fields`. */
export type NeighbourRow = readonly [
  name: string,
  ids: string | null,
  spectral: string | null,
  raDeg: number,
  decDeg: number,
  distPc: number,
  distErrPc: number | null,
  vmag: number,
  pmRaMas: number,
  pmDecMas: number,
  rvKms: number | null,
  origin: 'gaia-dr3' | 'hyg-v44',
  gaiaSourceId: string | null,
];

export interface NeighbourFile {
  source: {
    neighbours: {
      description: string;
      maxDistancePc: number;
      gaiaEpoch: number;
      /** Plafond du mouvement propre de HYG : une valeur égale est une borne inférieure (Barnard). */
      pmCapMasPerYear?: number;
    };
    /** Null quand Gaia est suspendu (GAL-RIGHTS-SAFEGUARD-001) : toutes les lignes viennent de HYG. */
    gaia: {
      name: string;
      url: string;
      archive: string;
      citationDoi: string;
      acknowledgement: string;
      acknowledgementUrl: string;
    } | null;
    hyg: { name: string; url: string; license: string; licenseUrl: string };
  };
  fields: string[];
  count: number;
  stars: NeighbourRow[];
}

/** Une étoile (ou plusieurs, si elles sont indiscernables à l'œil) : ce que le repère désigne. */
export interface NeighbourSystem {
  /** Les composantes, la plus proche d'abord. Au moins une. */
  members: readonly NeighbourRow[];
}

/** 1 pc en unités astronomiques : 648 000 / π (définition de l'UAI, résolution B2 de 2015). */
export const AU_PER_PARSEC = 648_000 / Math.PI;
/** Séparation sous laquelle deux étoiles partagent un repère : un repère fait 9 pixels. */
export const SAME_MARKER_ARCSEC = 60;

const RAD = Math.PI / 180;

/** L'étoile sous la forme du catalogue du ciel (mêmes champs, vitesse radiale 0 si inconnue). */
export function neighbourAsStar(row: NeighbourRow): StarRow {
  return [
    row[3],
    row[4],
    row[7],
    null,
    row[5],
    row[8],
    row[9],
    row[10] ?? 0,
    row[0],
  ];
}

/** Séparation angulaire de deux directions (degrés → secondes d'arc), formule de Vincenty-haversine. */
export function separationArcsec(a: NeighbourRow, b: NeighbourRow): number {
  const dRa = (a[3] - b[3]) * RAD;
  const dDec = (a[4] - b[4]) * RAD;
  const h =
    Math.sin(dDec / 2) ** 2 +
    Math.cos(a[4] * RAD) * Math.cos(b[4] * RAD) * Math.sin(dRa / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h))) * (180 / Math.PI) * 3600;
}

/**
 * Regroupe les étoiles que leur séparation rend indiscernables (Sirius A et B, α Cen A et B) :
 * un repère par système, la fiche liste les composantes. Chaînage simple, dans l'ordre de distance.
 */
export function groupSystems(
  rows: readonly NeighbourRow[],
  maxArcsec = SAME_MARKER_ARCSEC
): NeighbourSystem[] {
  const systems: NeighbourRow[][] = [];
  for (const row of rows) {
    const home = systems.find((members) =>
      members.some((m) => separationArcsec(m, row) <= maxArcsec)
    );
    if (home) home.push(row);
    else systems.push([row]);
  }
  return systems.map((members) => ({ members }));
}

/** Le nom du système : celui de sa composante la plus brillante (V la plus faible). */
export function systemName(system: NeighbourSystem): string {
  return systemPrimary(system)[0];
}

/** La composante la plus brillante du système (V la plus faible) : elle donne le nom et le repère. */
export function systemPrimary(system: NeighbourSystem): NeighbourRow {
  return system.members.reduce((a, b) => (b[7] < a[7] ? b : a));
}

/** L'étoile sous la forme du catalogue du ciel, pour le repère du système (sa composante brillante). */
export function systemAsStar(system: NeighbourSystem): StarRow {
  return neighbourAsStar(systemPrimary(system));
}

/** Noms de la même étoile selon l'UAI ou l'usage : de quoi la retrouver par la recherche. */
const ALIASES: Readonly<Record<string, readonly string[]>> = {
  'Rigil Kentaurus': ['Alpha Centauri', 'Alpha Centauri A', 'Alpha Cen A'],
  Toliman: ['Alpha Centauri B', 'Alpha Cen B'],
  'Proxima Centauri': ['Proxima', 'Alpha Centauri C', 'Alpha Cen C'],
  Ran: ['Epsilon Eridani', 'Eps Eridani', 'Eps Eri'],
  Keid: ['Omicron 2 Eridani', '40 Eridani'],
};

/** Tous les noms qui désignent un système : noms des composantes, autres désignations, alias. */
export function namesOf(system: NeighbourSystem): string[] {
  const names: string[] = [];
  for (const m of system.members) {
    names.push(m[0]);
    for (const id of (m[1] ?? '').split(' · ')) if (id) names.push(id);
    names.push(...(ALIASES[m[0]] ?? []));
  }
  return [...new Set(names)];
}

export interface DistanceFacts {
  lightYears: number;
  /** Incertitude en années-lumière, ou null si la source n'en publie pas. */
  lightYearsError: number | null;
  au: number;
  /** Distance si la Terre était à 1 cm du Soleil, en kilomètres. */
  kmAtOneCentimetre: number;
}

/** Distances dérivées : tout vient de la seule distance publiée, avec les constantes de l'UAI. */
export function distanceFacts(row: NeighbourRow): DistanceFacts {
  const au = row[5] * AU_PER_PARSEC;
  return {
    lightYears: row[5] * LIGHT_YEARS_PER_PARSEC,
    lightYearsError: row[6] === null ? null : row[6] * LIGHT_YEARS_PER_PARSEC,
    au,
    // 1 UA = 1 cm  →  d UA = d cm = d / 100 000 km.
    kmAtOneCentimetre: au / 100_000,
  };
}

/** Mouvement propre total, en secondes d'arc par an (les deux composantes publiées, en mas/an). */
export function totalProperMotionArcsecPerYear(row: NeighbourRow): number {
  return Math.hypot(row[8], row[9]) / 1000;
}

/** Vitesse radiale : > 0 l'étoile s'éloigne, < 0 elle se rapproche ; null si la source n'en donne pas. */
export function approach(row: NeighbourRow): 'approaching' | 'receding' | null {
  if (row[10] === null || row[10] === 0) return null;
  return row[10] < 0 ? 'approaching' : 'receding';
}

/** Le texte d'un repère : nom et distance en années-lumière (un chiffre après la virgule). */
export function markerLabel(
  system: NeighbourSystem,
  format: (lightYears: number) => string
): string {
  const primary = systemPrimary(system);
  return `${systemName(system)} · ${format(distanceFacts(primary).lightYears)}`;
}
