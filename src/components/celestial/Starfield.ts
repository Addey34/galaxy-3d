/**
 * Champ d'étoiles en THREE.Points, superposé au fond Voie lactée.
 *
 * LE CIEL RÉEL (2026-11-03) : les 8 920 étoiles de magnitude ≤ 6,5 du catalogue HYG
 * (`public/assets/sky/stars.json`, `core/starCatalogue.ts`), à leur vraie position, avec leur
 * vraie couleur (B−V) et un éclat selon leur magnitude. Elles bougent avec la date de la scène
 * (mouvement propre, `setDate`). Ce champ était un semis aléatoire de 2 500 points ; il ne revient
 * que si le fichier ne charge pas, et le journal le dit.
 *
 * Pourquoi des points et pas la texture : la texture équirectangulaire de fond est compressée en
 * JPEG, ses étoiles apparaissent en blocs carrés (artefacts DCT). Chaque point est rond par
 * construction, indépendant de cette compression.
 *
 * Placement : sur une grande sphère céleste, rendues sans écriture de profondeur (depthWrite off)
 * en tout premier (renderOrder très bas) pour rester un décor lointain, insensible aux corps. Le
 * repère est celui de la scène (`frames.equatorialToScene`), le même que celui des orbites.
 */
import * as THREE from 'three';
import { markGlowSource } from '@/components/systems/glowSelection';
import { GLOW_GAINS } from '@/config/engine';
import { OBLIQUITY_RAD } from '@/core/frames';
import {
  starAppearance,
  starColor,
  starDirection,
  yearsSinceJ2000,
  type StarCatalogueFile,
  type StarRow,
} from '@/core/starCatalogue';
import Logger from '@/utils/Logger';

// Rayon de la sphère céleste. Grand mais dans le far educ ; le depthWrite off +
// renderOrder bas garantit qu'elles restent en arrière-plan quel que soit le mode.
const SKY_RADIUS = 2600;
/** Les étoiles ne sont recalculées que si la date a avancé d'au moins ce nombre d'années. */
const REFRESH_YEARS = 0.25;
const FALLBACK_COUNT = 2500;
export const STAR_CATALOGUE_URL = '/assets/sky/stars.json';

const COS_OBL = Math.cos(OBLIQUITY_RAD);
const SIN_OBL = Math.sin(OBLIQUITY_RAD);

const vertexShader = /* glsl */ `
  attribute float size;
  varying vec3 vColor;
  uniform float pixelRatio;
  void main() {
    vColor = color;
    gl_PointSize = size * pixelRatio;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;

// Disque rond à bord doux, comme l'ancien sprite radial : plein au centre, nul au bord.
const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  uniform float opacity;
  void main() {
    float d = length( gl_PointCoord - vec2( 0.5 ) ) * 2.0;
    float a = 1.0 - smoothstep( 0.0, 1.0, d );
    gl_FragColor = vec4( vColor, a * a * opacity );
    #include <colorspace_fragment>
  }
`;

export class Starfield {
  readonly points: THREE.Points;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private stars: readonly StarRow[] = [];
  private years = Number.NaN;
  private readonly scratch = new Float64Array(3);
  private _source: 'none' | 'catalogue' | 'procedural' = 'none';

  constructor() {
    this.geometry = new THREE.BufferGeometry();
    this.material = new THREE.ShaderMaterial({
      name: 'StarfieldPoints',
      uniforms: { opacity: { value: 1 }, pixelRatio: { value: 1 } },
      vertexShader,
      fragmentShader,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      // toneMapped false : les étoiles gardent leur éclat franc et nourrissent le
      // bloom sans être compressées par l'ACESFilmicToneMapping du renderer.
      toneMapped: false,
    });
    // sizeAttenuation false par construction : la taille écran est celle de l'attribut `size`,
    // insensible à la distance caméra (étoiles « à l'infini »), pas de gonflement en s'approchant.
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = 'starfield';
    this.points.onBeforeRender = (renderer) => {
      this.material.uniforms['pixelRatio']!.value = renderer.getPixelRatio();
    };
    // Source de halo : ce sont elles, rondes par construction, qui rayonnent — et plus les
    // étoiles du fond JPEG, que la compression découpe en blocs.
    markGlowSource(this.points, GLOW_GAINS.starfield);
    // Décor lointain : rendu en tout premier, jamais occulté par erreur.
    this.points.renderOrder = -1;
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  /** `catalogue` (ciel réel), `procedural` (repli, fichier illisible) ou `none` (pas encore chargé). */
  get source(): 'none' | 'catalogue' | 'procedural' {
    return this._source;
  }

  /** Nombre d'étoiles dessinées. */
  get count(): number {
    return this.geometry.getAttribute('position')?.count ?? 0;
  }

  /** Charge le catalogue réel ; sur échec, retombe sur le semis procédural et le dit. */
  async load(
    fetchImpl: typeof fetch = fetch,
    url: string = STAR_CATALOGUE_URL
  ): Promise<void> {
    try {
      const res = await fetchImpl(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const file = (await res.json()) as StarCatalogueFile;
      if (!Array.isArray(file.stars) || file.stars.length === 0)
        throw new Error('catalogue vide');
      this.setCatalogue(file.stars);
    } catch (err) {
      Logger.warn(
        '[Starfield] catalogue réel illisible, semis procédural de repli',
        err
      );
      this.setProcedural();
    }
  }

  setCatalogue(stars: readonly StarRow[], date?: Date): void {
    this.stars = stars;
    this._source = 'catalogue';
    const n = stars.length;
    const colors = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    const color = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const s = stars[i]!;
      const { size, gain } = starAppearance(s[2]);
      const [r, g, b] = starColor(s[3]);
      color.setRGB(r, g, b, THREE.SRGBColorSpace);
      colors[i * 3] = color.r * gain;
      colors[i * 3 + 1] = color.g * gain;
      colors[i * 3 + 2] = color.b * gain;
      sizes[i] = size;
    }
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(n * 3), 3)
    );
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    this.years = Number.NaN;
    this.setDate(date ?? new Date());
    this.points.visible = true;
  }

  /**
   * Replace les étoiles à `date` (mouvement propre). Sans effet tant que la date n'a pas avancé
   * de `REFRESH_YEARS` : un millier d'images par seconde ne recalculent rien.
   */
  setDate(date: Date): void {
    if (this._source !== 'catalogue') return;
    const years = yearsSinceJ2000(date);
    if (
      Number.isFinite(this.years) &&
      Math.abs(years - this.years) < REFRESH_YEARS
    )
      return;
    this.years = years;
    const position = this.geometry.getAttribute(
      'position'
    ) as THREE.BufferAttribute;
    const out = this.scratch;
    for (let i = 0; i < this.stars.length; i++) {
      starDirection(this.stars[i]!, years, out);
      // equatorialToScene, en ligne : (x, y, z) → (x, −y·sin ε + z·cos ε, −(y·cos ε + z·sin ε))
      const x = out[0]!;
      const y = out[1]!;
      const z = out[2]!;
      position.setXYZ(
        i,
        x * SKY_RADIUS,
        (-y * SIN_OBL + z * COS_OBL) * SKY_RADIUS,
        -(y * COS_OBL + z * SIN_OBL) * SKY_RADIUS
      );
    }
    position.needsUpdate = true;
  }

  /** Repli : 2 500 points au hasard. À ne jamais prendre pour le ciel. */
  private setProcedural(): void {
    this._source = 'procedural';
    const positions = new Float32Array(FALLBACK_COUNT * 3);
    const colors = new Float32Array(FALLBACK_COUNT * 3);
    const sizes = new Float32Array(FALLBACK_COUNT).fill(2.2);
    for (let i = 0; i < FALLBACK_COUNT; i++) {
      const theta = 2 * Math.PI * Math.random();
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = SKY_RADIUS * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = SKY_RADIUS * Math.cos(phi);
      positions[i * 3 + 2] = SKY_RADIUS * Math.sin(phi) * Math.sin(theta);
      const b = 0.35 + Math.pow(Math.random(), 3) * 0.65;
      colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = b;
    }
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3)
    );
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    this.points.visible = true;
  }

  /**
   * Recentre le champ sur la caméra (sans hériter de sa rotation) pour un vrai
   * décor « à l'infini » : en explo la caméra s'éloigne beaucoup de l'origine, une
   * sphère fixe centrée sur (0,0,0) sortirait du frustum. On copie donc la position
   * caméra chaque frame ; les étoiles restent immobiles à l'écran quand on tourne
   * (position suivie, orientation non).
   */
  followCamera(cameraPosition: THREE.Vector3): void {
    this.points.position.copy(cameraPosition);
  }

  /**
   * Part visible des étoiles, 0 à 1 : sous un ciel de jour elles s'effacent
   * (`core/atmosphereScattering.ts`, `starVisibility`). Invisible, le nuage n'est pas dessiné.
   */
  setVisibility(fraction: number): void {
    this.material.uniforms['opacity']!.value = fraction;
    this.points.visible = fraction > 0 && this._source !== 'none';
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
