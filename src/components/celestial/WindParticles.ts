/**
 * Prototype de visualisation du VENT par particules advectées, plaquées sur une sphère
 * (couche `wind`, légèrement au-dessus des nuages/pluie). Chaque particule vit à une
 * position (lat, lon) et est déplacée à chaque frame par le champ de vent réel
 * (`sampleWind`), puis ré-ensemencée en fin de vie → effet de « flux » qui coule.
 *
 * Advection CPU (prototype) : ~quelques milliers de particules, suffisant pour juger
 * l'effet. Une simulation GPU (bien plus de particules + traînées) viendra si l'effet plaît.
 */
import * as THREE from 'three';
import { sampleWind, type WindGrid } from '@/core/windField';

const DEG2RAD = Math.PI / 180;

export interface WindParticlesOptions {
  radius: number;
  count: number;
  /** Facteur vitesse : degrés de déplacement par (km/h · seconde). Petit → lent. */
  speedScale: number;
  /** Durée de vie moyenne d'une particule (s) avant ré-ensemencement. */
  lifeSeconds: number;
  color: number;
  opacity: number;
  /** Décalage de longitude (rad) pour aligner sur l'orientation des textures. */
  lonOffset: number;
}

export class WindParticles {
  readonly points: THREE.Points;
  private readonly geometry: THREE.BufferGeometry;
  private readonly positions: Float32Array;
  private readonly alphas: Float32Array;
  private readonly lat: Float32Array;
  private readonly lon: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly opts: WindParticlesOptions;

  constructor(options: WindParticlesOptions) {
    this.opts = options;
    const n = options.count;
    this.positions = new Float32Array(n * 3);
    this.alphas = new Float32Array(n);
    this.lat = new Float32Array(n);
    this.lon = new Float32Array(n);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);

    for (let i = 0; i < n; i++) this._seed(i);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.positions, 3)
    );
    this.geometry.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1));

    const material = new THREE.PointsMaterial({
      color: options.color,
      // Petits points : un flux fin, pas des flocons. Le rayon de la Terre ≈ 1 unité.
      size: 0.012,
      sizeAttenuation: true,
      transparent: true,
      opacity: options.opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    // Opacité par particule (fondu naissance/mort) via un patch shader léger.
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float alpha;\nvarying float vAlpha;'
        )
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\n\tvAlpha = alpha;'
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying float vAlpha;'
        )
        .replace(
          'vec4 diffuseColor = vec4( diffuse, opacity );',
          'vec4 diffuseColor = vec4( diffuse, opacity * vAlpha );'
        );
    };

    this.points = new THREE.Points(this.geometry, material);
    this.points.name = 'wind_particles';
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  /** (Ré)ensemence une particule à une position aléatoire, âge 0, vie aléatoire. */
  private _seed(i: number): void {
    // Distribution ~uniforme sur la sphère en latitude (évite l'entassement aux pôles).
    this.lat[i] = Math.asin(Math.random() * 2 - 1) / DEG2RAD;
    this.lon[i] = Math.random() * 360 - 180;
    this.age[i] = 0;
    this.life[i] = this.opts.lifeSeconds * (0.5 + Math.random());
    this._writePosition(i);
    this.alphas[i] = 0;
  }

  /** lat/lon → position monde sur la sphère (même orientation que les textures). */
  private _writePosition(i: number): void {
    const phi = (90 - this.lat[i]) * DEG2RAD; // angle polaire depuis +Y
    const theta = this.lon[i] * DEG2RAD + this.opts.lonOffset;
    const r = this.opts.radius;
    const s = Math.sin(phi);
    this.positions[i * 3] = -r * s * Math.cos(theta);
    this.positions[i * 3 + 1] = r * Math.cos(phi);
    this.positions[i * 3 + 2] = r * s * Math.sin(theta);
  }

  /**
   * Advecte toutes les particules par le champ `grid` (dt réel, en secondes). Sans grille
   * (pas encore chargée), ne fait rien.
   */
  update(dt: number, grid: WindGrid | null): void {
    if (!grid || dt <= 0) return;
    const n = this.opts.count;
    const k = this.opts.speedScale * dt;
    for (let i = 0; i < n; i++) {
      const { u, v } = sampleWind(grid, this.lat[i], this.lon[i]);
      // u = est (→ lon+), v = nord (→ lat+). Le déplacement en longitude s'élargit près
      // des pôles (méridiens resserrés) → on divise par cos(lat) (borné).
      const cosLat = Math.max(0.2, Math.cos(this.lat[i] * DEG2RAD));
      this.lon[i] += (k * u) / cosLat;
      this.lat[i] += k * v;

      // Sortie de latitude → ré-ensemencement ; longitude enroulée.
      if (this.lat[i] > 89 || this.lat[i] < -89) {
        this._seed(i);
        continue;
      }
      if (this.lon[i] > 180) this.lon[i] -= 360;
      else if (this.lon[i] < -180) this.lon[i] += 360;

      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this._seed(i);
        continue;
      }
      this._writePosition(i);
      // Fondu triangulaire naissance → plein → mort.
      const t = this.age[i] / this.life[i];
      this.alphas[i] = Math.min(t * 4, (1 - t) * 4, 1);
    }
    (this.geometry.attributes['position'] as THREE.BufferAttribute).needsUpdate =
      true;
    (this.geometry.attributes['alpha'] as THREE.BufferAttribute).needsUpdate =
      true;
  }

  dispose(): void {
    this.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
