/** Déclarations de `scripts/ode-pages.mjs`, pour les tests de `src/config/`. */

export const TMP_SUFFIX: string;
export const EXIT_LOCAL_STORAGE: number;
export const LOCAL_STORAGE_CODES: ReadonlySet<string>;
export const pageName: (offset: number) => string;

export class LocalStorageError extends Error {
  code: string | undefined;
  constructor(operation: string, cause: unknown);
}

export function isLocalStorageError(error: unknown): boolean;
export function validatePageBuffer(buffer: Buffer): number;
export function validatePageFile(file: string): number;

export function writePageAtomic(
  file: string,
  products: readonly unknown[],
  options?: {
    hooks?: { afterStep?: (label: string) => void };
    fs?: Record<string, (...args: never[]) => unknown>;
  }
): void;

export function inspectExistingPages(
  dir: string,
  offsets: readonly number[]
): {
  valid: Set<number>;
  invalid: { offset: number; reason: string }[];
  staleTmp: string[];
};

export interface PageTask {
  key: string;
  offset: number;
  file: string;
}

export function collectPages(options: {
  tasks: readonly PageTask[];
  pull: (task: PageTask) => Promise<readonly unknown[]>;
  write?: (file: string, products: readonly unknown[]) => void;
  unavailable: Record<string, unknown>;
  markUnavailable: (task: PageTask, error: Error) => void;
  concurrency?: number;
  onProgress?: (info: unknown) => void;
}): Promise<{
  done: number;
  failed: number;
  fatal: Error | null;
  remaining: number;
}>;

export function writeFileAtomic(file: string, text: string): void;
