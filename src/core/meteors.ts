/**
 * LES PLUIES DE MÉTÉORES : le fichier livré, la longitude solaire, la fenêtre d'activité et le radiant
 * à une date. Pur, sans DOM ni Three.js.
 *
 * `public/assets/sky/meteors.json` (`scripts/generate-meteors.mjs`) est un instantané de l'IAU Meteor
 * Data Center (pluies annuelles établies, une solution par pluie). Un radiant n'est qu'une DIRECTION :
 * le point du ciel d'où semblent venir les météores d'une pluie. L'application ne lui invente ni
 * distance, ni taille de scène, ni taux horaire (la source ne les donne pas).
 *
 * Une pluie est ACTIVE quand la longitude solaire de la date de la scène tombe dans la fenêtre que
 * la source déclare (début et fin, en longitude solaire J2000, avec passage de 360° à 0° géré). La
 * date de la scène décide seule : un voyage dans le temps, une éclipse ou une visite suivent la même
 * règle sans cas particulier.
 *
 * Importé seulement par la couche paresseuse (`ui/meteorLayer`), jamais par le démarrage.
 */
import { SunPosition } from 'astronomy-engine';
import './timeScale';

/** Une pluie, dans l'ordre de `fields`. */
export type MeteorShower = readonly [
  iauNo: number,
  code: string,
  name: string,
  sunLonBegin: number,
  sunLonEnd: number,
  sunLonMean: number,
  raDeg: number,
  decDeg: number,
  raDriftDegPerDay: number | null,
  decDriftDegPerDay: number | null,
  vgKmS: number,
  solution: number,
];

export interface MeteorsFile {
  source: {
    id: string;
    name: string;
    url: string;
    file: string;
    retrieved: string;
    updated: string;
    sha256: string;
    rows: number;
    cite: string[];
  };
  fields: string[];
  count: number;
  dropped: { notAnnual: number; noCompleteSolution: number };
  showers: MeteorShower[];
}

const J2000_MS = Date.UTC(2000, 0, 1, 12);
const CENTURY_MS = 36_525 * 86_400_000;
/** Jours solaires moyens par degré de longitude solaire (le Soleil avance de ~0,9856° par jour). */
const DEG_PER_DAY = 360 / 365.2422;

/**
 * Longitude écliptique du Soleil à `date`, en degrés [0, 360), ramenée à l'équinoxe J2000 : c'est
 * le repère de la source (« averaged ecliptic longitude of the Sun, J2000 »). Astronomy Engine rend
 * l'écliptique VRAI DE LA DATE ; la précession générale en longitude (≈ 0,375° en 2026) l'en sépare.
 */
export function sunLongitudeJ2000(date: Date): number {
  const t = (date.getTime() - J2000_MS) / CENTURY_MS;
  // Précession générale en longitude, IAU 2006, en secondes d'arc.
  const precession = (5028.796195 * t + 1.1054348 * t * t) / 3600;
  return mod360(SunPosition(date).elon - precession);
}

export function mod360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Écart `a - b` ramené à ]-180, 180] degrés. */
export function angularDiffDeg(a: number, b: number): number {
  const d = mod360(a - b);
  return d > 180 ? d - 360 : d;
}

/** Vrai si `lon` est dans la fenêtre [begin, end], qui peut franchir 360° (begin > end). */
export function inActivityWindow(
  lon: number,
  begin: number,
  end: number
): boolean {
  const l = mod360(lon);
  const b = mod360(begin);
  const e = mod360(end);
  return b <= e ? l >= b && l <= e : l >= b || l <= e;
}

export interface MeteorRadiant {
  active: boolean;
  /** Ascension droite et déclinaison J2000 du radiant à cette date, en degrés. */
  raDeg: number;
  decDeg: number;
}

/**
 * Le radiant d'une pluie à la longitude solaire `lon`. Sa position est celle de la source à la
 * longitude solaire MOYENNE de la pluie, déplacée de la dérive quotidienne publiée (degrés par
 * jour) multipliée par l'écart en jours. Sans dérive publiée (`null`), le radiant ne bouge pas : ce
 * n'est pas une dérive nulle mesurée, c'est une dérive absente, et on ne l'invente pas.
 * Hors fenêtre, `active` est faux et la position est celle d'au bord (jamais extrapolée plus loin).
 */
export function meteorRadiant(
  shower: MeteorShower,
  lon: number
): MeteorRadiant {
  const [, , , begin, end, mean, ra, dec, dRa, dDe] = shower;
  const active = inActivityWindow(lon, begin, end);
  // L'écart est borné à la fenêtre : on ne prolonge pas une dérive linéaire au-delà de ce que la
  // source décrit.
  const lo = angularDiffDeg(begin, mean);
  const hi = angularDiffDeg(end, mean);
  const delta = Math.min(Math.max(angularDiffDeg(lon, mean), lo), hi);
  const days = delta / DEG_PER_DAY;
  const raDeg = mod360(ra + (dRa ?? 0) * days);
  const decDeg = Math.min(90, Math.max(-90, dec + (dDe ?? 0) * days));
  return { active, raDeg, decDeg };
}

/** Direction équatoriale J2000 (vecteur unitaire) d'un radiant, écrite dans `out`. */
export function radiantDirection(
  raDeg: number,
  decDeg: number,
  out: [number, number, number] | Float64Array
): void {
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  const c = Math.cos(dec);
  out[0] = c * Math.cos(ra);
  out[1] = c * Math.sin(ra);
  out[2] = Math.sin(dec);
}

/** Le nom écrit sur le ciel : celui de la source (latin, identique dans les quatre langues). */
export function meteorLabel(shower: MeteorShower): string {
  return shower[2];
}

/**
 * Lit le fichier livré. Lève si sa forme n'est pas celle attendue : un fichier à moitié compris
 * placerait des radiants au mauvais endroit, pire qu'une couche absente.
 */
export function parseMeteorsFile(raw: unknown): MeteorsFile {
  const doc = raw as Partial<MeteorsFile> | null;
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.showers))
    throw new Error('fichier des pluies de météores : forme inattendue');
  if (doc.showers.length === 0)
    throw new Error('fichier des pluies de météores : aucune pluie');
  for (const s of doc.showers) {
    const ok =
      Array.isArray(s) &&
      s.length === 12 &&
      typeof s[2] === 'string' &&
      [3, 4, 5, 6, 7, 10].every((k) => Number.isFinite(s[k])) &&
      [8, 9].every((k) => s[k] === null || Number.isFinite(s[k]));
    if (!ok)
      throw new Error(
        `fichier des pluies de météores : ligne illisible ${JSON.stringify(s)}`
      );
  }
  return doc as MeteorsFile;
}
