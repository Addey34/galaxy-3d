/**
 * Visualisation du VENT par particules advectées, plaquées sur une sphère (couche `wind`,
 * légèrement au-dessus des nuages/pluie). Chaque particule vit à une position (lat, lon) et
 * est déplacée à chaque frame par le champ de vent réel (`sampleWind`), puis ré-ensemencée
 * en fin de vie → effet de « flux » qui coule.
 *
 * Rendu : points ronds et doux (masque radial dans le shader) en `AdditiveBlending` +
 * `toneMapped: false` → un filet de lumière qui s'AJOUTE à la surface, jamais une pastille
 * opaque sombre. La COULEUR encode la vitesse du vent (cyan calme → blanc/jaune tempête),
 * comme une carte météo. L'alpha suit un fondu naissance→plein→mort et s'annule sur les
 * bords du point (pas d'arête dure).
 *
 * Advection CPU : quelques milliers de particules, suffisant pour un flux lisible.
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
  /** Opacité globale de la couche (0..1). */
  opacity: number;
  /** Taille de base d'un point (unités monde ; le rayon Terre ≈ 1). */
  size: number;
  /** Vitesse de vent (km/h) qui sature l'échelle de couleur (au-delà = tempête). */
  speedMax: number;
  /** Décalage de longitude (rad) pour aligner sur l'orientation des textures. */
  lonOffset: number;
  /**
   * Latitude absolue max où le champ de vent est défini (= `maxLat` de la grille). Les
   * particules sont ensemencées et confinées dans [-maxLat, +maxLat] : au-delà le champ
   * est clampé et toutes les particules liraient la même rangée → paquet figé aux pôles.
   */
  maxLat: number;
  /** Dérive minimale (km/h) ajoutée au champ pour éviter les amas statiques en vent calme. */
  minDriftKmh: number;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Fondu doux (Hermite) : 0 en 0, 1 en 1, dérivées nulles aux bords (pas de « claque »). */
const smoothstep01 = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

// Rampe de couleur vent (faible → fort), style carte météo : cyan → blanc → jaune.
const COLOR_CALM = new THREE.Color(0x6ec6ff); // vent faible : cyan doux
const COLOR_MID = new THREE.Color(0xffffff); // vent moyen : blanc
const COLOR_STRONG = new THREE.Color(0xffd24a); // vent fort : jaune chaud

export class WindParticles {
  readonly points: THREE.Points;
  private readonly geometry: THREE.BufferGeometry;
  private readonly positions: Float32Array;
  private readonly alphas: Float32Array;
  private readonly colors: Float32Array;
  private readonly sizes: Float32Array;
  private readonly lat: Float32Array;
  private readonly lon: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly opts: WindParticlesOptions;
  private readonly _color = new THREE.Color();

  constructor(options: WindParticlesOptions) {
    this.opts = options;
    const n = options.count;
    this.positions = new Float32Array(n * 3);
    this.alphas = new Float32Array(n);
    this.colors = new Float32Array(n * 3);
    this.sizes = new Float32Array(n);
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
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));

    const material = new THREE.PointsMaterial({
      size: options.size,
      sizeAttenuation: true,
      transparent: true,
      opacity: options.opacity,
      depthWrite: false,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      // Clé du « plus de points noirs » : la couleur additive ne doit pas être
      // recomprimée par l'ACESFilmicToneMapping du renderer.
      toneMapped: false,
    });

    // Patch shader : taille + couleur + alpha par particule, et surtout un MASQUE
    // RADIAL doux (gl_PointCoord) → chaque point est un halo rond qui s'estompe sur
    // les bords. Sans ce masque, PointsMaterial dessine un carré à arêtes dures qui,
    // combiné au tri de transparence, apparaît comme un moucheté sombre.
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float alpha;\nattribute float aSize;\nvarying float vAlpha;'
        )
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvAlpha = alpha;')
        // Remplace la taille uniforme par la taille par particule (aSize). Le facteur
        // d'atténuation par la distance (#ifdef USE_SIZEATTENUATION) suit derrière.
        .replace('gl_PointSize = size;', 'gl_PointSize = aSize;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vAlpha;')
        .replace(
          'vec4 diffuseColor = vec4( diffuse, opacity );',
          [
            '// Masque radial : 1 au centre → 0 au bord (halo rond doux).',
            'float d = length( gl_PointCoord - vec2( 0.5 ) );',
            'float radial = smoothstep( 0.5, 0.0, d );',
            'vec4 diffuseColor = vec4( diffuse, opacity * vAlpha * radial );',
          ].join('\n\t')
        );
    };

    this.points = new THREE.Points(this.geometry, material);
    this.points.name = 'wind_particles';
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  /** (Ré)ensemence une particule à une position aléatoire, âge 0, vie aléatoire. */
  private _seed(i: number): void {
    // Distribution ~uniforme en surface (via asin), MAIS bornée à la bande où le champ de
    // vent est défini ([-maxLat, +maxLat]). Au-delà, `sampleWind` clampe et toutes les
    // particules liraient la même rangée → paquet figé aux pôles (l'artefact « moche »).
    const sinMax = Math.sin(this.opts.maxLat * DEG2RAD);
    this.lat[i] = Math.asin((Math.random() * 2 - 1) * sinMax) / DEG2RAD;
    this.lon[i] = Math.random() * 360 - 180;
    this.age[i] = 0;
    this.life[i] = this.opts.lifeSeconds * (0.5 + Math.random());
    this._writePosition(i);
    this.alphas[i] = 0;
    this.sizes[i] = this.opts.size;
    // Couleur initiale neutre (recalculée dès la 1re advection selon la vitesse).
    this.colors[i * 3] = COLOR_CALM.r;
    this.colors[i * 3 + 1] = COLOR_CALM.g;
    this.colors[i * 3 + 2] = COLOR_CALM.b;
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

  /** Couleur (cyan→blanc→jaune) selon la vitesse normalisée [0..1]. */
  private _speedColor(t: number): THREE.Color {
    if (t < 0.5) {
      return this._color.copy(COLOR_CALM).lerp(COLOR_MID, t * 2);
    }
    return this._color.copy(COLOR_MID).lerp(COLOR_STRONG, (t - 0.5) * 2);
  }

  /**
   * Advecte toutes les particules par le champ `grid` (dt réel, en secondes). Sans grille
   * (pas encore chargée), ne fait rien.
   */
  update(dt: number, grid: WindGrid | null): void {
    if (!grid || dt <= 0) return;
    const n = this.opts.count;
    const k = this.opts.speedScale * dt;
    const invMax = 1 / this.opts.speedMax;
    const maxLat = this.opts.maxLat;
    const minDrift = this.opts.minDriftKmh;
    for (let i = 0; i < n; i++) {
      let { u, v } = sampleWind(grid, this.lat[i], this.lon[i]);
      // Dérive minimale : sous un seuil, le vent est trop faible pour déplacer la
      // particule → elle stagne et scintille en amas. On force une vitesse plancher dans
      // la direction du champ (ou une direction stable dérivée de la longitude si nul).
      const speed = Math.hypot(u, v);
      if (speed < minDrift) {
        if (speed > 1e-4) {
          const boost = minDrift / speed;
          u *= boost;
          v *= boost;
        } else {
          // Champ quasi nul : petite dérive zonale (est) stable, pas de direction aléatoire.
          u = minDrift;
        }
      }
      // u = est (→ lon+), v = nord (→ lat+). Le déplacement en longitude s'élargit près
      // des pôles (méridiens resserrés) → on divise par cos(lat) (borné).
      const cosLat = Math.max(0.2, Math.cos(this.lat[i] * DEG2RAD));
      this.lon[i] += (k * u) / cosLat;
      this.lat[i] += k * v;

      // Sortie de la bande couverte par le champ → ré-ensemencement ; longitude enroulée.
      if (this.lat[i] > maxLat || this.lat[i] < -maxLat) {
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
      // Fondu naissance → plein → mort, lissé (Hermite) : pas de « claque » d'apparition
      // ni de disparition qui produit le scintillement moucheté.
      const t = this.age[i] / this.life[i];
      const fadeIn = smoothstep01(t / 0.25); // plein après 25 % de la vie
      const fadeOut = smoothstep01((1 - t) / 0.25); // s'éteint sur les 25 % finaux
      this.alphas[i] = Math.min(fadeIn, fadeOut);

      // Couleur + taille selon la vitesse du vent RÉELLE (carte météo — la dérive
      // plancher n'influence pas la couleur, seulement le mouvement).
      const sn = Math.min(1, speed * invMax);
      const c = this._speedColor(sn);
      this.colors[i * 3] = c.r;
      this.colors[i * 3 + 1] = c.g;
      this.colors[i * 3 + 2] = c.b;
      // Vent fort = point un peu plus gros (jusqu'à ×1.8), vent calme = discret.
      this.sizes[i] = this.opts.size * (0.7 + 1.1 * sn);
    }
    const attrs = this.geometry.attributes;
    (attrs['position'] as THREE.BufferAttribute).needsUpdate = true;
    (attrs['alpha'] as THREE.BufferAttribute).needsUpdate = true;
    (attrs['color'] as THREE.BufferAttribute).needsUpdate = true;
    (attrs['aSize'] as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
