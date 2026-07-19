/**
 * Un corps céleste (planète, satellite, Soleil) et toutes ses couches visuelles.
 *
 * Chaque corps est un graphe de Groups imbriqués :
 *   group      → translation (position orbitale, posée par OrbitalMechanics)
 *     _tiltGroup  → orientation de l'axe de rotation (obliquité + azimut réels, fixe dans l'espace)
 *       _meshGroup  → rotation propre (jour/nuit) ; porte les couches :
 *         surface · clouds · atmosphere · lights (shader jour/nuit) · ring
 *
 * Gère aussi le LOD des textures (résolution selon la distance caméra) et le passage
 * Éducatif ↔ Explo (taille de base vs vraie taille physique via radiusKm).
 */
import * as THREE from 'three';
import { buildLayers } from '@/components/celestial/celestialLayers';
import { applyTexture } from '@/components/celestial/celestialTextures';
import { KM_PER_AU, SQRT_K } from '@/core/ScaleService';
import type { CameraDistance, CelestialBodyConfig } from '@/types';
import * as NightLightsShader from '@/shaders/NightLightsShader';
import Logger from '@/utils/Logger';
import type { AnimationSystem } from '@/components/systems/AnimationSystem';
import type { TextureSystem } from '@/components/systems/TextureSystem';

const CLOUDS_ROTATION_FACTOR = 0.1;

// Orientation initiale (fallback) de l'axe : simple obliquité penchée vers -Z. Remplacée
// dès le premier sync par setAxisDirection(), qui oriente l'axe le long du vrai pôle nord
// IAU (obliquité + azimut réels). Ce fallback ne sert qu'entre la création et ce sync.
const TILT_AXIS = new THREE.Vector3(1, 0, 0); // on penche autour de +X → l'axe Y bascule vers ∓Z
// Axe de spin local du _meshGroup (= +Y) qu'on aligne sur la direction réelle du pôle.
const LOCAL_UP = new THREE.Vector3(0, 1, 0);

export default class CelestialObject {
  readonly group: THREE.Group;
  // _tiltGroup : porte l'obliquité (fixe dans l'espace car group ne fait que translater).
  // _meshGroup : enfant de _tiltGroup, tourne sur l'axe penché (rotation diurne).
  private readonly _tiltGroup: THREE.Group;
  private readonly _meshGroup: THREE.Group;
  private readonly layers: Map<string, THREE.Mesh>;

  private readonly rotationSpeed: number;

  // Facteur d'échelle visuel : 1 en Éducatif, vraie taille physique en Explo.
  private _scaleFactor = 1;

  private lastLODUpdateDistance = Infinity;
  private _lodPending = false;
  private readonly _lodWorldPos = new THREE.Vector3();
  // Dernière texture appliquée par clé — évite de re-uploader au GPU une résolution
  // identique (getLODTexture renvoie le même objet depuis le cache).
  private readonly _appliedTextures = new Map<string, THREE.Texture>();

  constructor(
    private readonly textureSystem: TextureSystem,
    private readonly config: CelestialBodyConfig,
    readonly name: string,
    private readonly animationSystem: AnimationSystem
  ) {
    this.group = new THREE.Group();
    this.group.name = name;

    this._tiltGroup = new THREE.Group();
    this._tiltGroup.name = `${name}_tilt`;
    // Obliquité : on penche l'axe de spin de -tilt autour de +X (axe Y → vers -Z).
    this._tiltGroup.rotateOnAxis(TILT_AXIS, -(config.realData?.axialTilt ?? 0));
    this.group.add(this._tiltGroup);

    this._meshGroup = new THREE.Group();
    this._meshGroup.name = `${name}_mesh`;
    this._tiltGroup.add(this._meshGroup);

    this.rotationSpeed = config.rotationSpeed ?? 0;

    this.layers = buildLayers(config, name);
    this.layers.forEach((mesh) => this._meshGroup.add(mesh));
    if (this.layers.has('ring')) void this._loadRingTexture();

    void this._loadAllTextures();
    this._registerForUpdates();

    Logger.info(`[CelestialObject] Created "${name}"`);
  }

  /** Distance de visite caméra par mode (source : catalogue). */
  get cameraDistance(): CameraDistance | undefined {
    return this.config.cameraDistance;
  }

  // ============================================================================
  // TEXTURE LOADING
  // ============================================================================

  private async _loadAllTextures(): Promise<void> {
    for (const textureKey of Object.keys(this.config.textures)) {
      try {
        const texture = await this.textureSystem.getLODTexture(
          this.name,
          textureKey,
          100
        );
        applyTexture(this.layers, textureKey, texture);
        this._appliedTextures.set(textureKey, texture);
      } catch {
        Logger.warn(
          `[CelestialObject] Failed to load ${textureKey} for ${this.name}`
        );
      }
    }
  }

  private async _loadRingTexture(): Promise<void> {
    const ring = this.config.ring;
    if (!ring) return;
    try {
      const quality = ring.textureResolutions[0];
      const texture = await this.textureSystem.loadTexture(
        ring.textures,
        quality
      );
      const ringMesh = this.layers.get('ring');
      if (ringMesh) {
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        const mat = ringMesh.material as THREE.MeshStandardMaterial;
        mat.map = texture;
        mat.alphaMap = texture;
        mat.needsUpdate = true;
      }
    } catch {
      Logger.warn(`[CelestialObject] Ring texture failed for ${this.name}`);
    }
  }

  // ============================================================================
  // UPDATE — called every frame via AnimationSystem
  // ============================================================================

  private _registerForUpdates(): void {
    this.animationSystem.addUpdatable(this);
  }

  /**
   * Mise à jour visuelle uniquement (rotation propre, nuages, shader jour/nuit).
   * La position orbitale, elle, est gérée par OrbitalMechanics.
   * Ignorée quand le corps est hors-champ (visible=false).
   */
  update(
    delta: number,
    sunWorldPosition: THREE.Vector3 | null,
    visible: boolean,
    _cameraPosition?: THREE.Vector3
  ): void {
    if (!visible) return;

    this._meshGroup.rotation.y += this.rotationSpeed * delta;

    const clouds = this.layers.get('clouds');
    if (clouds)
      clouds.rotation.y += this.rotationSpeed * delta * CLOUDS_ROTATION_FACTOR;

    const lights = this.layers.get('lights');
    if (lights?.material instanceof THREE.ShaderMaterial && sunWorldPosition) {
      const uniforms = lights.material
        .uniforms as unknown as NightLightsShader.NightLightsUniforms;
      uniforms.sunPosition.value?.copy(sunWorldPosition);
    }
  }

  /**
   * Initialise l'angle de rotation axiale de la surface (Y) pour aligner le jour/nuit
   * avec l'heure UTC réelle. Appelé par OrbitalMechanics au démarrage et sur reset.
   */
  setInitialSurfaceRotation(radians: number): void {
    this._meshGroup.rotation.y = radians;
  }

  /**
   * Oriente l'axe de rotation du corps le long de `sceneNorth` (vecteur unité dans le
   * repère scène = direction du pôle de spin réel, cf. EphemerisService.getNorthPoleDirection).
   * On aligne le +Y local du _tiltGroup (= axe de spin du _meshGroup) sur ce vecteur, ce qui
   * fixe obliquité ET azimut. Le _tiltGroup n'étant porté que par la translation du group,
   * l'axe reste fixe dans l'espace le long de l'orbite → saisons correctes.
   *
   * Pour les corps rétrogrades (obliquité > 90°), l'appelant passe l'opposé du pôle nord IAU
   * (= moment cinétique de spin), de sorte que la rotation +rotationSpeed (anti-horaire vue
   * du +Y) reproduise bien le sens rétrograde réel.
   */
  setAxisDirection(sceneNorth: THREE.Vector3): void {
    this._tiltGroup.quaternion.setFromUnitVectors(LOCAL_UP, sceneNorth);
  }

  /**
   * Bascule le mode d'échelle.
   * En Explo : chaque corps est réduit/agrandi à sa vraie taille physique via radiusKm.
   *   scaleFactor = (radiusKm / KM_PER_AU × SQRT_K) / config.radius
   * En Éducatif : retour à la taille de base (scaleFactor = 1).
   */
  setScaleMode(mode: 'educ' | 'explo'): void {
    if (mode === 'explo' && this.config.realData?.radiusKm) {
      // Vraie taille physique en mode Explo : radiusKm → UA → unités scène
      const trueSceneRadius =
        (this.config.realData.radiusKm / KM_PER_AU) * SQRT_K;
      this._scaleFactor = trueSceneRadius / this.config.radius;
    } else {
      this._scaleFactor = 1;
    }

    this._meshGroup.scale.setScalar(this._scaleFactor);
    this.group.userData['radius'] = this.config.radius * this._scaleFactor;
    this._meshGroup.visible = true;
  }

  /**
   * Ajuste la résolution des textures (LOD) selon la distance à la caméra.
   * `_lodPending` empêche d'empiler plusieurs chargements concurrents pour le même
   * corps quand la caméra se déplace rapidement.
   */
  async updateLODTextures(
    camera: THREE.Camera,
    maxDistance = 200,
    threshold = 5
  ): Promise<void> {
    if (this._lodPending || !camera || !this.group) return;

    this.group.getWorldPosition(this._lodWorldPos);
    const distance = camera.position.distanceTo(this._lodWorldPos);

    if (distance > maxDistance) {
      this.lastLODUpdateDistance = distance;
      return;
    }
    if (Math.abs(distance - this.lastLODUpdateDistance) < threshold) return;

    this._lodPending = true;
    this.lastLODUpdateDistance = distance;

    try {
      for (const textureKey of Object.keys(this.config.textures)) {
        const texture = await this.textureSystem.getLODTexture(
          this.name,
          textureKey,
          distance
        );
        // Même résolution qu'avant → inutile de réappliquer (évite un upload GPU).
        if (this._appliedTextures.get(textureKey) === texture) continue;
        applyTexture(this.layers, textureKey, texture);
        this._appliedTextures.set(textureKey, texture);
      }
    } catch {
      // silent — avoids log spam during rapid camera movement
    } finally {
      this._lodPending = false;
    }
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  dispose(): void {
    this.layers.forEach((mesh) => {
      mesh.geometry?.dispose();
      const material = Array.isArray(mesh.material)
        ? mesh.material[0]
        : mesh.material;
      if (material) {
        if (material instanceof THREE.MeshStandardMaterial) {
          (
            ['map', 'normalMap', 'bumpMap', 'roughnessMap', 'alphaMap'] as const
          ).forEach((p) => {
            material[p]?.dispose();
          });
        }
        if (material instanceof THREE.ShaderMaterial) {
          const uniforms =
            material.uniforms as unknown as NightLightsShader.NightLightsUniforms;
          uniforms.lightsMap?.value?.dispose();
        }
        material.dispose();
      }
    });
    this.layers.clear();
    Logger.warn(`[CelestialObject] Disposed "${this.name}"`);
  }
}
