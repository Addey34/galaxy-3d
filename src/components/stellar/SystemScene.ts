/**
 * LA SCÈNE D'UN SYSTÈME STELLAIRE (GAL-UNIVERSE-006) : ses étoiles et les orbites de ses planètes
 * cataloguées. Une scène Three.js à part, rendue par le renderer de l'application dans le rendu de
 * remplacement de la vue du voisinage (`ui/stellarView`) : aucun renderer, aucune boucle de plus.
 *
 * Contrat (`docs/ARCHITECTURE.md` § « Explorer un système stellaire ») :
 *  - **1 unité = 1 UA**, la primaire à l'origine. Le plan XY est le PLAN DU CIEL vu de la Terre
 *    (x vers l'ouest, y vers le nord) : les composantes y sont à leur position projetée mesurée
 *    (`core/exoplanetSystems.skyOffsetAu`).
 *  - Une orbite est dessinée DE FACE dans ce plan, autour de son étoile : son orientation réelle
 *    (inclinaison et nœud) n'est pas publiée, et la vue le dit. Une bande va du périastre à
 *    l'apoastre ; un cercle plein dit une excentricité publiée nulle ; un cercle en tirets, une
 *    excentricité non publiée. AUCUNE planète n'est placée sur son orbite : sa phase n'est pas connue.
 *  - Une étoile est une sphère à son rayon publié (rayon solaire nominal de l'IAU) quand l'archive le
 *    donne, plus un point de taille écran constante pour la retrouver de loin (symbolique).
 *  - Les orbites des planètes du Système solaire (demi-grands axes du registre, NSSDCA), en option,
 *    servent de comparaison d'échelle : des cercles gris, nommés comme tels.
 *  - Propriétaire de ses ressources GPU : `dispose()` les libère toutes.
 */
import * as THREE from 'three';
import {
  orbitExtentAu,
  starRadiusAu,
  type SystemModel,
} from '@/core/exoplanetSystems';
import { spectralColour } from './spectralColour';

/** Taille écran du point d'une étoile (pixels) : symbolique, il ne dit pas sa taille. */
const STAR_POINT_PX = 12;
const RING_SEGMENTS = 192;

/** Couleurs des orbites, dans l'ordre des planètes d'une étoile : distinctes, lisibles sur fond noir. */
const ORBIT_COLOURS = [
  0x7fd4ff, 0xffc76b, 0x9cf59a, 0xff8fb1, 0xc6a8ff, 0x6bffe0, 0xffe86b,
  0xff9f6b,
];
const COMPARISON_COLOUR = 0x8a93a6;

const pointVertex = /* glsl */ `
  uniform float pixelRatio;
  uniform float size;
  void main() {
    gl_PointSize = size * pixelRatio;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;
const pointFragment = /* glsl */ `
  uniform vec3 colour;
  void main() {
    float d = length( gl_PointCoord - vec2( 0.5 ) ) * 2.0;
    float core = 1.0 - smoothstep( 0.0, 0.5, d );
    float halo = ( 1.0 - smoothstep( 0.25, 1.0, d ) ) * 0.5;
    gl_FragColor = vec4( colour, clamp( core + halo, 0.0, 1.0 ) );
    #include <colorspace_fragment>
  }
`;

/** Ce que la scène dessine d'une orbite, pour la sélection et la mise en évidence. */
interface OrbitDrawing {
  planet: number;
  component: number;
  inner: number;
  outer: number;
  axis: number;
  objects: THREE.Object3D[];
  materials: Array<THREE.Material & { opacity: number }>;
  baseOpacity: number[];
}

export interface ComparisonRing {
  /** Nom du corps du Système solaire (clé du registre). */
  name: string;
  /** Demi-grand axe (UA), lu dans le registre. */
  au: number;
}

export class SystemScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly model: SystemModel;
  /** Centre de chaque composante dans la scène (UA). */
  readonly centres: readonly THREE.Vector3[];

  private readonly materials: THREE.Material[] = [];
  private readonly orbits: OrbitDrawing[] = [];
  private readonly pixelRatioUniforms: THREE.IUniform<number>[] = [];
  private readonly comparison = new THREE.Group();
  private comparisonRings: ComparisonRing[] = [];
  private selectedPlanet = -1;
  private framing = { width: 0, height: 0, dx: 0, dy: 0 };

  constructor(model: SystemModel, aspect = 1) {
    this.model = model;
    this.camera = new THREE.PerspectiveCamera(45, aspect, 1e-5, 1e6);
    this.centres = model.components.map(
      (c) => new THREE.Vector3(c.offsetAu[0], c.offsetAu[1], 0)
    );
    this.scene.add(this.comparison);
    this.comparison.visible = false;

    model.components.forEach((component, i) => {
      const colour = new THREE.Color(...spectralColour(component.spectral));
      // Une composante à planètes CIRCUMBINAIRES est un couple d'étoiles dont les positions ne sont pas
      // publiées : aucune sphère individuelle n'est dessinée au centre de ses orbites, seulement le point.
      const radius = component.circumbinary
        ? null
        : starRadiusAu(component.host);
      if (radius !== null) {
        const sphere = new THREE.Mesh(
          new THREE.SphereGeometry(radius, 32, 16),
          this.track(new THREE.MeshBasicMaterial({ color: colour }))
        );
        sphere.position.copy(this.centres[i]!);
        this.scene.add(sphere);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(this.centres[i]!.toArray(), 3)
      );
      const material = this.track(
        new THREE.ShaderMaterial({
          uniforms: {
            pixelRatio: { value: 1 },
            size: { value: STAR_POINT_PX },
            colour: { value: colour },
          },
          vertexShader: pointVertex,
          fragmentShader: pointFragment,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        })
      );
      this.pixelRatioUniforms.push(
        material.uniforms['pixelRatio'] as THREE.IUniform<number>
      );
      this.scene.add(new THREE.Points(geometry, material));
    });

    const perComponent = new Map<number, number>();
    model.planets.forEach((planet, index) => {
      const shape = planet.shape;
      if (shape.kind === 'none') return;
      const k = perComponent.get(planet.component) ?? 0;
      perComponent.set(planet.component, k + 1);
      const colour = ORBIT_COLOURS[k % ORBIT_COLOURS.length]!;
      const centre = this.centres[planet.component]!;
      const drawing: OrbitDrawing = {
        planet: index,
        component: planet.component,
        inner: shape.kind === 'band' ? shape.periastronAu : shape.axis.value,
        outer: shape.kind === 'band' ? shape.apoastronAu : shape.axis.value,
        axis: shape.axis.value,
        objects: [],
        materials: [],
        baseOpacity: [],
      };
      const add = (
        object: THREE.Object3D,
        material: THREE.Material & { opacity: number }
      ): void => {
        object.position.copy(centre);
        this.scene.add(object);
        drawing.objects.push(object);
        drawing.materials.push(material);
        drawing.baseOpacity.push(material.opacity);
      };
      if (shape.kind === 'band') {
        const fill = this.track(
          new THREE.MeshBasicMaterial({
            color: colour,
            transparent: true,
            opacity: 0.18,
            side: THREE.DoubleSide,
            depthWrite: false,
          })
        );
        add(
          new THREE.Mesh(
            new THREE.RingGeometry(
              shape.periastronAu,
              shape.apoastronAu,
              RING_SEGMENTS,
              1
            ),
            fill
          ),
          fill
        );
        for (const r of [shape.periastronAu, shape.apoastronAu]) {
          const edge = this.track(
            new THREE.LineBasicMaterial({
              color: colour,
              transparent: true,
              opacity: 0.75,
            })
          );
          add(new THREE.LineLoop(circle(r), edge), edge);
        }
      } else if (shape.kind === 'circle') {
        const line = this.track(
          new THREE.LineBasicMaterial({
            color: colour,
            transparent: true,
            opacity: 0.9,
          })
        );
        add(new THREE.LineLoop(circle(shape.axis.value), line), line);
      } else {
        const dashed = this.track(
          new THREE.LineDashedMaterial({
            color: colour,
            transparent: true,
            opacity: 0.9,
            dashSize: shape.axis.value * 0.06,
            gapSize: shape.axis.value * 0.05,
          })
        );
        const loop = new THREE.LineLoop(circle(shape.axis.value), dashed);
        loop.computeLineDistances();
        add(loop, dashed);
      }
      this.orbits.push(drawing);
    });
  }

  private track<T extends THREE.Material>(material: T): T {
    this.materials.push(material);
    return material;
  }

  /** Les orbites du Système solaire pour comparaison (cercles gris), centrées sur une composante. */
  setComparisonRings(rings: readonly ComparisonRing[]): void {
    this.comparisonRings = [...rings];
    for (const child of [...this.comparison.children]) {
      (child as THREE.Line).geometry.dispose();
      this.comparison.remove(child);
    }
    const material = this.track(
      new THREE.LineDashedMaterial({
        color: COMPARISON_COLOUR,
        transparent: true,
        opacity: 0.55,
        dashSize: 1,
        gapSize: 1,
      })
    );
    for (const ring of rings) {
      const loop = new THREE.LineLoop(
        circle(ring.au),
        material.clone() as THREE.LineDashedMaterial
      );
      const m = loop.material as THREE.LineDashedMaterial;
      m.dashSize = ring.au * 0.03;
      m.gapSize = ring.au * 0.03;
      this.track(m);
      loop.computeLineDistances();
      this.comparison.add(loop);
    }
  }

  /** Montre ou cache la comparaison, centrée sur la composante `component`. */
  setComparison(visible: boolean, component = 0): void {
    this.comparison.visible = visible;
    this.comparison.position.copy(this.centres[component] ?? this.centres[0]!);
  }

  get comparisonVisible(): boolean {
    return this.comparison.visible;
  }

  /** Le point où se pose le nom d'un anneau de comparaison (en haut à gauche de son cercle). */
  comparisonAnchor(index: number): THREE.Vector3 | null {
    const ring = this.comparisonRings[index];
    if (!ring || !this.comparison.visible) return null;
    const angle = (3 * Math.PI) / 4;
    return new THREE.Vector3(
      Math.cos(angle) * ring.au,
      Math.sin(angle) * ring.au,
      0
    ).add(this.comparison.position);
  }

  get comparisonCount(): number {
    return this.comparisonRings.length;
  }

  /** Les planètes qui ont une orbite dessinée (rangs dans `model.planets`). */
  get drawnPlanets(): number[] {
    return this.orbits.map((o) => o.planet);
  }

  /**
   * Le point où se pose le NOM d'une orbite : sur le cercle du demi-grand axe, à un angle propre à la
   * planète pour que les noms ne s'empilent pas. Ce n'est PAS la position de la planète (inconnue).
   */
  labelAnchor(planet: number): THREE.Vector3 | null {
    const drawing = this.orbits.find((o) => o.planet === planet);
    if (!drawing) return null;
    const rank = this.orbits
      .filter((o) => o.component === drawing.component)
      .indexOf(drawing);
    const angle = Math.PI / 5 + rank * ((2 * Math.PI) / 7);
    return new THREE.Vector3(
      Math.cos(angle) * drawing.axis,
      Math.sin(angle) * drawing.axis,
      0
    ).add(this.centres[drawing.component]!);
  }

  /** Met une orbite en évidence (les autres s'estompent), ou aucune (-1). */
  setSelectedPlanet(planet: number): void {
    this.selectedPlanet = planet;
    for (const drawing of this.orbits) {
      const factor = planet < 0 ? 1 : drawing.planet === planet ? 1.6 : 0.35;
      drawing.materials.forEach((m, k) => {
        m.opacity = Math.min(1, drawing.baseOpacity[k]! * factor);
      });
    }
  }

  get selected(): number {
    return this.selectedPlanet;
  }

  /** Rayon (UA) qui contient tout ce qui est dessiné autour de la composante, ou tout le système (-1). */
  extentAu(component = -1): number {
    if (component >= 0) {
      const orbits = orbitExtentAu(this.model, component);
      const star = starRadiusAu(this.model.components[component]!.host) ?? 0;
      return Math.max(orbits, star * 4, 0.01);
    }
    let extent = 0;
    this.model.components.forEach((_, i) => {
      extent = Math.max(
        extent,
        this.centres[i]!.length() + orbitExtentAu(this.model, i)
      );
    });
    return Math.max(extent, this.extentAu(0));
  }

  projectVector(
    v: THREE.Vector3,
    width: number,
    height: number
  ): { x: number; y: number } | null {
    this.camera.updateMatrixWorld();
    const view = v.clone().applyMatrix4(this.camera.matrixWorldInverse);
    if (view.z >= 0) return null;
    const p = v.clone().project(this.camera);
    return { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * height };
  }

  /**
   * Ce qui est sous le point (x, y) de l'écran : une étoile (dans `radiusPx`) d'abord, sinon l'orbite la
   * plus proche (dans `radiusPx`, ou à l'intérieur d'une bande). `null` sinon.
   */
  pick(
    x: number,
    y: number,
    width: number,
    height: number,
    radiusPx: number
  ): { kind: 'star' | 'planet'; index: number } | null {
    let star = -1;
    let starDistance = radiusPx;
    this.centres.forEach((centre, i) => {
      const s = this.projectVector(centre.clone(), width, height);
      if (!s) return;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < starDistance) {
        starDistance = d;
        star = i;
      }
    });
    if (star >= 0) return { kind: 'star', index: star };
    // Le rayon de visée coupe le plan des orbites (z = 0) : la distance à chaque cercle se lit en pixels.
    const ndc = this.toNdc(x, y, width, height);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (
      !ray.ray.intersectPlane(
        new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
        hit
      )
    )
      return null;
    let best = -1;
    let bestDistance = radiusPx;
    for (const drawing of this.orbits) {
      const centre = this.centres[drawing.component]!;
      const offset = hit.clone().sub(centre);
      const rho = offset.length();
      if (
        rho >= drawing.inner &&
        rho <= drawing.outer &&
        drawing.inner < drawing.outer
      ) {
        if (bestDistance > 0 || best < 0) {
          best = drawing.planet;
          bestDistance = 0;
        }
        continue;
      }
      const ringRadius = rho < drawing.inner ? drawing.inner : drawing.outer;
      const direction =
        rho > 0 ? offset.normalize() : new THREE.Vector3(1, 0, 0);
      const onRing = centre.clone().add(direction.multiplyScalar(ringRadius));
      const s = this.projectVector(onRing, width, height);
      if (!s) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bestDistance) {
        bestDistance = d;
        best = drawing.planet;
      }
    }
    return best >= 0 ? { kind: 'planet', index: best } : null;
  }

  private toNdc(
    x: number,
    y: number,
    width: number,
    height: number
  ): THREE.Vector2 {
    return new THREE.Vector2((x / width) * 2 - 1, -(y / height) * 2 + 1);
  }

  /** Cadrage : le contenu est centré dans la zone libre de l'écran (hors volet et bandeau). */
  setFraming(width: number, height: number, dx: number, dy: number): void {
    this.framing = { width, height, dx, dy };
    this.camera.aspect = width / Math.max(1, height);
    if (dx === 0 && dy === 0) this.camera.clearViewOffset();
    else this.camera.setViewOffset(width, height, -dx, -dy, width, height);
    this.camera.updateProjectionMatrix();
  }

  /** Les plans de découpe suivent la distance de la caméra (de quelques rayons d'étoile à des centaines d'UA). */
  fitClipping(distanceAu: number): void {
    const near = Math.max(1e-7, distanceAu * 1e-3);
    const far = Math.max(10, distanceAu * 200);
    if (near === this.camera.near && far === this.camera.far) return;
    this.camera.near = near;
    this.camera.far = far;
    this.camera.updateProjectionMatrix();
  }

  /** La distance de caméra qui fait tenir un rayon `radiusAu` dans le plus petit côté du champ. */
  distanceToFit(radiusAu: number): number {
    const vertical = (this.camera.fov * Math.PI) / 180;
    const horizontal =
      2 * Math.atan(Math.tan(vertical / 2) * this.camera.aspect);
    const half = Math.min(vertical, horizontal) / 2;
    return (radiusAu * 1.25) / Math.tan(half);
  }

  render(renderer: THREE.WebGLRenderer): void {
    const ratio = renderer.getPixelRatio();
    for (const u of this.pixelRatioUniforms) u.value = ratio;
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
    this.orbits.length = 0;
    this.scene.clear();
  }

  get currentFraming(): {
    width: number;
    height: number;
    dx: number;
    dy: number;
  } {
    return this.framing;
  }
}

/** Un cercle de rayon `r` dans le plan XY, centré à l'origine. */
function circle(r: number): THREE.BufferGeometry {
  const points: number[] = [];
  for (let i = 0; i < RING_SEGMENTS; i++) {
    const a = (i / RING_SEGMENTS) * Math.PI * 2;
    points.push(Math.cos(a) * r, Math.sin(a) * r, 0);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(points, 3)
  );
  return geometry;
}
