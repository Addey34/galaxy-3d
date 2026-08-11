import { SpkKernel, subtractStates, zeroState } from './SpkKernel';
import type { SpkSegmentDescriptor, SpkState } from './SpkKernel';

const RECORD_BYTES = 1024;
const WORD_BYTES = 8;

type LoadUrlRequest = {
  type: 'loadUrl';
  id: number;
  url: string;
};

type LoadBufferRequest = {
  type: 'loadBuffer';
  id: number;
  buffer: ArrayBuffer;
};

type StateRequest = {
  type: 'state';
  id: number;
  target: number;
  center: number;
  etSeconds: number;
};

type WorkerRequest = LoadUrlRequest | LoadBufferRequest | StateRequest;

type WorkerScope = {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: unknown): void;
  location: Location;
};

type RangeDirectory = {
  url: string;
  littleEndian: boolean;
  segments: readonly SpkSegmentDescriptor[];
};

const scope = globalThis as unknown as WorkerScope;
let kernel: SpkKernel | null = null;
let rangeDirectory: RangeDirectory | null = null;
const segmentKernels = new Map<string, SpkKernel>();
const segmentLoads = new Map<string, Promise<SpkKernel>>();

function ascii(view: DataView, offset: number, length: number): string {
  let result = '';
  for (let index = 0; index < length; index += 1) {
    const code = view.getUint8(offset + index);
    result += code === 0 ? ' ' : String.fromCharCode(code);
  }
  return result.trimEnd();
}

function parseHeader(buffer: ArrayBuffer): {
  littleEndian: boolean;
  firstSummaryRecord: number;
} {
  if (buffer.byteLength < RECORD_BYTES)
    throw new Error('SPK header is smaller than one DAF record');
  const view = new DataView(buffer);
  if (ascii(view, 0, 8) !== 'DAF/SPK')
    throw new Error('invalid DAF/SPK identification word');
  const format = ascii(view, 88, 8);
  const littleEndian =
    format === 'LTL-IEEE' ? true : format === 'BIG-IEEE' ? false : undefined;
  if (littleEndian === undefined)
    throw new Error('unsupported DAF binary format: ' + format);
  if (
    view.getInt32(8, littleEndian) !== 2 ||
    view.getInt32(12, littleEndian) !== 6
  )
    throw new Error('unsupported SPK summary format');
  return {
    littleEndian,
    firstSummaryRecord: view.getInt32(76, littleEndian),
  };
}

function parseSummaryRecord(
  buffer: ArrayBuffer,
  littleEndian: boolean
): { next: number; segments: SpkSegmentDescriptor[] } {
  if (buffer.byteLength < RECORD_BYTES * 2)
    throw new Error('SPK summary range is incomplete');
  const summary = new DataView(buffer, 0, RECORD_BYTES);
  const names = new DataView(buffer, RECORD_BYTES, RECORD_BYTES);
  const next = Math.trunc(summary.getFloat64(0, littleEndian));
  const count = Math.trunc(summary.getFloat64(16, littleEndian));
  if (count < 0 || count > 25) throw new Error('invalid SPK summary count');

  const segments: SpkSegmentDescriptor[] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 24 + index * 5 * WORD_BYTES;
    const initialAddress = summary.getInt32(offset + 32, littleEndian);
    const finalAddress = summary.getInt32(offset + 36, littleEndian);
    if (initialAddress < 1 || finalAddress < initialAddress)
      throw new Error('invalid SPK segment address range');
    segments.push({
      startEtSeconds: summary.getFloat64(offset, littleEndian),
      endEtSeconds: summary.getFloat64(offset + 8, littleEndian),
      target: summary.getInt32(offset + 16, littleEndian),
      center: summary.getInt32(offset + 20, littleEndian),
      frame: summary.getInt32(offset + 24, littleEndian),
      type: summary.getInt32(offset + 28, littleEndian),
      initialAddress,
      finalAddress,
      name: ascii(names, index * 40, 40),
    });
  }
  return { next, segments };
}

async function fetchRange(
  url: string,
  startByte: number,
  endByte: number
): Promise<ArrayBuffer> {
  const expectedBytes = endByte - startByte + 1;
  const response = await fetch(url, {
    headers: { Range: `bytes=${startByte}-${endByte}` },
  });
  if (response.status !== 206)
    throw new Error(
      `SPK range request returned HTTP ${response.status}, expected 206`
    );

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength !== expectedBytes)
    throw new Error('SPK range response has an invalid size');
  return buffer;
}

async function loadDirectory(url: string): Promise<RangeDirectory> {
  const header = await fetchRange(url, 0, RECORD_BYTES - 1);
  const { littleEndian, firstSummaryRecord } = parseHeader(header);
  const segments: SpkSegmentDescriptor[] = [];
  const visited = new Set<number>();
  let summaryRecord = firstSummaryRecord;

  while (summaryRecord > 0) {
    if (visited.has(summaryRecord))
      throw new Error('SPK summary records contain a cycle');
    visited.add(summaryRecord);
    const startByte = (summaryRecord - 1) * RECORD_BYTES;
    const record = await fetchRange(
      url,
      startByte,
      startByte + RECORD_BYTES * 2 - 1
    );
    const parsed = parseSummaryRecord(record, littleEndian);
    segments.push(...parsed.segments);
    summaryRecord = parsed.next;
  }

  return { url, littleEndian, segments };
}

function findSegment(
  directory: RangeDirectory,
  target: number,
  center: number,
  etSeconds: number
): SpkSegmentDescriptor | null {
  for (let index = directory.segments.length - 1; index >= 0; index -= 1) {
    const segment = directory.segments[index];
    if (
      segment.target === target &&
      segment.center === center &&
      etSeconds >= segment.startEtSeconds &&
      etSeconds <= segment.endEtSeconds &&
      (segment.type === 2 || segment.type === 3)
    )
      return segment;
  }
  return null;
}

function segmentKey(segment: SpkSegmentDescriptor): string {
  return `${segment.initialAddress}:${segment.finalAddress}`;
}

async function loadSegment(
  directory: RangeDirectory,
  segment: SpkSegmentDescriptor
): Promise<SpkKernel> {
  const key = segmentKey(segment);
  const cached = segmentKernels.get(key);
  if (cached) return cached;
  const pending = segmentLoads.get(key);
  if (pending) return pending;

  const load = fetchRange(
    directory.url,
    (segment.initialAddress - 1) * WORD_BYTES,
    segment.finalAddress * WORD_BYTES - 1
  ).then((buffer) => {
    const loaded = SpkKernel.fromSegment(
      segment,
      buffer,
      directory.littleEndian
    );
    segmentKernels.set(key, loaded);
    segmentLoads.delete(key);
    return loaded;
  });
  segmentLoads.set(key, load);
  return load;
}

/** Premier segment couvrant `target` (peu importe le centre) à `etSeconds`. */
function findSegmentByTarget(
  directory: RangeDirectory,
  target: number,
  etSeconds: number
): SpkSegmentDescriptor | null {
  for (let index = directory.segments.length - 1; index >= 0; index -= 1) {
    const segment = directory.segments[index];
    if (
      segment.target === target &&
      etSeconds >= segment.startEtSeconds &&
      etSeconds <= segment.endEtSeconds &&
      (segment.type === 2 || segment.type === 3)
    )
      return segment;
  }
  return null;
}

/**
 * État `target←center` en mode Range : tente un segment direct, sinon **compose via un
 * centre commun** (comme `SpkKernel.getState`, mais en chargeant chaque segment à la demande
 * par requête HTTP Range). Indispensable pour les lunes stockées relatives à un barycentre.
 */
async function resolveRangeState(
  directory: RangeDirectory,
  target: number,
  center: number,
  etSeconds: number
): Promise<SpkState | null> {
  if (target === center) return zeroState();

  const directSeg = findSegment(directory, target, center, etSeconds);
  if (directSeg) {
    return (await loadSegment(directory, directSeg)).getState(
      target,
      center,
      etSeconds
    );
  }
  // Composition : target←commun − center←commun (mêmes règles que SpkKernel.getState).
  const targetSeg = findSegmentByTarget(directory, target, etSeconds);
  const centerSeg = findSegmentByTarget(directory, center, etSeconds);
  if (!targetSeg || !centerSeg || targetSeg.center !== centerSeg.center)
    return null;
  const [targetKernel, centerKernel] = await Promise.all([
    loadSegment(directory, targetSeg),
    loadSegment(directory, centerSeg),
  ]);
  return subtractStates(
    targetKernel.getState(target, targetSeg.center, etSeconds),
    centerKernel.getState(center, centerSeg.center, etSeconds)
  );
}

function assertSameOrigin(url: string): string {
  const absolute = new URL(url, scope.location.href);
  if (absolute.origin !== scope.location.origin)
    throw new Error('SPK worker accepts same-origin URLs only');
  return absolute.href;
}

function reply(
  id: number,
  type: string,
  payload: Record<string, unknown>
): void {
  scope.postMessage({ id, type, ...payload });
}

scope.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  try {
    if (data.type === 'loadUrl') {
      kernel = null;
      rangeDirectory = await loadDirectory(assertSameOrigin(data.url));
      segmentKernels.clear();
      segmentLoads.clear();
      reply(data.id, 'loaded', { segments: rangeDirectory.segments });
      return;
    }

    if (data.type === 'loadBuffer') {
      rangeDirectory = null;
      segmentKernels.clear();
      segmentLoads.clear();
      kernel = SpkKernel.parse(data.buffer);
      reply(data.id, 'loaded', { segments: kernel.segments });
      return;
    }

    if (kernel) {
      reply(data.id, 'state', {
        state: kernel.getState(data.target, data.center, data.etSeconds),
      });
      return;
    }

    if (!rangeDirectory) throw new Error('SPK kernel is not loaded');
    const state = await resolveRangeState(
      rangeDirectory,
      data.target,
      data.center,
      data.etSeconds
    );
    reply(data.id, 'state', { state });
  } catch (error) {
    reply(data.id, 'error', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
