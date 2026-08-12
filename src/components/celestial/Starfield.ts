/**
 * Champ d'étoiles procédural en THREE.Points, superposé au fond Voie lactée.
 *
 * Motivation : la texture équirectangulaire de fond est compressée en JPEG → ses
 * étoiles apparaissent en blocs carrés (artefacts DCT). On dessine donc de vraies
 * étoiles ponctuelles indépendantes de cette compression : chaque point utilise un
 * sprite radial doux (généré par canvas) → étoiles rondes garanties, avec une
 * légère variation de taille, de luminosité et de teinte (blanc / bleuté / doré).
 *
 * Placement : les étoiles sont réparties uniformément sur une grande sphère
 * céleste et rendues sans écriture de profondeur (depthWrite off) en tout premier
 * (renderOrder très bas) pour rester un décor lointain, insensible aux corps.
 */
import * as THREE from 'three';

const STAR_COUNT = 2500;
// Rayon de la sphère céleste. Grand mais dans le far educ ; le depthWrite off +
// renderOrder bas garantit qu'elles restent en arrière-plan quel que soit le mode.
const SKY_RADIUS = 2600;

// Teintes stellaires plausibles (blanc dominant, quelques bleutées et dorées).
const STAR_COLORS = [
  0xffffff, 0xffffff, 0xffffff, 0xfff4e8, 0xe8f0ff, 0xffe9c4, 0xdfe8ff,
];

/** Sprite radial doux (blanc central → transparent) pour des étoiles rondes. */
function createStarSprite(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0.0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.25)');
  gradient.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class Starfield {
  readonly points: THREE.Points;
  private readonly sprite: THREE.Texture;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.PointsMaterial;

  constructor() {
    this.sprite = createStarSprite();

    const positions = new Float32Array(STAR_COUNT * 3);
    const colors = new Float32Array(STAR_COUNT * 3);
    const color = new THREE.Color();

    for (let i = 0; i < STAR_COUNT; i++) {
      // Distribution uniforme sur la sphère (méthode de l'angle solide égal).
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const sinPhi = Math.sin(phi);
      positions[i * 3] = SKY_RADIUS * sinPhi * Math.cos(theta);
      positions[i * 3 + 1] = SKY_RADIUS * Math.cos(phi);
      positions[i * 3 + 2] = SKY_RADIUS * sinPhi * Math.sin(theta);

      // Teinte + luminosité variées : la majorité des étoiles est faible, quelques-
      // unes brillent (courbe puissance) — évite un semis uniforme artificiel.
      color.setHex(STAR_COLORS[(Math.random() * STAR_COLORS.length) | 0]);
      const brightness = 0.35 + Math.pow(Math.random(), 3) * 0.65;
      colors[i * 3] = color.r * brightness;
      colors[i * 3 + 1] = color.g * brightness;
      colors[i * 3 + 2] = color.b * brightness;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3)
    );
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    this.material = new THREE.PointsMaterial({
      map: this.sprite,
      // sizeAttenuation false : taille écran constante (étoiles « à l'infini »),
      // insensible à la distance caméra → pas de gonflement en s'approchant.
      sizeAttenuation: false,
      size: 2.2,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      // toneMapped false : les étoiles gardent leur éclat franc et nourrissent le
      // bloom sans être compressées par l'ACESFilmicToneMapping du renderer.
      toneMapped: false,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = 'proceduralStarfield';
    // Décor lointain : rendu en tout premier, jamais occulté par erreur.
    this.points.renderOrder = -1;
    this.points.frustumCulled = false;
  }

  /**
   * Recentre le champ sur la caméra (sans hériter de sa rotation) pour un vrai
   * décor « à l'infini » : en explo la caméra s'éloigne beaucoup de l'origine, une
   * sphère fixe centrée sur (0,0,0) sortirait du frustum. On copie donc la position
   * caméra chaque frame ; les étoiles restent immobiles à l'écran quand on tourne
   * (position suivie, orientation non).
   */
  followCamera(cameraPosition: THREE.Vector3): void {
    this.points.position.copy(cameraPosition);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.sprite.dispose();
  }
}
