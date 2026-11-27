export interface HygStar {
  id: string;
  hip: string | null;
  gl: string | null;
  proper: string | null;
  bf: string | null;
  spect: string | null;
  raDeg: number;
  decDeg: number;
  distPc: number;
  pmRa: number;
  pmDec: number;
  rv: number;
  vmag: number;
}

export interface GaiaCandidate {
  sourceId: string;
  ra: number;
  dec: number;
  parallax: number;
  parallaxError: number;
  pmRa: number | null;
  pmDec: number | null;
  rv: number | null;
  ruwe: number | null;
  gMag: number | null;
}

export const MAX_DISTANCE_PC: number;
/** GAL-RIGHTS-SAFEGUARD-001 : faux tant que l'ESA n'a pas répondu (fichier HYG seul). */
export const GAIA_ENABLED: boolean;
export const FIELDS: string[];
export function displayName(star: HygStar): string;
export function propagate(
  raDeg: number,
  decDeg: number,
  pmRa: number,
  pmDec: number,
  years: number
): { raDeg: number; decDeg: number };
export function chooseGaia(
  star: HygStar,
  candidates: GaiaCandidate[],
  taken?: Set<string>
): { gaia: GaiaCandidate | null; reason: string | null };
export function buildRow(
  star: HygStar,
  gaia: GaiaCandidate | null
): (string | number | null)[];
