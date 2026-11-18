/**
 * LA PRÉCOMPILATION DE LA PERSPECTIVE AÉRIENNE (GAL-RENDER-001C, commit C).
 *
 * À la première approche de la Terre en Explo, `skyLayer.attachSky` pose la perspective aérienne
 * sur le sol et les nuages : deux programmes de plus (deux faces pour les nuages), ~450 ms
 * d'édition de liens SUR LE FIL PRINCIPAL (mesuré, GAL-RENDER-001B). Ici on les compile avant, avec
 * `compileAsync` (`KHR_parallel_shader_compile`, hors du fil quand le pilote le permet), puis on
 * laisse les vrais matériaux retrouver ces programmes dans le cache du moteur.
 *
 * PROPRIÉTÉ ET DURÉE DE VIE. Une précompilation possède, et elle seule : les COPIES de matériaux
 * (`probes`) et le matériau de ciel d'essai (`probeSky`, pour ses uniforms). Elle EMPRUNTE la
 * géométrie, les textures et les lumières de la vraie scène : elle n'en libère jamais aucune (une
 * copie de matériau ne dispose pas les textures qu'elle référence). Les copies tiennent le programme
 * en cache (compteur d'usage du moteur) : les libérer avant que les vrais matériaux l'aient pris le
 * détruirait, la première version de ce moyen (lot 54) le faisait. `release()` est donc appelé par
 * le propriétaire APRÈS usage effectif (quelques images rendues avec la perspective posée), ou
 * à l'échec, ou à l'abandon (corps libéré). Il est idempotent. Nombre de copies conservées :
 * au plus 3 (sol, nuages arrière et avant), pour la durée de cette seule opération.
 */
import * as THREE from 'three';
import { createSkyMaterial, getSky } from '@/shaders/SkyScatteringShader';
import {
  skyScattering,
  type SkyScatteringModelId,
} from '@/core/atmosphereScattering';
import { addAerialPerspective } from './aerialPerspective';

/** Ce qu'il faut pour compiler : le moteur, la scène (ses lumières), la caméra, la cible. */
export interface AerialCompileContext {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  /**
   * La cible où l'image est RENDUE : elle fait partie de la clé de programme (correction des tons
   * et espace couleur dépendent de `getRenderTarget()`). `null` : rendu direct à l'écran.
   */
  readonly renderTarget: THREE.WebGLRenderTarget | null;
}

/** Une précompilation en cours ou terminée : à libérer par son propriétaire. */
export interface AerialPrecompile {
  /** Résolue quand les programmes sont prêts, ou à l'échec (jamais rejetée). */
  readonly ready: Promise<boolean>;
  /** Libère les copies et le ciel d'essai. Idempotent. */
  release(): void;
  /** Nombre de copies encore tenues (0 après `release`). */
  readonly held: number;
  /** Clé de programme de chaque copie tenue : ce que le vrai matériau doit retrouver. */
  programKeys(): string[];
}

/** Au-delà, on ne bloque plus la pose du ciel sur la compilation (contexte perdu, pilote muet). */
export const PRECOMPILE_TIMEOUT_MS = 5000;

/** `compileAsync` existe-t-il, et peut-on s'y fier ici (pas de session XR : autre cible, autre clé) ? */
export function canPrecompile(context: AerialCompileContext): boolean {
  return (
    typeof context.renderer.compileAsync === 'function' &&
    !context.renderer.xr?.isPresenting
  );
}

/**
 * Copie un matériau SANS la sérialisation JSON de `userData` que fait `Material.clone()` (celui des
 * nuages porte des textures : `toDataURL`, 568 ms mesurés sous frein × 4) et en gardant ce qui
 * entre dans la clé de programme : `onBeforeCompile` et `customProgramCacheKey`.
 */
export function cloneForProgram(source: THREE.Material): THREE.Material {
  const userData = source.userData;
  source.userData = {};
  let copy: THREE.Material;
  try {
    copy = source.clone();
  } finally {
    source.userData = userData;
  }
  copy.onBeforeCompile = source.onBeforeCompile;
  if (Object.prototype.hasOwnProperty.call(source, 'customProgramCacheKey'))
    copy.customProgramCacheKey = source.customProgramCacheKey;
  copy.userData = { ...userData };
  return copy;
}

/**
 * Lance la précompilation des matériaux `*_surface` et `*_clouds` frères de `anchor` (la couche
 * atmosphère), avec la perspective aérienne qu'`attachSky` leur posera. Ne lève jamais : un échec
 * rend un `ready` à `false`, et le rendu de référence s'applique.
 */
export function precompileAerial(
  anchor: THREE.Object3D,
  modelId: SkyScatteringModelId,
  context: AerialCompileContext
): AerialPrecompile {
  const probes: THREE.Material[] = [];
  let probeSky: THREE.Material | null = null;
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    for (const probe of probes) probe.dispose();
    probes.length = 0;
    probeSky?.dispose();
    probeSky = null;
  };
  const handle: AerialPrecompile = {
    ready: Promise.resolve(false),
    release,
    programKeys: () => probes.map((p) => p.customProgramCacheKey()),
    get held() {
      return probes.length;
    },
  };

  let work: Promise<boolean>;
  try {
    probeSky = createSkyMaterial(skyScattering(modelId));
    const uniforms = getSky(probeSky)!.uniforms as Record<
      string,
      THREE.IUniform
    >;
    const probeScene = new THREE.Scene();
    for (const child of anchor.parent?.children ?? []) {
      if (!(child instanceof THREE.Mesh)) continue;
      const isGround = child.name.endsWith('_surface');
      const isClouds = child.name.endsWith('_clouds');
      if (!isGround && !isClouds) continue;
      for (const source of [child.material].flat()) {
        // `attachSky` ne pose la perspective sur les nuages que s'ils sont tonemappés.
        if (isClouds && !source.toneMapped) continue;
        const copy = cloneForProgram(source);
        addAerialPerspective(copy, uniforms, isClouds ? 'below' : 'vertex');
        const probe = new THREE.Mesh(child.geometry, copy);
        probe.castShadow = child.castShadow;
        probe.receiveShadow = child.receiveShadow;
        probeScene.add(probe);
        probes.push(copy);
      }
    }
    if (probes.length === 0) {
      release();
      return handle;
    }
    const { renderer } = context;
    const previous = renderer.getRenderTarget();
    let compiled: Promise<unknown>;
    try {
      // `compile` lit la cible courante pour fixer les tons et l'espace couleur du programme.
      renderer.setRenderTarget(context.renderTarget);
      compiled = renderer.compileAsync(
        probeScene,
        context.camera,
        context.scene
      );
    } finally {
      renderer.setRenderTarget(previous);
    }
    work = timeBounded(compiled, PRECOMPILE_TIMEOUT_MS);
  } catch {
    release();
    return handle;
  }
  return Object.assign(handle, {
    ready: work.then(
      (ok) => ok,
      () => false
    ),
  });
}

function timeBounded(work: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    work.then(
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      () => {
        clearTimeout(timer);
        resolve(false);
      }
    );
  });
}
