/**
 * LE VOLUME STELLAIRE ÉTENDU (GAL-UNIVERSE-008), pur : le format écrit par
 * `scripts/generate-stellar-volume.mjs`, et ce qu'on en tire. Aucun DOM, aucun objet Three.js.
 *
 * Contrat (`docs/ARCHITECTURE.md` § « Le volume stellaire étendu ») :
 *  - les coquilles portent position (pc) et vitesse (km/s) ÉQUATORIALES (ICRS) à J2016,0 ; elles sont
 *    tournées ici dans le repère de la scène stellaire par `equatorialToGalactic` puis
 *    `galacticToScene`, LES MÊMES fonctions que le voisinage à 5 pc : les deux vues sont cohérentes
 *    par construction (1 unité = 1 pc, Soleil à l'origine, plan galactique horizontal) ;
 *  - le mouvement est rectiligne uniforme, borné à la fenêtre de `STELLAR_MOTION_LIMIT_YEARS` comptée
 *    depuis J2000, comme dans le voisinage ; sans vitesse radiale publiée, la composante radiale est
 *    nulle (drapeau `radialVelocity` absent) ; une étoile « SIMBAD seul » n'a aucune vitesse ;
 *  - la couleur est INDICATIVE (indice de couleur → classe approximative d'une naine de la séquence
 *    principale), jamais un type spectral ;
 *  - ce qui manque reste manquant (`null`), rien n'est complété.
 */
import {
  clampMotionYears,
  equatorialToGalactic,
  galacticToScene,
  type Vec3,
} from './stellarSpace';

/** Les échelles proposées : le voisinage existant (5 pc), puis les trois coquilles. */
export const VOLUME_SCALES_PC = [5, 25, 50, 100] as const;
export type VolumeScale = (typeof VOLUME_SCALES_PC)[number];

/** Les filtres de la vue : tous, naines blanches probables, hôtes d'exoplanètes, vitesse radiale publiée. */
export const VOLUME_FILTERS = [
  'all',
  'whiteDwarfs',
  'exoplanetHosts',
  'radialVelocity',
] as const;
export type VolumeFilter = (typeof VOLUME_FILTERS)[number];

export interface VolumeFlags {
  radialVelocity: number;
  whiteDwarf: number;
  exoplanetHost: number;
  hyg: number;
  simbadOnly: number;
  colourBV: number;
  named: number;
}

export interface VolumeManifest {
  epochYear: number;
  recordBytes: number;
  detailBytes: number;
  detailBucket: number;
  positionScale: number;
  velocityScale: number;
  flags: VolumeFlags;
  count: number;
  counts: Record<string, number>;
  shells: Array<{
    maxPc: number;
    file: string;
    start: number;
    count: number;
    bytes: number;
    sha256: string;
  }>;
  details: Array<{ file: string; bytes: number; sha256: string }>;
  names: string;
  source: Record<string, Record<string, string>>;
  witnesses: {
    physical: Array<{ name: string; pc: [number, number] }>;
    gcnsGalactic: Array<{
      index: number;
      sourceId: string;
      distPc: number;
      galacticXyzPc: [number, number, number];
    }>;
  };
}

/** Une coquille décodée, dans le repère de la scène stellaire. */
export interface VolumeShell {
  maxPc: number;
  /** Rang global de sa première étoile (les détails et les noms sont indexés par rang global). */
  start: number;
  count: number;
  /** Positions à J2016,0 (pc, repère de la scène), trois par étoile. */
  epochPositions: Float32Array;
  /** Vitesses (pc par an, repère de la scène), trois par étoile. */
  velocities: Float32Array;
  /** Magnitude × 10 (G de Gaia, ou V de HYG) ; 255 = non publiée. */
  mag: Uint8Array;
  /** Indice de couleur × 25 (BP−RP, ou B−V si `colourBV`) ; −128 = non publié. */
  colour: Int8Array;
  flags: Uint8Array;
  /** Demi-intervalle 16-84 % de la distance, relatif, en ‰ ; 255 = non publié. */
  relErr: Uint8Array;
}

/** km/s → parsecs par an (même constante que `core/stellarSpace`). */
export const KMS_TO_PC_PER_YEAR = 31_557_600 / 3.085677581491367e13;

/** Décode une coquille et la tourne dans le repère de la scène stellaire. */
export function decodeShell(
  buffer: ArrayBuffer,
  manifest: Pick<
    VolumeManifest,
    'recordBytes' | 'positionScale' | 'velocityScale'
  >,
  shell: { maxPc: number; start: number; count: number }
): VolumeShell {
  const { recordBytes, positionScale, velocityScale } = manifest;
  if (buffer.byteLength !== shell.count * recordBytes)
    throw new Error(
      `coquille de ${shell.maxPc} pc : ${buffer.byteLength} octets pour ${shell.count} étoiles`
    );
  const view = new DataView(buffer);
  const n = shell.count;
  const epochPositions = new Float32Array(n * 3);
  const velocities = new Float32Array(n * 3);
  const mag = new Uint8Array(n);
  const colour = new Int8Array(n);
  const flags = new Uint8Array(n);
  const relErr = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * recordBytes;
    const p: Vec3 = [
      view.getInt16(o, true) / positionScale,
      view.getInt16(o + 2, true) / positionScale,
      view.getInt16(o + 4, true) / positionScale,
    ];
    const v: Vec3 = [
      (view.getInt16(o + 6, true) / velocityScale) * KMS_TO_PC_PER_YEAR,
      (view.getInt16(o + 8, true) / velocityScale) * KMS_TO_PC_PER_YEAR,
      (view.getInt16(o + 10, true) / velocityScale) * KMS_TO_PC_PER_YEAR,
    ];
    epochPositions.set(galacticToScene(equatorialToGalactic(p)), i * 3);
    velocities.set(galacticToScene(equatorialToGalactic(v)), i * 3);
    mag[i] = view.getUint8(o + 12);
    colour[i] = view.getInt8(o + 13);
    flags[i] = view.getUint8(o + 14);
    relErr[i] = view.getUint8(o + 15);
  }
  return {
    maxPc: shell.maxPc,
    start: shell.start,
    count: n,
    epochPositions,
    velocities,
    mag,
    colour,
    flags,
    relErr,
  };
}

/**
 * Écrit dans `target` les positions de la coquille `yearsFromJ2000` ans après J2000 (borné à la fenêtre
 * du voisinage). Les positions publiées sont à J2016,0 : le décalage est compté depuis cette époque.
 */
export function writePositionsAt(
  target: Float32Array,
  shell: VolumeShell,
  yearsFromJ2000: number,
  epochYear: number
): void {
  const dt = clampMotionYears(yearsFromJ2000) - (epochYear - 2000);
  const p = shell.epochPositions;
  const v = shell.velocities;
  for (let i = 0; i < p.length; i++) target[i] = p[i]! + v[i]! * dt;
}

/** Distance au Soleil (pc) de l'étoile `i` d'une coquille, à l'époque des données. */
export function epochDistancePc(shell: VolumeShell, i: number): number {
  const p = shell.epochPositions;
  return Math.hypot(p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!);
}

/** La magnitude publiée, ou `null`. */
export function magnitudeOf(shell: VolumeShell, i: number): number | null {
  const m = shell.mag[i]!;
  return m === 255 ? null : m / 10;
}

/** L'indice de couleur publié et sa nature (BP−RP de Gaia ou B−V de HYG), ou `null`. */
export function colourIndexOf(
  shell: VolumeShell,
  i: number,
  flags: VolumeFlags
): { value: number; kind: 'bp-rp' | 'b-v' } | null {
  const c = shell.colour[i]!;
  if (c === -128) return null;
  return {
    value: c / 25,
    kind: shell.flags[i]! & flags.colourBV ? 'b-v' : 'bp-rp',
  };
}

/** Demi-intervalle relatif de la distance (16-84 %), ou `null` (non publié, ou au-delà de 25,4 %). */
export function relativeDistanceErrorOf(
  shell: VolumeShell,
  i: number
): number | null {
  const e = shell.relErr[i]!;
  return e === 255 ? null : e / 1000;
}

/** Magnitude absolue (même bande que la magnitude) à la distance donnée, sans extinction. */
export function absoluteMagnitude(mag: number, distPc: number): number {
  return mag - 5 * Math.log10(distPc / 10);
}

/**
 * La lettre de classe APPROXIMATIVE qu'un indice de couleur suggère pour une naine de la séquence
 * principale (seuils arrondis du tableau de Pecaut et Mamajek 2013), pour colorer un point : jamais
 * affichée comme un type spectral. Une naine blanche probable prend la couleur des naines blanches.
 */
export function indicativeClass(
  index: { value: number; kind: 'bp-rp' | 'b-v' } | null,
  whiteDwarf: boolean
): string | null {
  if (whiteDwarf) return 'D';
  if (!index) return null;
  const limits =
    index.kind === 'bp-rp'
      ? [0.0, 0.38, 0.78, 0.98, 1.84]
      : [0.0, 0.3, 0.58, 0.81, 1.4];
  const classes = ['B', 'A', 'F', 'G', 'K', 'M'];
  let k = 0;
  while (k < limits.length && index.value >= limits[k]!) k++;
  return classes[k]!;
}

/** L'étoile `i` répond-elle au filtre ? */
export function matchesFilter(
  flagsValue: number,
  filter: VolumeFilter,
  flags: VolumeFlags
): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'whiteDwarfs':
      return (flagsValue & flags.whiteDwarf) !== 0;
    case 'exoplanetHosts':
      return (flagsValue & flags.exoplanetHost) !== 0;
    case 'radialVelocity':
      return (flagsValue & flags.radialVelocity) !== 0;
  }
}

/** Les coquilles à charger pour voir jusqu'à `radiusPc` (5 pc : aucune, le voisinage suffit). */
export function shellsFor(
  radiusPc: number,
  manifest: Pick<VolumeManifest, 'shells'>
): number[] {
  if (radiusPc <= 5) return [];
  const out: number[] = [];
  for (let k = 0; k < manifest.shells.length; k++) {
    out.push(k);
    if (manifest.shells[k]!.maxPc >= radiusPc) break;
  }
  return out;
}

/** Les détails d'une étoile (paquet de `detailBucket` étoiles, rang local). */
export interface VolumeDetail {
  /** Identifiant Gaia DR3, ou `null` (étoile prise à HYG ou à SIMBAD). */
  sourceId: string | null;
  parallaxMas: number | null;
  parallaxErrorMas: number | null;
  /** Écarts (pc) entre la médiane de la distance et ses centiles 16 et 84. */
  distanceBelowPc: number | null;
  distanceAbovePc: number | null;
  ruwe: number | null;
  whiteDwarfProbability: number | null;
  /** Probabilité, selon le GCNS, que l'astrométrie soit fiable. */
  astrometryProbability: number | null;
  radialVelocityErrorKms: number | null;
}

export function decodeDetail(
  buffer: ArrayBuffer,
  localIndex: number,
  detailBytes: number
): VolumeDetail {
  const view = new DataView(buffer, localIndex * detailBytes, detailBytes);
  const id = view.getBigInt64(0, true);
  const parallax = view.getFloat32(8, true);
  const u16 = (o: number, scale: number): number | null => {
    const v = view.getUint16(o, true);
    return v === 65535 ? null : v / scale;
  };
  const u8 = (o: number, scale: number): number | null => {
    const v = view.getUint8(o);
    return v === 255 ? null : v / scale;
  };
  return {
    sourceId: id === 0n ? null : id.toString(),
    parallaxMas: Number.isFinite(parallax) ? parallax : null,
    parallaxErrorMas: u16(12, 10000),
    distanceBelowPc: u16(14, 1000),
    distanceAbovePc: u16(16, 1000),
    ruwe: u16(18, 1000),
    whiteDwarfProbability: u8(20, 200),
    astrometryProbability: u8(21, 200),
    radialVelocityErrorKms: u16(22, 100),
  };
}

/** Le paquet de détails et le rang local d'une étoile de rang global `index`. */
export function detailLocation(
  index: number,
  detailBucket: number
): { bucket: number; local: number } {
  return {
    bucket: Math.floor(index / detailBucket),
    local: index % detailBucket,
  };
}

/**
 * Une entrée de `names.json` : nom affiché ; pour un hôte d'exoplanètes, l'hôte et le nombre de planètes ;
 * et, quand la source en publie un (lignes HYG), le type spectral (l'hôte vaut alors `null` s'il n'y en a pas).
 */
export type VolumeNameEntry =
  [string] | [string, string, number] | [string, string | null, number, string];

/** L'hôte d'exoplanètes et son nombre de planètes, ou `null`. */
export function hostOf(
  entry: VolumeNameEntry | undefined
): { host: string; planets: number } | null {
  if (!entry || entry.length < 3 || !entry[1]) return null;
  return { host: entry[1], planets: entry[2]! };
}

/** Le type spectral publié par la source, ou `null` (le GCNS n'en publie aucun). */
export function spectralOf(entry: VolumeNameEntry | undefined): string | null {
  return entry?.length === 4 ? entry[3] : null;
}

/** Pour la recherche : la forme sans accents, en minuscules, espaces réduits. */
export function searchKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cherche dans les noms : un préfixe passe avant une occurrence ailleurs, puis la plus proche du Soleil
 * (le rang global suit la distance). Rend au plus `limit` rangs globaux.
 */
export function searchNames(
  names: Readonly<Record<string, VolumeNameEntry>>,
  query: string,
  limit = 12
): number[] {
  const q = searchKey(query);
  if (q.length < 2) return [];
  const prefix: number[] = [];
  const inside: number[] = [];
  for (const [key, entry] of Object.entries(names)) {
    const host = hostOf(entry);
    const labels = host ? [entry[0], host.host] : [entry[0]];
    let best = -1;
    for (const label of labels) {
      const k = searchKey(label);
      if (k.startsWith(q)) best = Math.max(best, 1);
      else if (k.includes(q)) best = Math.max(best, 0);
    }
    if (best === 1) prefix.push(Number(key));
    else if (best === 0) inside.push(Number(key));
  }
  prefix.sort((a, b) => a - b);
  inside.sort((a, b) => a - b);
  return [...prefix, ...inside].slice(0, limit);
}
