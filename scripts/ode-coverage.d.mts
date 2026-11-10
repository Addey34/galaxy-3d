/** Déclarations de `scripts/ode-coverage.mjs`, pour les tests de `src/config/`. */

export interface DbfRow {
  ODEId?: string;
  ProductId?: string;
  DatasetId?: string;
  [field: string]: string | undefined;
}

export interface CoverageAnalysis {
  totalRecords: number;
  recordsByKind: Record<string, number>;
  distinctByKind: Record<string, number>;
  unionDistinct: number;
  repeatedTotal: number;
  repeatedRecordsInExcess: number;
  repeated: {
    id: string;
    occurrences: number;
    byKind: Record<string, number>;
  }[];
  emptyIds: { count: number; byKind: Record<string, number> };
  invalidIds: { count: number; sample: { id: string; kind: string }[] };
  inconsistentTotal: number;
  inconsistent: { id: string; productIds: string[]; datasetIds: string[] }[];
  distinctProductIds: number;
  distinctDatasetIds: number;
  productsAfterGrouping: number;
  note: string;
}

export interface CoverageProduct {
  id: string;
  pid: string;
  ds: string;
  shapes: Record<string, unknown[]>;
  [field: string]: unknown;
}

export function untar(buf: Buffer): Record<string, Buffer>;
export function readDbf(d: Buffer, want: string[]): DbfRow[];
export function readShp(d: Buffer): number[][][][];
export function analyzeRecords(
  perKind: Partial<Record<'a' | 'l' | 'p', DbfRow[]>>
): CoverageAnalysis;
export function parseCoverageArchive(
  buf: Buffer,
  key: string,
  offset: number
): { products: CoverageProduct[]; analysis: CoverageAnalysis | null };
