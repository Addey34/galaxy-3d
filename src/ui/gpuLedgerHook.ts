/**
 * L'ACCROCHAGE DU REGISTRE DES ALLOCATIONS (`core/gpuLedger.ts`) AUX CONTEXTES WebGL 2, sous
 * `?debug-perf` seulement (lot 56).
 *
 * Il doit précéder le PREMIER appel WebGL de l'application : une texture téléversée avant lui
 * n'existerait pas pour le registre, et sa suppression ultérieure ne retrancherait rien. C'est
 * pourquoi `MainSolarSystemApp` attend le morceau des sondes AVANT de construire l'application
 * quand ce drapeau est présent, et seulement alors : un visiteur ordinaire n'en paie rien.
 *
 * On enveloppe les méthodes du PROTOTYPE, donc tout contexte créé ensuite est compté, chacun dans
 * son propre registre.
 */
import { GpuLedger } from '@/core/gpuLedger';

const ledgers = new WeakMap<WebGL2RenderingContext, GpuLedger>();
let installed = false;

/** Le registre d'un contexte, créé à son premier appel compté. */
export function ledgerFor(gl: WebGL2RenderingContext): GpuLedger | null {
  return ledgers.get(gl) ?? null;
}

export function isGpuLedgerInstalled(): boolean {
  return installed;
}

function of(gl: WebGL2RenderingContext): GpuLedger {
  let ledger = ledgers.get(gl);
  if (!ledger) {
    ledger = new GpuLedger();
    ledgers.set(gl, ledger);
  }
  return ledger;
}

/** Largeur et hauteur d'une source DOM (`<img>`, `ImageBitmap`, `<canvas>`, `<video>`, `ImageData`). */
function sourceSize(source: unknown): [number, number] {
  const s = source as {
    naturalWidth?: number;
    naturalHeight?: number;
    videoWidth?: number;
    videoHeight?: number;
    displayWidth?: number;
    displayHeight?: number;
    width?: number;
    height?: number;
  };
  return [
    s.naturalWidth || s.videoWidth || s.displayWidth || s.width || 0,
    s.naturalHeight || s.videoHeight || s.displayHeight || s.height || 0,
  ];
}

export function installGpuLedger(): void {
  if (installed || typeof WebGL2RenderingContext === 'undefined') return;
  installed = true;
  const proto = WebGL2RenderingContext.prototype as unknown as Record<
    string,
    (...args: unknown[]) => unknown
  >;
  const wrap = (
    name: string,
    record: (ledger: GpuLedger, args: unknown[]) => void
  ): void => {
    const original = proto[name]!;
    proto[name] = function (this: WebGL2RenderingContext, ...args: unknown[]) {
      const value = original.apply(this, args);
      record(of(this), args);
      return value;
    };
  };
  const n = (v: unknown): number => v as number;
  const k = (v: unknown): object | null => (v as object | null) ?? null;

  wrap('activeTexture', (l, a) => l.activeTexture(n(a[0])));
  wrap('bindTexture', (l, a) => l.bindTexture(n(a[0]), k(a[1])));
  wrap('deleteTexture', (l, a) => l.deleteTexture(k(a[0])));
  // texImage2D a deux formes : dimensions explicites (8 arguments ou plus, le 4e est un nombre)
  // ou source DOM (6 arguments, la source porte ses dimensions).
  wrap('texImage2D', (l, a) => {
    if (a.length >= 8 && typeof a[3] === 'number')
      l.texImage(n(a[0]), n(a[1]), n(a[2]), n(a[3]), n(a[4]), 1, n(a[7]));
    else {
      const [w, h] = sourceSize(a[5]);
      l.texImage(n(a[0]), n(a[1]), n(a[2]), w, h, 1, n(a[4]));
    }
  });
  wrap('texImage3D', (l, a) =>
    l.texImage(n(a[0]), n(a[1]), n(a[2]), n(a[3]), n(a[4]), n(a[5]), n(a[8]))
  );
  wrap('copyTexImage2D', (l, a) =>
    l.texImage(n(a[0]), n(a[1]), n(a[2]), n(a[5]), n(a[6]))
  );
  wrap('compressedTexImage2D', (l, a) => {
    // (cible, niveau, format, l, h, bord, données | taille, décalage)
    const data = a[6];
    const bytes =
      typeof data === 'number'
        ? data
        : ((data as ArrayBufferView | undefined)?.byteLength ?? 0);
    l.compressedTexImage(n(a[0]), n(a[1]), n(a[3]), n(a[4]), bytes);
  });
  wrap('texStorage2D', (l, a) =>
    l.texStorage(n(a[0]), n(a[1]), n(a[2]), n(a[3]), n(a[4]))
  );
  wrap('texStorage3D', (l, a) =>
    l.texStorage(n(a[0]), n(a[1]), n(a[2]), n(a[3]), n(a[4]), n(a[5]))
  );
  wrap('generateMipmap', (l, a) => l.generateMipmap(n(a[0])));
  wrap('bindRenderbuffer', (l, a) => l.bindRenderbuffer(k(a[1])));
  wrap('renderbufferStorage', (l, a) =>
    l.renderbufferStorage(1, n(a[1]), n(a[2]), n(a[3]))
  );
  wrap('renderbufferStorageMultisample', (l, a) =>
    l.renderbufferStorage(n(a[1]), n(a[2]), n(a[3]), n(a[4]))
  );
  wrap('deleteRenderbuffer', (l, a) => l.deleteRenderbuffer(k(a[0])));
  wrap('bindBuffer', (l, a) => l.bindBuffer(n(a[0]), k(a[1])));
  wrap('bufferData', (l, a) => {
    const data = a[1];
    l.bufferData(
      n(a[0]),
      typeof data === 'number'
        ? data
        : ((data as ArrayBufferView | ArrayBuffer | null)?.byteLength ?? 0)
    );
  });
  wrap('deleteBuffer', (l, a) => l.deleteBuffer(k(a[0])));
}
