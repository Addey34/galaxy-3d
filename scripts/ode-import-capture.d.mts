export class ImportError extends Error {}

export function readCapture(mainFile: string): {
  digest: string;
  files: { name: string; data: Buffer }[];
};
export function importCapture(options: {
  cacheDir: string;
  mainFile: string;
  write?: boolean;
  fs?: {
    linkSync?: (existing: string, target: string) => void;
    [name: string]: unknown;
  };
}): {
  status: 'dry-run' | 'imported';
  digest: string;
  imported: string[];
  alreadyPresent: string[];
};
