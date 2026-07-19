import CelestialObjectFactory from './components/celestial/CelestialObjectFactory';
import { AnimationSystem } from './components/systems/AnimationSystem';
import { CameraSystem } from './components/systems/CameraSystem';
import { LightingSystem } from './components/systems/LightingSystem';
import { SceneSystem } from './components/systems/SceneSystem';
import type { CelestialBodies } from './components/systems/SceneSystem';
import { TextureSystem } from './components/systems/TextureSystem';
import type { TextureSystemConfig } from './components/systems/TextureSystem';
import { SimulationClock } from './core/SimulationClock';
import { EphemerisService } from './core/EphemerisService';
import { OrbitalElementsService } from './core/OrbitalElementsService';
import { OrbitalMechanics } from './core/OrbitalMechanics';
import { APP_SETTINGS, TEXTURE_SETTINGS } from './config/engine';
import { CELESTIAL_CONFIG } from './config/bodies';
import { forEachBody } from './config/catalog';
import { SMALL_BODY_KINDS } from './types';
import Logger from './utils/Logger';

type ProgressCallback = (percent: number, message: string) => void;

/** Surface publique renvoyée par `init()` : ce que la couche UI (MainSolarSystemApp) pilote. */
export interface PublicAPI {
  sceneSystem: SceneSystem;
  animationSystem: AnimationSystem;
  cameraSystem: CameraSystem;
  orbitalMechanics: OrbitalMechanics;
  cleanup: () => void;
}

/**
 * Façade de l'application : orchestre l'initialisation de tous les systèmes dans l'ordre
 * (textures → scène → lumières → corps → caméra → astronomie → boucle de rendu), en
 * remontant la progression via un callback, puis expose une `PublicAPI` à l'UI.
 */
export class SolarSystemApp {
  // bodyCache évite de recréer les CelestialObject si init() était appelé deux fois
  // (guard initialized) ou si _getCelestialBodies() est appelé en interne plusieurs fois.
  private bodyCache: CelestialBodies | null = null;
  private initialized = false;

  private readonly systems = {
    texture: null as TextureSystem | null,
    scene: null as SceneSystem | null,
    lighting: new LightingSystem(),
    camera: new CameraSystem(),
    animation: new AnimationSystem(APP_SETTINGS.performance.targetFPS),
  };

  // Conservés pour le callback de recomputation des orbites
  private _orbitalMechanics: OrbitalMechanics | null = null;
  private _ephemerisService: EphemerisService | null = null;

  async init(progressCallback: ProgressCallback): Promise<PublicAPI> {
    if (this.initialized) {
      Logger.warn('[SolarSystemApp] init() called twice — ignored.');
      return this._publicAPI();
    }
    try {
      Logger.group('SolarSystemApp Init');
      await this._loadResources(progressCallback);
      this._initCoreSystems(progressCallback);

      progressCallback(75, 'Creating celestial bodies...');
      const bodies = await this._getCelestialBodies();

      this._finalizeSetup(bodies, progressCallback);
      this.initialized = true;

      Logger.success('Solar System successfully initialized ✅');
      Logger.groupEnd();
      return this._publicAPI();
    } catch (error) {
      Logger.error('❌ SolarSystemApp failed to initialize:', error);
      this.dispose();
      throw error;
    }
  }

  private async _loadResources(
    progressCallback: ProgressCallback
  ): Promise<void> {
    const config: TextureSystemConfig = {
      basePath: TEXTURE_SETTINGS.basePath,
      defaultSettings: TEXTURE_SETTINGS.defaultSettings,
      bodies: CELESTIAL_CONFIG.bodies,
      performance: APP_SETTINGS.performance,
    };
    this.systems.texture = TextureSystem.getInstance(config);
    await this.systems.texture.preloadCriticalTextures((percent, msg) => {
      progressCallback(percent * 0.4, msg);
    });
  }

  private _initCoreSystems(progressCallback: ProgressCallback): void {
    progressCallback(45, 'Building scene...');
    this.systems.scene = new SceneSystem(
      CELESTIAL_CONFIG,
      this.systems.texture!
    );
    this.systems.scene.init();

    progressCallback(60, 'Setting up lighting...');
    this.systems.lighting.setup(this.systems.scene.scene);
  }

  private async _getCelestialBodies(): Promise<CelestialBodies> {
    if (this.bodyCache) return this.bodyCache;
    const factory = new CelestialObjectFactory(
      this.systems.texture!,
      CELESTIAL_CONFIG,
      this.systems.animation
    );
    this.bodyCache = await factory.createAll();
    return this.bodyCache;
  }

  private _finalizeSetup(
    bodies: CelestialBodies,
    progressCallback: ProgressCallback
  ): void {
    progressCallback(85, 'Finalizing...');

    this.systems.scene!.setupCelestialBodies(bodies);

    this.systems.camera.init(
      this.systems.scene!.camera,
      this.systems.scene!.renderer,
      bodies,
      this.systems.scene!
    );

    this.systems.animation.init({
      scene: this.systems.scene!.scene,
      camera: this.systems.scene!.camera,
      renderer: this.systems.scene!.renderer,
      cameraSystem: this.systems.camera,
      celestialBodies: bodies,
    });

    // Créer les systèmes astronomiques
    this._ephemerisService = new EphemerisService();
    this._orbitalMechanics = new OrbitalMechanics(
      new SimulationClock(),
      this._ephemerisService,
      new OrbitalElementsService(),
      CELESTIAL_CONFIG,
      bodies
    );

    // Callback : recalcul des orbites à chaque changement de mode ou de date
    this._orbitalMechanics.onOrbitsChanged = () => {
      this._recomputeOrbits();
    };

    this.systems.animation.setOrbitalMechanics(this._orbitalMechanics);

    // Positionner les planètes sur leurs positions réelles avant le premier rendu
    this._orbitalMechanics.syncAnglesFromEphemeris(
      this._orbitalMechanics.simulationDate
    );
    this._recomputeOrbits();

    progressCallback(95, 'Starting...');
    this.systems.animation.run();
  }

  /** Calcule les points d'orbite 3D pour tous les corps et les envoie à SceneSystem.
   *  Met aussi à jour la taille visuelle des planètes selon le mode courant. */
  private _recomputeOrbits(): void {
    const om = this._orbitalMechanics!;
    const scene = this.systems.scene!;
    const bodies = this.bodyCache!;
    const date = om.simulationDate;
    const mode = om.scaleMode; // 'educ' | 'explo'

    forEachBody(CELESTIAL_CONFIG, ({ name, config: cfg }) => {
      if (cfg.kind === 'skybox') return; // la skybox n'est pas un CelestialObject

      bodies[name]?.setScaleMode(mode);

      if (cfg.kind === 'star') return; // l'étoile centrale reste à l'origine (pas d'orbite)

      // Les petits corps (astéroïdes, comètes, planètes naines) n'ont pas de mesh 3D et
      // ne vivent que dans la couche instrument (overlay 2D + labels). Leur calculer une
      // ligne d'orbite dessinerait une orbite « sans planète » (cf. SceneSystem.addBody).
      if (SMALL_BODY_KINDS.has(cfg.kind)) return;

      const points = om.computeOrbitPoints(name, cfg, date);
      if (points) scene.setOrbitPoints(name, points);
    });

    scene.applyOrbitPoints();
  }

  private _publicAPI(): PublicAPI {
    return {
      sceneSystem: this.systems.scene!,
      animationSystem: this.systems.animation,
      cameraSystem: this.systems.camera,
      orbitalMechanics: this._orbitalMechanics!,
      cleanup: () => this.dispose(),
    };
  }

  dispose(): void {
    this.systems.animation.dispose();
    this.systems.camera.dispose();
    this.systems.lighting.dispose();
    this.systems.scene?.dispose();
    this.systems.texture?.dispose();
    this.bodyCache = null;
    this.initialized = false;
    Logger.success('Cleanup complete.');
  }
}
