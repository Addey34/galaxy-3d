/**
 * Radiants des PLUIES DE MÉTÉORES, sur le ciel : couche optionnelle, éteinte par défaut. Même principe
 * que `DeepSkyMarkers` : des points à l'infini, de taille écran fixe, jamais une taille de scène. Un
 * anneau avec un point central (ni losange du ciel profond, ni anneau creux des exoplanètes) les
 * distingue. Contrairement aux autres repères du ciel, ils DÉPENDENT DE LA DATE : un radiant n'est
 * dessiné que si sa pluie est active à la date de la scène, et il suit sa dérive quotidienne.
 * Ils s'effacent avec les étoiles sous un ciel de jour : l'opacité est lue sur le matériau des étoiles.
 */
import * as THREE from 'three';
import {
  meteorRadiant,
  radiantDirection,
  sunLongitudeJ2000,
  type MeteorShower,
} from '@/core/meteors';
import { equatorialToSceneInto } from '@/core/frames';

const SKY_RADIUS = 2600;
const MARKER_SIZE_PX = 12;

const vertexShader = /* glsl */ `
  uniform float pixelRatio;
  attribute float aOn;
  varying float vOn;
  void main() {
    vOn = aOn;
    gl_PointSize = ${MARKER_SIZE_PX.toFixed(1)} * pixelRatio;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    // Un point du ciel est « à l'infini » : sa profondeur est celle du plan lointain, jamais sa distance
    // réelle (2600). Sinon un far resté plus court coupe tout repère proche de l'axe de visée.
    gl_Position.z = gl_Position.w;
  }
`;

// Un anneau fin et un point central : transparent entre les deux pour ne pas masquer le ciel.
const fragmentShader = /* glsl */ `
  uniform float opacity;
  varying float vOn;
  void main() {
    float d = length( gl_PointCoord - vec2( 0.5 ) ) * 2.0;
    float ring = smoothstep( 0.62, 0.72, d ) * ( 1.0 - smoothstep( 0.84, 0.96, d ) );
    float dot_ = 1.0 - smoothstep( 0.12, 0.2, d );
    gl_FragColor = vec4( vec3( 0.55, 0.88, 1.0 ), max( ring, dot_ ) * opacity * vOn );
    #include <colorspace_fragment>
  }
`;

export class MeteorRadiants {
  readonly points: THREE.Points;
  readonly showers: readonly MeteorShower[];
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly position: Float32Array;
  private readonly on: Float32Array;
  private syncedMs = Number.NaN;
  private activeCount = 0;
  private readonly dir = new Float64Array(3);

  constructor(
    showers: readonly MeteorShower[],
    /** Matériau des étoiles : son opacité (jour/nuit) est reprise à chaque image. */
    private readonly starMaterial: THREE.Material | null,
    /** Date de la scène, relue à chaque image : la seule chose qui décide des pluies actives. */
    private readonly getDate: () => Date
  ) {
    this.showers = showers;
    this.position = new Float32Array(showers.length * 3);
    this.on = new Float32Array(showers.length);
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.position, 3)
    );
    this.geometry.setAttribute('aOn', new THREE.BufferAttribute(this.on, 1));
    this.material = new THREE.ShaderMaterial({
      name: 'MeteorRadiants',
      uniforms: { opacity: { value: 1 }, pixelRatio: { value: 1 } },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = 'meteorRadiants';
    this.points.onBeforeRender = (renderer) => {
      this.sync();
      this.material.uniforms['pixelRatio']!.value = renderer.getPixelRatio();
      const stars = (this.starMaterial as THREE.ShaderMaterial | null)
        ?.uniforms?.['opacity'];
      if (stars) this.material.uniforms['opacity']!.value = stars.value;
    };
    this.points.renderOrder = -1;
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.sync();
  }

  /**
   * Recalcule radiants et pluies actives pour la date de la scène. Une seule fois par instant :
   * les noms (`directionOf`) et le rendu la demandent chacun à chaque image.
   */
  sync(): void {
    const date = this.getDate();
    const ms = date.getTime();
    if (ms === this.syncedMs) return;
    this.syncedMs = ms;
    const lon = sunLongitudeJ2000(date);
    let active = 0;
    this.showers.forEach((shower, i) => {
      const r = meteorRadiant(shower, lon);
      radiantDirection(r.raDeg, r.decDeg, this.dir);
      equatorialToSceneInto(
        this.dir[0]!,
        this.dir[1]!,
        this.dir[2]!,
        SKY_RADIUS,
        this.position,
        i * 3
      );
      this.on[i] = r.active ? 1 : 0;
      if (r.active) active += 1;
    });
    this.activeCount = active;
    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.getAttribute('aOn').needsUpdate = true;
  }

  /** Nombre de pluies actives à la dernière date lue. */
  get active(): number {
    this.sync();
    return this.activeCount;
  }

  /**
   * Direction (unitaire, repère de la scène) du radiant `index`, FAUSSE si sa pluie n'est pas active
   * à la date de la scène : le nom d'une pluie éteinte ne s'écrit pas.
   */
  directionOf(index: number, out: [number, number, number]): boolean {
    this.sync();
    if (this.on[index] !== 1) return false;
    const a = this.position;
    const n = Math.hypot(a[index * 3]!, a[index * 3 + 1]!, a[index * 3 + 2]!);
    if (!(n > 0)) return false;
    out[0] = a[index * 3]! / n;
    out[1] = a[index * 3 + 1]! / n;
    out[2] = a[index * 3 + 2]! / n;
    return true;
  }

  dispose(): void {
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}

export const METEOR_SKY_RADIUS = SKY_RADIUS;
