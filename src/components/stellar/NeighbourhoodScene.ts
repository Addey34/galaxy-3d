/**
 * LA SCÈNE DU VOISINAGE SOLAIRE : les étoiles voisines à leurs positions relatives RÉELLES, en
 * parsecs, autour du Soleil. Une scène Three.js à part, rendue par le renderer de l'application
 * (`AnimationSystem.setRenderOverride`) : un seul contexte WebGL, une seule boucle d'animation.
 *
 * Contrat (`docs/ARCHITECTURE.md` § « Le voisinage solaire en 3D ») :
 *  - **1 unité = 1 parsec**, Soleil à l'origine, repère galactique (plan galactique horizontal) :
 *    `core/stellarSpace.ts`. Aucun facteur de la scène solaire.
 *  - Une étoile est un POINT lumineux de taille ÉCRAN fixe (10 px) : ni sphère ni rayon, la taille
 *    d'une étoile n'est pas représentée. Sa couleur est celle de son type spectral, indicative.
 *    Cette représentation est symbolique et la fiche le dit.
 *  - Ce qui est mesuré : la position (trois coordonnées en parsecs), la distance au Soleil, le
 *    mouvement. Les cercles du plan galactique (un par parsec) et le trait de chaque étoile vers ce
 *    plan servent à LIRE la profondeur ; ce sont des repères d'instrument.
 *  - Propriétaire de ses ressources GPU (géométries, matériaux) : `dispose()` les libère toutes.
 */
import * as THREE from 'three';
import {
  groupSystems,
  systemPrimary,
  type NeighbourRow,
  type NeighbourSystem,
} from '@/core/neighbours';
import { auToParsecs, ECLIPTIC_RINGS_AU } from '@/core/scaleTransition';
import {
  scaleRingsPc,
  solarSceneToStellar,
  stellarScenePosition,
  type Vec3,
} from '@/core/stellarSpace';

/** Taille écran d'un point (pixels) : symbolique, la même pour toutes les étoiles. */
export const STAR_POINT_PX = 10;
const SUN_POINT_PX = 13;
const SELECTION_PX = 26;

const pointVertex = /* glsl */ `
  uniform float pixelRatio;
  uniform float size;
  attribute vec3 color;
  varying vec3 vColor;
  void main() {
    vColor = color;
    gl_PointSize = size * pixelRatio;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;
// Un disque doux : un cœur net et un halo court, sans bord dur.
const pointFragment = /* glsl */ `
  varying vec3 vColor;
  void main() {
    float d = length( gl_PointCoord - vec2( 0.5 ) ) * 2.0;
    float core = 1.0 - smoothstep( 0.0, 0.55, d );
    float halo = ( 1.0 - smoothstep( 0.3, 1.0, d ) ) * 0.45;
    gl_FragColor = vec4( vColor, clamp( core + halo, 0.0, 1.0 ) );
    #include <colorspace_fragment>
  }
`;
const ringFragment = /* glsl */ `
  varying vec3 vColor;
  void main() {
    float d = length( gl_PointCoord - vec2( 0.5 ) ) * 2.0;
    float ring = smoothstep( 0.62, 0.74, d ) * ( 1.0 - smoothstep( 0.88, 1.0, d ) );
    gl_FragColor = vec4( vColor, ring );
    #include <colorspace_fragment>
  }
`;

/** Couleur indicative du type spectral (première lettre, ou naine blanche « D ») ; blanc sinon. */
export function spectralColour(spectral: string | null): Vec3 {
  const s = (spectral ?? '').trim();
  const first = s[0]?.toUpperCase() ?? '';
  switch (first) {
    case 'O':
    case 'B':
      return [0.65, 0.78, 1];
    case 'A':
      return [0.86, 0.92, 1];
    case 'F':
      return [1, 0.97, 0.86];
    case 'G':
      return [1, 0.9, 0.55];
    case 'K':
      return [1, 0.72, 0.4];
    case 'M':
      return [1, 0.5, 0.36];
    case 'D':
      return [0.84, 0.9, 1];
    default:
      // « sdM4 » (sous-naine) : la lettre utile suit le préfixe.
      return /^sd[A-Z]/.test(s) ? spectralColour(s.slice(2)) : [1, 1, 1];
  }
}

function pointsMaterial(
  size: number,
  fragmentShader: string
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { pixelRatio: { value: 1 }, size: { value: size } },
    vertexShader: pointVertex,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
}

export class NeighbourhoodScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly systems: readonly NeighbourSystem[];
  /** Distance (pc) de l'étoile la plus lointaine à J2000 : fixe la taille de la vue d'ensemble. */
  readonly extentPc: number;
  /** Cercles de l'écliptique (UA) : leur point d'ancrage dans le repère stellaire, pour les noms. */
  readonly eclipticAnchors: ReadonlyArray<{ au: number; point: Vec3 }>;

  private readonly primaries: readonly NeighbourRow[];
  private readonly starGeometry = new THREE.BufferGeometry();
  private readonly dropGeometry = new THREE.BufferGeometry();
  private readonly sunGeometry = new THREE.BufferGeometry();
  private readonly selectionGeometry = new THREE.BufferGeometry();
  private readonly distanceGeometry = new THREE.BufferGeometry();
  private readonly materials: THREE.Material[] = [];
  private readonly ringObjects: THREE.LineLoop[] = [];
  private readonly axis: THREE.Line;
  private readonly selection: THREE.Points;
  private readonly distanceLine: THREE.Line;
  private readonly positions: Float32Array;
  private readonly pixelRatioUniforms: THREE.IUniform<number>[] = [];
  private selected = -1;
  private years = 0;

  constructor(rows: readonly NeighbourRow[], aspect = 1) {
    this.systems = groupSystems(rows);
    this.primaries = this.systems.map(systemPrimary);
    this.extentPc = Math.max(...this.primaries.map((r) => r[5]));
    this.camera = new THREE.PerspectiveCamera(
      50,
      aspect,
      0.02,
      this.extentPc * 40
    );

    const n = this.systems.length;
    this.positions = new Float32Array(n * 3);
    const colours = new Float32Array(n * 3);
    this.primaries.forEach((row, i) =>
      colours.set(spectralColour(row[2]), i * 3)
    );
    this.starGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.positions, 3)
    );
    this.starGeometry.setAttribute(
      'color',
      new THREE.BufferAttribute(colours, 3)
    );
    const stars = new THREE.Points(
      this.starGeometry,
      this.track(pointsMaterial(STAR_POINT_PX, pointFragment))
    );
    stars.name = 'neighbourStars';
    stars.frustumCulled = false;
    this.scene.add(stars);

    // Le Soleil : l'origine, un point jaune un peu plus grand (symbole, pas un rayon).
    this.sunGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3)
    );
    this.sunGeometry.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array([1, 0.86, 0.35]), 3)
    );
    const sun = new THREE.Points(
      this.sunGeometry,
      this.track(pointsMaterial(SUN_POINT_PX, pointFragment))
    );
    sun.name = 'sun';
    sun.frustumCulled = false;
    this.scene.add(sun);

    // Un trait de chaque étoile vers le plan galactique : lire la hauteur d'un coup d'œil.
    this.dropGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(n * 6), 3)
    );
    const drops = new THREE.LineSegments(
      this.dropGeometry,
      this.track(
        new THREE.LineBasicMaterial({
          color: 0x5f7fb0,
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
        })
      )
    );
    drops.frustumCulled = false;
    this.scene.add(drops);

    // Un cercle par parsec dans le plan galactique.
    const ringMaterial = this.track(
      new THREE.LineBasicMaterial({
        color: 0x6f90c8,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
      })
    );
    for (const radius of scaleRingsPc(this.extentPc)) {
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k < 160; k++) {
        const a = (k / 160) * Math.PI * 2;
        pts.push(
          new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius)
        );
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const ring = new THREE.LineLoop(geo, ringMaterial);
      ring.frustumCulled = false;
      this.ringObjects.push(ring);
      this.scene.add(ring);
    }

    // L'axe vers le centre galactique : une DIRECTION (la Galaxie n'est pas à l'échelle ici).
    const axisGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(this.extentPc + 0.6, 0, 0),
    ]);
    this.axis = new THREE.Line(
      axisGeo,
      this.track(
        new THREE.LineBasicMaterial({
          color: 0xffc27a,
          transparent: true,
          opacity: 0.55,
        })
      )
    );
    this.axis.frustumCulled = false;
    this.scene.add(this.axis);

    // Les cercles de l'ÉCLIPTIQUE (plan des planètes), une décade d'UA chacun : le pont vers le Système
    // solaire. Ils sont dans le repère galactique par la rotation réelle (`solarSceneToStellar`) : le
    // plan des planètes est incliné de 60,2° sur celui de la Galaxie. Repères d'instrument, pas des orbites.
    const eclipticMaterial = this.track(
      new THREE.LineBasicMaterial({
        color: 0xd9a35f,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      })
    );
    const anchors: Array<{ au: number; point: Vec3 }> = [];
    for (const au of ECLIPTIC_RINGS_AU) {
      const radius = auToParsecs(au);
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k < 160; k++) {
        const a = (k / 160) * Math.PI * 2;
        pts.push(
          new THREE.Vector3(
            ...solarSceneToStellar([
              Math.cos(a) * radius,
              0,
              Math.sin(a) * radius,
            ])
          )
        );
      }
      const ring = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(pts),
        eclipticMaterial
      );
      ring.frustumCulled = false;
      ring.name = 'ecliptic-ring';
      this.scene.add(ring);
      anchors.push({
        au,
        point: solarSceneToStellar([radius, 0, 0]),
      });
    }
    this.eclipticAnchors = anchors;

    // La sélection : un anneau sur l'étoile, et le trait de sa distance depuis le Soleil.
    this.selectionGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(3), 3)
    );
    this.selectionGeometry.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array([0.55, 1, 0.7]), 3)
    );
    this.selection = new THREE.Points(
      this.selectionGeometry,
      this.track(pointsMaterial(SELECTION_PX, ringFragment))
    );
    this.selection.frustumCulled = false;
    this.selection.visible = false;
    this.scene.add(this.selection);

    this.distanceGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(6), 3)
    );
    this.distanceLine = new THREE.Line(
      this.distanceGeometry,
      this.track(
        new THREE.LineBasicMaterial({
          color: 0x8cffb2,
          transparent: true,
          opacity: 0.85,
        })
      )
    );
    this.distanceLine.frustumCulled = false;
    this.distanceLine.visible = false;
    this.scene.add(this.distanceLine);

    for (const object of this.scene.children) {
      if (object instanceof THREE.Points)
        object.onBeforeRender = (renderer) => {
          const ratio = renderer.getPixelRatio();
          (object.material as THREE.ShaderMaterial).uniforms[
            'pixelRatio'
          ]!.value = ratio;
        };
    }

    this.setYears(0, true);
  }

  private track<T extends THREE.Material>(material: T): T {
    this.materials.push(material);
    return material;
  }

  /** Replace les étoiles `years` ans après J2000 (borné par `core/stellarSpace`). */
  setYears(years: number, force = false): void {
    if (!force && years === this.years) return;
    this.years = years;
    const drops = this.dropGeometry.getAttribute(
      'position'
    ) as THREE.BufferAttribute;
    this.primaries.forEach((row, i) => {
      const p = stellarScenePosition(row, years);
      this.positions.set(p, i * 3);
      drops.array[i * 6] = p[0];
      drops.array[i * 6 + 1] = p[1];
      drops.array[i * 6 + 2] = p[2];
      drops.array[i * 6 + 3] = p[0];
      drops.array[i * 6 + 4] = 0;
      drops.array[i * 6 + 5] = p[2];
    });
    (
      this.starGeometry.getAttribute('position') as THREE.BufferAttribute
    ).needsUpdate = true;
    drops.needsUpdate = true;
    this.setSelected(this.selected);
  }

  /** Position (parsecs, repère de la scène) du système `index` à la date courante de la scène. */
  positionOf(index: number): Vec3 {
    return [
      this.positions[index * 3]!,
      this.positions[index * 3 + 1]!,
      this.positions[index * 3 + 2]!,
    ];
  }

  setSelected(index: number): void {
    this.selected = index;
    const on = index >= 0 && index < this.systems.length;
    this.selection.visible = on;
    this.distanceLine.visible = on;
    if (!on) return;
    const p = this.positionOf(index);
    (
      this.selectionGeometry.getAttribute('position') as THREE.BufferAttribute
    ).array.set(p);
    (
      this.selectionGeometry.getAttribute('position') as THREE.BufferAttribute
    ).needsUpdate = true;
    const d = this.distanceGeometry.getAttribute(
      'position'
    ) as THREE.BufferAttribute;
    d.array.set([0, 0, 0, p[0], p[1], p[2]]);
    d.needsUpdate = true;
  }

  get selectedIndex(): number {
    return this.selected;
  }

  /** Position à l'écran (pixels CSS) du système `index`, ou null derrière la caméra. */
  project(
    index: number,
    width: number,
    height: number
  ): { x: number; y: number } | null {
    const v = new THREE.Vector3(...this.positionOf(index));
    return this.projectVector(v, width, height);
  }

  projectVector(
    v: THREE.Vector3,
    width: number,
    height: number
  ): { x: number; y: number } | null {
    this.camera.updateMatrixWorld();
    const view = v.clone().applyMatrix4(this.camera.matrixWorldInverse);
    if (view.z >= 0) return null;
    v.project(this.camera);
    return {
      x: ((v.x + 1) / 2) * width,
      y: ((1 - v.y) / 2) * height,
    };
  }

  /** Le système le plus proche du point (x, y) de l'écran, à `radiusPx` près, ou -1. Le plus proche de la caméra l'emporte à égalité. */
  pick(
    x: number,
    y: number,
    width: number,
    height: number,
    radiusPx: number
  ): number {
    let best = -1;
    let bestDistance = radiusPx;
    for (let i = 0; i < this.systems.length; i++) {
      const s = this.project(i, width, height);
      if (!s) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    return best;
  }

  private framing = { width: 0, height: 0, dx: 0, dy: 0 };

  /**
   * Cadrage : le Soleil et ses voisines sont centrés dans la zone LIBRE de l'écran (hors volet et
   * bandeau) par un décalage de la fenêtre de projection, sans bouger la caméra. `dx`, `dy` : de
   * combien de pixels le contenu descend et va à droite.
   */
  setFraming(width: number, height: number, dx: number, dy: number): void {
    this.framing = { width, height, dx, dy };
    this.camera.aspect = width / Math.max(1, height);
    if (dx === 0 && dy === 0) this.camera.clearViewOffset();
    else this.camera.setViewOffset(width, height, -dx, -dy, width, height);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Les plans de découpe suivent la distance de la caméra : à 70 UA (3e-4 pc) le plan proche de la vue
   * d'ensemble (0,02 pc) couperait le Soleil. Le rapport proche/distance reste constant.
   */
  fitClipping(distancePc: number): void {
    const near = Math.min(0.02, Math.max(1e-7, distancePc * 0.002));
    if (near === this.camera.near) return;
    this.camera.near = near;
    this.camera.updateProjectionMatrix();
  }

  resize(width: number, height: number): void {
    this.setFraming(width, height, this.framing.dx, this.framing.dy);
  }

  render(renderer: THREE.WebGLRenderer): void {
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
  }

  /** Libère TOUTES les ressources GPU de la scène : géométries et matériaux. */
  dispose(): void {
    this.scene.traverse((object) => {
      const geometry = (object as THREE.Mesh).geometry as
        THREE.BufferGeometry | undefined;
      geometry?.dispose();
    });
    for (const material of this.materials) material.dispose();
    this.materials.length = 0;
    this.ringObjects.length = 0;
    this.scene.clear();
  }
}
