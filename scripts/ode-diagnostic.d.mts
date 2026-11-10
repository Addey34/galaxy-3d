/** Déclarations de `scripts/ode-diagnostic.mjs`, pour les tests de `src/config/`. */

import type { CoverageAnalysis } from './ode-coverage.mjs';

export const DIAGNOSTICS_DIR: string;
export function diagnosticsDir(cacheDir: string): string;
export function sha256(buffer: Buffer): string;
export function quarantineBase(options: {
  key: string;
  offset: number;
  limit: number;
  at: string;
}): string;

export function quarantineRaw(options: {
  cacheDir: string;
  raw: Buffer;
  key: string;
  offset: number;
  limit: number;
  freeze: Record<string, string>;
  http: {
    status: number | null;
    contentType: string | null;
    url: string | null;
  };
  query?: unknown;
  now?: Date;
  write?: (file: string, data: string | Buffer) => void;
}): { rawFile: string; sha256: string; base: string; dir: string };

export function writeAnalysis(options: {
  dir: string;
  base: string;
  analysis: CoverageAnalysis;
  write?: (file: string, data: string | Buffer) => void;
}): string;

export function describeGap(analysis: CoverageAnalysis | null): string | null;
