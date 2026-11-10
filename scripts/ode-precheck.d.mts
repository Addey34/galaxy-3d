/** Déclarations de `scripts/ode-precheck.mjs`, pour les tests de `src/config/`. */

export interface PrecheckCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface PrecheckResult {
  ok: boolean;
  checks: PrecheckCheck[];
  plan: {
    datasets: number;
    products: number;
    pages: number;
    exceptions: { key: string; frozen: number; all: number; kind: string }[];
  } | null;
  estimate: number;
}

export function freeBytes(
  path: string,
  statfs?: (p: string) => { bavail: number | bigint; bsize: number | bigint }
): number;

export function precheck(options: {
  body: string;
  cacheDir: string;
  backupDir?: string | null;
  bytesPerProduct?: number;
  deliveredIndex?: { frozenAt?: string } | null;
  statfs?: (p: string) => { bavail: number | bigint; bsize: number | bigint };
  root?: string;
}): PrecheckResult;
