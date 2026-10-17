/**
 * LA SONDE DE PERFORMANCE (lot 54), sous `?debug-perf` seulement, dans le morceau des sondes.
 *
 * Le lot 54 est « la performance hors octets » : ce que coûte une scène en IMAGES PAR SECONDE, en
 * BLOCAGES du fil principal et en MÉMOIRE GPU, et non plus en octets téléchargés. Rien de cela ne
 * se lit depuis une page sans accès au moteur de rendu : cette sonde le publie sur
 * `window.perfProbe`, que `scripts/measure-perf.mjs` lit scène par scène.
 *
 * LA MÉMOIRE GPU EST ESTIMÉE, et dit comment : WebGL ne publie aucun compte d'octets. On parcourt
 * les textures et géométries ATTEINTES par la scène (une seule fois chacune) et on compte ce
 * qu'elles téléversent : largeur × hauteur × octets par texel, plus un tiers pour les mipmaps
 * quand elles en ont ; pour une texture compressée, les octets de ses niveaux tels quels. Ce
 * n'est pas ce que le pilote alloue (alignement, copies), c'est ce que l'application lui DONNE,
 * et c'est la grandeur que KTX2 ferait baisser.
 */
import * as THREE from 'three';
import type { PublicAPI } from '@/SolarSystemApp';
import { hasDebugFlag } from '@/utils/debugFlags';
import { decodeTextureOffThread } from '@/components/systems/TextureSystem';

/** Ce que la sonde rend à chaque lecture. */
export interface PerfSnapshot {
  renderer: string;
  frames: { count: number; p50Ms: number; p95Ms: number; maxMs: number };
  longTasks: { count: number; totalMs: number; maxMs: number };
  textures: {
    count: number;
    bytes: number;
    compressed: number;
    largest: string[];
  };
  geometries: { count: number; bytes: number };
  drawCalls: number;
  triangles: number;
  programs: number;
}

/** Octets par texel d'une texture non compressée, selon son format et son type. */
function bytesPerTexel(texture: THREE.Texture): number {
  const channels =
    texture.format === THREE.RedFormat
      ? 1
      : texture.format === THREE.RGFormat
        ? 2
        : texture.format === THREE.RGBFormat
          ? 3
          : 4;
  const bytes =
    texture.type === THREE.FloatType
      ? 4
      : texture.type === THREE.HalfFloatType ||
          texture.type === THREE.UnsignedShortType ||
          texture.type === THREE.ShortType
        ? 2
        : 1;
  return channels * bytes;
}

function textureBytes(texture: THREE.Texture): number {
  if ((texture as THREE.CompressedTexture).isCompressedTexture) {
    const mipmaps = (texture as THREE.CompressedTexture).mipmaps as
      { data: ArrayBufferView }[] | undefined;
    return (mipmaps ?? []).reduce((sum, m) => sum + m.data.byteLength, 0);
  }
  const image = texture.image as
    { width?: number; height?: number; depth?: number } | undefined;
  const width = image?.width ?? 0;
  const height = image?.height ?? 0;
  const base = width * height * (image?.depth ?? 1) * bytesPerTexel(texture);
  return texture.generateMipmaps ? Math.round((base * 4) / 3) : base;
}

function geometryBytes(geometry: THREE.BufferGeometry): number {
  let bytes = geometry.index?.array.byteLength ?? 0;
  for (const attribute of Object.values(geometry.attributes))
    bytes += (attribute as THREE.BufferAttribute).array?.byteLength ?? 0;
  return bytes;
}

export function setupPerfProbe(api: PublicAPI): () => void {
  if (!hasDebugFlag('debug-perf')) return () => undefined;

  const renderer = api.sceneSystem.renderer;
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const rendererName = info
    ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
    : 'unknown';

  // Durées d'image : l'écart entre deux images rendues, en millisecondes. Et les appels de dessin
  // d'une image ENTIÈRE : `renderer.info` se remet à zéro à chaque `render()`, et le compositeur
  // en fait plusieurs par image, si bien que sa dernière passe (un seul triangle plein écran)
  // annonçait « 1 appel » (mesuré le 2026-10-17). On cumule donc d'un rappel d'image au suivant.
  let last = 0;
  let frames: number[] = [];
  let drawCalls = 0;
  let triangles = 0;
  renderer.info.autoReset = false;
  const stopFrames = api.animationSystem.onFrame(() => {
    const now = performance.now();
    if (last > 0) frames.push(now - last);
    last = now;
    drawCalls = renderer.info.render.calls;
    triangles = renderer.info.render.triangles;
    renderer.info.reset();
  });

  // Le chemin de chaque texture du cache, pour qu'un relevé dise QUELLE texture pèse.
  const names = (): Map<THREE.Texture, string> => {
    const out = new Map<THREE.Texture, string>();
    for (const [path, texture] of api.textureSystem.cachedEntries())
      out.set(texture, path.split('/').pop() ?? path);
    return out;
  };

  // Blocages du fil principal (> 50 ms), tels que le navigateur les rapporte. Un script injecté
  // avant l'application (`scripts/measure-perf.mjs`) les observe depuis la navigation et les
  // range dans `window.__longTasks` : on reprend SA liste, sans quoi tout ce qui précède le
  // chargement de cette sonde manquerait.
  const early = (window as unknown as { __longTasks?: number[] }).__longTasks;
  const longTasks: number[] = early ?? [];
  let observer: PerformanceObserver | null = null;
  if (!early)
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push(entry.duration);
      });
      observer.observe({ type: 'longtask', buffered: false });
    } catch {
      observer = null;
    }

  const percentile = (values: number[], p: number): number => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
  };

  const snapshot = (): PerfSnapshot => {
    const textures = new Map<THREE.Texture, number>();
    const geometries = new Set<THREE.BufferGeometry>();
    api.sceneSystem.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      const materials = mesh.material
        ? Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material]
        : [];
      for (const material of materials) {
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture && !textures.has(value))
            textures.set(value, textureBytes(value));
        }
        const uniforms = (material as THREE.ShaderMaterial).uniforms ?? {};
        for (const uniform of Object.values(uniforms)) {
          const value = (uniform as { value?: unknown })?.value;
          if (value instanceof THREE.Texture && !textures.has(value))
            textures.set(value, textureBytes(value));
        }
      }
    });
    const known = names();
    const largest = [...textures.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([t, bytes]) => {
        const image = t.image as
          { width?: number; height?: number } | undefined;
        return `${known.get(t) ?? (t.name || '(hors cache)')} ${image?.width ?? '?'}×${image?.height ?? '?'} ${Math.round(bytes / 1048576)} Mio`;
      });
    return {
      renderer: rendererName,
      frames: {
        count: frames.length,
        p50Ms: percentile(frames, 0.5),
        p95Ms: percentile(frames, 0.95),
        maxMs: Math.max(0, ...frames),
      },
      longTasks: {
        count: longTasks.length,
        totalMs: longTasks.reduce((a, b) => a + b, 0),
        maxMs: Math.max(0, ...longTasks),
      },
      textures: {
        count: textures.size,
        bytes: [...textures.values()].reduce((a, b) => a + b, 0),
        compressed: [...textures.keys()].filter(
          (t) => (t as THREE.CompressedTexture).isCompressedTexture
        ).length,
        largest,
      },
      geometries: {
        count: geometries.size,
        bytes: [...geometries].reduce((a, g) => a + geometryBytes(g), 0),
      },
      drawCalls,
      triangles,
      programs: renderer.info.programs?.length ?? 0,
    };
  };

  /**
   * Le coût en FIL PRINCIPAL de préparer une texture, par deux chemins : `TextureLoader` (une
   * `<img>`, décodée au téléversement) et `createImageBitmap` (décodée hors du fil principal).
   * Chaque chemin est mesuré du début du chargement à la fin de `initTexture`, et le temps
   * BLOQUÉ est celui de `initTexture` seul : le reste est de l'attente réseau ou de décodage
   * parallèle, qui ne fige pas l'écran.
   */
  const uploadTest = async (
    url: string
  ): Promise<{ path: string; blockedMs: number; totalMs: number }[]> => {
    const out: { path: string; blockedMs: number; totalMs: number }[] = [];
    const time = async (path: string, load: () => Promise<THREE.Texture>) => {
      const start = performance.now();
      const texture = await load();
      texture.colorSpace = THREE.SRGBColorSpace;
      const before = performance.now();
      renderer.initTexture(texture);
      const after = performance.now();
      out.push({ path, blockedMs: after - before, totalMs: after - start });
      texture.dispose();
    };
    await time('TextureLoader', () =>
      new THREE.TextureLoader().loadAsync(`${url}?img=${Date.now()}`)
    );
    await time('createImageBitmap', async () => {
      const blob = await (await fetch(`${url}?bmp=${Date.now()}`)).blob();
      const bitmap = await createImageBitmap(blob, {
        imageOrientation: 'flipY',
      });
      const texture = new THREE.Texture(bitmap);
      texture.flipY = false;
      texture.needsUpdate = true;
      return texture;
    });
    return out;
  };

  /**
   * LES DEUX CHEMINS DONNENT-ILS LES MÊMES PIXELS ? Une texture chargée par `TextureSystem` et la
   * même par `TextureLoader` (l'ancien chemin) sont rendues chacune dans une petite cible hors
   * écran, puis relues : l'écart maximal par canal. Une image retournée ou décalée n'y échappe
   * pas, alors qu'aucune erreur ne la signalerait (lot 54).
   */
  const decodeEquivalence = async (
    relativePath: string,
    quality: string
  ): Promise<{
    maxDiff: number;
    width: number;
    height: number;
    url: string;
  }> => {
    const width = 64;
    const height = 32;
    const read = (texture: THREE.Texture): Uint8Array => {
      texture.colorSpace = THREE.NoColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      texture.needsUpdate = true;
      const target = new THREE.WebGLRenderTarget(width, height);
      const scene = new THREE.Scene();
      const material = new THREE.MeshBasicMaterial({ map: texture });
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
      scene.add(quad);
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      const pixels = new Uint8Array(width * height * 4);
      renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
      renderer.setRenderTarget(previous);
      target.dispose();
      quad.geometry.dispose();
      material.dispose();
      return pixels;
    };
    const loaded = await api.textureSystem.loadTexture(relativePath, quality);
    const url =
      [...api.textureSystem.cachedEntries()].find(
        ([, t]) => t === loaded
      )?.[0] ?? '';
    // Une copie : régler la copie ne touche pas la texture du cache, que la scène emploie.
    // Le chemin hors du fil, appelé EXPLICITEMENT : en rendu logiciel (la CI), `TextureSystem`
    // garde l'ancien, et comparer le cache à `TextureLoader` ne prouverait plus rien.
    const fromSystem = read(await decodeTextureOffThread(url));
    const fromLoader = read(await new THREE.TextureLoader().loadAsync(url));
    let maxDiff = 0;
    for (let i = 0; i < fromSystem.length; i += 1)
      maxDiff = Math.max(maxDiff, Math.abs(fromSystem[i]! - fromLoader[i]!));
    return { maxDiff, width, height, url };
  };

  /**
   * Les attentes d'édition de liens relevées par le script de mesure (`window.__shaderLinks`,
   * posé avant l'application), nommées par le programme de Three.js qui les a causées.
   */
  const shaderLinks = (): {
    name: string;
    ms: number;
    at: number;
    method: string;
  }[] => {
    const raw =
      (
        window as unknown as {
          __shaderLinks?: {
            program: WebGLProgram;
            ms: number;
            at: number;
            method: string;
          }[];
        }
      ).__shaderLinks ?? [];
    // Le programme de chaque objet de la scène, par les propriétés internes du moteur de rendu :
    // c'est ce qui dit QUEL corps a payé une attente, là où la clé de cache ne le dit pas.
    const names = new Map<WebGLProgram, string>();
    api.sceneSystem.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      const materials = mesh.material
        ? Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material]
        : [];
      for (const material of materials) {
        const current = (
          renderer.properties.get(material) as {
            currentProgram?: { program: WebGLProgram };
          }
        ).currentProgram;
        if (!current) continue;
        let path = object.name || object.type;
        for (let o = object.parent; o && path.length < 80; o = o.parent)
          if (o.name) path = `${o.name}/${path}`;
        names.set(current.program, `${material.type} ${path}`);
      }
    });
    return raw.map((l) => ({
      name: names.get(l.program) ?? '(shader, ou programme hors scène)',
      ms: l.ms,
      at: l.at,
      method: l.method,
    }));
  };

  /**
   * LA TEXTURE TELLE QUE LE GPU LA TIENT : une texture du cache, rendue SANS la marquer à
   * téléverser, comparée à la même image lue fraîchement en données brutes. Un écart dit que son
   * stockage ne correspond pas à son espace de couleur déclaré (lot 54).
   */
  const storedVersusRaw = async (
    file: string,
    /** Témoin : retéléverser d'abord la texture, telle qu'elle est déclarée maintenant. */
    reupload = false
  ): Promise<{ maxDiff: number; colorSpace: string } | null> => {
    const entry = [...api.textureSystem.cachedEntries()].find(([path]) =>
      path.endsWith(file)
    );
    if (!entry) return null;
    const [url, stored] = entry;
    if (reupload) stored.needsUpdate = true;
    const read = (texture: THREE.Texture, upload: boolean): Uint8Array => {
      const width = 64;
      const height = 32;
      if (upload) {
        texture.colorSpace = THREE.NoColorSpace;
        texture.needsUpdate = true;
      }
      const target = new THREE.WebGLRenderTarget(width, height);
      const scene = new THREE.Scene();
      const material = new THREE.MeshBasicMaterial({ map: texture });
      scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.render(scene, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
      const pixels = new Uint8Array(width * height * 4);
      renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
      renderer.setRenderTarget(previous);
      target.dispose();
      material.dispose();
      return pixels;
    };
    const fromGpu = read(stored, false);
    const fresh = read(await new THREE.TextureLoader().loadAsync(url), true);
    let maxDiff = 0;
    for (let i = 0; i < fromGpu.length; i += 1)
      maxDiff = Math.max(maxDiff, Math.abs(fromGpu[i]! - fresh[i]!));
    return { maxDiff, colorSpace: stored.colorSpace };
  };

  const probe = {
    snapshot,
    storedVersusRaw,
    shaderLinks,
    uploadTest,
    decodeEquivalence,
    /** Repart de zéro : les durées d'image et les blocages d'une scène, pas des précédentes. */
    reset(): void {
      frames = [];
      longTasks.length = 0;
      last = 0;
    },
  };
  (window as unknown as { perfProbe?: typeof probe }).perfProbe = probe;

  return () => {
    stopFrames();
    renderer.info.autoReset = true;
    observer?.disconnect();
    delete (window as unknown as { perfProbe?: typeof probe }).perfProbe;
  };
}
