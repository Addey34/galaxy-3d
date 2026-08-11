import type { SpkSegmentDescriptor, SpkState } from './SpkKernel';
export interface SpkKernelWorkerTransport {
  loadUrl(url: string): Promise<readonly SpkSegmentDescriptor[]>;
  getState(
    target: number,
    center: number,
    etSeconds: number
  ): Promise<SpkState | null>;
  dispose(): void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

interface WorkerResponse {
  id: number;
  type: 'loaded' | 'state' | 'error';
  segments?: readonly SpkSegmentDescriptor[];
  state?: SpkState | null;
  message?: string;
}

export class SpkKernelWorkerClient implements SpkKernelWorkerTransport {
  private readonly worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();

  constructor() {
    this.worker = new Worker(new URL('./SpkKernelWorker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      const request = this.pending.get(data.id);
      if (!request) return;
      this.pending.delete(data.id);
      if (data.type === 'error') {
        request.reject(new Error(data.message ?? 'SPK worker error'));
      } else {
        request.resolve(data);
      }
    };
    this.worker.onerror = (event) => {
      const error = new Error(event.message || 'SPK worker failed');
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear();
    };
  }

  loadUrl(url: string): Promise<readonly SpkSegmentDescriptor[]> {
    return this.request<{ segments: readonly SpkSegmentDescriptor[] }>({
      type: 'loadUrl',
      url,
    }).then((response) => response.segments);
  }

  loadBuffer(buffer: ArrayBuffer): Promise<readonly SpkSegmentDescriptor[]> {
    return this.request<{ segments: readonly SpkSegmentDescriptor[] }>(
      { type: 'loadBuffer', buffer },
      [buffer]
    ).then((response) => response.segments);
  }

  getState(
    target: number,
    center: number,
    etSeconds: number
  ): Promise<SpkState | null> {
    return this.request<{ state: SpkState | null }>({
      type: 'state',
      target,
      center,
      etSeconds,
    }).then((response) => response.state);
  }

  dispose(): void {
    this.worker.terminate();
    for (const request of this.pending.values())
      request.reject(new Error('SPK worker disposed'));
    this.pending.clear();
  }

  private request<T extends object>(
    payload: Record<string, unknown>,
    transfer: Transferable[] = []
  ): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.worker.postMessage({ id, ...payload }, transfer);
    });
  }
}
