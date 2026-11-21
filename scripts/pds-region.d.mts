export interface RegionSource {
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  radiusKm: number;
  pixelsPerDegree: number;
  pixelsPerDegreeLon: number;
  latTop: number;
  lonWest: number;
  data: Float32Array;
  deviations: Record<string, number>;
  label: {
    productId: string;
    version: string;
    created: string;
    standardParallel: number;
    centerLongitude: number;
  };
}
export function parsePds3Header(buffer: Buffer): {
  value(key: string): string;
  number(key: string): number;
};
export function readRegionSource(
  file: string,
  source: { productId: string; productVersion: string }
): RegionSource;
export function sourceCoordinates(
  src: Pick<
    RegionSource,
    'lonWest' | 'latTop' | 'pixelsPerDegreeLon' | 'pixelsPerDegree'
  >,
  lat: number,
  lon: number
): { x: number; y: number };
export function resampleTile(
  src: RegionSource,
  level: number,
  row: number,
  column: number,
  tileSizePx: number,
  dnPerUnit: number
): Buffer | null;
export function photometryStats(
  src: RegionSource,
  dnPerUnit: number
): {
  validSamples: number;
  nullSamples: number;
  meanReflectance: number;
  maxReflectance: number;
  clippedHighFraction: number;
  zeroFraction: number;
};
export const isNull: (value: number) => boolean;
