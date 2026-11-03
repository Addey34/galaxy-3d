/**
 * LES SATELLITES ARTIFICIELS : lecture et validité des éléments orbitaux de CelesTrak.
 *
 * Module PUR (aucun DOM, aucune E/S). Les éléments viennent du service `galaxy-data`
 * (`services/galaxy-data/satellites.py`, qui relaie CelesTrak) ; ils décrivent une orbite moyenne
 * à UNE époque, propagée par SGP4. Cette précision n'est pas éternelle : l'erreur croît de
 * quelques kilomètres par jour, donc un élément n'est utilisé que dans une fenêtre autour de son
 * époque (`ELEMENT_VALIDITY_DAYS`), et JAMAIS extrapolé au-delà : hors fenêtre, le satellite n'est
 * pas dessiné au lieu de l'être au mauvais endroit.
 *
 * Importé seulement par la couche paresseuse (`ui/satelliteLayer`), jamais par le démarrage.
 */

/** Rayon équatorial terrestre de SGP4 (WGS 72), en km : l'unité de longueur des positions TEME. */
export const EARTH_RADIUS_KM = 6378.135;

/** Une unité astronomique, en km (valeur IAU 2012). */
export const AU_KM = 149_597_870.7;

/**
 * Demi-fenêtre de validité autour de l'époque, en jours. SGP4 dérive de l'ordre de 1 à 3 km par
 * jour en orbite basse (traînée atmosphérique comprise) : sept jours de chaque côté gardent
 * l'erreur sous la vingtaine de kilomètres, invisible tant qu'un satellite se lit comme un point.
 */
export const ELEMENT_VALIDITY_DAYS = 7;

const DAY_MS = 86_400_000;

/** Un objet du fichier, champs de l'OMM de CelesTrak renommés (cf. `satellites.py`). */
export interface SatelliteElements {
  id: number;
  name: string;
  designator?: string;
  /** Groupe de CelesTrak qui nomme l'objet en premier : `stations` ou `visual`. */
  group?: string;
  /** Époque, ISO 8601 en UTC, sans `Z` (la forme de CelesTrak) ou avec. */
  epoch: string;
  meanMotion: number;
  eccentricity: number;
  inclination: number;
  raan: number;
  argPerigee: number;
  meanAnomaly: number;
  bstar: number;
  meanMotionDot: number;
  meanMotionDdot: number;
  ephemerisType?: number;
  classification?: string;
  elementSet?: number;
  revAtEpoch?: number;
}

export interface SatelliteFile {
  version: 1;
  source: { name: string; url: string };
  /** Instant de lecture chez CelesTrak, ISO 8601 UTC. */
  fetchedAt: string;
  groups: Record<string, number>;
  objects: SatelliteElements[];
}

const NUMERIC: readonly (keyof SatelliteElements)[] = [
  'id',
  'meanMotion',
  'eccentricity',
  'inclination',
  'raan',
  'argPerigee',
  'meanAnomaly',
  'bstar',
  'meanMotionDot',
  'meanMotionDdot',
];

/** Époque en millisecondes UTC, ou NaN si la chaîne n'est pas une date. */
export function epochMs(epoch: string): number {
  return Date.parse(/Z$|[+-]\d\d:\d\d$/.test(epoch) ? epoch : `${epoch}Z`);
}

/**
 * Lit le fichier du service. Lève si sa forme n'est pas celle attendue : un fichier à moitié
 * compris ferait dessiner des satellites au mauvais endroit, pire qu'une couche absente. Un objet
 * dont un champ est illisible est écarté, et le nombre d'écartés est rendu pour être dit.
 */
export function parseSatelliteFile(raw: unknown): {
  file: SatelliteFile;
  rejected: number;
} {
  const doc = raw as Partial<SatelliteFile> | null;
  if (!doc || typeof doc !== 'object' || doc.version !== 1)
    throw new Error('fichier des satellites : version inconnue');
  if (!Array.isArray(doc.objects) || doc.objects.length === 0)
    throw new Error('fichier des satellites : aucun objet');
  if (!Number.isFinite(Date.parse(String(doc.fetchedAt))))
    throw new Error('fichier des satellites : date de lecture illisible');
  const objects: SatelliteElements[] = [];
  let rejected = 0;
  for (const o of doc.objects as SatelliteElements[]) {
    const ok =
      o !== null &&
      typeof o === 'object' &&
      typeof o.name === 'string' &&
      Number.isFinite(epochMs(String(o.epoch))) &&
      NUMERIC.every((k) => Number.isFinite(o[k]));
    if (ok) objects.push(o);
    else rejected += 1;
  }
  if (objects.length === 0)
    throw new Error('fichier des satellites : aucun objet lisible');
  return { file: { ...(doc as SatelliteFile), objects }, rejected };
}

/** Vrai si `dateMs` tombe dans la fenêtre de validité des éléments d'époque `epochMillis`. */
export function withinValidity(epochMillis: number, dateMs: number): boolean {
  return Math.abs(dateMs - epochMillis) <= ELEMENT_VALIDITY_DAYS * DAY_MS;
}

/**
 * Vrai si AU MOINS un objet est dans sa fenêtre à `dateMs` : ce qui décide si la couche peut dire
 * « voici les satellites » ou doit dire « hors de la validité des éléments ».
 */
export function anyWithinValidity(
  epochs: readonly number[],
  dateMs: number
): boolean {
  return epochs.some((e) => withinValidity(e, dateMs));
}

/**
 * L'objet en OMM, la forme que lit `satellite.js` (`json2satrec`). Les champs facultatifs absents
 * prennent la valeur que CelesTrak publie pour un jeu SGP4 ordinaire.
 */
export function toOmm(o: SatelliteElements): Record<string, unknown> {
  return {
    OBJECT_NAME: o.name,
    OBJECT_ID: o.designator ?? '',
    EPOCH: o.epoch,
    MEAN_MOTION: o.meanMotion,
    ECCENTRICITY: o.eccentricity,
    INCLINATION: o.inclination,
    RA_OF_ASC_NODE: o.raan,
    ARG_OF_PERICENTER: o.argPerigee,
    MEAN_ANOMALY: o.meanAnomaly,
    EPHEMERIS_TYPE: o.ephemerisType ?? 0,
    CLASSIFICATION_TYPE: o.classification ?? 'U',
    NORAD_CAT_ID: o.id,
    ELEMENT_SET_NO: o.elementSet ?? 999,
    REV_AT_EPOCH: o.revAtEpoch ?? 0,
    BSTAR: o.bstar,
    MEAN_MOTION_DOT: o.meanMotionDot,
    MEAN_MOTION_DDOT: o.meanMotionDdot,
  };
}

/**
 * Passe un vecteur de l'équateur vrai de la date (TEME, ce que rend SGP4) à l'équateur J2000, par
 * une matrice 3×3 en ligne (`Astronomy.Rotation_EQD_EQJ`). TEME n'est pas EQD à la lettre : ils
 * diffèrent de l'équation des équinoxes (≈ 1″, soit une trentaine de mètres en orbite basse),
 * très en deçà de l'erreur de SGP4 elle-même.
 */
export function rotate(
  m: readonly (readonly number[])[],
  x: number,
  y: number,
  z: number
): [number, number, number] {
  const r0 = m[0]!;
  const r1 = m[1]!;
  const r2 = m[2]!;
  return [
    r0[0]! * x + r0[1]! * y + r0[2]! * z,
    r1[0]! * x + r1[1]! * y + r1[2]! * z,
    r2[0]! * x + r2[1]! * y + r2[2]! * z,
  ];
}
