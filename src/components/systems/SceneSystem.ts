/**
 * Socle de rendu Three.js : possède la scène, la caméra perspective, le WebGLRenderer
 * et le fond étoilé. Construit aussi la hiérarchie de transformation des corps et les lignes
 * d'orbite disponibles dans les deux modes.
 */
import * as THREE from 'three';
// Chargées dynamiquement dans setupPostProcessing : le bloom est désactivé sur les paliers
// low/medium (la majorité du parc mobile — cf. BOOT_QUALITY_PROFILE), un import statique
// embarquerait ces modules dans le bundle initial pour des appareils qui ne les utilisent
// jamais. Seul le TYPE est importé ici (effacé à la compilation, aucun poids runtime).
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import {
  BLOOM_SETTINGS,
  CAMERA_SETTINGS,
  RENDER_SETTINGS,
  currentMaxPixelRatio,
} from '@/config/engine';
import { educRadius } from '@/core/ScaleService';
import type { CelestialBodyConfig, CelestialConfig } from '@/types';
import Logger from '@/utils/Logger';
import { Starfield } from '@/components/celestial/Starfield';
import type { TextureSystem } from './TextureSystem';
import type CelestialObject from '@/components/celestial/CelestialObject';

/** Table nom → corps céleste, partagée entre les systèmes. */
export type CelestialBodies = Record<string, CelestialObject>;

export class SceneSystem {
  readonly scene = new THREE.Scene();
  readonly orbitGroups: Record<string, THREE.Group> = {};

  camera!: THREE.PerspectiveCamera;
  renderer!: THREE.WebGLRenderer;
  /** Composer de post-process (bloom) ; null si désactivé (mobile). */
  composer: EffectComposer | null = null;

  /** Champ d'étoiles procédural (points ronds) superposé au fond Voie lactée. */
  private _starfield: Starfield | null = null;

  /**
   * Callbacks optionnels câblés par la couche UI (voir `src/ui/contextRecovery.ts`) : le
   * GPU peut reprendre le contexte WebGL à tout moment (onglet en arrière-plan sur mobile,
   * reset driver, trop de contextes ouverts) — sans `preventDefault()` sur `webglcontextlost`,
   * le navigateur ne tente même pas de le restaurer.
   */
  onContextLost: (() => void) | null = null;
  onContextRestored: (() => void) | null = null;

  /** Champ d'étoiles procédural, pour que la boucle d'animation le suive à la caméra. */
  get starfield(): Starfield | null {
    return this._starfield;
  }

  private readonly _orbitLines = new Map<string, THREE.Line>();
  private readonly _orbitPts = new Map<string, Float32Array>();
  private _orbitsGloballyVisible = false;
  private _orbitMasterEnabled = true;
  private readonly _orbitHidden = new Set<string>();

  /** Table des corps, conservée pour exposer leurs positions monde (HUD explo). */
  private _celestialBodies: CelestialBodies = {};
  private readonly _tmpWorldPos = new THREE.Vector3();

  private readonly targetObject = new THREE.Object3D();
  private readonly disposeFunctions: Array<() => void> = [];

  constructor(
    private readonly config: CelestialConfig,
    private readonly textureSystem: TextureSystem
  ) {
    this.targetObject.name = 'mainTarget';
    this.scene.add(this.targetObject);
    Logger.info('[SceneSystem] Scene instance created ✅');
  }

  async init(): Promise<this> {
    this.setupCamera();
    this.setupRenderer();
    // Le TextureSystem doit connaître les capacités WebGL avant tout chargement de texture.
    this.textureSystem.setRenderer(this.renderer);
    await this.setupPostProcessing();
    this.setupStarfield();
    this.setupEventListeners();
    return this;
  }

  /**
   * Chaîne de post-process : rendu de base → bloom (seuil élevé = seules les
   * sources très lumineuses bavent : Soleil + lumières de ville) → OutputPass
   * (tone mapping + conversion sRGB en fin de chaîne). Désactivé sur mobile.
   * Modules chargés à la demande (cf. l'import de type en tête de fichier) : les
   * appareils au palier low/medium ne téléchargent jamais le code du bloom.
   */
  private async setupPostProcessing(): Promise<void> {
    if (!BLOOM_SETTINGS.enabled) return;

    const [
      { EffectComposer },
      { RenderPass },
      { UnrealBloomPass },
      { OutputPass },
    ] = await Promise.all([
      import('three/examples/jsm/postprocessing/EffectComposer.js'),
      import('three/examples/jsm/postprocessing/RenderPass.js'),
      import('three/examples/jsm/postprocessing/UnrealBloomPass.js'),
      import('three/examples/jsm/postprocessing/OutputPass.js'),
    ]);

    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));

    const size = this.renderer.getSize(new THREE.Vector2());
    const bloom = new UnrealBloomPass(
      size,
      BLOOM_SETTINGS.strength,
      BLOOM_SETTINGS.radius,
      BLOOM_SETTINGS.threshold
    );
    composer.addPass(bloom);
    // OutputPass reprend le tone mapping du renderer : sans lui, EffectComposer
    // shunte le tone mapping/sRGB câblé sur le renderer et l'image sort délavée.
    composer.addPass(new OutputPass());
    composer.setPixelRatio(this.renderer.getPixelRatio());

    this.composer = composer;
  }

  private setupCamera(): void {
    this.camera = new THREE.PerspectiveCamera(
      CAMERA_SETTINGS.fov,
      window.innerWidth / window.innerHeight,
      CAMERA_SETTINGS.educNear,
      CAMERA_SETTINGS.educFar
    );
    this.camera.position.copy(CAMERA_SETTINGS.initialPosition);
    this.camera.lookAt(this.targetObject.position);
  }

  private setupRenderer(): void {
    this.renderer = new THREE.WebGLRenderer({
      antialias: RENDER_SETTINGS.antialias,
      powerPreference: RENDER_SETTINGS.powerPreference,
      preserveDrawingBuffer: RENDER_SETTINGS.preserveDrawingBuffer,
    });
    const pixelRatio = Math.min(
      window.devicePixelRatio,
      currentMaxPixelRatio()
    );
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = RENDER_SETTINGS.shadowMap.enabled;
    this.renderer.shadowMap.type = RENDER_SETTINGS.shadowMap.type;
    this.renderer.toneMapping = RENDER_SETTINGS.toneMapping;
    this.renderer.toneMappingExposure = RENDER_SETTINGS.toneMappingExposure;
    // Coût nul hors session XR (flag dormant) — active la prise en charge WebXR pour
    // ui/webxr.ts. La stéréo passe par renderer.render() direct, pas par l'EffectComposer
    // (bloom) : aucun chemin multiview-aware dans cette version de Three.js.
    this.renderer.xr.enabled = true;
    document.body.appendChild(this.renderer.domElement);
  }

  private setupStarfield(): void {
    // Le fond de ciel passe par le même LOD que les autres textures : le profil mobile
    // et la limite WebGL réelle sont appliqués avant de lancer le chargement.
    const starsName =
      Object.entries(this.config.bodies).find(
        ([, cfg]) => cfg.kind === 'skybox'
      )?.[0] ?? 'stars';
    this.textureSystem
      .getLODTexture(starsName, 'surface', 0)
      .then((tex) => {
        // Fond équirectangulaire posé en `scene.background` plutôt qu'une sphère mesh :
        // un décor à l'infini, insensible aux plans near/far. L'ancienne sphère de rayon
        // 10000 était entièrement au-delà du far Explo (3000) → ciel noir en Exploration.
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        // Adoucit les étoiles « en blocs » du fond équirectangulaire : sans
        // filtrage trilinéaire + anisotropie, une étoile d'un pixel projetée sur
        // la sphère céleste apparaît comme un carré dur. Filtrage linéaire (min +
        // mag) + mipmaps + anisotropie maximale du GPU → les points deviennent
        // ronds et flous plutôt que carrés, surtout au ras de l'horizon céleste
        // où l'échantillonnage est le plus étiré.
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearMipMapLinearFilter;
        tex.generateMipmaps = true;
        tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        tex.needsUpdate = true;
        this.scene.background = tex;
        // Rehausse la bande galactique (texture source très sombre) ; le cœur le
        // plus brillant nourrit le bloom pour un ciel vivant.
        this.scene.backgroundIntensity = RENDER_SETTINGS.backgroundIntensity;
      })
      .catch((err) =>
        Logger.warn('[SceneSystem] Starfield texture failed', err)
      );

    // Vraies étoiles ponctuelles (points ronds) par-dessus la Voie lactée de fond :
    // nettes et rondes, indépendantes de la compression JPEG du fond.
    this._starfield = new Starfield();
    this.scene.add(this._starfield.points);
  }

  /**
   * Ré-applique À CHAUD les leviers de qualité ajustables sans recréer le renderer : le
   * plafond de pixel ratio (impact #1 sur la fluidité — divise le nombre de pixels rendus).
   * Antialiasing et anisotropie, figés à la création du renderer/des textures, ne changent
   * qu'au prochain chargement (l'UI le signale). Appelé par le sélecteur de qualité.
   */
  applyQualityLive(): void {
    const pixelRatio = Math.min(window.devicePixelRatio, currentMaxPixelRatio());
    this.renderer.setPixelRatio(pixelRatio);
    if (this.composer) this.composer.setPixelRatio(pixelRatio);
  }

  private setupEventListeners(): void {
    const onResize = (): void => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      // Ré-applique le plafond de pixel ratio : franchir le seuil mobile (768px)
      // par redimensionnement bascule 2 ↔ 1.5 sans recréer le renderer.
      const pixelRatio = Math.min(
        window.devicePixelRatio,
        currentMaxPixelRatio()
      );
      this.renderer.setPixelRatio(pixelRatio);
      if (this.composer) {
        this.composer.setSize(window.innerWidth, window.innerHeight);
        this.composer.setPixelRatio(pixelRatio);
      }
    };
    window.addEventListener('resize', onResize, { passive: true });
    this.disposeFunctions.push(() =>
      window.removeEventListener('resize', onResize)
    );

    const onContextLost = (event: Event): void => {
      // Sans preventDefault(), la perte est définitive : le navigateur ne relance jamais
      // 'webglcontextrestored'. Three.js (r176+) recrée textures/géométries/matériaux à
      // la volée au prochain render() une fois le contexte restauré ; rien d'autre à refaire ici.
      event.preventDefault();
      Logger.warn('[SceneSystem] WebGL context lost');
      this.onContextLost?.();
    };
    const onContextRestored = (): void => {
      Logger.success('[SceneSystem] WebGL context restored');
      this.onContextRestored?.();
    };
    this.renderer.domElement.addEventListener(
      'webglcontextlost',
      onContextLost,
      false
    );
    this.renderer.domElement.addEventListener(
      'webglcontextrestored',
      onContextRestored,
      false
    );
    this.disposeFunctions.push(() => {
      this.renderer.domElement.removeEventListener(
        'webglcontextlost',
        onContextLost
      );
      this.renderer.domElement.removeEventListener(
        'webglcontextrestored',
        onContextRestored
      );
    });
  }

  setupCelestialBodies(celestialBodies: CelestialBodies): void {
    this._celestialBodies = celestialBodies;
    const addBody = (
      name: string,
      config: CelestialBodyConfig,
      parentGroup: THREE.Group | null = null
    ): void => {
      const body = celestialBodies[name];
      if (!body) {
        Logger.warn(`[SceneSystem] Body "${name}" not found`);
        return;
      }

      body.group.updateMatrixWorld(true);
      // Position initiale placeholder — OrbitalMechanics l'écrase au premier frame (educ comme explo).
      // Dérivée de distanceAU (échelle éducatif √-compressée) si disponible, sinon origine.
      const initR =
        config.realData?.distanceAU != null
          ? educRadius(config.realData.distanceAU)
          : 0;
      body.group.position.set(initR, 0, 0);

      const orbitGroup = new THREE.Group();
      orbitGroup.name = `orbit_${name}`;
      orbitGroup.add(body.group);
      this.orbitGroups[name] = orbitGroup;
      // Les orbites éducatives couvrent tous les corps, y compris les planètes naines texturées
      // et les petits corps sans mesh. Elles servent de repère global dans les deux modes.
      orbitGroup.add(this.createOrbitVisual(name, config.orbitalColor));
      if (parentGroup) {
        parentGroup.add(orbitGroup);
      } else {
        this.scene.add(orbitGroup);
      }

      if (config.satellites) {
        Object.entries(config.satellites).forEach(([satName, satConfig]) => {
          addBody(satName, satConfig, body.group);
        });
      }
    };

    // L'étoile centrale est la racine ; les planètes vivent dans son groupe (leurs
    // satellites y sont ajoutés par récursion via addBody). La skybox n'est pas un corps.
    const starEntry = Object.entries(this.config.bodies).find(
      ([, cfg]) => cfg.kind === 'star'
    );
    let starGroup: THREE.Group | null = null;
    if (starEntry) {
      addBody(starEntry[0], starEntry[1]);
      starGroup = celestialBodies[starEntry[0]]?.group ?? null;
    }

    // Tous les corps héliocentriques (planètes ET petits corps) vivent dans le groupe de
    // l'étoile ; seules l'étoile (racine) et la skybox sont exclues. Leurs satellites sont
    // ajoutés par récursion via addBody.
    Object.entries(this.config.bodies)
      .filter(([, cfg]) => cfg.kind !== 'star' && cfg.kind !== 'skybox')
      .forEach(([name, config]) => addBody(name, config, starGroup));

    Logger.success('[SceneSystem] Celestial bodies added to scene');
  }

  /**
   * Applique `cb` à chaque corps navigable (hors skybox) avec sa position monde à jour.
   * Le vecteur passé est réutilisé entre les appels — le copier si on veut le conserver.
   */
  forEachBodyWorldPosition(
    cb: (name: string, worldPos: THREE.Vector3) => void
  ): void {
    for (const [name, body] of Object.entries(this._celestialBodies)) {
      if (!body.group || this.config.bodies[name]?.kind === 'skybox') continue;
      body.group.getWorldPosition(this._tmpWorldPos);
      cb(name, this._tmpWorldPos);
    }
  }

  /** Renvoie l'objet céleste par nom (ou undefined). Accès ciblé pour l'UI. */
  getBody(name: string): CelestialObject | undefined {
    return this._celestialBodies[name];
  }

  private createOrbitVisual(bodyName: string, color: number): THREE.Line {
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.25,
      // The orbit must disappear behind opaque celestial surfaces.
      depthTest: true,
      depthWrite: false,
    });
    const line = new THREE.Line(geometry, material);
    line.renderOrder = 3;
    line.frustumCulled = false;
    this._orbitLines.set(bodyName, line);
    return line;
  }

  setOrbitPoints(bodyName: string, points: Float32Array): void {
    this._orbitPts.set(bodyName, points);
  }

  setOrbitLinesVisible(visible: boolean): void {
    this._orbitsGloballyVisible = visible;
    const base = visible && this._orbitMasterEnabled;
    for (const [name, line] of this._orbitLines) {
      line.visible = base && !this._orbitHidden.has(name);
    }
  }

  /** Bascule globale (bouton ON/OFF du panneau Orbites). Persiste à travers educ↔explo. */
  setOrbitMasterEnabled(enabled: boolean): void {
    this._orbitMasterEnabled = enabled;
    const base = this._orbitsGloballyVisible && enabled;
    for (const [name, line] of this._orbitLines) {
      line.visible = base && !this._orbitHidden.has(name);
    }
  }

  setBodyOrbitVisible(name: string, visible: boolean): void {
    if (visible) this._orbitHidden.delete(name);
    else this._orbitHidden.add(name);
    const line = this._orbitLines.get(name);
    if (line)
      line.visible =
        this._orbitsGloballyVisible && this._orbitMasterEnabled && visible;
  }

  /** Noms de tous les corps dotés d'une ligne d'orbite (planètes, naines, lunes, petits corps). */
  orbitBodyNames(): string[] {
    return [...this._orbitLines.keys()];
  }

  applyOrbitPoints(): void {
    for (const [bodyName, line] of this._orbitLines) {
      const points = this._orbitPts.get(bodyName);
      if (!points) continue;
      const previousGeometry = line.geometry;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
      geometry.computeBoundingSphere();
      line.geometry = geometry;
      previousGeometry.dispose();
    }
  }

  dispose(): void {
    Object.values(this._celestialBodies).forEach((body) => body.dispose());
    this._celestialBodies = {};
    Object.values(this.orbitGroups).forEach((group) => {
      group.traverse((child) => {
        if (child instanceof THREE.Line) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
    });
    this.disposeFunctions.forEach((fn) => fn());
    this._starfield?.dispose();
    this.composer?.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    Logger.warn('[SceneSystem] Disposed');
  }
}
