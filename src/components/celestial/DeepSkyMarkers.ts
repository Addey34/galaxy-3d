/**
 * Repères du CIEL PROFOND (amas, nébuleuses, galaxies), sur le ciel : couche optionnelle, éteinte par
 * défaut. Même principe que `ExoplanetHosts` : des points à l'infini, de taille écran fixe, jamais
 * une taille de scène. Un losange (et non un anneau ni un disque) les distingue des étoiles et des
 * systèmes d'exoplanètes. Positions fixes (J2000) : le catalogue ne donne pas de mouvement propre.
 * Ils s'effacent avec les étoiles sous un ciel de jour : l'opacité est lue sur le matériau des étoiles.
 */
import { nearestDirection } from '@/core/skyPick';
import * as THREE from 'three';
import { deepSkyDirection, type DeepSkyObject } from '@/core/deepsky';
import { equatorialToSceneInto } from '@/core/frames';

const SKY_RADIUS = 2600;
const MARKER_SIZE_PX = 8;

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

// Un losange creux : transparent au centre pour ne pas masquer l'objet qu'il désigne.
const fragmentShader = /* glsl */ `
  uniform float opacity;
  void main() {
    vec2 p = abs( gl_PointCoord - vec2( 0.5 ) ) * 2.0;
    float d = p.x + p.y;
    float edge = smoothstep( 0.55, 0.7, d ) * ( 1.0 - smoothstep( 0.82, 1.0, d ) );
    gl_FragColor = vec4( vec3( 1.0, 0.72, 0.42 ), edge * opacity );
    #include <colorspace_fragment>
  }
`;

export class DeepSkyMarkers {
  readonly points: THREE.Points;
  readonly objects: readonly DeepSkyObject[];
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;

  constructor(
    objects: readonly DeepSkyObject[],
    /** Matériau des étoiles : son opacité (jour/nuit) est reprise à chaque image. */
    private readonly starMaterial: THREE.Material | null
  ) {
    this.objects = objects;
    const array = new Float32Array(objects.length * 3);
    const dir = new Float64Array(3);
    objects.forEach((o, i) => {
      deepSkyDirection(o, dir);
      equatorialToSceneInto(
        dir[0]!,
        dir[1]!,
        dir[2]!,
        SKY_RADIUS,
        array,
        i * 3
      );
    });
    this.geometry.setAttribute('position', new THREE.BufferAttribute(array, 3));
    this.material = new THREE.ShaderMaterial({
      name: 'DeepSkyMarkers',
      uniforms: { opacity: { value: 1 }, pixelRatio: { value: 1 } },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = 'deepSkyMarkers';
    this.points.onBeforeRender = (renderer) => {
      this.material.uniforms['pixelRatio']!.value = renderer.getPixelRatio();
      const stars = (this.starMaterial as THREE.ShaderMaterial | null)
        ?.uniforms?.['opacity'];
      if (stars) this.material.uniforms['opacity']!.value = stars.value;
    };
    this.points.renderOrder = -1;
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  /** Direction (unitaire, repère de la scène) de l'objet `index`, lue dans le tampon des repères. */
  directionOf(index: number, out: [number, number, number]): boolean {
    const a = (this.geometry.getAttribute('position') as THREE.BufferAttribute)
      .array;
    const n = Math.hypot(a[index * 3]!, a[index * 3 + 1]!, a[index * 3 + 2]!);
    if (!(n > 0)) return false;
    out[0] = a[index * 3]! / n;
    out[1] = a[index * 3 + 1]! / n;
    out[2] = a[index * 3 + 2]! / n;
    return true;
  }

  /** L'objet visé par le rayon (vecteur unitaire de la scène), à `tolRad` près, ou null. */
  pickObject(
    ray: readonly [number, number, number],
    tolRad: number
  ): DeepSkyObject | null {
    const a = (this.geometry.getAttribute('position') as THREE.BufferAttribute)
      .array;
    return (
      this.objects[nearestDirection(a, this.objects.length, ray, tolRad)] ??
      null
    );
  }

  dispose(): void {
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}

export const DEEPSKY_SKY_RADIUS = SKY_RADIUS;
