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
 * TRAÎNÉES (GAL-WIND-002) : chaque particule est aussi un court SEGMENT, de sa position vers
 * `position - vitesse · trailSeconds`, alpha plein à la tête et nul à la queue. Le segment vient du
 * vecteur INSTANTANÉ déjà échantillonné pour l'advection : meme direction, longueur proportionnelle
 * à la vitesse (les rapports de vitesse se lisent), nulle au calme. Aucune memoire de position :
 * pas de traînée obsolete après un changement de grille, rien a purger au ré-ensemencement, et
 * chaque extrémité est projetee sur la sphere SÉPARÉMENT (aucun raccord a l'antimeridien).
 *
 * Advection CPU : quelques milliers de particules, suffisant pour un flux lisible.
 */
import * as THREE from 'three';
import { sampleWind, type WindGrid } from '@/core/windField';
import { DEG_TO_RAD as DEG2RAD } from '@/core/MathConstants';
import { geographicToLocalDirection } from '@/core/frames';
import { samplePalette, WIND_DOMAIN, WIND_PALETTE } from '@/core/meteoPalette';
import { srgbByteToLinear } from '@/core/srgb';

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
  /**
   * Latitude absolue max où le champ de vent est défini (= `maxLat` de la grille). Les
   * particules sont ensemencées et confinées dans [-maxLat, +maxLat] : au-delà le champ
   * est clampé et toutes les particules liraient la même rangée → paquet figé aux pôles.
   */
  maxLat: number;
  /**
   * Vitesse (km/h) sous laquelle une particule S'ESTOMPE au lieu de bouger (2026-10-12). Il y
   * avait ici une dérive minimale AJOUTÉE au champ, qui faisait couler un flux de 6 km/h là où
   * le modèle n'en donnait aucun : un mouvement inventé. Le calme se montre désormais comme
   * peu de flux visible, ce qu'il est.
   */
  calmKmh: number;
  /**
   * Durée (s) de déplacement que represente la longueur d'une traînée : à `speedScale` et vitesse
   * donnees, elle vaut `speedScale · trailSeconds · vitesse` degrés. 0 = points seuls.
   */
  trailSeconds: number;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Fondu doux (Hermite) : 0 en 0, 1 en 1, dérivées nulles aux bords (pas de « claque »). */
const smoothstep01 = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/**
 * Octet sRGB → linéaire. Les attributs de couleur de sommet sont lus comme du LINÉAIRE par three :
 * donner les octets de la palette /255 les faisait encoder deux fois à la sortie, donc tirer toutes
 * les teintes vers le blanc (85 km/h, annoncé jaune par la légende, sortait gris). Table exacte,
 * les octets de la palette étant entiers.
 */
const SRGB_TO_LINEAR = Float32Array.from({ length: 256 }, (_, i) =>
  srgbByteToLinear(i)
);

// Couleur initiale d'une particule, avant sa première advection : le bas de la palette.
const [CALM_R, CALM_G, CALM_B] = samplePalette(WIND_PALETTE, 0).map(
  (c) => SRGB_TO_LINEAR[c]!
) as [number, number, number];

/** Latitude maximale d'une extrémité de traînée (les méridiens s'y resserrent, cf. `cosLat`). */
const TRAIL_MAX_LAT = 89.5;

export class WindParticles {
  /** Les têtes de particules ; les traînées en sont l'enfant (meme visibilite, meme repere). */
  readonly points: THREE.Points;
  readonly trails: THREE.LineSegments;
  private readonly trailGeometry: THREE.BufferGeometry;
  /** 2 sommets par particule : tête, queue. */
  private readonly trailPositions: Float32Array;
  /** RGBA par sommet : l'alpha de la queue reste nul, celui de la tête suit la particule. */
  private readonly trailColors: Float32Array;
  private readonly _uv = { u: 0, v: 0 };
  private readonly _rgb: [number, number, number] = [0, 0, 0];
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
  private readonly _local = new THREE.Vector3();

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
    this.trailPositions = new Float32Array(n * 6);
    this.trailColors = new Float32Array(n * 8);

    for (let i = 0; i < n; i++) this._seed(i);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.positions, 3)
    );
    this.geometry.setAttribute(
      'alpha',
      new THREE.BufferAttribute(this.alphas, 1)
    );
    this.geometry.setAttribute(
      'color',
      new THREE.BufferAttribute(this.colors, 3)
    );
    this.geometry.setAttribute(
      'aSize',
      new THREE.BufferAttribute(this.sizes, 1)
    );

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
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\n\tvAlpha = alpha;'
        )
        // Remplace la taille uniforme par la taille par particule (aSize). Le facteur
        // d'atténuation par la distance (#ifdef USE_SIZEATTENUATION) suit derrière.
        .replace('gl_PointSize = size;', 'gl_PointSize = aSize;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying float vAlpha;'
        )
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

    this.trailGeometry = new THREE.BufferGeometry();
    this.trailGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.trailPositions, 3)
    );
    // itemSize 4 : three active alors l'alpha par sommet (USE_COLOR_ALPHA), sans shader maison.
    this.trailGeometry.setAttribute(
      'color',
      new THREE.BufferAttribute(this.trailColors, 4)
    );
    const trailMaterial = new THREE.LineBasicMaterial({
      transparent: true,
      opacity: options.opacity,
      depthWrite: false,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.trails = new THREE.LineSegments(this.trailGeometry, trailMaterial);
    this.trails.name = 'wind_trails';
    this.trails.frustumCulled = false;
    this.trails.renderOrder = 3;
    this.trails.visible = options.trailSeconds > 0;
    this.points.add(this.trails);
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
    this.colors[i * 3] = CALM_R;
    this.colors[i * 3 + 1] = CALM_G;
    this.colors[i * 3 + 2] = CALM_B;
    // Traînée réduite à un point d'alpha nul : aucun segment parasite après un ré-ensemencement.
    this._writeTrail(i, 0, 0);
    this._writeTrailColor(i, CALM_R, CALM_G, CALM_B, 0);
  }

  /**
   * Écrit les deux sommets de la traînée de `i` : la tête (la particule) et la queue, décalée de
   * `-(dLon, dLat)` degrés. Chaque extrémité passe séparément par `geographicToLocalDirection` :
   * deux points voisins de la sphère, jamais une corde entre deux longitudes enroulées.
   */
  private _writeTrail(i: number, dLon: number, dLat: number): void {
    const r = this.opts.radius;
    const tp = this.trailPositions;
    tp[i * 6] = this.positions[i * 3]!;
    tp[i * 6 + 1] = this.positions[i * 3 + 1]!;
    tp[i * 6 + 2] = this.positions[i * 3 + 2]!;
    if (dLon === 0 && dLat === 0) {
      tp[i * 6 + 3] = tp[i * 6]!;
      tp[i * 6 + 4] = tp[i * 6 + 1]!;
      tp[i * 6 + 5] = tp[i * 6 + 2]!;
      return;
    }
    const tailLat = Math.max(
      -TRAIL_MAX_LAT,
      Math.min(TRAIL_MAX_LAT, this.lat[i]! - dLat)
    );
    const p = geographicToLocalDirection(
      tailLat,
      this.lon[i]! - dLon,
      this._local
    );
    tp[i * 6 + 3] = p.x * r;
    tp[i * 6 + 4] = p.y * r;
    tp[i * 6 + 5] = p.z * r;
  }

  /** Couleur (linéaire) des deux sommets ; alpha de la tête `a`, de la queue toujours 0. */
  private _writeTrailColor(
    i: number,
    r: number,
    g: number,
    b: number,
    a: number
  ): void {
    const c = this.trailColors;
    c[i * 8] = r;
    c[i * 8 + 1] = g;
    c[i * 8 + 2] = b;
    c[i * 8 + 3] = a;
    c[i * 8 + 4] = r;
    c[i * 8 + 5] = g;
    c[i * 8 + 6] = b;
    c[i * 8 + 7] = 0;
  }

  /**
   * lat/lon → position locale, par la fonction qui pose aussi les séismes et le point subsolaire
   * (`core/frames.ts`). Ce module en avait sa propre copie, alignée par un décalage réglé à la
   * main (`lonOffset: π`) : la même formule, mais deux propriétaires.
   */
  private _writePosition(i: number): void {
    const p = geographicToLocalDirection(this.lat[i], this.lon[i], this._local);
    const r = this.opts.radius;
    this.positions[i * 3] = p.x * r;
    this.positions[i * 3 + 1] = p.y * r;
    this.positions[i * 3 + 2] = p.z * r;
  }

  /**
   * Advecte toutes les particules par le champ `grid` (dt réel, en secondes). Sans grille
   * (pas encore chargée), ne fait rien.
   */
  update(dt: number, grid: WindGrid | null): void {
    if (!grid || dt <= 0) return;
    const n = this.opts.count;
    const k = this.opts.speedScale * dt;
    const span = WIND_DOMAIN.max - WIND_DOMAIN.min;
    const maxLat = this.opts.maxLat;
    const calm = this.opts.calmKmh;
    const kTrail = this.opts.speedScale * this.opts.trailSeconds;
    for (let i = 0; i < n; i++) {
      const { u, v } = sampleWind(grid, this.lat[i], this.lon[i], this._uv);
      const speed = Math.hypot(u, v);
      // Vent INCONNU ici (NaN : donnée absente) : la particule ne bouge pas, ne se dessine pas et
      // ne laisse aucune traînée ; aucune valeur invalide n'entre dans ses buffers. Elle vieillit
      // et se ré-ensemence normalement. Une position déjà invalide est ré-ensemencée.
      if (!Number.isFinite(speed)) {
        if (!Number.isFinite(this.lat[i]) || !Number.isFinite(this.lon[i])) {
          this._seed(i);
          continue;
        }
        this.age[i] += dt;
        if (this.age[i] >= this.life[i]) {
          this._seed(i);
          continue;
        }
        this.alphas[i] = 0;
        this._writeTrail(i, 0, 0);
        this._writeTrailColor(
          i,
          this.colors[i * 3]!,
          this.colors[i * 3 + 1]!,
          this.colors[i * 3 + 2]!,
          0
        );
        continue;
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
      // Même déplacement que l'advection (`k · u / cosLat`, `k · v`), sur la durée de la traînée.
      this._writeTrail(i, (kTrail * u) / cosLat, kTrail * v);
      // Fondu naissance → plein → mort, lissé (Hermite) : pas de « claque » d'apparition
      // ni de disparition qui produit le scintillement moucheté. Au calme, la particule
      // s'estompe : elle ne bouge presque pas, et la montrer pleine ferait un amas.
      const t = this.age[i] / this.life[i];
      const fadeIn = smoothstep01(t / 0.25); // plein après 25 % de la vie
      const fadeOut = smoothstep01((1 - t) / 0.25); // s'éteint sur les 25 % finaux
      const alpha = Math.min(fadeIn, fadeOut) * smoothstep01(speed / calm);
      this.alphas[i] = alpha;

      // Couleur + taille selon la vitesse RÉELLE, par la palette que la légende affiche.
      const sn = clamp01((speed - WIND_DOMAIN.min) / span);
      const rgb = samplePalette(WIND_PALETTE, sn, this._rgb);
      const lr = SRGB_TO_LINEAR[rgb[0]]!;
      const lg = SRGB_TO_LINEAR[rgb[1]]!;
      const lb = SRGB_TO_LINEAR[rgb[2]]!;
      this.colors[i * 3] = lr;
      this.colors[i * 3 + 1] = lg;
      this.colors[i * 3 + 2] = lb;
      this._writeTrailColor(i, lr, lg, lb, alpha);
      // Vent fort = point un peu plus gros (jusqu'à ×1.8), vent calme = discret.
      this.sizes[i] = this.opts.size * (0.7 + 1.1 * sn);
    }
    const attrs = this.geometry.attributes;
    (attrs['position'] as THREE.BufferAttribute).needsUpdate = true;
    (attrs['alpha'] as THREE.BufferAttribute).needsUpdate = true;
    (attrs['color'] as THREE.BufferAttribute).needsUpdate = true;
    (attrs['aSize'] as THREE.BufferAttribute).needsUpdate = true;
    const trailAttrs = this.trailGeometry.attributes;
    (trailAttrs['position'] as THREE.BufferAttribute).needsUpdate = true;
    (trailAttrs['color'] as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
    this.trailGeometry.dispose();
    (this.trails.material as THREE.Material).dispose();
  }
}
