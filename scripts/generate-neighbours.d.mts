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
export function combine(
  hygRows: ReadonlyArray<readonly unknown[]>,
  gaiaRows: ReadonlyArray<readonly unknown[]>
): { rows: Array<{ row: unknown[]; reason: string | null }>; notes: string[] };
export const HYG_FIELDS: string[];
export const GAIA_FIELDS: string[];
