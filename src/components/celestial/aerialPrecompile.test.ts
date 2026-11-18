import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addAerialPerspective,
  hasAerialPerspective,
} from './aerialPerspective';
import {
  canPrecompile,
  cloneForProgram,
  precompileAerial,
  PRECOMPILE_TIMEOUT_MS,
  type AerialCompileContext,
} from './aerialPrecompile';

/** Un corps minimal : une couche atmosphère et ses frères sol et nuages, comme CelestialObject. */
function body() {
  const group = new THREE.Group();
  const geometry = new THREE.SphereGeometry(1, 8, 4);
  const map = new THREE.Texture();
  const ground = new THREE.MeshStandardMaterial({ map });
  const cloudsBack = new THREE.MeshStandardMaterial({
    map,
    transparent: true,
    side: THREE.BackSide,
  });
  const cloudsFront = new THREE.MeshStandardMaterial({
    map,
    transparent: true,
    side: THREE.FrontSide,
  });
  const surface = new THREE.Mesh(geometry, ground);
  surface.name = 'earth_surface';
  const clouds = new THREE.Mesh(geometry, [cloudsBack, cloudsFront]);
  clouds.name = 'earth_clouds';
  const atmosphere = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  atmosphere.name = 'earth_atmosphere';
  group.add(surface, clouds, atmosphere);
  return { group, atmosphere, geometry, map, ground, cloudsBack, cloudsFront };
}

type Call = { target: unknown; scene: THREE.Scene; lights: THREE.Scene };

function fakeContext(overrides: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  let current: unknown = 'ancienne-cible';
  const renderer = {
    getRenderTarget: () => current,
    setRenderTarget: (t: unknown) => {
      current = t;
    },
    xr: { isPresenting: false },
    compileAsync: (scene: THREE.Scene, _c: unknown, lights: THREE.Scene) => {
      calls.push({ target: current, scene, lights });
      return Promise.resolve(scene);
    },
    ...overrides,
  };
  const context: AerialCompileContext = {
    renderer: renderer as unknown as THREE.WebGLRenderer,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    renderTarget: new THREE.WebGLRenderTarget(1, 1),
  };
  return { context, calls };
}

const MODEL = 'bruneton-2017' as const;

afterEach(() => vi.useRealTimers());

describe('precompileAerial : correspondance avec les programmes du vrai rendu', () => {
  it('compile avec la CIBLE du compositeur, puis rend la cible precedente', async () => {
    const { atmosphere } = body();
    const { context, calls } = fakeContext();
    const p = precompileAerial(atmosphere, MODEL, context);
    expect(await p.ready).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.target).toBe(context.renderTarget);
    // Les lumieres viennent de la VRAIE scene.
    expect(calls[0]!.lights).toBe(context.scene);
    // Aucune modification residuelle de l'etat du moteur.
    expect(context.renderer.getRenderTarget()).toBe('ancienne-cible');
    p.release();
  });

  it('une copie a la MEME cle de programme que le vrai materiau apres attachSky', () => {
    const b = body();
    const { context } = fakeContext();
    const p = precompileAerial(b.atmosphere, MODEL, context);
    expect(p.held).toBe(3);
    const probeKeys = p.programKeys();
    // Ce que fait attachSky sur les vrais materiaux (sol : vertex, nuages : below).
    addAerialPerspective(b.ground, {}, 'vertex');
    addAerialPerspective(b.cloudsBack, {}, 'below');
    addAerialPerspective(b.cloudsFront, {}, 'below');
    expect([
      b.ground.customProgramCacheKey(),
      b.cloudsBack.customProgramCacheKey(),
      b.cloudsFront.customProgramCacheKey(),
    ]).toEqual(probeKeys);
    // Et la variante 'below' differe bien de la variante du sol : la cle porte la difference.
    expect(probeKeys[0]).toMatch(/-aerial$/);
    expect(probeKeys[1]).toMatch(/-aerial-below$/);
    p.release();
  });

  it('ne touche pas aux vrais materiaux, a leur geometrie ni a leurs textures', async () => {
    const b = body();
    const events: string[] = [];
    for (const [name, target] of [
      ['geometrie', b.geometry],
      ['texture', b.map],
      ['sol', b.ground],
      ['nuages', b.cloudsBack],
    ] as const)
      target.addEventListener('dispose', () => events.push(name));
    const p = precompileAerial(b.atmosphere, MODEL, fakeContext().context);
    await p.ready;
    p.release();
    expect(events).toEqual([]);
    expect(hasAerialPerspective(b.ground)).toBe(false);
    expect(hasAerialPerspective(b.cloudsBack)).toBe(false);
  });

  it('ne copie que les nuages soumis a la courbe de tons (comme attachSky)', () => {
    const b = body();
    b.cloudsFront.toneMapped = false;
    const p = precompileAerial(b.atmosphere, MODEL, fakeContext().context);
    expect(p.held).toBe(2);
    p.release();
  });
});

describe('precompileAerial : duree de vie des materiaux temporaires', () => {
  it('garde les copies tant que le proprietaire ne libere pas', async () => {
    const p = precompileAerial(body().atmosphere, MODEL, fakeContext().context);
    await p.ready;
    // La resolution de ready ne libere RIEN : les copies tiennent encore les programmes.
    expect(p.held).toBe(3);
    p.release();
    expect(p.held).toBe(0);
  });

  it('release() dispose chaque copie et le ciel d essai exactement une fois', async () => {
    const spy = vi.spyOn(THREE.Material.prototype, 'dispose');
    const p = precompileAerial(body().atmosphere, MODEL, fakeContext().context);
    await p.ready;
    const before = spy.mock.calls.length;
    p.release();
    p.release();
    // 3 copies + le ciel d'essai.
    expect(spy.mock.calls.length - before).toBe(4);
    spy.mockRestore();
  });
});

describe('precompileAerial : replis', () => {
  it('compileAsync qui echoue : ready vaut false, sans rejet', async () => {
    const { context } = fakeContext({
      compileAsync: () => Promise.reject(new Error('contexte perdu')),
    });
    const p = precompileAerial(body().atmosphere, MODEL, context);
    await expect(p.ready).resolves.toBe(false);
    p.release();
    expect(p.held).toBe(0);
  });

  it('compileAsync qui leve de facon synchrone : false, etat du moteur restaure', async () => {
    const { context } = fakeContext({
      compileAsync: () => {
        throw new Error('boum');
      },
    });
    const p = precompileAerial(body().atmosphere, MODEL, context);
    await expect(p.ready).resolves.toBe(false);
    expect(context.renderer.getRenderTarget()).toBe('ancienne-cible');
    expect(p.held).toBe(0);
  });

  it('une compilation qui ne finit jamais est abandonnee apres le delai borne', async () => {
    vi.useFakeTimers();
    const { context } = fakeContext({
      compileAsync: () => new Promise(() => {}),
    });
    const p = precompileAerial(body().atmosphere, MODEL, context);
    let result: boolean | undefined;
    void p.ready.then((v) => (result = v));
    await vi.advanceTimersByTimeAsync(PRECOMPILE_TIMEOUT_MS - 1);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2);
    expect(result).toBe(false);
    p.release();
  });

  it('sans sol ni nuages a copier : aucun appel', async () => {
    const group = new THREE.Group();
    const atmosphere = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial()
    );
    group.add(atmosphere);
    const { context, calls } = fakeContext();
    const p = precompileAerial(atmosphere, MODEL, context);
    await expect(p.ready).resolves.toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('canPrecompile : refuse sans compileAsync et en session XR', () => {
    expect(canPrecompile(fakeContext().context)).toBe(true);
    expect(
      canPrecompile(fakeContext({ compileAsync: undefined }).context)
    ).toBe(false);
    expect(
      canPrecompile(fakeContext({ xr: { isPresenting: true } }).context)
    ).toBe(false);
  });
});

describe('cloneForProgram', () => {
  it('ne serialise pas userData et le laisse intact sur la source', () => {
    const m = new THREE.MeshStandardMaterial();
    const hostile = {
      toJSON() {
        throw new Error('userData serialise');
      },
    };
    m.userData = { texture: hostile, drapeau: 1 };
    const original = m.userData;
    const copy = cloneForProgram(m);
    expect(m.userData).toBe(original);
    expect(copy.userData).toEqual({ texture: hostile, drapeau: 1 });
    expect(copy.userData).not.toBe(original);
  });

  it('garde onBeforeCompile et customProgramCacheKey propres', () => {
    const m = new THREE.MeshStandardMaterial();
    const hook = vi.fn();
    m.onBeforeCompile = hook;
    m.customProgramCacheKey = () => 'ma-cle';
    const copy = cloneForProgram(m);
    expect(copy.onBeforeCompile).toBe(hook);
    expect(copy.customProgramCacheKey()).toBe('ma-cle');
  });

  it('restaure userData meme si le clonage leve', () => {
    const m = new THREE.MeshStandardMaterial();
    m.userData = { a: 1 };
    const original = m.userData;
    vi.spyOn(m, 'clone').mockImplementation(() => {
      throw new Error('echec');
    });
    expect(() => cloneForProgram(m)).toThrow('echec');
    expect(m.userData).toBe(original);
  });
});
