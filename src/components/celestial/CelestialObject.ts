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
import {
  configureShadows,
  createAtmosphereMaterial,
  createCloudsMaterial,
  createRingMaterial,
  createSphereGeometry,
  createSurfaceMaterial,
  RING_SEGMENTS,
} from '../../config/layerConfig';
import { RENDER_SETTINGS, SHADER_SETTINGS } from '../../config/settings';
import { SQRT_K } from '../../core/ScaleService';
import type { CelestialBodyConfig } from '../../types';
import * as NightLightsShader from '../../shaders/NightLightsShader';
import Logger from '../../utils/Logger';
import type { AnimationSystem } from '../systems/AnimationSystem';
import type { TextureSystem } from '../systems/TextureSystem';

const CLOUDS_ROTATION_FACTOR = 0.1;
const SURFACE_TEXTURE_TYPES = ['surface', 'normalMap', 'bump', 'spec', 'specularMap'];

// ── Mode Explo — vraie échelle ──────────────────────────────────────────────
const KM_PER_AU = 149_597_870;

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
  private readonly layers = new Map<string, THREE.Mesh>();

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

    this._createAllLayers();
    void this._loadAllTextures();
    this._registerForUpdates();

    Logger.info(`[CelestialObject] Created "${name}"`);
  }

  // ============================================================================
  // LAYER CREATION
  // ============================================================================

  private _createAllLayers(): void {
    const { textures } = this.config;
    if (textures.surface)    this._createSurfaceLayer();
    if (textures.clouds)     this._createCloudsLayer();
    if (textures.atmosphere) this._createAtmosphereLayer();
    if (textures.lights)     this._createLightsLayer();
    if (this.config.ring)    this._createRingLayer();
  }

  private _createSurfaceLayer(): void {
    const isSun   = this.name === 'sun';
    const material = createSurfaceMaterial(isSun);
    const mesh     = new THREE.Mesh(createSphereGeometry(this.config.radius, 'surface'), material);
    mesh.name      = `${this.name}_surface`;
    if (RENDER_SETTINGS.shadowMap.enabled && !isSun) configureShadows(mesh, true, true);
    this._addLayer('surface', mesh);
  }

  private _createCloudsLayer(): void {
    const mesh = new THREE.Mesh(createSphereGeometry(this.config.radius, 'clouds'), createCloudsMaterial());
    mesh.name  = `${this.name}_clouds`;
    if (RENDER_SETTINGS.shadowMap.enabled) configureShadows(mesh, false, true);
    this._addLayer('clouds', mesh);
  }

  private _createAtmosphereLayer(): void {
    const mesh = new THREE.Mesh(createSphereGeometry(this.config.radius, 'atmosphere'), createAtmosphereMaterial());
    mesh.name  = `${this.name}_atmosphere`;
    this._addLayer('atmosphere', mesh);
  }

  private _createLightsLayer(): void {
    const settings = SHADER_SETTINGS.nightLights;
    const uniforms = NightLightsShader.createUniforms(settings);
    uniforms.sunPosition.value = new THREE.Vector3(0, 0, 0);

    const material = new THREE.ShaderMaterial({
      vertexShader:   NightLightsShader.vertexShader,
      fragmentShader: NightLightsShader.fragmentShader,
      uniforms,
      transparent: true,
      blending:    THREE.AdditiveBlending,
      depthWrite:  false,
      // depthTest: false — le depth buffer 24-bit ne peut pas distinguer le layer lights
      // (R×1.002) de la surface (R) au limbe de la sphère dès que la caméra dépasse ~12u.
      // Ça créait une barre noire verticale sur le côté ombre du limbe.
      // FrontSide + le shader (nightFactor=0 sur le jour) assurent que rien
      // d'incorrect n'est rendu — le depth test n'apporte rien ici.
      depthTest:   false,
      side:        THREE.FrontSide,
    });

    const mesh = new THREE.Mesh(createSphereGeometry(this.config.radius, 'lights'), material);
    mesh.name  = `${this.name}_lights`;
    // renderOrder > 0 : le layer lights se rend après les nuages (renderOrder=0 par défaut)
    // pour que son AdditiveBlending s'applique APRÈS le blend des nuages, pas dessous.
    mesh.renderOrder = 1;
    this._addLayer('lights', mesh);
  }

  private _createRingLayer(): void {
    const ring = this.config.ring!;
    const inner = this.config.radius * ring.innerRadius;
    const outer = this.config.radius * ring.outerRadius;

    const geometry = new THREE.RingGeometry(inner, outer, RING_SEGMENTS);
    this._correctRingUVs(geometry, inner, outer);

    const mesh     = new THREE.Mesh(geometry, createRingMaterial());
    mesh.name      = `${this.name}_ring`;
    mesh.rotation.x = Math.PI / 2;
    this._addLayer('ring', mesh);
    void this._loadRingTexture();
  }

  private _correctRingUVs(geometry: THREE.RingGeometry, innerRadius: number, outerRadius: number): void {
    const pos = geometry.attributes['position'] as THREE.BufferAttribute;
    const uv  = geometry.attributes['uv']       as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const dist = Math.sqrt(pos.getX(i) ** 2 + pos.getY(i) ** 2);
      const u    = (dist - innerRadius) / (outerRadius - innerRadius);
      uv.setXY(i, u, uv.getY(i));
    }
  }

  private _addLayer(name: string, mesh: THREE.Mesh): void {
    this.layers.set(name, mesh);
    this._meshGroup.add(mesh);
  }

  // ============================================================================
  // TEXTURE LOADING
  // ============================================================================

  private async _loadAllTextures(): Promise<void> {
    for (const textureKey of Object.keys(this.config.textures)) {
      try {
        const texture = await this.textureSystem.getLODTexture(this.name, textureKey, 100);
        this._applyTexture(textureKey, texture);
        this._appliedTextures.set(textureKey, texture);
      } catch {
        Logger.warn(`[CelestialObject] Failed to load ${textureKey} for ${this.name}`);
      }
    }
  }

  private async _loadRingTexture(): Promise<void> {
    const ring = this.config.ring;
    if (!ring) return;
    try {
      const quality = ring.textureResolutions[0];
      const texture = await this.textureSystem.loadTexture(ring.textures, quality);
      const ringMesh = this.layers.get('ring');
      if (ringMesh) {
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        const mat = ringMesh.material as THREE.MeshStandardMaterial;
        mat.map       = texture;
        mat.alphaMap  = texture;
        mat.needsUpdate = true;
      }
    } catch {
      Logger.warn(`[CelestialObject] Ring texture failed for ${this.name}`);
    }
  }

  private _applyTexture(textureKey: string, texture: THREE.Texture): void {
    if (SURFACE_TEXTURE_TYPES.includes(textureKey)) {
      this._applySurfaceTexture(textureKey, texture);
      return;
    }
    const handlers: Record<string, () => void> = {
      clouds:     () => this._applyCloudsTexture(texture),
      atmosphere: () => this._applyAtmosphereTexture(texture),
      lights:     () => this._applyLightsTexture(texture),
    };
    handlers[textureKey]?.();
  }

  private _applySurfaceTexture(textureKey: string, texture: THREE.Texture): void {
    const mesh = this.layers.get('surface');
    if (!mesh) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;

    switch (textureKey) {
      case 'surface':
        mat.map = texture;
        break;
      case 'normalMap':
        mat.normalMap   = texture;
        mat.normalScale = new THREE.Vector2(1, 1);
        // Partage la normalMap avec le shader des lumières pour aligner les terminateurs.
        this._applyLightsNormalMap(texture, mat.normalScale);
        break;
      case 'bump':
        mat.bumpMap   = texture;
        mat.bumpScale = 0.05;
        break;
      case 'spec':
      case 'specularMap':
        mat.roughnessMap = texture;
        mat.roughness    = 1.0;
        break;
    }
    mat.needsUpdate = true;
  }

  private _applyCloudsTexture(texture: THREE.Texture): void {
    const mesh = this.layers.get('clouds');
    if (!mesh) return;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    const mat   = mesh.material as THREE.MeshStandardMaterial;
    mat.map      = texture;
    mat.alphaMap = texture;
    mat.needsUpdate = true;
  }

  private _applyAtmosphereTexture(texture: THREE.Texture): void {
    const mesh = this.layers.get('atmosphere');
    if (!mesh) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    mat.map = texture;
    mat.needsUpdate = true;
  }

  private _applyLightsTexture(texture: THREE.Texture): void {
    const mesh = this.layers.get('lights');
    if (!(mesh?.material instanceof THREE.ShaderMaterial)) return;
    const uniforms = mesh.material.uniforms as unknown as NightLightsShader.NightLightsUniforms;
    uniforms.lightsMap.value = texture;
    mesh.material.needsUpdate = true;
  }

  // Donne au shader des lumières la même normalMap que la surface : son terminateur
  // suit alors le relief à l'identique, supprimant la bande sombre sans lumières.
  private _applyLightsNormalMap(texture: THREE.Texture, normalScale: THREE.Vector2): void {
    const mesh = this.layers.get('lights');
    if (!(mesh?.material instanceof THREE.ShaderMaterial)) return;
    const uniforms = mesh.material.uniforms as unknown as NightLightsShader.NightLightsUniforms;
    uniforms.normalMap.value = texture;
    uniforms.normalScale.value.copy(normalScale);
    uniforms.useNormalMap.value = 1;
    mesh.material.needsUpdate = true;
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
  update(delta: number, sunWorldPosition: THREE.Vector3 | null, visible: boolean, _cameraPosition?: THREE.Vector3): void {
    if (!visible) return;

    this._meshGroup.rotation.y += this.rotationSpeed * delta;

    const clouds = this.layers.get('clouds');
    if (clouds) clouds.rotation.y += this.rotationSpeed * delta * CLOUDS_ROTATION_FACTOR;

    const lights = this.layers.get('lights');
    if (lights?.material instanceof THREE.ShaderMaterial && sunWorldPosition) {
      const uniforms = lights.material.uniforms as unknown as NightLightsShader.NightLightsUniforms;
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
      const trueSceneRadius = (this.config.realData.radiusKm / KM_PER_AU) * SQRT_K;
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
        const texture = await this.textureSystem.getLODTexture(this.name, textureKey, distance);
        // Même résolution qu'avant → inutile de réappliquer (évite un upload GPU).
        if (this._appliedTextures.get(textureKey) === texture) continue;
        this._applyTexture(textureKey, texture);
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
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (material) {
        if (material instanceof THREE.MeshStandardMaterial) {
          (['map', 'normalMap', 'bumpMap', 'roughnessMap', 'alphaMap'] as const).forEach((p) => {
            material[p]?.dispose();
          });
        }
        if (material instanceof THREE.ShaderMaterial) {
          const uniforms = material.uniforms as unknown as NightLightsShader.NightLightsUniforms;
          uniforms.lightsMap?.value?.dispose();
        }
        material.dispose();
      }
    });
    this.layers.clear();
    Logger.warn(`[CelestialObject] Disposed "${this.name}"`);
  }
}
