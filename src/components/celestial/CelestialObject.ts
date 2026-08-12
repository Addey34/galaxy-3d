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
import {
  GEOMETRY_SEGMENTS,
  GEOMETRY_SEGMENTS_HI,
  createSphereGeometry,
  getCloudShadowUniforms,
  getMoonlightUniforms,
  getOceanGlintUniforms,
  getPrecipUniforms,
  getRealCloudsUniforms,
  getRingShadowUniforms,
  type PrecipUniforms,
  setMaterialLightAttenuation,
  type CloudShadowUniforms,
  type MoonlightUniforms,
  type OceanGlintUniforms,
  type RingShadowUniforms,
} from '@/config/layerConfig';
import { ringTexturePath } from '@/config/catalog';
import type { CameraDistance, CelestialBodyConfig } from '@/types';
import * as NightLightsShader from '@/shaders/NightLightsShader';
import Logger from '@/utils/Logger';
import type { AnimationSystem } from '@/components/systems/AnimationSystem';
import type { TextureSystem } from '@/components/systems/TextureSystem';

const CLOUDS_ROTATION_FACTOR = 0.1;
// Opacité de l'ombre portée des nuages sur la surface (0 = aucune, 1 = noir).
const CLOUD_SHADOW_STRENGTH = 0.35;
// Distance (en rayons apparents) sous laquelle on densifie la surface pour le
// displacement. Au-delà, le relief géométrique est invisible → géométrie standard.
const HI_RES_TESSELLATION_THRESHOLD = 12;
// Intensité maximale du clair de Lune (pleine Lune, point face à la Lune). Faible :
// la nuit reste sombre, la Lune ne fait que déposer une lueur subtile sur les mers/sol.
const MOONLIGHT_MAX_STRENGTH = 0.12;

// Durée du fondu enchaîné entre deux frames de pluie IMERG (transition douce, sans
// clignotement au changement de demi-heure). Piloté par le temps réel (delta).
const PRECIP_FADE_SECONDS = 0.6;
// Vecteurs de travail (calcul de phase lunaire) — évite d'allouer chaque frame.
const _tmpMoonVecA = new THREE.Vector3();
const _tmpMoonVecB = new THREE.Vector3();

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

  private lastLODNormalizedDistance = Infinity;
  private _lodPending = false;
  private _disposed = false;
  private readonly _lodWorldPos = new THREE.Vector3();
  private readonly _hasTextures: boolean;
  // Géométrie surface haute densité active (pour le displacement au gros plan) :
  // évite de reconstruire la sphère à chaque frame, seulement sur transition.
  private _hiResSurfaceActive = false;
  // Dernière texture appliquée par clé — évite de re-uploader au GPU une résolution
  // identique (getLODTexture renvoie le même objet depuis le cache).
  private readonly _appliedTextures = new Map<string, THREE.Texture>();
  // Uniforms d'ombre nuageuse du matériau surface (si présent) : la cloud map y
  // est partagée pour projeter l'ombre des nuages, et l'offset suit leur dérive.
  private _cloudShadow?: CloudShadowUniforms;
  // Uniforms d'ombre portée de la planète sur son anneau (Saturne).
  private _ringShadow?: RingShadowUniforms;
  private readonly _ringWorldPos = new THREE.Vector3();
  // Uniforms de clair de Lune du matériau surface (Terre) : la face nuit reçoit
  // une lueur diffuse selon la position réelle de la Lune (réflecteur).
  private _moonlight?: MoonlightUniforms;
  // Uniforms du reflet solaire océanique (Terre) : lobe spéculaire dédié suivant
  // la direction du Soleil, masqué sur l'océan via la spec map.
  private _oceanGlint?: OceanGlintUniforms;
  // Uniforms de la couche pluie (Terre) : position du Soleil pour l'éclairage jour/nuit.
  private _precip?: PrecipUniforms;
  private _precipMat?: THREE.MeshBasicMaterial;
  // Fondu enchaîné pluie : durée écoulée (s) de la transition en cours (< 0 = inactive).
  private _precipFadeElapsed = -1;
  private _precipFadeTarget: THREE.Texture | null = null;
  private readonly _selfWorldPos = new THREE.Vector3();
  // Nuages géoréférencés réels (GIBS) : quand actif, on suspend la dérive continue
  // de la couche nuages (qui simule des nuages fictifs) — une vraie image satellite
  // doit rester alignée sur sa longitude. La Terre continue de tourner (_meshGroup).
  private _realCloudDrift = true;
  // Vrai dès qu'une couverture nuageuse réelle (GIBS) est appliquée : le LOD de
  // textures ne doit alors PLUS toucher la couche `clouds` (sinon il réécrit la
  // cloud map statique par-dessus l'image satellite à chaque changement de distance
  // caméra — c'était la cause de « nuages statiques / absents »).
  private _realCloudsActive = false;

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
    this._hasTextures = Object.keys(config.textures ?? {}).length > 0;

    this.layers = buildLayers(config, name);
    this.layers.forEach((mesh) => this._meshGroup.add(mesh));
    const surface = this.layers.get('surface');
    if (surface && !Array.isArray(surface.material)) {
      this._cloudShadow = getCloudShadowUniforms(surface.material);
      this._moonlight = getMoonlightUniforms(surface.material);
      this._oceanGlint = getOceanGlintUniforms(surface.material);
    }
    const precip = this.layers.get('precip');
    if (precip && !Array.isArray(precip.material)) {
      this._precipMat = precip.material as THREE.MeshBasicMaterial;
      this._precip = getPrecipUniforms(precip.material);
    }
    const ring = this.layers.get('ring');
    if (ring && !Array.isArray(ring.material))
      this._ringShadow = getRingShadowUniforms(ring.material);
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
    for (const textureKey of Object.keys(this.config.textures ?? {})) {
      try {
        const texture = await this.textureSystem.getLODTexture(
          this.name,
          textureKey,
          100
        );
        applyTexture(this.layers, textureKey, texture);
        this._bindCloudShadow(textureKey, texture);
        this._appliedTextures.set(textureKey, texture);
      } catch {
        Logger.warn(
          `[CelestialObject] Failed to load ${textureKey} for ${this.name}`
        );
      }
    }
  }

  /**
   * Partage la cloud map avec le matériau surface pour projeter l'ombre des
   * nuages, et active l'effet (strength > 0). Sans clouds, la branche reste inerte.
   */
  private _bindCloudShadow(textureKey: string, texture: THREE.Texture): void {
    if (textureKey !== 'clouds' || !this._cloudShadow) return;
    this._cloudShadow.map.value = texture;
    this._cloudShadow.strength.value = CLOUD_SHADOW_STRENGTH;
  }

  /**
   * Applique une couverture nuageuse RÉELLE (image satellite GIBS) à la couche
   * nuages : la texture sert de `map` et son alpha est dérivé par extraction shader
   * (nuages = blanc lumineux désaturé). Aligne l'image (rotation nuages remise à 0),
   * suspend la dérive fictive, et branche l'ombre portée. `opacity`/seuils optionnels
   * surchargent les valeurs par défaut du matériau. Sans couche nuages → no-op.
   */
  setRealCloudsTexture(
    texture: THREE.Texture,
    options: {
      opacity?: number;
      lumLow?: number;
      lumHigh?: number;
      satMax?: number;
      lumLowLand?: number;
    } = {}
  ): void {
    const clouds = this.layers.get('clouds');
    if (!clouds || Array.isArray(clouds.material)) return;
    // À partir d'ici, le LOD de textures ne doit plus écraser la couche nuages.
    this._realCloudsActive = true;
    const mat = clouds.material as THREE.MeshStandardMaterial;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    mat.map = texture;
    // L'alpha vient de l'extraction shader (diffuseColor.a), pas d'une alphaMap :
    // on retire toute alphaMap héritée de la couche statique.
    mat.alphaMap = null;
    if (options.opacity !== undefined) mat.opacity = options.opacity;
    mat.needsUpdate = true;

    const uniforms = getRealCloudsUniforms(mat);
    if (uniforms) {
      uniforms.enabled.value = 1;
      if (options.lumLow !== undefined) uniforms.lumLow.value = options.lumLow;
      if (options.lumHigh !== undefined)
        uniforms.lumHigh.value = options.lumHigh;
      if (options.satMax !== undefined) uniforms.satMax.value = options.satMax;
      if (options.lumLowLand !== undefined)
        uniforms.lumLowLand.value = options.lumLowLand;
      // Carte océan = canal g de la spec map (roughnessMap) de la surface : lève
      // l'ambiguïté sable-clair/nuage (voir REAL_CLOUDS_GLSL). Peut être absente si la
      // spec map n'est pas encore chargée → extraction « terre stricte » partout jusque-là.
      const surface = this.layers.get('surface');
      const surfaceMat =
        surface && !Array.isArray(surface.material)
          ? (surface.material as THREE.MeshStandardMaterial)
          : undefined;
      const oceanMask = surfaceMat?.roughnessMap ?? null;
      uniforms.oceanMask.value = oceanMask;
      uniforms.hasOceanMask.value = oceanMask ? 1 : 0;
    }

    // Image géoréférencée : on la fige à sa longitude (fin de la dérive fictive) et
    // on aligne l'ombre portée sur l'orientation courante de la couche.
    clouds.rotation.y = 0;
    this._realCloudDrift = false;
    this._bindCloudShadow('clouds', texture);
    if (this._cloudShadow) this._cloudShadow.offset.value = 0;
  }

  /**
   * Attache un objet 3D au groupe qui porte la rotation diurne (comme la surface/les
   * nuages) : il tourne donc avec le corps. Utilisé par la couche de particules de vent.
   */
  attachSpinningChild(object: THREE.Object3D): void {
    this._meshGroup.add(object);
  }

  /** Rayon local des couches (espace du _meshGroup), avant scaleFactor de scène. */
  get layerRadius(): number {
    return this.config.radius;
  }

  private static _configurePrecipTex(texture: THREE.Texture): void {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
  }

  /**
   * Affiche une frame de PRÉCIPITATION (carte IMERG) sur la couche `precip`, avec FONDU
   * ENCHAÎNÉ depuis la frame précédente (pas de clignotement au changement de demi-heure).
   * La première frame est posée directement ; les suivantes fondent en douceur via
   * `_tickPrecipFade` (uniforms map/mapB + mix). `opacity` optionnelle surcharge le défaut.
   * Sans couche precip → no-op.
   */
  setPrecipTexture(texture: THREE.Texture, options: { opacity?: number } = {}): void {
    const mat = this._precipMat;
    const uniforms = this._precip;
    if (!mat || !uniforms) return;
    CelestialObject._configurePrecipTex(texture);
    if (options.opacity !== undefined) uniforms.opacity.value = options.opacity;
    uniforms.enabled.value = 1;

    // Première frame (aucune map encore) : pose directe, pas de fondu.
    if (!mat.map) {
      mat.map = texture;
      uniforms.mix.value = 0;
      mat.needsUpdate = true;
      return;
    }
    // Même texture déjà en cours d'affichage : rien à faire.
    if (mat.map === texture || this._precipFadeTarget === texture) return;

    // Un fondu est déjà en cours : on le finalise (la cible devient la frame courante)
    // avant d'enchaîner sur la nouvelle → pas de map figée si les frames arrivent vite.
    if (this._precipFadeTarget) {
      mat.map = this._precipFadeTarget;
      this._precipFadeTarget = null;
    }

    // Démarre un fondu map → texture (via mapB).
    uniforms.mapB.value = texture;
    uniforms.mix.value = 0;
    this._precipFadeTarget = texture;
    this._precipFadeElapsed = 0;
    mat.needsUpdate = true;
  }

  /** Avance le fondu enchaîné pluie ; à la fin, promeut mapB en map et réarme. */
  private _tickPrecipFade(delta: number): void {
    if (this._precipFadeElapsed < 0 || !this._precipMat || !this._precip) return;
    // `delta` ici est en secondes de SIMULATION (mise à l'échelle par la vitesse) : en
    // accéléré il serait énorme → le fondu se ferait instantanément. On le borne à un pas
    // temps-réel plausible (rawDelta est plafonné à 0.1 s) pour un fondu toujours fluide.
    this._precipFadeElapsed += Math.min(Math.max(delta, 0), 0.1);
    const t = Math.min(this._precipFadeElapsed / PRECIP_FADE_SECONDS, 1);
    this._precip.mix.value = t;
    if (t >= 1) {
      // Fin : la cible devient la frame courante (map), on réinitialise le fondu.
      if (this._precipFadeTarget) this._precipMat.map = this._precipFadeTarget;
      this._precip.mix.value = 0;
      this._precip.mapB.value = null;
      this._precipFadeTarget = null;
      this._precipFadeElapsed = -1;
      this._precipMat.needsUpdate = true;
    }
  }

  private async _loadRingTexture(normalizedDistance = 250): Promise<void> {
    const ring = this.config.ring;
    if (!ring) return;
    try {
      const texture = await this.textureSystem.getRingLODTexture(
        ring.textures ?? ringTexturePath(this.name),
        ring.textureResolutions,
        normalizedDistance
      );
      if (this._appliedTextures.get('ring') === texture) return;
      const ringMesh = this.layers.get('ring');
      if (!ringMesh) return;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      const material = ringMesh.material as THREE.MeshStandardMaterial;
      material.map = texture;
      material.alphaMap = texture;
      // Émissif piloté par l'albédo de l'anneau : un disque plat MeshStandard
      // éclairé par la PointLight du Soleil reçoit la lumière en incidence rasante
      // (≈ 0 diffus) → anneau quasi invisible. Les particules de glace réelles
      // diffusent pourtant vivement. On ré-illumine donc l'anneau par sa propre
      // texture en émissif ; l'ombre portée de la planète (shader) assombrit aussi
      // ce terme pour garder l'arc occulté crédible.
      material.emissive = new THREE.Color(0xffffff);
      material.emissiveMap = texture;
      material.emissiveIntensity = 0.6;
      material.needsUpdate = true;
      this._appliedTextures.set('ring', texture);
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
    _cameraPosition?: THREE.Vector3,
    moonWorldPosition?: THREE.Vector3 | null
  ): void {
    if (!visible) return;

    this._meshGroup.rotation.y += this.rotationSpeed * delta;

    const clouds = this.layers.get('clouds');
    if (clouds && this._realCloudDrift) {
      clouds.rotation.y += this.rotationSpeed * delta * CLOUDS_ROTATION_FACTOR;
      // Suit la dérive des nuages pour aligner l'ombre portée sur la surface :
      // une rotation Y = décalage de longitude = décalage d'UV.x (÷ 2π).
      if (this._cloudShadow)
        this._cloudShadow.offset.value = clouds.rotation.y / (Math.PI * 2);
    }

    const lights = this.layers.get('lights');
    if (lights?.material instanceof THREE.ShaderMaterial && sunWorldPosition) {
      const uniforms = lights.material
        .uniforms as unknown as NightLightsShader.NightLightsUniforms;
      uniforms.sunPosition.value?.copy(sunWorldPosition);
    }

    // Couche pluie : direction du Soleil (éclairage jour/nuit) + fondu enchaîné.
    if (this._precip && sunWorldPosition)
      this._precip.sunPosition.value.copy(sunWorldPosition);
    this._tickPrecipFade(delta);

    // Le halo Fresnel a besoin de la position du Soleil pour n'illuminer que le
    // côté jour du limbe.
    const atmosphere = this.layers.get('atmosphere');
    if (atmosphere?.material instanceof THREE.ShaderMaterial && sunWorldPosition) {
      const uniforms = atmosphere.material.uniforms as unknown as {
        sunPosition: THREE.IUniform<THREE.Vector3 | null>;
      };
      uniforms.sunPosition.value?.copy(sunWorldPosition);
    }

    // Ombre portée de la planète sur son anneau : centre + rayon (échelle
    // courante) + direction du Soleil, en coordonnées monde.
    if (this._ringShadow && sunWorldPosition) {
      this.group.getWorldPosition(this._ringWorldPos);
      this._ringShadow.planetCenter.value.copy(this._ringWorldPos);
      this._ringShadow.planetRadius.value =
        this.config.radius * this._scaleFactor;
      this._ringShadow.sunDirection.value
        .subVectors(sunWorldPosition, this._ringWorldPos)
        .normalize();
    }

    // Direction monde du Soleil, partagée par le clair de Lune (masque nuit) et le
    // reflet solaire océanique (lobe spéculaire). L'uniform sunDir est le MÊME
    // objet dans les deux (partagé dans createShadowAwareStandardMaterial) : une
    // seule écriture suffit. Le reflet n'a besoin que de cette direction ;
    // le glint est ainsi actif même sans données lunaires.
    if ((this._oceanGlint || this._moonlight) && sunWorldPosition) {
      this.group.getWorldPosition(this._selfWorldPos);
      const sunDir = this._oceanGlint?.sunDir ?? this._moonlight?.sunDir;
      sunDir?.value.subVectors(sunWorldPosition, this._selfWorldPos).normalize();
    }

    // Clair de Lune sur la face nuit (Terre) : position de la Lune + intensité
    // selon la phase = fraction éclairée de la Lune vue depuis la Terre ≈
    // (1 + cos(angle Soleil-Lune-Terre)) / 2 : ~1 à la pleine Lune, ~0 à la nouvelle.
    if (this._moonlight && sunWorldPosition && moonWorldPosition) {
      this._moonlight.position.value.copy(moonWorldPosition);

      const toSun = _tmpMoonVecA
        .subVectors(sunWorldPosition, moonWorldPosition)
        .normalize();
      const toEarth = _tmpMoonVecB
        .subVectors(this._selfWorldPos, moonWorldPosition)
        .normalize();
      const phase = (1 + toSun.dot(toEarth)) * 0.5;
      this._moonlight.strength.value = phase * MOONLIGHT_MAX_STRENGTH;
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
   * Applique l'irradiance solaire et l'occultation analytique aux couches PBR.
   * La couche `lights` (lumières de ville) en est exclue : c'est un phénomène de
   * la face nuit, alimenté par les villes — une éclipse (ombre sur la face jour)
   * ne doit pas l'éteindre. Son shader gère lui-même sa visibilité jour/nuit.
   */
  setLightAttenuation(attenuation: number): void {
    const bounded = THREE.MathUtils.clamp(attenuation, 0, 6);
    this.layers.forEach((mesh, layerName) => {
      if (layerName === 'lights') return;
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      materials.forEach((material) =>
        setMaterialLightAttenuation(material, bounded)
      );
    });
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
   * Facteur d'échelle visuel en mode Explo : vraie taille physique via radiusKm.
   *   (radiusKm / KM_PER_AU × SQRT_K) / config.radius
   * 1 si le corps n'a pas de rayon physique connu (garde la taille de base).
   */
  private _exploScaleFactor(): number {
    const radiusKm = this.config.realData?.radiusKm;
    if (!radiusKm) return 1;
    return ((radiusKm / KM_PER_AU) * SQRT_K) / this.config.radius;
  }

  /** Applique un facteur d'échelle donné aux couches et met à jour le rayon de cadrage. */
  private _applyScaleFactor(factor: number): void {
    this._scaleFactor = factor;
    this._meshGroup.scale.setScalar(factor);
    this.group.userData['radius'] = this.config.radius * factor;
    this._meshGroup.visible = true;
  }

  /**
   * Bascule le mode d'échelle.
   * En Explo : chaque corps est réduit/agrandi à sa vraie taille physique via radiusKm.
   * En Éducatif : retour à la taille de base (scaleFactor = 1).
   */
  setScaleMode(mode: 'educ' | 'explo'): void {
    this._applyScaleFactor(mode === 'explo' ? this._exploScaleFactor() : 1);
  }

  /**
   * Morphe la taille entre Éducatif (`p = 0`, taille de base) et Explo (`p = 1`, vraie
   * taille physique). Sert à la transition animée Éduc↔Explo ; interpolation linéaire du
   * facteur, cohérente avec le morphing des positions dans `OrbitalMechanics`.
   */
  setScaleMorph(p: number): void {
    const explo = this._exploScaleFactor();
    this._applyScaleFactor(1 + (explo - 1) * p);
  }

  /**
   * Ajuste le LOD selon la distance exprimée en rayons apparents. Cette métrique reste
   * cohérente entre tailles pédagogiques et rayons physiques, contrairement aux unités scène.
   * `_lodPending` empêche d'empiler plusieurs chargements concurrents.
   */
  async updateLODTextures(
    camera: THREE.Camera,
    maxNormalizedDistance = 250,
    threshold = 2
  ): Promise<void> {
    if (!this._hasTextures || this._lodPending || !camera || !this.group)
      return;

    this.group.getWorldPosition(this._lodWorldPos);
    const distance = camera.position.distanceTo(this._lodWorldPos);
    const worldRadius = Math.max(
      (this.group.userData['radius'] as number | undefined) ??
        this.config.radius * this._scaleFactor,
      1e-9
    );
    const normalizedDistance = Math.min(
      distance / worldRadius,
      maxNormalizedDistance
    );
    if (
      Math.abs(normalizedDistance - this.lastLODNormalizedDistance) < threshold
    ) {
      return;
    }

    this._lodPending = true;
    this.lastLODNormalizedDistance = normalizedDistance;

    try {
      for (const textureKey of Object.keys(this.config.textures ?? {})) {
        // Nuages réels actifs : le LOD ne remplace pas la couche `clouds` (l'image
        // satellite GIBS prime sur la texture statique versionnée).
        if (textureKey === 'clouds' && this._realCloudsActive) continue;
        const texture = await this.textureSystem.getLODTexture(
          this.name,
          textureKey,
          normalizedDistance
        );
        // Re-vérifie après l'await : les nuages réels ont pu s'activer pendant le
        // chargement d'un LOD `clouds` en vol → ne pas l'appliquer par-dessus.
        if (textureKey === 'clouds' && this._realCloudsActive) continue;
        if (this._appliedTextures.get(textureKey) === texture) continue;
        applyTexture(this.layers, textureKey, texture);
        this._bindCloudShadow(textureKey, texture);
        this._appliedTextures.set(textureKey, texture);
      }
      this._updateSurfaceTessellation(normalizedDistance);
      if (this.config.ring) await this._loadRingTexture(normalizedDistance);
    } catch {
      // Dégradation silencieuse : la dernière texture valide reste appliquée.
    } finally {
      this._lodPending = false;
    }
  }

  /**
   * Densifie la géométrie de surface au gros plan pour rendre le displacement
   * (relief géométrique) visible, et revient à la géométrie standard au loin.
   * N'agit que si le corps déclare une carte `displacement` — sinon rien à faire,
   * l'effet reste totalement inerte (aucun coût). Ne reconstruit la sphère que sur
   * transition de seuil (pas à chaque frame).
   */
  private _updateSurfaceTessellation(normalizedDistance: number): void {
    if (!this.config.textures?.displacement) return;
    const surface = this.layers.get('surface');
    if (!surface) return;

    const shouldBeHiRes =
      normalizedDistance <= HI_RES_TESSELLATION_THRESHOLD;
    if (shouldBeHiRes === this._hiResSurfaceActive) return;

    const segments = shouldBeHiRes
      ? GEOMETRY_SEGMENTS_HI
      : GEOMETRY_SEGMENTS;
    const next = createSphereGeometry(this.config.radius, 'surface', segments);
    surface.geometry.dispose();
    surface.geometry = next;
    this._hiResSurfaceActive = shouldBeHiRes;
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.animationSystem.removeUpdatable(this);
    this.layers.forEach((mesh) => {
      mesh.geometry?.dispose();
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      materials.forEach((material) => {
        // TextureSystem owns cached textures. Detach them here, but do not dispose
        // them per mesh: several materials may share one cached GPU resource.
        if (material instanceof THREE.MeshStandardMaterial) {
          material.map = null;
          material.normalMap = null;
          material.bumpMap = null;
          material.displacementMap = null;
          material.roughnessMap = null;
          material.alphaMap = null;
          material.emissiveMap = null;
          // Sampler custom de l'ombre nuageuse : détaché du cache partagé.
          const cloudShadow = getCloudShadowUniforms(material);
          if (cloudShadow) cloudShadow.map.value = null;
        }
        if (material instanceof THREE.ShaderMaterial) {
          const uniforms =
            material.uniforms as unknown as NightLightsShader.NightLightsUniforms;
          if (uniforms.lightsMap) uniforms.lightsMap.value = null;
        }
        material.dispose();
      });
    });
    this.layers.clear();
    Logger.warn(`[CelestialObject] Disposed "${this.name}"`);
  }
}
