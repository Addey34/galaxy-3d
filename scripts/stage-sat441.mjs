/* global process, fetch, console */
import { mkdir, readFile, rename, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = JSON.parse(
  await readFile(resolve(root, 'scripts/spk-sources.json'), 'utf8')
).sat441;
const output = resolve(root, 'public', source.deploymentPath.slice(1));
const temporary = output + '.part';

try {
  const existing = await stat(output);
  if (existing.size === source.bytes) {
    console.log(`SAT441 already staged: ${output}`);
    process.exit(0);
  }
  throw new Error(`refusing to overwrite an unexpected file: ${output}`);
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

try {
  await stat(temporary);
  throw new Error(
    `refusing to overwrite an existing partial file: ${temporary}`
  );
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const response = await fetch(source.source);
if (!response.ok || !response.body)
  throw new Error(`SAT441 download returned HTTP ${response.status}`);
const contentLength = Number(response.headers.get('content-length'));
if (contentLength !== source.bytes)
  throw new Error(`SAT441 size mismatch: ${contentLength || 'unknown'} bytes`);

await mkdir(dirname(output), { recursive: true });
await pipeline(
  Readable.fromWeb(response.body),
  createWriteStream(temporary, { flags: 'wx' })
);
const staged = await stat(temporary);
if (staged.size !== source.bytes)
  throw new Error(`SAT441 staged size mismatch: ${staged.size} bytes`);
await rename(temporary, output);
console.log(`SAT441 staged at ${output}`);
