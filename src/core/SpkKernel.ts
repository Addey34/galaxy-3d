// L'échelle ET vient de la convention unique de Galaxy (cf. `timeScale.ts`).
export { etSecondsFromDate } from './timeScale';

const RECORD_BYTES = 1024;
const WORD_BYTES = 8;

export interface SpkSegmentDescriptor {
  startEtSeconds: number;
  endEtSeconds: number;
  target: number;
  center: number;
  frame: number;
  type: number;
  initialAddress: number;
  finalAddress: number;
  name: string;
}

export interface SpkState {
  positionKm: readonly [number, number, number];
  velocityKmPerSecond: readonly [number, number, number];
  frame: number;
}

/**
 * Compose deux états partageant un centre commun : `a` = target←commun, `b` = center←commun.
 * Retourne `target←center` = a − b, ou null si les référentiels diffèrent. Fonction pure,
 * partagée par `SpkKernel.getState` (kernel entier) et le worker (mode HTTP Range).
 */
export function subtractStates(
  a: SpkState | null,
  b: SpkState | null
): SpkState | null {
  if (!a || !b || a.frame !== b.frame) return null;
  return {
    positionKm: [
      a.positionKm[0] - b.positionKm[0],
      a.positionKm[1] - b.positionKm[1],
      a.positionKm[2] - b.positionKm[2],
    ],
    velocityKmPerSecond: [
      a.velocityKmPerSecond[0] - b.velocityKmPerSecond[0],
      a.velocityKmPerSecond[1] - b.velocityKmPerSecond[1],
      a.velocityKmPerSecond[2] - b.velocityKmPerSecond[2],
    ],
    frame: a.frame,
  };
}

/**
 * Segments à lire pour l'état `target←center` à `etSeconds` : un segment DIRECT s'il existe,
 * sinon deux segments rapportés à un CENTRE COMMUN (`target←c` et `center←c`), sinon `null`.
 * Le dernier segment de l'annuaire qui couvre la date l'emporte, comme dans un noyau SPICE.
 *
 * Une seule implémentation, partagée par le Worker (qui lit les segments) et par la façade
 * synchrone (qui décide s'il vaut la peine de demander). Elles en avaient chacune une : le
 * Worker savait composer, la façade n'indexait que les paires directes. SAT441 ne stocke les
 * lunes et Saturne que par rapport au barycentre de Saturne (602←6, 699←6), donc aucune
 * position de lune n'était JAMAIS demandée, même avec le noyau activé — sans erreur.
 */
export type SpkSegmentPlan =
  | { kind: 'direct'; segment: SpkSegmentDescriptor }
  | {
      kind: 'composed';
      target: SpkSegmentDescriptor;
      center: SpkSegmentDescriptor;
    };

export function planSpkSegments(
  segments: readonly SpkSegmentDescriptor[],
  target: number,
  center: number,
  etSeconds: number
): SpkSegmentPlan | null {
  const readable = (segment: SpkSegmentDescriptor): boolean =>
    etSeconds >= segment.startEtSeconds &&
    etSeconds <= segment.endEtSeconds &&
    (segment.type === 2 || segment.type === 3);
  const last = (
    match: (segment: SpkSegmentDescriptor) => boolean
  ): SpkSegmentDescriptor | null => {
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      if (readable(segments[index]) && match(segments[index]))
        return segments[index];
    }
    return null;
  };

  const direct = last((s) => s.target === target && s.center === center);
  if (direct) return { kind: 'direct', segment: direct };
  const targetSegment = last((s) => s.target === target);
  const centerSegment = last((s) => s.target === center);
  if (
    !targetSegment ||
    !centerSegment ||
    targetSegment.center !== centerSegment.center
  )
    return null;
  return { kind: 'composed', target: targetSegment, center: centerSegment };
}

/** État nul (target === center). */
export function zeroState(frame = 1): SpkState {
  return { positionKm: [0, 0, 0], velocityKmPerSecond: [0, 0, 0], frame };
}

interface Segment extends SpkSegmentDescriptor {
  readonly littleEndian: boolean;
  readonly data: DataView;
}

function ascii(view: DataView, offset: number, length: number): string {
  let result = '';
  for (let index = 0; index < length; index += 1) {
    const code = view.getUint8(offset + index);
    result += code === 0 ? ' ' : String.fromCharCode(code);
  }
  return result.trimEnd();
}

function chebyshev(coefficients: readonly number[], x: number) {
  let value = coefficients[0] ?? 0;
  let derivative = 0;
  let t0 = 1;
  let t1 = x;
  let u0 = 1;
  let u1 = 2 * x;
  if (coefficients.length > 1) {
    value += coefficients[1] * t1;
    derivative += coefficients[1];
  }
  for (let degree = 2; degree < coefficients.length; degree += 1) {
    const t2 = 2 * x * t1 - t0;
    const u2 = 2 * x * u1 - u0;
    value += coefficients[degree] * t2;
    derivative += degree * coefficients[degree] * u1;
    t0 = t1;
    t1 = t2;
    u0 = u1;
    u1 = u2;
  }
  return { value, derivative };
}

function evaluate(
  values: readonly number[],
  offset: number,
  size: number,
  type: 2 | 3,
  etSeconds: number
): SpkState {
  const midpoint = values[offset];
  const radius = values[offset + 1];
  const groups = type === 2 ? 3 : 6;
  const count = (size - 2) / groups;
  const x = (etSeconds - midpoint) / radius;
  const position: number[] = [];
  const velocity: number[] = [];

  for (let axis = 0; axis < 3; axis += 1) {
    const start = offset + 2 + axis * count;
    const result = chebyshev(values.slice(start, start + count), x);
    position.push(result.value);
    if (type === 2) {
      velocity.push(result.derivative / radius);
    } else {
      const velocityStart = offset + 2 + (axis + 3) * count;
      velocity.push(
        chebyshev(values.slice(velocityStart, velocityStart + count), x).value
      );
    }
  }
  return {
    positionKm: [position[0], position[1], position[2]],
    velocityKmPerSecond: [velocity[0], velocity[1], velocity[2]],
    frame: 0,
  };
}

export class SpkKernel {
  readonly segments: readonly SpkSegmentDescriptor[];

  private constructor(private readonly entries: readonly Segment[]) {
    this.segments = entries;
  }

  static fromSegment(
    descriptor: SpkSegmentDescriptor,
    buffer: ArrayBuffer,
    littleEndian: boolean
  ): SpkKernel {
    if (descriptor.type !== 2 && descriptor.type !== 3)
      throw new Error('unsupported SPK segment type');
    const expectedBytes =
      (descriptor.finalAddress - descriptor.initialAddress + 1) * WORD_BYTES;
    if (buffer.byteLength !== expectedBytes)
      throw new Error('SPK segment payload has an invalid size');
    return new SpkKernel([
      {
        ...descriptor,
        littleEndian,
        data: new DataView(buffer),
      },
    ]);
  }

  static parse(buffer: ArrayBuffer): SpkKernel {
    if (buffer.byteLength < RECORD_BYTES)
      throw new Error('SPK buffer is smaller than one DAF record');

    const view = new DataView(buffer);
    if (ascii(view, 0, 8) !== 'DAF/SPK')
      throw new Error('invalid DAF/SPK identification word');
    const format = ascii(view, 88, 8);
    const littleEndian =
      format === 'LTL-IEEE' ? true : format === 'BIG-IEEE' ? false : undefined;
    if (littleEndian === undefined)
      throw new Error('unsupported DAF binary format: ' + format);

    const int = (offset: number) => view.getInt32(offset, littleEndian);
    const nd = int(8);
    const ni = int(12);
    if (nd !== 2 || ni !== 6) throw new Error('unsupported SPK summary format');

    const entries: Segment[] = [];
    const visited = new Set<number>();
    let summaryRecord = int(76);
    while (summaryRecord > 0) {
      if (visited.has(summaryRecord))
        throw new Error('SPK summary records contain a cycle');
      visited.add(summaryRecord);
      const summaryOffset = (summaryRecord - 1) * RECORD_BYTES;
      const nameOffset = summaryOffset + RECORD_BYTES;
      if (nameOffset + RECORD_BYTES > buffer.byteLength)
        throw new Error('SPK summary record points outside the buffer');

      const summary = new DataView(buffer, summaryOffset, RECORD_BYTES);
      const next = Math.trunc(summary.getFloat64(0, littleEndian));
      const count = Math.trunc(summary.getFloat64(16, littleEndian));
      if (count < 0 || count > 25) throw new Error('invalid SPK summary count');
      const names = new DataView(buffer, nameOffset, RECORD_BYTES);

      for (let index = 0; index < count; index += 1) {
        const offset = 24 + index * 5 * WORD_BYTES;
        const initialAddress = summary.getInt32(offset + 32, littleEndian);
        const finalAddress = summary.getInt32(offset + 36, littleEndian);
        if (
          initialAddress < 1 ||
          finalAddress < initialAddress ||
          finalAddress * WORD_BYTES > buffer.byteLength
        )
          throw new Error('invalid SPK segment address range');
        entries.push({
          startEtSeconds: summary.getFloat64(offset, littleEndian),
          endEtSeconds: summary.getFloat64(offset + 8, littleEndian),
          target: summary.getInt32(offset + 16, littleEndian),
          center: summary.getInt32(offset + 20, littleEndian),
          frame: summary.getInt32(offset + 24, littleEndian),
          type: summary.getInt32(offset + 28, littleEndian),
          initialAddress,
          finalAddress,
          name: ascii(names, index * 40, 40),
          littleEndian,
          data: new DataView(
            buffer,
            (initialAddress - 1) * WORD_BYTES,
            (finalAddress - initialAddress + 1) * WORD_BYTES
          ),
        });
      }
      summaryRecord = next;
    }
    return new SpkKernel(entries);
  }

  /**
   * État de `target` relatif à `center`. Tente d'abord un segment direct `target <- center` ;
   * sinon **compose via un centre commun** (les kernels de satellites stockent souvent
   * `moon <- barycentre` et `planète <- barycentre`, pas `moon <- planète` directement) :
   * state(target←center) = state(target←commun) − state(center←commun).
   */
  getState(target: number, center: number, etSeconds: number): SpkState | null {
    if (target === center)
      return zeroState(this._frameFor(target, etSeconds) ?? 1);

    const plan = planSpkSegments(this.entries, target, center, etSeconds);
    if (!plan) return null;
    if (plan.kind === 'direct')
      return this._directState(target, center, etSeconds);
    // Composition via le centre commun des deux segments (ex. barycentre 6 pour Saturne).
    return subtractStates(
      this._directState(target, plan.target.center, etSeconds),
      this._directState(center, plan.center.center, etSeconds)
    );
  }

  /** Référentiel du segment couvrant `target`, pour l'état nul (target === center). */
  private _frameFor(target: number, etSeconds: number): number | null {
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      const s = this.entries[index];
      if (
        s.target === target &&
        etSeconds >= s.startEtSeconds &&
        etSeconds <= s.endEtSeconds
      )
        return s.frame;
    }
    return null;
  }

  /** Lecture d'un segment direct `target <- center` (Chebyshev types 2/3), sinon null. */
  private _directState(
    target: number,
    center: number,
    etSeconds: number
  ): SpkState | null {
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      const segment = this.entries[index];
      if (
        segment.target !== target ||
        segment.center !== center ||
        etSeconds < segment.startEtSeconds ||
        etSeconds > segment.endEtSeconds ||
        (segment.type !== 2 && segment.type !== 3)
      )
        continue;

      const values: number[] = [];
      for (
        let offset = 0;
        offset < segment.data.byteLength;
        offset += WORD_BYTES
      )
        values.push(segment.data.getFloat64(offset, segment.littleEndian));

      const metadata = values.length - 4;
      const init = values[metadata];
      const interval = values[metadata + 1];
      const size = Math.trunc(values[metadata + 2]);
      const count = Math.trunc(values[metadata + 3]);
      if (
        !Number.isFinite(init) ||
        !Number.isFinite(interval) ||
        interval <= 0 ||
        size < 3 ||
        count < 1 ||
        count * size + 4 > values.length
      )
        throw new Error('invalid SPK Chebyshev metadata');

      const record = Math.min(
        count - 1,
        Math.max(0, Math.floor((etSeconds - init) / interval))
      );
      const state = evaluate(
        values,
        record * size,
        size,
        segment.type,
        etSeconds
      );
      return { ...state, frame: segment.frame };
    }
    return null;
  }
}
