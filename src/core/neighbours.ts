/**
 * LES ÉTOILES VOISINES DU SOLEIL : le fichier livré et sa lecture. Pur, sans DOM ni Three.js.
 *
 * Deux fichiers, un par fournisseur (`public/assets/sky/neighbours/`, `scripts/generate-neighbours.mjs`) :
 * les étoiles de HYG à 5 pc ou moins, et leurs contreparties de Gaia DR3. `combineNeighbours` (plus
 * bas) les rapproche à l'exécution : distance et mouvement de Gaia DR3 quand la mesure est sûre, de
 * HYG sinon (`origin`). Une étoile devient une ligne du catalogue d'étoiles (`StarRow`) : elle a donc
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

/**
 * Les droits d'un fichier de fournisseur, écrits DANS le fichier : licence, titulaire, citation, ce que
 * Galaxy a changé. Chaque fichier n'en porte qu'une : deux fournisseurs aux droits différents ne
 * partagent jamais un fichier (GAL-UNIVERSE-008, séparation des données).
 */
export interface ProviderNotice {
  id: string;
  name: string;
  url: string;
  license: string;
  licenseUrl: string;
  rightsHolder: string;
  retrieved: string;
  changes: string;
  citation?: string;
  citationDoi?: string;
  acknowledgement?: string;
  acknowledgementUrl?: string;
  via?: string;
}

/** Une étoile de HYG v4.4 à 5 pc ou moins (`neighbours/hyg-v44.json`), valeurs de HYG seules. */
export type NeighbourHygRow = readonly [
  hygId: string,
  name: string,
  ids: string | null,
  spectral: string | null,
  raDeg: number,
  decDeg: number,
  distPc: number,
  vmag: number,
  pmRaMas: number,
  pmDecMas: number,
  rvKms: number | null,
];

/** Une source de Gaia DR3 (`neighbours/gaia-dr3.json`), valeurs publiées par Gaia à J2016,0. */
export type NeighbourGaiaRow = readonly [
  sourceId: string,
  raDeg: number,
  decDeg: number,
  parallaxMas: number,
  parallaxErrorMas: number,
  pmRaMas: number | null,
  pmDecMas: number | null,
  rvKms: number | null,
  ruwe: number | null,
  gMag: number | null,
];

export interface NeighbourHygFile {
  provider: ProviderNotice;
  maxDistancePc: number;
  fields: string[];
  stars: NeighbourHygRow[];
}

export interface NeighbourGaiaFile {
  provider: ProviderNotice;
  epoch: number;
  fields: string[];
  stars: NeighbourGaiaRow[];
}

/** Le voisinage tel que l'application le lit : les deux fournisseurs rapprochés à l'exécution. */
export interface NeighbourFile {
  source: {
    neighbours: {
      maxDistancePc: number;
      gaiaEpoch: number;
    };
    /** `null` : le fournisseur Gaia est absent ou désactivé ; toutes les lignes sont alors de HYG. */
    gaia: ProviderNotice | null;
    hyg: ProviderNotice;
  };
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

/**
 * LE RAPPROCHEMENT À L'EXÉCUTION (GAL-UNIVERSE-008, séparation des données). HYG et Gaia DR3 ne
 * partagent aucun fichier : le client lit les deux et refait ici, avec les MÊMES règles que le
 * générateur (`scripts/generate-neighbours.mjs`, comparées par `neighbourMatching.test.ts`), le choix de
 * la contrepartie Gaia de chaque étoile de HYG : même cône autour de la position ramenée à 2016, même
 * parallaxe minimale, puis parallaxe, mouvement propre et éclat concordants, RUWE et rapport signal sur
 * bruit. Sans fichier Gaia, chaque étoile garde la ligne de HYG (sauf un mouvement plafonné, écarté).
 */
export const NEIGHBOUR_MATCHING = {
  gaiaEpoch: 2016,
  hygPmCapMas: 9999.99,
  ruweMax: 1.4,
  parallaxSnrMin: 20,
  hygAgreement: 0.2,
  coneDeg: 0.1,
  censoredConeDeg: 0.15,
  pmAgreement: 0.1,
  pmFloorMas: 250,
  magAgreement: 4,
  /** La requête du générateur rend au plus 40 sources par cône, triées par parallaxe décroissante. */
  maxCandidates: 40,
} as const;

/** Position → autre époque par le mouvement propre (mas/an, pmRa déjà × cos δ). */
export function propagatePosition(
  raDeg: number,
  decDeg: number,
  pmRa: number,
  pmDec: number,
  years: number
): { raDeg: number; decDeg: number } {
  const cosDec = Math.cos((decDeg * Math.PI) / 180);
  return {
    raDeg: raDeg + (pmRa * years) / 3.6e6 / cosDec,
    decDeg: decDeg + (pmDec * years) / 3.6e6,
  };
}

function separationDeg(
  ra1: number,
  dec1: number,
  ra2: number,
  dec2: number
): number {
  const x =
    Math.sin(dec1 * RAD) * Math.sin(dec2 * RAD) +
    Math.cos(dec1 * RAD) * Math.cos(dec2 * RAD) * Math.cos((ra1 - ra2) * RAD);
  return Math.acos(Math.min(1, x)) / RAD;
}

const censoredPm = (h: NeighbourHygRow): boolean =>
  Math.abs(h[8]) >= NEIGHBOUR_MATCHING.hygPmCapMas ||
  Math.abs(h[9]) >= NEIGHBOUR_MATCHING.hygPmCapMas;

/** Les sources de Gaia que le cône de recherche du générateur rend autour d'une étoile de HYG. */
export function gaiaCandidates(
  h: NeighbourHygRow,
  gaia: readonly NeighbourGaiaRow[]
): NeighbourGaiaRow[] {
  const m = NEIGHBOUR_MATCHING;
  const censored = censoredPm(h);
  const at = censored
    ? { raDeg: h[4], decDeg: h[5] }
    : propagatePosition(h[4], h[5], h[8], h[9], m.gaiaEpoch - 2000);
  const radius = censored ? m.censoredConeDeg : m.coneDeg;
  const minParallax = Number(((1000 / h[6]) * 0.5).toFixed(2));
  return gaia
    .filter(
      (g) =>
        g[3] > minParallax &&
        separationDeg(at.raDeg, at.decDeg, g[1], g[2]) < radius
    )
    .sort((a, b) => b[3] - a[3])
    .slice(0, m.maxCandidates);
}

/** La contrepartie sûre de Gaia, ou `null` et la raison (mêmes règles que `chooseGaia` du générateur). */
export function chooseGaiaCounterpart(
  h: NeighbourHygRow,
  candidates: readonly NeighbourGaiaRow[],
  taken: ReadonlySet<string> = new Set()
): { gaia: NeighbourGaiaRow | null; reason: string | null } {
  const m = NEIGHBOUR_MATCHING;
  const plxHyg = 1000 / h[6];
  let best: NeighbourGaiaRow | null = null;
  for (const c of candidates) {
    if (taken.has(c[0])) continue;
    if (Math.abs(c[3] - plxHyg) / plxHyg > m.hygAgreement) continue;
    if (!censoredPm(h) && c[5] !== null && c[6] !== null) {
      const total = Math.hypot(h[8], h[9]);
      const gapPm = Math.hypot(c[5] - h[8], c[6] - h[9]);
      if (gapPm > Math.max(m.pmFloorMas, m.pmAgreement * total)) continue;
    }
    if (c[9] === null || Math.abs(c[9] - h[7]) > m.magAgreement) continue;
    if (!best || c[9] < best[9]!) best = c;
  }
  if (!best)
    return { gaia: null, reason: 'aucune contrepartie Gaia cohérente' };
  if (best[8] === null || best[8] >= m.ruweMax)
    return { gaia: null, reason: `RUWE ${best[8]} (≥ ${m.ruweMax})` };
  if (best[3] / best[4] < m.parallaxSnrMin)
    return { gaia: null, reason: 'parallaxe à moins de 20 sigmas' };
  if (best[5] === null || best[6] === null)
    return { gaia: null, reason: 'mouvement propre absent' };
  return { gaia: best, reason: null };
}

const roundTo = (v: number, digits: number): number =>
  Number(v.toFixed(digits));

/** La ligne affichée : valeurs de Gaia quand la contrepartie est sûre, sinon de HYG (`buildRow`). */
export function neighbourRowOf(
  h: NeighbourHygRow,
  gaia: NeighbourGaiaRow | null
): NeighbourRow {
  if (gaia) {
    const distPc = 1000 / gaia[3];
    const back = propagatePosition(
      gaia[1],
      gaia[2],
      gaia[5]!,
      gaia[6]!,
      2000 - NEIGHBOUR_MATCHING.gaiaEpoch
    );
    return [
      h[1],
      h[2],
      h[3],
      roundTo(back.raDeg, 6),
      roundTo(back.decDeg, 6),
      roundTo(distPc, 5),
      roundTo((distPc * gaia[4]) / gaia[3], 5),
      h[7],
      roundTo(gaia[5]!, 2),
      roundTo(gaia[6]!, 2),
      gaia[7] ?? h[10],
      'gaia-dr3',
      gaia[0],
    ];
  }
  return [
    h[1],
    h[2],
    h[3],
    roundTo(h[4], 6),
    roundTo(h[5], 6),
    h[6],
    null,
    h[7],
    h[8],
    h[9],
    h[10],
    'hyg-v44',
    null,
  ];
}

/** Rapproche les deux fournisseurs ; `gaia` absent : HYG seul (mouvements plafonnés écartés). */
export function combineNeighbours(
  hyg: NeighbourHygFile,
  gaia: NeighbourGaiaFile | null
): NeighbourFile {
  const taken = new Set<string>();
  const rows: NeighbourRow[] = [];
  const pool = gaia?.stars ?? [];
  // Du plus brillant au plus faible : la composante A d'un double prend la source la plus brillante.
  for (const h of [...hyg.stars].sort((a, b) => a[7] - b[7])) {
    const { gaia: match } = chooseGaiaCounterpart(
      h,
      gaiaCandidates(h, pool),
      taken
    );
    if (match) taken.add(match[0]);
    else if (censoredPm(h)) continue;
    rows.push(neighbourRowOf(h, match));
  }
  rows.sort((a, b) => a[5] - b[5]);
  return {
    source: {
      neighbours: {
        maxDistancePc: hyg.maxDistancePc,
        gaiaEpoch: NEIGHBOUR_MATCHING.gaiaEpoch,
      },
      gaia: gaia?.provider ?? null,
      hyg: hyg.provider,
    },
    count: rows.length,
    stars: rows,
  };
}
