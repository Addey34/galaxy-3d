/** Déclarations de `scripts/ode-pages.mjs`, pour les tests de `src/config/`. */

export const TMP_SUFFIX: string;
export const EXIT_LOCAL_STORAGE: number;
export const LOCAL_STORAGE_CODES: ReadonlySet<string>;
export const pageName: (offset: number) => string;

export class LocalStorageError extends Error {
  code: string | undefined;
  constructor(operation: string, cause: unknown);
}

export class IncompletePageError extends Error {
  got?: number;
  distinct?: number;
  expected?: number;
  constructor(message: string, details?: object);
}

export function writeAll(
  fd: number,
  buffer: Buffer,
  write?: (...args: never[]) => number
): void;

export function isLocalStorageError(error: unknown): boolean;
export function validatePageBuffer(
  buffer: Buffer,
  options?: { expected?: number; excludedIds?: ReadonlySet<string> }
): number;
export function validatePageFile(
  file: string,
  options?: { expected?: number; excludedIds?: ReadonlySet<string> }
): number;

export function writePageAtomic(
  file: string,
  products: readonly unknown[],
  options?: {
    hooks?: { afterStep?: (label: string) => void };
    fs?: Record<string, (...args: never[]) => unknown>;
    expected?: number;
    excludedIds?: ReadonlySet<string>;
  }
): void;

export function inspectExistingPages(
  dir: string,
  offsets: readonly number[],
  expectedFor?: (offset: number) => number,
  excludedFor?: (offset: number) => ReadonlySet<string> | undefined
): {
  valid: Set<number>;
  invalid: { offset: number; reason: string }[];
  staleTmp: string[];
};

export interface PageTask {
  key: string;
  offset: number;
  file: string;
  expected?: number;
  excludedIds?: ReadonlySet<string>;
}

export function collectPages(options: {
  tasks: readonly PageTask[];
  pull: (task: PageTask) => Promise<readonly unknown[]>;
  write?: (
    file: string,
    products: readonly unknown[],
    options?: { expected?: number; excludedIds?: ReadonlySet<string> }
  ) => void;
  unavailable: Record<string, unknown>;
  markUnavailable: (task: PageTask, error: Error) => void;
  markIncomplete?: (task: PageTask, error: IncompletePageError) => void;
  concurrency?: number;
  onProgress?: (info: unknown) => void;
}): Promise<{
  done: number;
  failed: number;
  incomplete: number;
  fatal: Error | null;
  remaining: number;
}>;

export function writeFileAtomic(
  file: string,
  text: string | Buffer,
  options?: { fs?: Record<string, (...args: never[]) => unknown> }
): void;
