/* global console, process, URL */
/**
 * Publie uniquement les LOD deja presents dans public/assets/textures/.
 * Le mode par defaut est un dry-run ; --apply est obligatoire pour envoyer.
 * La source brute des mosaiques scientifiques ne doit jamais passer par ce script.
 * --body=<body> permet un deploiement progressif d'un corps a la fois.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TEXTURE_ROOT = resolve(PROJECT_ROOT, 'public/assets/textures');
const cliArgs = process.argv.slice(2);
const bucket = cliArgs.find((arg) => arg.startsWith('--bucket='))?.slice('--bucket='.length);
const prefix = cliArgs.find((arg) => arg.startsWith('--prefix='))?.slice('--prefix='.length) ?? 'galaxy/assets/textures';
const apply = cliArgs.includes('--apply');
const body = cliArgs.find((arg) => arg.startsWith('--body='))?.slice('--body='.length);
const sourceRoot = body ? resolve(TEXTURE_ROOT, body) : TEXTURE_ROOT;

function fail(message) {
  console.error('Texture publish aborted: ' + message);
  process.exitCode = 1;
}

if (!bucket || !/^[-a-z0-9._]+$/.test(bucket)) {
  fail('provide a valid bucket with --bucket=<gcs-bucket>.');
} else if (!prefix || prefix.includes('..') || prefix.startsWith('/')) {
  fail('prefix must be a relative object path without "..".');
} else if (body && !/^[a-z0-9-]+$/.test(body)) {
  fail('body must contain only lowercase letters, numbers or hyphens.');
} else if (!existsSync(sourceRoot)) {
  fail('texture directory does not exist: ' + sourceRoot);
} else {
  const destinationPrefix = body ? prefix.replace(/\\/g, '/') + '/' + body : prefix.replace(/\\/g, '/');
  const destination = 'gs://' + bucket + '/' + destinationPrefix;
  const command = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud';
  const args = [
    'storage',
    'rsync',
    sourceRoot,
    destination,
    '--recursive',
    '--checksums-only',
    '--cache-control=public,max-age=31536000,immutable',
  ];

  if (!apply) args.push('--dry-run');

  console.log((apply ? 'Publishing' : 'Dry-run') + ' ' + (body ?? 'all') + ' textures to ' + destination);
  console.log(
    apply
      ? 'Only derived assets are sent; source mosaics remain outside the repository.'
      : 'No files will be uploaded. Add --apply only after reviewing the plan.'
  );

  const result = spawnSync(command, args, { stdio: 'inherit', shell: false });
  if (result.error) {
    fail('could not start ' + command + ': ' + result.error.message);
  } else if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  }
}
