/**
 * HALO LUMINEUX — remplace `UnrealBloomPass`, pour deux raisons mesurées sur l'écran.
 *
 * 1. **La forme.** `UnrealBloomPass` floute cinq niveaux de mip avec de petits noyaux (3 à 11
 *    taps) puis les recompose en suréchantillonnant BILINÉAIREMENT. Un filtre bilinéaire est
 *    séparable : un texel brillant du niveau 1/32 devient, à l'écran, un plateau de 32 px aux
 *    contours carrés. C'est ce qui dessinait une boîte autour de chaque ville et de chaque
 *    étoile brillante. Ici, chaîne de mips à la manière de Call of Duty (Jimenez 2014) :
 *    sous-échantillonnage à 13 taps, puis remontée par un filtre en tente 3×3 ajouté niveau
 *    par niveau. La somme de tentes emboîtées approche un noyau à symétrie de révolution :
 *    le halo est ROND quelle que soit la forme de sa source.
 * 2. **La sélection.** Le seuil de luminance faisait briller le fond de ciel, dont les étoiles
 *    JPEG sont des blocs de compression. La sélection est désormais déclarative (cf.
 *    `glowSelection.ts`) : seuls les objets du calque `GLOW_LAYER` alimentent le halo, et ceux
 *    d'`OCCLUDER_LAYER` le masquent.
 *
 * Coût : deux rendus supplémentaires en demi-résolution, légers — les occulteurs en noir sans
 * éclairage, puis les quelques sources de halo —, et une chaîne de mips à partir du quart.
 */
import * as THREE from 'three';
import {
  FullScreenQuad,
  Pass,
} from 'three/examples/jsm/postprocessing/Pass.js';
import { OCCLUDER_LAYER, glowClasses } from './glowSelection';

export interface GlowSettings {
  /** Intensité du halo ajouté à l'image. */
  strength: number;
  /** Écart des taps de la tente de remontée, en texels du niveau source (1 = standard). */
  radius: number;
  /** Nombre de niveaux de mip, donc étendue maximale du halo. */
  levels: number;
  /**
   * Luminance (linéaire) à partir de laquelle une source DÉCLARÉE rayonne. Sans seuil, chaque
   * ville faible et tout le disque du Soleil rayonnaient : l'image entière voilée, le Soleil
   * blanchi. Ce n'est plus un sélecteur de sources (le fond de ciel n'est jamais dans la passe)
   * mais un réglage de ce que chaque source garde de lumineux.
   */
  threshold: number;
  /** Largeur du genou autour du seuil (0 = coupure franche). */
  knee: number;
}

const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/**
 * Sous-échantillonnage 13 taps (grille 3×3 à ±2 texels + losange à ±1 texel). Au premier
 * niveau, moyenne de Karis (poids 1 / (1 + luminance)) : une étoile d'un pixel ne scintille
 * pas d'une image à l'autre selon qu'elle tombe ou non sur un tap.
 */
export const DOWNSAMPLE_FRAGMENT = /* glsl */ `
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform float uKaris;
uniform float uThreshold;
uniform float uKnee;
uniform float uPrefilter;
varying vec2 vUv;
// Seuil à genou doux (Unreal Engine 4) : la part au-delà du seuil passe entière, une rampe
// quadratique raccorde en douceur — pas de liseré autour de ce qui franchit tout juste.
vec3 prefilter(vec3 c) {
  float brightness = max(c.r, max(c.g, c.b));
  float soft = clamp(brightness - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-5);
  float contribution = max(soft, brightness - uThreshold) / max(brightness, 1e-5);
  return c * contribution;
}
vec3 tap(vec2 offset) {
  vec3 c = texture2D(uSource, vUv + offset * uTexel).rgb;
  return uPrefilter > 0.5 ? prefilter(c) : c;
}
float karisWeight(vec3 c) {
  return mix(1.0, 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722))), uKaris);
}
void main() {
  vec3 a = tap(vec2(-2.0, 2.0));
  vec3 b = tap(vec2(0.0, 2.0));
  vec3 c = tap(vec2(2.0, 2.0));
  vec3 d = tap(vec2(-2.0, 0.0));
  vec3 e = tap(vec2(0.0, 0.0));
  vec3 f = tap(vec2(2.0, 0.0));
  vec3 g = tap(vec2(-2.0, -2.0));
  vec3 h = tap(vec2(0.0, -2.0));
  vec3 i = tap(vec2(2.0, -2.0));
  vec3 j = tap(vec2(-1.0, 1.0));
  vec3 k = tap(vec2(1.0, 1.0));
  vec3 l = tap(vec2(-1.0, -1.0));
  vec3 m = tap(vec2(1.0, -1.0));
  // Cinq sous-carrés 2×2, pondérés 0,5 (centre) et 0,125 (coins), comme chez Jimenez.
  vec3 q0 = (j + k + l + m) * 0.25;
  vec3 q1 = (a + b + d + e) * 0.25;
  vec3 q2 = (b + c + e + f) * 0.25;
  vec3 q3 = (d + e + g + h) * 0.25;
  vec3 q4 = (e + f + h + i) * 0.25;
  float w0 = 0.5 * karisWeight(q0);
  float w1 = 0.125 * karisWeight(q1);
  float w2 = 0.125 * karisWeight(q2);
  float w3 = 0.125 * karisWeight(q3);
  float w4 = 0.125 * karisWeight(q4);
  vec3 sum = q0 * w0 + q1 * w1 + q2 * w2 + q3 * w3 + q4 * w4;
  gl_FragColor = vec4(sum / (w0 + w1 + w2 + w3 + w4), 1.0);
}`;

/** Remontée par tente 3×3 (poids 1-2-1 ⊗ 1-2-1 / 16), ajoutée au niveau supérieur. */
export const UPSAMPLE_FRAGMENT = /* glsl */ `
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform float uRadius;
varying vec2 vUv;
vec3 tap(vec2 offset) {
  return texture2D(uSource, vUv + offset * uTexel * uRadius).rgb;
}
void main() {
  vec3 sum = tap(vec2(0.0, 0.0)) * 4.0;
  sum += (tap(vec2(0.0, 1.0)) + tap(vec2(-1.0, 0.0)) + tap(vec2(1.0, 0.0)) + tap(vec2(0.0, -1.0))) * 2.0;
  sum += tap(vec2(-1.0, 1.0)) + tap(vec2(1.0, 1.0)) + tap(vec2(-1.0, -1.0)) + tap(vec2(1.0, -1.0));
  gl_FragColor = vec4(sum / 16.0, 1.0);
}`;

/**
 * Remise à l'échelle du tampon de sélection : écrit `uScale` en mélange multiplicatif
 * (source × 0 + destination × couleur source), donc destination × `uScale`. Ne touche pas la
 * profondeur : les occulteurs déjà écrits continuent de masquer la classe suivante.
 */
export const SCALE_FRAGMENT = /* glsl */ `
uniform float uScale;
void main() {
  gl_FragColor = vec4(vec3(uScale), 1.0);
}`;

/**
 * Image de la scène + halo, AUTOUR des sources et non sur elles : le halo est pondéré par
 * 1 / (1 + 4 × luminance de la SÉLECTION au même pixel). Sans cela il se posait sur sa propre
 * source et la blanchissait — mesuré au centre du disque solaire, RGB (231, 151, 31) sans
 * halo, (230, 204, 130) avec : le Soleil perdait sa texture dès que les villes recevaient un
 * halo lisible. La pondération lit la sélection, pas l'image : une planète éclairée n'est pas
 * une source, le halo du Soleil peut passer sur elle. Règle générique, valable pour toute
 * source déclarée sans réglage par objet. L'alpha de la scène est conservé tel quel.
 */
export const COMPOSITE_FRAGMENT = /* glsl */ `
uniform sampler2D uScene;
uniform sampler2D uGlow;
uniform sampler2D uSelection;
uniform float uStrength;
varying vec2 vUv;
void main() {
  vec4 base = texture2D(uScene, vUv);
  float source = dot(texture2D(uSelection, vUv).rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 glow = texture2D(uGlow, vUv).rgb * uStrength / (1.0 + 4.0 * source);
  gl_FragColor = vec4(base.rgb + glow, base.a);
}`;

function target(): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  });
}

export class GlowPass extends Pass {
  readonly settings: GlowSettings;
  private readonly selection = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  private readonly mips: THREE.WebGLRenderTarget[] = [];
  private readonly quad = new FullScreenQuad();
  private readonly occluderMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000,
  });
  private readonly downsample = new THREE.ShaderMaterial({
    uniforms: {
      uSource: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uKaris: { value: 0 },
      uThreshold: { value: 1 },
      uKnee: { value: 0.5 },
      uPrefilter: { value: 0 },
    },
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader: DOWNSAMPLE_FRAGMENT,
    depthTest: false,
    depthWrite: false,
  });
  private readonly upsample = new THREE.ShaderMaterial({
    uniforms: {
      uSource: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uRadius: { value: 1 },
    },
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader: UPSAMPLE_FRAGMENT,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });
  private readonly composite = new THREE.ShaderMaterial({
    uniforms: {
      uScene: { value: null },
      uGlow: { value: null },
      uSelection: { value: null },
      uStrength: { value: 1 },
    },
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader: COMPOSITE_FRAGMENT,
    depthTest: false,
    depthWrite: false,
  });
  private readonly scale = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 1 } },
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader: SCALE_FRAGMENT,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.ZeroFactor,
    blendDst: THREE.SrcColorFactor,
    depthTest: false,
    depthWrite: false,
  });
  private readonly clearColor = new THREE.Color();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    settings: GlowSettings
  ) {
    super();
    this.settings = { ...settings };
    for (let i = 0; i < Math.max(1, settings.levels); i++)
      this.mips.push(target());
  }

  /**
   * La sélection est rendue en DEMI-résolution : elle ne sert qu'à être floutée, et ses deux
   * rendus de scène (occulteurs, sources) coûtaient ~15 % d'images par seconde en pleine
   * résolution (test de perf, 14,7 → 12,7 fps sur bureau). La chaîne de mips part de là.
   */
  override setSize(width: number, height: number): void {
    const level = (size: number, divisor: number): number =>
      Math.max(1, Math.floor(size / divisor));
    this.selection.setSize(level(width, 2), level(height, 2));
    this.mips.forEach((mip, i) =>
      mip.setSize(level(width, 2 ** (i + 2)), level(height, 2 ** (i + 2)))
    );
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget
  ): void {
    this.renderSelection(renderer);

    // Descente : chaque niveau résume le précédent (13 taps).
    let source: THREE.WebGLRenderTarget = this.selection;
    this.quad.material = this.downsample;
    this.mips.forEach((mip, i) => {
      this.downsample.uniforms['uSource']!.value = source.texture;
      (this.downsample.uniforms['uTexel']!.value as THREE.Vector2).set(
        1 / source.width,
        1 / source.height
      );
      // Premier niveau seulement : seuil (ce que la source garde de lumineux) + moyenne de Karis.
      this.downsample.uniforms['uKaris']!.value = i === 0 ? 1 : 0;
      this.downsample.uniforms['uPrefilter']!.value = i === 0 ? 1 : 0;
      this.downsample.uniforms['uThreshold']!.value = this.settings.threshold;
      this.downsample.uniforms['uKnee']!.value = this.settings.knee;
      renderer.setRenderTarget(mip);
      this.quad.render(renderer);
      source = mip;
    });

    // Remontée : chaque niveau reçoit, en ADDITION, la tente du niveau inférieur.
    this.quad.material = this.upsample;
    this.upsample.uniforms['uRadius']!.value = this.settings.radius;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    for (let i = this.mips.length - 1; i > 0; i--) {
      const lower = this.mips[i]!;
      this.upsample.uniforms['uSource']!.value = lower.texture;
      (this.upsample.uniforms['uTexel']!.value as THREE.Vector2).set(
        1 / lower.width,
        1 / lower.height
      );
      renderer.setRenderTarget(this.mips[i - 1]!);
      this.quad.render(renderer);
    }
    renderer.autoClear = autoClear;

    // Composition : scène + halo.
    this.quad.material = this.composite;
    this.composite.uniforms['uScene']!.value = readBuffer.texture;
    this.composite.uniforms['uGlow']!.value = this.mips[0]!.texture;
    this.composite.uniforms['uSelection']!.value = this.selection.texture;
    this.composite.uniforms['uStrength']!.value = this.settings.strength;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  /**
   * Image des SEULES sources de halo, masquées par les occulteurs. Le fond de ciel est retiré
   * le temps de ces deux rendus : il n'est pas une source, et c'est lui qui dessinait les
   * carrés. Tout l'état touché (fond, calques de la caméra, matériau de substitution, couleur
   * de fond, effacement automatique) est restauré à l'identique.
   */
  private renderSelection(renderer: THREE.WebGLRenderer): void {
    const background = this.scene.background;
    const override = this.scene.overrideMaterial;
    const mask = this.camera.layers.mask;
    const autoClear = renderer.autoClear;
    renderer.getClearColor(this.clearColor);
    const clearAlpha = renderer.getClearAlpha();

    this.scene.background = null;
    renderer.setRenderTarget(this.selection);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.autoClear = false;

    this.camera.layers.set(OCCLUDER_LAYER);
    this.scene.overrideMaterial = this.occluderMaterial;
    renderer.render(this.scene, this.camera);

    // Les sources, classe d'intensité par classe d'intensité, dans la MÊME cible (la
    // profondeur des occulteurs n'est écrite qu'une fois). Entre deux classes, le tampon
    // accumulé est remis à l'échelle : après la classe A de gain gA, × gA/gB ; la classe B
    // s'ajoute ; à la fin, × gB. Résultat : gA·A + gB·B, sans rendu supplémentaire des
    // occulteurs ni cible supplémentaire.
    this.scene.overrideMaterial = null;
    const classes = glowClasses();
    classes.forEach((current, index) => {
      this.camera.layers.set(current.layer);
      renderer.render(this.scene, this.camera);
      const next = classes[index + 1];
      const factor = next ? current.gain / next.gain : current.gain;
      if (factor !== 1) {
        this.scale.uniforms['uScale']!.value = factor;
        this.quad.material = this.scale;
        this.quad.render(renderer);
      }
    });

    this.camera.layers.mask = mask;
    this.scene.overrideMaterial = override;
    this.scene.background = background;
    renderer.autoClear = autoClear;
    renderer.setClearColor(this.clearColor, clearAlpha);
  }

  override dispose(): void {
    this.selection.dispose();
    this.mips.forEach((mip) => mip.dispose());
    this.quad.dispose();
    this.occluderMaterial.dispose();
    this.downsample.dispose();
    this.upsample.dispose();
    this.composite.dispose();
    this.scale.dispose();
  }
}
