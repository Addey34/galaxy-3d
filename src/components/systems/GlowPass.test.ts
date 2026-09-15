import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  COMPOSITE_FRAGMENT,
  DOWNSAMPLE_FRAGMENT,
  GlowPass,
  SCALE_FRAGMENT,
  UPSAMPLE_FRAGMENT,
} from './GlowPass';
import {
  GLOW_LAYER,
  OCCLUDER_LAYER,
  glowClasses,
  glowGainOf,
  isGlowOccluder,
  isGlowSource,
  markGlowOccluder,
  markGlowSource,
} from './glowSelection';
import { GLOW_GAINS } from '@/config/engine';
import { buildLayers } from '@/components/celestial/celestialLayers';
import { CELESTIAL_CONFIG } from '@/config/bodies';

const SETTINGS = {
  strength: 0.75,
  radius: 1,
  levels: 6,
  threshold: 0.5,
  knee: 0.25,
};

/** Identifiants `uXxx` employés / déclarés dans une source GLSL (cf. shaderUniforms.test). */
const used = (source: string) =>
  new Set([...source.matchAll(/\bu[A-Z][A-Za-z0-9_]*/g)].map((m) => m[0]));
const declared = (source: string) =>
  new Set(
    [...source.matchAll(/uniform\s+\w+\s+(u[A-Za-z0-9_]*)\s*;/g)].map(
      (m) => m[1]!
    )
  );

describe('GlowPass : shaders', () => {
  /**
   * Un uniforme employé mais non déclaré ne compile pas, et Three.js ne dit rien d'exploitable :
   * la passe rendrait noir — déjà payé sur la Terre (cf. shaderUniforms.test). On vérifie en
   * plus que chaque uniforme DÉCLARÉ est bien fourni par le matériau JavaScript.
   */
  const pass = new GlowPass(
    new THREE.Scene(),
    new THREE.PerspectiveCamera(),
    SETTINGS
  );
  const materials = pass as unknown as Record<string, THREE.ShaderMaterial>;
  it.each([
    ['sous-échantillonnage', DOWNSAMPLE_FRAGMENT, 'downsample'],
    ['remontée', UPSAMPLE_FRAGMENT, 'upsample'],
    ['composition', COMPOSITE_FRAGMENT, 'composite'],
    ['remise à l’échelle', SCALE_FRAGMENT, 'scale'],
  ] as const)(
    '%s : uniformes employés = déclarés = fournis',
    (_label, source, key) => {
      const u = used(source);
      const d = declared(source);
      expect([...u].filter((name) => !d.has(name))).toEqual([]);
      expect(Object.keys(materials[key]!.uniforms).sort()).toEqual(
        [...d].sort()
      );
    }
  );
});

describe('sélection du halo', () => {
  it('ajoute les calques sans retirer l’objet du rendu normal', () => {
    const object = markGlowSource(new THREE.Object3D());
    expect(object.layers.isEnabled(0)).toBe(true);
    expect(object.layers.isEnabled(GLOW_LAYER)).toBe(true);
  });

  it('range les sources de même intensité dans la même classe', () => {
    const a = markGlowSource(new THREE.Object3D(), 2.5);
    const b = markGlowSource(new THREE.Object3D(), 2.5);
    expect(a.layers.mask).toBe(b.layers.mask);
    expect(glowGainOf(a)).toBe(2.5);
    expect(glowGainOf(markGlowSource(new THREE.Object3D(), 0.3))).toBe(0.3);
    expect(glowGainOf(new THREE.Object3D())).toBe(0);
    const gains = glowClasses().map((c) => c.gain);
    expect(gains).toEqual([...gains].sort((x, y) => x - y));
  });

  it('refuse une intensité nulle, négative ou non numérique', () => {
    for (const gain of [0, -1, Number.NaN])
      expect(() => markGlowSource(new THREE.Object3D(), gain)).toThrow(
        RangeError
      );
  });

  /**
   * Les sources réelles, construites par le vrai code : si quelqu'un retire un marquage, le
   * halo de cette source disparaît sans erreur — c'est ce que ceci empêche.
   */
  it('fait rayonner les lumières de ville et le Soleil, et occulter les surfaces', () => {
    const earth = buildLayers(CELESTIAL_CONFIG.bodies.earth, 'earth');
    const sun = buildLayers(CELESTIAL_CONFIG.bodies.sun, 'sun');
    const moon = buildLayers(
      CELESTIAL_CONFIG.bodies.earth.satellites!.moon!,
      'moon'
    );
    expect(isGlowSource(earth.get('lights')!)).toBe(true);
    // Chaque source porte SON intensité, lue dans la configuration.
    expect(glowGainOf(earth.get('lights')!)).toBe(GLOW_GAINS.cityLights);
    expect(glowGainOf(sun.get('surface')!)).toBe(GLOW_GAINS.star);
    expect(isGlowOccluder(earth.get('surface')!)).toBe(true);
    expect(isGlowSource(earth.get('surface')!)).toBe(false);
    expect(isGlowSource(sun.get('surface')!)).toBe(true);
    // La Lune doit pouvoir masquer le Soleil pendant une éclipse.
    expect(isGlowOccluder(moon.get('surface')!)).toBe(true);
    // Les nuages et l'atmosphère ne sont ni l'un ni l'autre : ils ne rayonnent pas.
    expect(isGlowSource(earth.get('clouds')!)).toBe(false);
    expect(isGlowSource(earth.get('atmosphere')!)).toBe(false);
    for (const layers of [earth, sun, moon])
      for (const mesh of layers.values()) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
  });
});

/** Faux renderer : enregistre ce que chaque `render` voit de la scène et de la caméra. */
function fakeRenderer() {
  const calls: {
    target: unknown;
    layers: number;
    override: THREE.Material | null;
    background: unknown;
    what: string;
    scale: number | null;
  }[] = [];
  let target: unknown = null;
  const clearColor = new THREE.Color(0x123456);
  const renderer = {
    autoClear: true,
    setRenderTarget: (t: unknown) => (target = t),
    getRenderTarget: () => target,
    clear: () => undefined,
    getClearColor: (out: THREE.Color) => out.copy(clearColor),
    getClearAlpha: () => 0.5,
    setClearColor: (c: THREE.ColorRepresentation) => clearColor.set(c),
    render: (scene: THREE.Object3D, camera: THREE.Camera) =>
      calls.push({
        target,
        layers: camera.layers.mask,
        override: (scene as THREE.Scene).overrideMaterial ?? null,
        background: (scene as THREE.Scene).background ?? null,
        what: (scene as THREE.Scene).isScene ? 'scene' : 'quad',
        scale:
          ((scene as THREE.Mesh).material as THREE.ShaderMaterial | undefined)
            ?.uniforms?.['uScale']?.value ?? null,
      }),
  };
  return {
    renderer: renderer as unknown as THREE.WebGLRenderer,
    calls,
    clearColor,
  };
}

describe('GlowPass : passe de sélection', () => {
  const scene = new THREE.Scene();
  const background = new THREE.Color(0x0000ff);
  scene.background = background;
  // Trois intensités, dont celles de la vraie configuration : les classes sont globales au
  // module, et les autres tests en ont peut-être déjà déclaré d'autres — on lit donc l'état
  // réel plutôt que de le supposer.
  scene.add(markGlowSource(new THREE.Object3D(), GLOW_GAINS.star));
  scene.add(markGlowSource(new THREE.Object3D(), GLOW_GAINS.cityLights));
  scene.add(markGlowSource(new THREE.Object3D()));
  scene.add(markGlowOccluder(new THREE.Object3D()));
  const classes = glowClasses();
  const camera = new THREE.PerspectiveCamera();
  camera.layers.enable(5);
  const maskBefore = camera.layers.mask;
  const pass = new GlowPass(scene, camera, SETTINGS);
  pass.setSize(64, 32);
  const { renderer, calls, clearColor } = fakeRenderer();
  const read = new THREE.WebGLRenderTarget(64, 32);
  const write = new THREE.WebGLRenderTarget(64, 32);
  pass.render(renderer, write, read);
  const sceneCalls = calls.filter((c) => c.what === 'scene');

  it('dessine les occulteurs en noir, PUIS chaque classe de sources, sans le fond de ciel', () => {
    expect(classes.length).toBeGreaterThanOrEqual(3);
    expect(sceneCalls).toHaveLength(1 + classes.length);
    expect(sceneCalls[0]!.layers).toBe(1 << OCCLUDER_LAYER);
    expect(sceneCalls[0]!.override).toBeInstanceOf(THREE.MeshBasicMaterial);
    classes.forEach((c, i) => {
      expect(sceneCalls[i + 1]!.layers).toBe(1 << c.layer);
      expect(sceneCalls[i + 1]!.override).toBeNull();
      expect(sceneCalls[i + 1]!.target).toBe(sceneCalls[0]!.target);
    });
    // Le fond de ciel est ce qui dessinait les carrés : jamais dans la sélection.
    for (const call of sceneCalls) expect(call.background).toBeNull();
  });

  /**
   * Chaque classe est ajoutée puis TOUT le tampon est remis à l'échelle. La contribution d'une
   * classe subit donc toutes les remises à l'échelle qui la suivent : leur produit doit valoir
   * exactement son gain, sinon une source brille trop ou pas assez sans aucune erreur.
   */
  it('pondère chaque classe par exactement son gain', () => {
    const selection = sceneCalls[0]!.target;
    const selectionCalls = calls.filter((c) => c.target === selection);
    classes.forEach((c) => {
      const at = selectionCalls.findIndex(
        (call) => call.what === 'scene' && call.layers === 1 << c.layer
      );
      const product = selectionCalls
        .slice(at + 1)
        .filter((call) => call.scale !== null)
        .reduce((acc, call) => acc * call.scale!, 1);
      expect(product).toBeCloseTo(c.gain, 12);
    });
  });

  it('rend la scène exactement dans l’état où il l’a trouvée', () => {
    expect(scene.background).toBe(background);
    expect(scene.overrideMaterial).toBeNull();
    expect(camera.layers.mask).toBe(maskBefore);
    expect(renderer.autoClear).toBe(true);
    expect(clearColor.getHex()).toBe(0x123456);
  });

  it('finit par composer dans le tampon d’écriture', () => {
    expect(calls.at(-1)!.target).toBe(write);
  });
});
