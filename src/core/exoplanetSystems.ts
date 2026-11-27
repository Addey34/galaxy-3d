/**
 * L'ARCHITECTURE D'UN SYSTÈME STELLAIRE (GAL-UNIVERSE-006). Pur, sans DOM ni Three.js.
 *
 * Un système exploré se construit à partir de deux sources déjà intégrées, sans rien inventer :
 *  - les COMPOSANTES stellaires : le catalogue des voisines (`neighbours/`, rapproché par `combineNeighbours` : position, distance,
 *    type spectral ; Gaia DR3 ou HYG) ;
 *  - les PLANÈTES et les paramètres de l'étoile hôte : l'instantané détaillé de la NASA Exoplanet
 *    Archive (`public/assets/sky/systems/*.json`, `scripts/generate-exoplanet-systems.mjs`), où chaque
 *    valeur porte un drapeau « calculée par l'archive ».
 *
 * La correspondance étoile ↔ hôte de l'archive reste celle de la visite du voisinage
 * (`core/stellarVisit.archiveMatches` : direction seule, tolérance qui suit le mouvement propre, jamais
 * le nom ni la distance, garde des trois divergences de distance de #576). Elle est seulement
 * départagée ici entre les composantes d'un même système, par la plus petite séparation.
 *
 * CE QUI EST REPRÉSENTÉ, ET CE QUI NE L'EST PAS (`orbitShape`) :
 *  - le demi-grand axe et l'excentricité publiés donnent la plage de distances à l'étoile, du
 *    périastre a(1 − e) à l'apoastre a(1 + e) : c'est une BANDE, pas une ellipse orientée. L'argument
 *    du périastre est compté depuis le nœud ascendant, dont la longitude (Ω) n'a aucune colonne dans
 *    la table composite (schéma TAP lu le 2026-11-25) : deux ellipses orientées chacune par son ω
 *    seraient une disposition relative inventée ;
 *  - aucune planète n'est placée sur son orbite : l'instant du périastre, parfois publié, donnerait
 *    une distance à l'étoile à une date, pas une direction sur une orbite d'orientation inconnue ;
 *  - l'inclinaison est rarement publiée et jamais avec le nœud : toutes les orbites sont dessinées de
 *    face, et la vue le dit ;
 *  - un demi-grand axe absent peut se DÉRIVER de la période et de la masse de l'étoile (troisième loi
 *    de Kepler, masse de la planète négligée) : la valeur est alors marquée « dérivée ici » ;
 *  - sans demi-grand axe ni moyen de le dériver, la planète n'a qu'une fiche documentaire.
 */
import {
  AU_PER_PARSEC,
  totalProperMotionArcsecPerYear,
  systemPrimary,
  type NeighbourRow,
  type NeighbourSystem,
} from './neighbours';
import { UNKNOWN_DISTANCE_PC, type ExoplanetSystem } from './exoplanets';
import { archiveMatches } from './stellarVisit';

/** Nombre de paquets : le même que `scripts/generate-exoplanet-systems.mjs` (un test lit les fichiers). */
export const SYSTEM_BUCKETS = 32;

/** FNV-1a 32 bits sur les unités UTF-16 du nom d'hôte, modulo le nombre de paquets. */
export function bucketOf(host: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < host.length; i++) {
    h ^= host.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % SYSTEM_BUCKETS;
}

/** L'adresse du paquet qui porte cet hôte. */
export function bucketUrl(host: string): string {
  return `/assets/sky/systems/${String(bucketOf(host)).padStart(2, '0')}.json`;
}

/** Drapeau de provenance : 1 = calculée par l'archive, 0 = tirée d'une publication, null = pas de valeur. */
type Calc = 0 | 1 | null;

export type SystemPlanetRow = readonly [
  name: string,
  periodDays: number | null,
  periodCalc: Calc,
  semiMajorAxisAu: number | null,
  semiMajorAxisCalc: Calc,
  eccentricity: number | null,
  eccentricityCalc: Calc,
  inclinationDeg: number | null,
  inclinationCalc: Calc,
  radiusEarth: number | null,
  radiusCalc: Calc,
  massEarth: number | null,
  massCalc: Calc,
  massKind: string | null,
  discoveryYear: number | null,
  method: string | null,
  controversial: 0 | 1,
  circumbinary: 0 | 1,
];

export type SystemHostRow = readonly [
  host: string,
  raDeg: number,
  decDeg: number,
  distPc: number | null,
  stars: number | null,
  planetCount: number | null,
  spectral: string | null,
  teffK: number | null,
  teffCalc: Calc,
  radiusSun: number | null,
  radiusCalc: Calc,
  massSun: number | null,
  massCalc: Calc,
  planets: readonly SystemPlanetRow[],
];

export interface SystemsFile {
  source: {
    id: string;
    name: string;
    url: string;
    table: string;
    acknowledgementUrl: string;
    citation: string;
    retrieved: string;
    planets: number;
    systems: number;
  };
  bucket: number;
  buckets: number;
  fields: string[];
  planetFields: string[];
  count: number;
  systems: SystemHostRow[];
}

/** Une valeur et sa NATURE : publiée, calculée par l'archive, dérivée par cette vue, ou inconnue. */
export type Provenance = 'published' | 'archiveCalculated' | 'derived';
export interface Valued {
  value: number;
  provenance: Provenance;
}

const valued = (value: number | null, calc: Calc): Valued | null =>
  value === null
    ? null
    : { value, provenance: calc === 1 ? 'archiveCalculated' : 'published' };

/** Rayon solaire nominal en UA (IAU 2015 B3 : 695 700 km ; 1 UA = 149 597 870,7 km). */
export const SUN_RADIUS_AU = 695_700 / 149_597_870.7;
/** Jours d'une année julienne : l'unité de la troisième loi de Kepler en UA, années et masses solaires. */
export const DAYS_PER_YEAR = 365.25;

/**
 * Le demi-grand axe tiré de la période et de la masse de l'étoile (troisième loi de Kepler, unités du
 * Système solaire : a³ = M P², masse de la planète négligée). `null` sans l'une des deux.
 */
export function keplerAxisAu(
  periodDays: number | null,
  starMassSun: number | null
): number | null {
  if (periodDays === null || starMassSun === null) return null;
  if (!(periodDays > 0) || !(starMassSun > 0)) return null;
  const years = periodDays / DAYS_PER_YEAR;
  return Math.cbrt(starMassSun * years * years);
}

/**
 * Ce que la vue peut dessiner de l'orbite d'une planète :
 *  - `band` : demi-grand axe et excentricité non nulle connus, la plage [périastre, apoastre] ;
 *  - `circle` : excentricité publiée nulle (souvent FIXÉE à zéro par l'ajustement, la fiche le dit) ;
 *  - `axisOnly` : demi-grand axe connu, excentricité non publiée (cercle en tirets) ;
 *  - `none` : rien ne permet de placer l'orbite (fiche documentaire seulement).
 */
export type OrbitShape =
  | {
      kind: 'band';
      axis: Valued;
      eccentricity: Valued;
      periastronAu: number;
      apoastronAu: number;
    }
  | { kind: 'circle'; axis: Valued; eccentricity: Valued }
  | { kind: 'axisOnly'; axis: Valued }
  | { kind: 'none' };

export function planetAxis(
  planet: SystemPlanetRow,
  host: SystemHostRow | null
): Valued | null {
  const published = valued(planet[3], planet[4]);
  if (published) return published;
  const derived = keplerAxisAu(planet[1], host?.[11] ?? null);
  return derived === null ? null : { value: derived, provenance: 'derived' };
}

export function orbitShape(
  planet: SystemPlanetRow,
  host: SystemHostRow | null
): OrbitShape {
  const axis = planetAxis(planet, host);
  if (!axis) return { kind: 'none' };
  const eccentricity = valued(planet[5], planet[6]);
  if (!eccentricity || eccentricity.value < 0 || eccentricity.value >= 1)
    return { kind: 'axisOnly', axis };
  if (eccentricity.value === 0) return { kind: 'circle', axis, eccentricity };
  return {
    kind: 'band',
    axis,
    eccentricity,
    periastronAu: axis.value * (1 - eccentricity.value),
    apoastronAu: axis.value * (1 + eccentricity.value),
  };
}

/** La masse de la planète et ce qu'elle est : masse vraie, masse minimale (m sin i), ou calculée. */
export interface PlanetMass {
  value: number;
  kind: 'mass' | 'minimum' | 'archiveCalculated';
}

export function planetMass(planet: SystemPlanetRow): PlanetMass | null {
  const value = planet[11];
  if (value === null) return null;
  if (planet[12] === 1) return { value, kind: 'archiveCalculated' };
  const kind = (planet[13] ?? '').toLowerCase();
  if (kind === 'mass') return { value, kind: 'mass' };
  if (kind === 'msini' || kind === 'msin(i)/sin(i)')
    return { value, kind: 'minimum' };
  // Toute autre provenance de l'archive (« M-R relationship »…) est un calcul, pas une mesure.
  return { value, kind: 'archiveCalculated' };
}

/** Séparation angulaire (secondes d'arc) entre deux directions (degrés). */
export function angularSeparationArcsec(
  ra1: number,
  dec1: number,
  ra2: number,
  dec2: number
): number {
  const rad = Math.PI / 180;
  const cos =
    Math.sin(dec1 * rad) * Math.sin(dec2 * rad) +
    Math.cos(dec1 * rad) * Math.cos(dec2 * rad) * Math.cos((ra1 - ra2) * rad);
  return Math.acos(Math.max(-1, Math.min(1, cos))) * (180 / Math.PI) * 3600;
}

/** L'époque des positions de l'archive (Gaia DR3) : sert seulement à départager deux composantes. */
const ARCHIVE_EPOCH_YEARS_FROM_J2000 = 16;

/** La direction d'une étoile voisine, déplacée de `years` par son mouvement propre (mas/an, α × cos δ). */
function propagated(row: NeighbourRow, years: number): [number, number] {
  const dec = row[4] + (row[9] * years) / 3_600_000;
  const cosDec = Math.cos((row[4] * Math.PI) / 180);
  const ra = row[3] + (row[8] * years) / 3_600_000 / Math.max(1e-9, cosDec);
  return [ra, dec];
}

/**
 * Les hôtes de l'archive de CHAQUE composante d'un système. Les hôtes reconnus sont ceux de
 * `archiveMatches` (inchangé) ; un hôte reconnu par plusieurs composantes (Struve 2398 A et B sont
 * à 12″ : les deux tolérances se recouvrent) va à la plus proche, positions ramenées à l'époque de
 * l'archive. Rend, pour chaque membre (dans l'ordre de `system.members`), la liste de ses hôtes.
 */
export function hostsByMember(
  system: NeighbourSystem,
  archive: readonly ExoplanetSystem[]
): string[][] {
  const matched = new Set(archiveMatches(system, archive).map((m) => m.host));
  const out = system.members.map(() => [] as string[]);
  for (const host of archive) {
    if (!matched.has(host[0])) continue;
    let best = 0;
    let bestSep = Infinity;
    system.members.forEach((member, i) => {
      const [ra, dec] = propagated(member, ARCHIVE_EPOCH_YEARS_FROM_J2000);
      const sep = angularSeparationArcsec(ra, dec, host[1], host[2]);
      if (sep < bestSep) {
        bestSep = sep;
        best = i;
      }
    });
    out[best]!.push(host[0]);
  }
  return out;
}

/**
 * La séparation PROJETÉE entre deux composantes, en UA : l'angle sur le ciel (″) × la distance (pc)
 * donne des UA exactement (définition du parsec). C'est une distance minimale entre les deux étoiles
 * (la composante le long de la ligne de visée est inconnue), et elle change au fil de leur orbite.
 */
export function projectedSeparationAu(
  a: NeighbourRow,
  b: NeighbourRow
): number {
  return angularSeparationArcsec(a[3], a[4], b[3], b[4]) * a[5];
}

/**
 * La position projetée d'une composante par rapport à la primaire, dans le plan du ciel, en UA :
 * x vers l'OUEST (à droite pour un observateur qui regarde le ciel, nord en haut), y vers le nord.
 * Mesure directe des positions du catalogue (J2000), à la distance de la primaire.
 */
export function skyOffsetAu(
  primary: NeighbourRow,
  member: NeighbourRow
): [number, number] {
  const rad = Math.PI / 180;
  const dRa = (member[3] - primary[3]) * Math.cos(primary[4] * rad) * 3600;
  const dDec = (member[4] - primary[4]) * 3600;
  return [-dRa * primary[5], dDec * primary[5]];
}

export interface SystemComponent {
  /** Le nom affiché : celui du catalogue des voisines, ou celui de l'hôte dans l'archive. */
  name: string;
  /** Type spectral (catalogue des voisines d'abord, sinon archive), ou null. */
  spectral: string | null;
  /**
   * La ligne du catalogue des voisines, ou null pour un système du ciel lointain (GAL-UNIVERSE-007) :
   * il n'est alors connu que par l'archive, et rien n'est inventé de ce qu'elle ne publie pas
   * (vitesse radiale, incertitude de distance…).
   */
  row: NeighbourRow | null;
  /** Distance au Soleil (pc) publiée par l'archive (`sy_dist`) pour un système sans ligne du catalogue. */
  archiveDistPc: number | null;
  /**
   * Vrai quand l'archive range au moins une planète de cette composante comme CIRCUMBINAIRE : elle tourne
   * autour d'un couple d'étoiles dont les positions ne sont pas dans les données. La vue ne dessine alors
   * pas d'étoile individuelle au centre de ses orbites (`SystemScene`), et la fiche le dit.
   */
  circumbinary: boolean;
  /** L'hôte de l'archive qui est cette étoile (le premier s'il y en a plusieurs), ou null. */
  host: SystemHostRow | null;
  /** Position projetée dans le plan du ciel (UA), la primaire à l'origine. */
  offsetAu: readonly [number, number];
  /** Séparation projetée à la primaire (UA), nulle pour la primaire. */
  separationAu: number;
}

export interface SystemPlanet {
  row: SystemPlanetRow;
  /** Rang de la composante autour de laquelle elle tourne. */
  component: number;
  shape: OrbitShape;
}

export interface SystemModel {
  name: string;
  components: SystemComponent[];
  planets: SystemPlanet[];
  /** Nombre d'étoiles du système selon l'archive (le plus grand de ses hôtes), ou null. */
  archiveStars: number | null;
  /** Hôtes reconnus mais absents de l'instantané détaillé (archive mise à jour entre deux lectures). */
  missingHosts: string[];
  /** Vrai quand au moins une orbite peut être dessinée ; sinon la vue est documentaire. */
  spatial: boolean;
}

/**
 * Le modèle d'un système : ses composantes (catalogue des voisines), leurs planètes (instantané détaillé),
 * l'orbite représentable de chacune. `details` donne les hôtes lus, par nom ; `hosts` vient de
 * `hostsByMember`.
 */
export function buildSystemModel(
  system: NeighbourSystem,
  name: string,
  hosts: readonly string[][],
  details: ReadonlyMap<string, SystemHostRow>
): SystemModel {
  // La primaire (la plus brillante, celle qui nomme le système) d'abord, à l'origine ; les autres dans l'ordre du catalogue.
  const primary = systemPrimary(system);
  const order = [
    system.members.indexOf(primary),
    ...system.members
      .map((_, i) => i)
      .filter((i) => system.members[i] !== primary),
  ];
  const missingHosts: string[] = [];
  const components: SystemComponent[] = order.map((member, i) => {
    const row = system.members[member]!;
    const names = hosts[member] ?? [];
    const found = names.map((n) => details.get(n) ?? null);
    names.forEach((n, k) => {
      if (!found[k]) missingHosts.push(n);
    });
    const host = found.find((h): h is SystemHostRow => h !== null) ?? null;
    return {
      name: row[0],
      spectral: row[2] ?? host?.[6] ?? null,
      row,
      archiveDistPc: null,
      circumbinary: found.some((h) => h?.[13].some((p) => p[17] === 1)),
      host,
      offsetAu: i === 0 ? [0, 0] : skyOffsetAu(primary, row),
      separationAu: i === 0 ? 0 : projectedSeparationAu(primary, row),
    };
  });
  const planets: SystemPlanet[] = [];
  order.forEach((member, i) => {
    for (const hostName of hosts[member] ?? []) {
      const host = details.get(hostName);
      if (!host) continue;
      for (const row of host[13])
        planets.push({ row, component: i, shape: orbitShape(row, host) });
    }
  });
  planets.sort(
    (a, b) =>
      a.component - b.component ||
      axisOf(a.shape) - axisOf(b.shape) ||
      a.row[0].localeCompare(b.row[0])
  );
  const stars = components
    .map((c) => c.host?.[4] ?? null)
    .filter((n): n is number => n !== null);
  return {
    name,
    components,
    planets,
    archiveStars: stars.length ? Math.max(...stars) : null,
    missingHosts,
    spatial: planets.some((p) => p.shape.kind !== 'none'),
  };
}

/**
 * Le modèle d'un système choisi dans le CIEL (GAL-UNIVERSE-007), connu de l'archive seule : une composante
 * (l'hôte), ses planètes de l'instantané détaillé. Aucune autre étoile n'est dessinée : l'archive dit
 * combien le système en compte (`sy_snum`), jamais où elles sont. `detail` est null quand l'hôte du ciel
 * manque à l'instantané détaillé (lus à des dates différentes) : la vue est alors documentaire et le dit.
 */
export function buildHostModel(
  sky: ExoplanetSystem,
  detail: SystemHostRow | null
): SystemModel {
  const planets: SystemPlanet[] = (detail?.[13] ?? [])
    .map((row) => ({ row, component: 0, shape: orbitShape(row, detail) }))
    .sort(
      (a, b) =>
        axisOf(a.shape) - axisOf(b.shape) || a.row[0].localeCompare(b.row[0])
    );
  const dist = detail?.[3] ?? sky[3];
  return {
    name: sky[0],
    components: [
      {
        name: sky[0],
        spectral: detail?.[6] ?? null,
        row: null,
        archiveDistPc:
          dist !== null && dist < UNKNOWN_DISTANCE_PC ? dist : null,
        circumbinary: planets.some((p) => p.row[17] === 1),
        host: detail,
        offsetAu: [0, 0],
        separationAu: 0,
      },
    ],
    planets,
    archiveStars: detail?.[4] ?? null,
    missingHosts: detail ? [] : [sky[0]],
    spatial: planets.some((p) => p.shape.kind !== 'none'),
  };
}

/**
 * Le système du voisinage qui PORTE cet hôte de l'archive (par la même règle que la visite, `hostsByMember`),
 * ou null : un hôte choisi dans le ciel qui est une étoile voisine s'explore avec ses composantes du
 * catalogue, comme depuis la vue du voisinage.
 */
export function neighbourSystemOf(
  host: string,
  systems: readonly NeighbourSystem[],
  archive: readonly ExoplanetSystem[]
): NeighbourSystem | null {
  const target = archive.find((h) => h[0] === host);
  if (!target) return null;
  for (const system of systems) {
    // Présélection bon marché : une étoile voisine à moins de 10° de l'hôte, sinon rien à départager.
    const near = system.members.some(
      (m) => angularSeparationArcsec(m[3], m[4], target[1], target[2]) < 36_000
    );
    if (near && hostsByMember(system, archive).flat().includes(host))
      return system;
  }
  return null;
}

const axisOf = (shape: OrbitShape): number =>
  shape.kind === 'none' ? Number.POSITIVE_INFINITY : shape.axis.value;

/** La plus grande distance à l'étoile qu'une orbite dessinée atteint autour de sa composante (UA), ou 0. */
export function orbitExtentAu(model: SystemModel, component: number): number {
  let extent = 0;
  for (const p of model.planets) {
    if (p.component !== component) continue;
    if (p.shape.kind === 'band') extent = Math.max(extent, p.shape.apoastronAu);
    else if (p.shape.kind !== 'none')
      extent = Math.max(extent, p.shape.axis.value);
  }
  return extent;
}

/** Rayon de l'étoile en UA (rayon solaire nominal de l'IAU), ou null si l'archive ne le donne pas. */
export function starRadiusAu(host: SystemHostRow | null): number | null {
  const r = host?.[9] ?? null;
  return r !== null && r > 0 ? r * SUN_RADIUS_AU : null;
}

/** Distance (pc) → UA, pour dire la distance d'une étoile dans l'unité de la vue. */
export function parsecsToAu(pc: number): number {
  return pc * AU_PER_PARSEC;
}

/** Mouvement propre total (″/an) d'une composante, pour la fiche. */
export const properMotion = totalProperMotionArcsecPerYear;
