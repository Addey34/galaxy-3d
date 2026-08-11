/* global process, fetch, TextDecoder, console */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sources = JSON.parse(
  await readFile(resolve(root, 'scripts/spk-sources.json'), 'utf8')
);
const source = sources.sat441;
const url = process.env.SPK_URL ?? process.env.VITE_SPK_KERNEL_URL;
if (!url) {
  throw new Error(
    'Set SPK_URL or VITE_SPK_KERNEL_URL to the deployed same-origin SAT441 URL.'
  );
}

const head = await fetch(url, { method: 'HEAD' });
if (!head.ok) throw new Error(`SAT441 HEAD returned HTTP ${head.status}`);
const headAcceptRanges = head.headers.get('accept-ranges')?.toLowerCase();

const range = await fetch(url, { headers: { Range: 'bytes=0-1023' } });
if (range.status !== 206)
  throw new Error(
    `SAT441 range request returned HTTP ${range.status}, expected 206`
  );
const rangeAcceptRanges = range.headers.get('accept-ranges')?.toLowerCase();
if (headAcceptRanges !== 'bytes' && rangeAcceptRanges !== 'bytes')
  throw new Error('SAT441 does not advertise byte ranges');
const contentRange = range.headers.get('content-range');
const totalMatch = contentRange?.match(/^bytes 0-1023\/(\d+)$/);
const contentLength = totalMatch ? Number(totalMatch[1]) : NaN;
if (contentLength !== source.bytes) {
  throw new Error(
    `SAT441 size mismatch: ${contentLength || 'unknown'} bytes, expected ${source.bytes}`
  );
}
const bytes = new Uint8Array(await range.arrayBuffer());
if (bytes.byteLength !== 1024)
  throw new Error(
    `SAT441 range returned ${bytes.byteLength} bytes, expected 1024`
  );
const identification = new TextDecoder().decode(bytes.slice(0, 8));
if (identification !== 'DAF/SPK ') {
  throw new Error(
    `SAT441 identification word is ${JSON.stringify(identification)}`
  );
}

console.log(
  JSON.stringify(
    {
      url,
      bytes: contentLength,
      acceptRanges: rangeAcceptRanges ?? headAcceptRanges,
      rangeStatus: range.status,
      contentRange,
      identification,
      etag: head.headers.get('etag'),
    },
    null,
    2
  )
);
