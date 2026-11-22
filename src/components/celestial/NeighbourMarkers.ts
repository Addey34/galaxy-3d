/**
 * Repères des ÉTOILES VOISINES du Soleil, sur le ciel (couche optionnelle, éteinte par défaut).
 *
 * Même principe que `ExoplanetHosts` et `DeepSkyMarkers` : des points à l'infini, de taille écran
 * fixe, recentrés sur la caméra par leur parent. Un carré creux les distingue des anneaux (systèmes
 * d'exoplanètes) et des losanges (ciel profond). Rien n'est mis à l'échelle : la distance d'une
 * étoile voisine (4,25 années-lumière pour Proxima, soit 9,4 millions d'unités de scène) n'est ni
 * dessinée ni utilisée pour placer le repère, elle est dite par la fiche. Position à une date par le
 * mouvement propre publié (`core/starCatalogue.ts`).
 */
import * as THREE from 'three';
import { equatorialToSceneInto } from '@/core/frames';
import { systemAsStar, type NeighbourSystem } from '@/core/neighbours';
import { directionAt, nearestDirection } from '@/core/skyPick';
import { starDirection, type StarRow } from '@/core/starCatalogue';

export const NEIGHBOUR_SKY_RADIUS = 2600;
/** Taille écran d'un repère, en pixels : un carré lisible, jamais une taille de scène. */
const MARKER_SIZE_PX = 11;
const REFRESH_YEARS = 0.25;

const vertexShader = /* glsl */ `
  uniform float pixelRatio;
  void main() {
    gl_PointSize = ${MARKER_SIZE_PX.toFixed(1)} * pixelRatio;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    // Un point du ciel est « à l'infini » : sa profondeur est celle du plan lointain, jamais sa distance
    // réelle (2600). Sinon un far resté plus court coupe tout repère proche de l'axe de visée.
    gl_Position.z = gl_Position.w;
  }
`;

// Un carré creux : transparent au centre (l'étoile du ciel reste visible dedans) et au bord.
const fragmentShader = /* glsl */ `
  uniform float opacity;
  void main() {
    vec2 p = abs( gl_PointCoord - vec2( 0.5 ) ) * 2.0;
    float d = max( p.x, p.y );
    float square = smoothstep( 0.62, 0.74, d ) * ( 1.0 - smoothstep( 0.86, 1.0, d ) );
    gl_FragColor = vec4( vec3( 0.72, 1.0, 0.62 ), square * opacity );
    #include <colorspace_fragment>
  }
`;

export class NeighbourMarkers {
  readonly points: THREE.Points;
  /** Les systèmes, dans l'ordre des points : l'indice d'un point retrouve son système. */
  readonly systems: readonly NeighbourSystem[];
  private readonly rows: readonly StarRow[];
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly scratch = new Float64Array(3);
  private years = Number.NaN;

  constructor(systems: readonly NeighbourSystem[]) {
    this.systems = systems;
    this.rows = systems.map(systemAsStar);
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(systems.length * 3), 3)
    );
    this.material = new THREE.ShaderMaterial({
      name: 'NeighbourMarkers',
      uniforms: { opacity: { value: 1 }, pixelRatio: { value: 1 } },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = 'neighbourMarkers';
    this.points.onBeforeRender = (renderer) => {
      this.material.uniforms['pixelRatio']!.value = renderer.getPixelRatio();
    };
    this.points.renderOrder = -1;
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.setYears(0);
  }

  /** Replace les étoiles `years` ans après J2000 ; sans effet sous `REFRESH_YEARS` d'écart. */
  setYears(years: number): void {
    if (
      Number.isFinite(this.years) &&
      Math.abs(years - this.years) < REFRESH_YEARS
    )
      return;
    this.years = years;
    const position = this.geometry.getAttribute(
      'position'
    ) as THREE.BufferAttribute;
    const array = position.array as Float32Array;
    const out = this.scratch;
    for (let i = 0; i < this.rows.length; i++) {
      starDirection(this.rows[i]!, years, out);
      equatorialToSceneInto(
        out[0]!,
        out[1]!,
        out[2]!,
        NEIGHBOUR_SKY_RADIUS,
        array,
        i * 3
      );
    }
    position.needsUpdate = true;
  }

  /** Direction (unitaire, repère de la scène) du système `index`, lue dans le tampon des repères. */
  directionOf(index: number, out: [number, number, number]): boolean {
    const position = this.geometry.getAttribute(
      'position'
    ) as THREE.BufferAttribute;
    return directionAt(position.array, index, out);
  }

  /** Le système visé par le rayon (vecteur unitaire de la scène), à `tolRad` près, ou null. */
  pickSystem(
    ray: readonly [number, number, number],
    tolRad: number
  ): NeighbourSystem | null {
    const position = this.geometry.getAttribute(
      'position'
    ) as THREE.BufferAttribute;
    return (
      this.systems[
        nearestDirection(position.array, this.systems.length, ray, tolRad)
      ] ?? null
    );
  }

  dispose(): void {
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
