/**
 * LE VOLUME STELLAIRE ÉTENDU dans la scène du voisinage (GAL-UNIVERSE-008) : jusqu'à 300 000 étoiles,
 * en UN objet `THREE.Points` par coquille chargée (trois appels de dessin au plus), jamais un maillage ni
 * une étiquette DOM par étoile. Même principe que les étoiles du voisinage (`NeighbourhoodScene`) : un
 * point de taille ÉCRAN, symbolique ; la taille d'une étoile n'est pas représentée.
 *
 *  - La luminosité du point suit la magnitude ABSOLUE (intrinsèque) : les étoiles lumineuses se
 *    détachent, la diversité se lit. Sans magnitude publiée, un point gris de taille minimale.
 *  - La couleur est INDICATIVE (`core/stellarVolume.indicativeClass`, palette de `spectralColour`).
 *  - Les filtres masquent dans le nuanceur (un drapeau par sommet), sans reconstruire la géométrie.
 *  - Les cercles du plan galactique à 25, 50 et 100 pc sont des repères d'instrument.
 *  - Propriétaire de ses ressources GPU : `dispose()` les libère toutes.
 */
import * as THREE from 'three';
import { spectralColour } from './spectralColour';
import {
  absoluteMagnitude,
  colourIndexOf,
  epochDistancePc,
  indicativeClass,
  magnitudeOf,
  writePositionsAt,
  type VolumeFilter,
  type VolumeFlags,
  type VolumeShell,
} from '@/core/stellarVolume';
import type { Vec3 } from '@/core/stellarSpace';

/** Taille écran (pixels) d'un point du volume : plus petite que celle des 61 voisines (10 px). */
export const VOLUME_POINT_MIN_PX = 1.6;
export const VOLUME_POINT_MAX_PX = 4.2;
const SELECTION_PX = 22;
/** Les cercles du plan galactique que le volume ajoute (pc). */
export const VOLUME_RINGS_PC = [25, 50, 100] as const;

const vertex = /* glsl */ `
  uniform float pixelRatio;
  uniform float filterMask;
  attribute vec3 color;
  attribute float aSize;
  attribute float aFlags;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = color;
    // Le filtre : un masque de drapeaux ; 0 = tout montrer. Hors filtre, le point n'est pas tracé.
    float shown = 1.0;
    if ( filterMask > 0.5 ) {
      shown = mod( floor( aFlags / filterMask ), 2.0 ) > 0.5 ? 1.0 : 0.0;
    }
    vAlpha = shown;
    gl_PointSize = aSize * pixelRatio * shown;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;
const fragment = /* glsl */ `
  uniform float opacity;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    if ( vAlpha < 0.5 ) discard;
    float d = length( gl_PointCoord - vec2( 0.5 ) ) * 2.0;
    float a = 1.0 - smoothstep( 0.35, 1.0, d );
    gl_FragColor = vec4( vColor, a * opacity );
    #include <colorspace_fragment>
  }
`;
const ringFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length( gl_PointCoord - vec2( 0.5 ) ) * 2.0;
    float ring = smoothstep( 0.62, 0.74, d ) * ( 1.0 - smoothstep( 0.88, 1.0, d ) );
    gl_FragColor = vec4( vColor, ring );
    #include <colorspace_fragment>
  }
`;

/** Taille écran d'un point selon sa magnitude absolue : de 4,2 px (M ≤ 0) à 1,6 px (M ≥ 14). */
export function pointSizePx(absMag: number | null): number {
  if (absMag === null) return VOLUME_POINT_MIN_PX;
  const t = Math.min(1, Math.max(0, absMag / 14));
  return VOLUME_POINT_MAX_PX + (VOLUME_POINT_MIN_PX - VOLUME_POINT_MAX_PX) * t;
}

/**
 * Opacité d'un point selon l'échelle : les points s'ajoutent (mélange additif), et 260 000 points à pleine
 * opacité saturaient l'écran en blanc à 100 pc, effaçant la distribution qu'on veut lire (mesuré sur
 * capture). Plus l'échelle est grande, plus il y a de points par pixel : chacun pèse moins.
 */
export function volumeOpacity(radiusPc: number): number {
  if (radiusPc <= 25) return 1;
  if (radiusPc <= 50) return 0.55;
  return 0.22;
}

/** Le bit (puissance de deux) d'un filtre, 0 pour « tout ». */
export function filterBit(filter: VolumeFilter, flags: VolumeFlags): number {
  switch (filter) {
    case 'all':
      return 0;
    case 'whiteDwarfs':
      return flags.whiteDwarf;
    case 'exoplanetHosts':
      return flags.exoplanetHost;
    case 'radialVelocity':
      return flags.radialVelocity;
  }
}

interface ShellObject {
  shell: VolumeShell;
  points: THREE.Points;
  positions: Float32Array;
}

export class StellarVolume {
  readonly group = new THREE.Group();
  private readonly shells: ShellObject[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly uniforms = {
    pixelRatio: { value: 1 },
    filterMask: { value: 0 },
    opacity: { value: 1 },
  };
  private readonly selection: THREE.Points;
  private readonly selectionPosition = new Float32Array(3);
  private readonly rings: THREE.LineLoop[] = [];
  private years = 0;
  private selected = -1;
  private filterMaskValue = 0;

  constructor(
    private readonly flags: VolumeFlags,
    private readonly epochYear: number
  ) {
    this.group.name = 'stellar-volume';
    const ringMaterial = this.track(
      new THREE.LineBasicMaterial({
        color: 0x6f90c8,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
      })
    );
    for (const radius of VOLUME_RINGS_PC) {
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k < 240; k++) {
        const a = (k / 240) * Math.PI * 2;
        pts.push(
          new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius)
        );
      }
      const ring = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(pts),
        ringMaterial
      );
      ring.frustumCulled = false;
      ring.visible = false;
      this.rings.push(ring);
      this.group.add(ring);
    }
    const selGeometry = new THREE.BufferGeometry();
    selGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.selectionPosition, 3)
    );
    selGeometry.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array([0.55, 1, 0.7]), 3)
    );
    selGeometry.setAttribute(
      'aSize',
      new THREE.BufferAttribute(new Float32Array([SELECTION_PX]), 1)
    );
    selGeometry.setAttribute(
      'aFlags',
      new THREE.BufferAttribute(new Float32Array([0]), 1)
    );
    this.selection = new THREE.Points(
      selGeometry,
      this.track(
        new THREE.ShaderMaterial({
          uniforms: {
            pixelRatio: this.uniforms.pixelRatio,
            filterMask: { value: 0 },
          },
          vertexShader: vertex,
          fragmentShader: ringFragment,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        })
      )
    );
    this.selection.frustumCulled = false;
    this.selection.visible = false;
    this.group.add(this.selection);
  }

  private track<T extends THREE.Material>(material: T): T {
    this.materials.push(material);
    return material;
  }

  /** Les coquilles posées dans la scène, la plus proche d'abord. */
  get loadedShells(): readonly VolumeShell[] {
    return this.shells.map((s) => s.shell);
  }

  /** Le nombre de points tracés (toutes coquilles visibles confondues). */
  get visibleCount(): number {
    return this.shells
      .filter((s) => s.points.visible)
      .reduce((sum, s) => sum + s.shell.count, 0);
  }

  /** Ajoute une coquille décodée : un `THREE.Points`, un appel de dessin. */
  addShell(shell: VolumeShell): void {
    if (this.shells.some((s) => s.shell.start === shell.start)) return;
    const n = shell.count;
    const positions = new Float32Array(n * 3);
    writePositionsAt(positions, shell, this.years, this.epochYear);
    const colours = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    const flagValues = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const mag = magnitudeOf(shell, i);
      const wd = (shell.flags[i]! & this.flags.whiteDwarf) !== 0;
      const cls = indicativeClass(colourIndexOf(shell, i, this.flags), wd);
      const c = cls === null ? [0.62, 0.64, 0.68] : spectralColour(cls);
      colours.set(c, i * 3);
      sizes[i] = pointSizePx(
        mag === null ? null : absoluteMagnitude(mag, epochDistancePc(shell, i))
      );
      flagValues[i] = shell.flags[i]!;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aFlags', new THREE.BufferAttribute(flagValues, 1));
    const points = new THREE.Points(
      geometry,
      this.track(
        new THREE.ShaderMaterial({
          uniforms: this.uniforms,
          vertexShader: vertex,
          fragmentShader: fragment,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        })
      )
    );
    points.frustumCulled = false;
    points.name = `stellar-volume-${shell.maxPc}`;
    this.shells.push({ shell, points, positions });
    this.shells.sort((a, b) => a.shell.start - b.shell.start);
    this.group.add(points);
  }

  /**
   * Montre les coquilles jusqu'à `radiusPc` et les cercles correspondants (5 pc : rien du volume, le
   * voisinage seul). Une coquille chargée et cachée reste en mémoire : revenir à une grande échelle est
   * immédiat.
   */
  setRadius(radiusPc: number): void {
    this.uniforms.opacity.value = volumeOpacity(radiusPc);
    for (const s of this.shells) s.points.visible = s.shell.maxPc <= radiusPc;
    this.rings.forEach((ring, k) => {
      ring.visible = VOLUME_RINGS_PC[k]! <= radiusPc;
    });
    if (this.selected >= 0 && !this.isVisible(this.selected)) this.select(-1);
  }

  setFilter(filter: VolumeFilter): void {
    this.filterMaskValue = filterBit(filter, this.flags);
    this.uniforms.filterMask.value = this.filterMaskValue;
  }

  setPixelRatio(ratio: number): void {
    this.uniforms.pixelRatio.value = ratio;
  }

  /** Déplace toutes les étoiles chargées à `yearsFromJ2000` (borné à la fenêtre du voisinage). */
  setYears(yearsFromJ2000: number): void {
    if (yearsFromJ2000 === this.years) return;
    this.years = yearsFromJ2000;
    for (const s of this.shells) {
      writePositionsAt(s.positions, s.shell, yearsFromJ2000, this.epochYear);
      (
        s.points.geometry.getAttribute('position') as THREE.BufferAttribute
      ).needsUpdate = true;
    }
    if (this.selected >= 0) this.placeSelection();
  }

  private locate(index: number): { object: ShellObject; local: number } | null {
    for (const object of this.shells) {
      const local = index - object.shell.start;
      if (local >= 0 && local < object.shell.count) return { object, local };
    }
    return null;
  }

  private isVisible(index: number): boolean {
    const at = this.locate(index);
    return !!at && at.object.points.visible;
  }

  /** La coquille et le rang local d'une étoile chargée, ou `null`. */
  shellOf(index: number): { shell: VolumeShell; local: number } | null {
    const at = this.locate(index);
    return at ? { shell: at.object.shell, local: at.local } : null;
  }

  /** Position courante (pc, repère de la scène) d'une étoile chargée, ou `null`. */
  positionOf(index: number): Vec3 | null {
    const at = this.locate(index);
    if (!at) return null;
    const p = at.object.positions;
    const k = at.local * 3;
    return [p[k]!, p[k + 1]!, p[k + 2]!];
  }

  get selectedIndex(): number {
    return this.selected;
  }

  select(index: number): void {
    this.selected = index;
    this.selection.visible = index >= 0 && this.isVisible(index);
    if (this.selection.visible) this.placeSelection();
  }

  private placeSelection(): void {
    const p = this.positionOf(this.selected);
    if (!p) return;
    this.selectionPosition.set(p);
    (
      this.selection.geometry.getAttribute('position') as THREE.BufferAttribute
    ).needsUpdate = true;
  }

  /**
   * L'étoile visible la plus proche du point écran (x, y), dans `radiusPx`, ou -1. Un parcours de toutes
   * les étoiles tracées, au clic seulement (≈ 300 000 projections) ; les étoiles masquées par le filtre ne
   * se choisissent pas.
   */
  pick(
    camera: THREE.PerspectiveCamera,
    x: number,
    y: number,
    width: number,
    height: number,
    radiusPx: number
  ): { index: number; distancePx: number } | null {
    const m = new THREE.Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    ).elements;
    let best = -1;
    let bestD2 = radiusPx * radiusPx;
    for (const object of this.shells) {
      if (!object.points.visible) continue;
      const p = object.positions;
      const flagsArray = object.shell.flags;
      for (let i = 0; i < object.shell.count; i++) {
        if (
          this.filterMaskValue > 0 &&
          (flagsArray[i]! & this.filterMaskValue) === 0
        )
          continue;
        const px = p[i * 3]!;
        const py = p[i * 3 + 1]!;
        const pz = p[i * 3 + 2]!;
        const w = m[3]! * px + m[7]! * py + m[11]! * pz + m[15]!;
        if (w <= 0) continue;
        const sx =
          ((m[0]! * px + m[4]! * py + m[8]! * pz + m[12]!) / w + 1) *
          0.5 *
          width;
        const sy =
          (1 - (m[1]! * px + m[5]! * py + m[9]! * pz + m[13]!) / w) *
          0.5 *
          height;
        const dx = sx - x;
        const dy = sy - y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = object.shell.start + i;
        }
      }
    }
    return best >= 0 ? { index: best, distancePx: Math.sqrt(bestD2) } : null;
  }

  /** Libère toutes les ressources GPU du volume. */
  dispose(): void {
    this.group.traverse((object) => {
      (object as THREE.Mesh).geometry?.dispose();
    });
    for (const material of this.materials) material.dispose();
    this.materials.length = 0;
    this.shells.length = 0;
    this.group.clear();
  }
}
