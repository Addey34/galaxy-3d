/**
 * Repères des ÉTOILES HÔTES d'exoplanètes, sur le ciel (couche optionnelle, éteinte par défaut).
 *
 * Même principe que `Starfield` : des points à l'infini, de taille écran fixe, recentrés sur la
 * caméra par leur parent. Un anneau (et non un disque) distingue un système connu d'une étoile
 * ordinaire ; les hôtes visibles à l'œil nu tombent donc au centre d'une étoile du ciel. Rien n'est
 * mis à l'échelle : ce sont des repères d'instrument, comme les marqueurs du HUD, pas des objets.
 * Position à une date par le mouvement propre publié (`core/starCatalogue.ts`).
 */
import * as THREE from 'three';
import { equatorialToSceneInto } from '@/core/frames';
import type { ExoplanetSystem } from '@/core/exoplanets';
import { systemAsStar } from '@/core/exoplanets';
import { nearestDirection } from '@/core/skyPick';
import { starDirection, type StarRow } from '@/core/starCatalogue';

const SKY_RADIUS = 2600;
/** Taille écran d'un repère, en pixels : assez pour un anneau lisible, jamais un trait de scène. */
const RING_SIZE_PX = 9;
const REFRESH_YEARS = 0.25;

const vertexShader = /* glsl */ `
  uniform float pixelRatio;
  void main() {
    gl_PointSize = ${RING_SIZE_PX.toFixed(1)} * pixelRatio;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;

// Un anneau fin : transparent au centre (l'étoile du ciel reste visible dedans) et au bord.
const fragmentShader = /* glsl */ `
  uniform float opacity;
  void main() {
    float d = length( gl_PointCoord - vec2( 0.5 ) ) * 2.0;
    float ring = smoothstep( 0.55, 0.7, d ) * ( 1.0 - smoothstep( 0.82, 1.0, d ) );
    gl_FragColor = vec4( vec3( 0.35, 0.85, 1.0 ), ring * opacity );
    #include <colorspace_fragment>
  }
`;

export class ExoplanetHosts {
  readonly points: THREE.Points;
  /** Les systèmes, dans l'ordre des points : l'indice d'un point retrouve son système. */
  readonly systems: readonly ExoplanetSystem[];
  private readonly rows: readonly StarRow[];
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly scratch = new Float64Array(3);
  private years = Number.NaN;

  constructor(
    systems: readonly ExoplanetSystem[],
    /** Date de relevé de l'archive, citée par la fiche. */
    readonly retrieved: string | null = null
  ) {
    this.systems = systems;
    this.rows = systems.map(systemAsStar);
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(systems.length * 3), 3)
    );
    this.material = new THREE.ShaderMaterial({
      name: 'ExoplanetHosts',
      uniforms: { opacity: { value: 1 }, pixelRatio: { value: 1 } },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = 'exoplanetHosts';
    this.points.onBeforeRender = (renderer) => {
      this.material.uniforms['pixelRatio']!.value = renderer.getPixelRatio();
    };
    this.points.renderOrder = -1;
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.setYears(0);
  }

  /** Replace les systèmes `years` ans après J2000 ; sans effet sous `REFRESH_YEARS` d'écart. */
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
        SKY_RADIUS,
        array,
        i * 3
      );
    }
    position.needsUpdate = true;
  }

  /** Part visible, 0 à 1 : sous un ciel de jour les repères s'effacent comme les étoiles. */
  setOpacity(fraction: number): void {
    this.material.uniforms['opacity']!.value = fraction;
  }

  /** Indice du repère le plus proche du rayon (vecteur unitaire de la scène), à `tolRad` près, ou -1. */
  pick(ray: readonly [number, number, number], tolRad: number): number {
    const position = this.geometry.getAttribute(
      'position'
    ) as THREE.BufferAttribute;
    return nearestDirection(position.array, this.systems.length, ray, tolRad);
  }

  /** Le système visé par le rayon, ou null. */
  pickSystem(
    ray: readonly [number, number, number],
    tolRad: number
  ): ExoplanetSystem | null {
    return this.systems[this.pick(ray, tolRad)] ?? null;
  }

  findSystem(name: string): ExoplanetSystem | null {
    return this.systems.find((s) => s[0] === name) ?? null;
  }

  get count(): number {
    return this.systems.length;
  }

  dispose(): void {
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
