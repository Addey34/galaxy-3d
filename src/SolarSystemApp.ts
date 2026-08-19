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
import { HorizonsEphemerisService } from './core/HorizonsEphemerisService';
import { FallbackPreciseEphemerisProvider } from './core/PreciseEphemerisProvider';
import { SpkKernelWorkerClient } from './core/SpkKernelWorkerClient';
import { SpkWorkerEphemerisProvider } from './core/SpkWorkerEphemerisProvider';
import { APP_SETTINGS, SPK_SETTINGS, TEXTURE_SETTINGS } from './config/engine';
import { CELESTIAL_CONFIG } from './config/bodies';
import { forEachBody } from './config/catalog';
import { t } from './i18n';
import Logger from './utils/Logger';

type ProgressCallback = (percent: number, message: string) => void;

function reportProgress(
  progressCallback: ProgressCallback,
  start: number,
  end: number,
  fraction: number,
  message: string
): void {
  const bounded = Math.min(1, Math.max(0, fraction));
  progressCallback(start + (end - start) * bounded, message);
}

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
  private _horizonsEphemeris: HorizonsEphemerisService | null = null;
  private _spkProvider: SpkWorkerEphemerisProvider | null = null;

  async init(progressCallback: ProgressCallback): Promise<PublicAPI> {
    if (this.initialized) {
      Logger.warn('[SolarSystemApp] init() called twice — ignored.');
      return this._publicAPI();
    }
    try {
      Logger.group('SolarSystemApp Init');
      progressCallback(5, t('loader.core'));
      await this._loadResources(progressCallback);
      this._initCoreSystems(progressCallback);

      progressCallback(65, t('loader.bodies'));
      const bodies = await this._getCelestialBodies(progressCallback);

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
    const manifestUrl = `${import.meta.env.BASE_URL}assets/ephemerides/manifest.json`;
    let textureProgress = 0;
    let ephemeridesReady = false;
    let lastTextureMessage = t('loader.core');
    const reportResourceProgress = (message = lastTextureMessage): void => {
      const combined = textureProgress * 0.75 + (ephemeridesReady ? 0.25 : 0);
      reportProgress(progressCallback, 8, 45, combined, message);
    };

    const texturePromise = this.systems.texture.preloadCriticalTextures(
      (percent, msg) => {
        textureProgress = percent;
        lastTextureMessage = msg;
        reportResourceProgress(msg);
      }
    );
    const horizonsPromise = HorizonsEphemerisService.load(manifestUrl).then(
      (horizons) => {
        ephemeridesReady = true;
        reportResourceProgress(t('loader.ephemerides'));
        return horizons;
      }
    );

    this._startOptionalSpk();

    const [, horizons] = await Promise.all([texturePromise, horizonsPromise]);
    this._horizonsEphemeris = horizons;
  }

  private _startOptionalSpk(): void {
    if (!SPK_SETTINGS.url) return;
    const provider = new SpkWorkerEphemerisProvider(
      new SpkKernelWorkerClient(),
      SPK_SETTINGS.bodyIds
    );
    this._spkProvider = provider;
    void provider
      .loadUrl(SPK_SETTINGS.url)
      .then(() => Logger.success('[SolarSystemApp] SPK provider ready'))
      .catch((error) => {
        Logger.warn(
          '[SolarSystemApp] SPK unavailable; keeping Horizons',
          error
        );
        provider.dispose();
        if (this._spkProvider === provider) this._spkProvider = null;
      });
  }
  private _initCoreSystems(progressCallback: ProgressCallback): void {
    progressCallback(45, t('loader.scene'));
    this.systems.scene = new SceneSystem(
      CELESTIAL_CONFIG,
      this.systems.texture!
    );
    this.systems.scene.init();
    // Le renderer existe désormais : le TextureSystem peut uploader les textures LOD au
    // GPU dès leur décodage (hors boucle de rendu), évitant les pics de frame-time.
    this.systems.texture!.setRenderer(this.systems.scene.renderer);

    progressCallback(60, t('loader.lighting'));
    this.systems.lighting.setup(this.systems.scene.scene);
    progressCallback(65, t('loader.lighting'));
  }

  private async _getCelestialBodies(
    progressCallback: ProgressCallback
  ): Promise<CelestialBodies> {
    if (this.bodyCache) return this.bodyCache;
    const factory = new CelestialObjectFactory(
      this.systems.texture!,
      CELESTIAL_CONFIG,
      this.systems.animation
    );
    this.bodyCache = await factory.createAll((percent, msg) => {
      reportProgress(progressCallback, 65, 82, percent, msg);
    });
    return this.bodyCache;
  }

  private _finalizeSetup(
    bodies: CelestialBodies,
    progressCallback: ProgressCallback
  ): void {
    progressCallback(84, t('loader.finalize'));

    this.systems.scene!.setupCelestialBodies(bodies);
    progressCallback(87, t('loader.finalize'));

    this.systems.camera.init(
      this.systems.scene!.camera,
      this.systems.scene!.renderer,
      bodies
    );
    progressCallback(90, t('loader.finalize'));

    this.systems.animation.init({
      scene: this.systems.scene!.scene,
      camera: this.systems.scene!.camera,
      renderer: this.systems.scene!.renderer,
      composer: this.systems.scene!.composer,
      starfield: this.systems.scene!.starfield,
      cameraSystem: this.systems.camera,
      celestialBodies: bodies,
    });
    progressCallback(93, t('loader.finalize'));

    // Créer les systèmes astronomiques
    this._ephemerisService = new EphemerisService();
    this._orbitalMechanics = new OrbitalMechanics(
      new SimulationClock(),
      this._ephemerisService,
      new OrbitalElementsService(),
      this._spkProvider
        ? new FallbackPreciseEphemerisProvider(
            this._spkProvider,
            this._horizonsEphemeris!
          )
        : this._horizonsEphemeris!,
      CELESTIAL_CONFIG,
      bodies
    );

    // Transition animée Éduc↔Explo : la taille visuelle de chaque corps morphe avec sa
    // position. Les lignes éducatives sont masquées dès que l'Exploration devient active.
    this._orbitalMechanics.onOrbitsChanged = () => {
      this._recomputeOrbits();
      this.systems.scene?.setOrbitLinesVisible(true);
      // Les orbites restent disponibles dans les deux modes ; le panneau Paramètres
      // permet de réduire la densité sans imposer une règle liée au mode d’échelle.
    };
    this._orbitalMechanics.onScaleMorph = (p) => {
      forEachBody(CELESTIAL_CONFIG, ({ name, config: cfg }) => {
        if (cfg.kind === 'skybox') return;
        this.bodyCache?.[name]?.setScaleMorph(p);
      });
    };
    this._orbitalMechanics.onMorphPhase = () => {
      this.systems.scene?.setOrbitLinesVisible(false);
    };
    this.systems.animation.setOrbitalMechanics(this._orbitalMechanics);

    // Positionner les planètes sur leurs positions réelles avant le premier rendu
    this._orbitalMechanics.syncAnglesFromEphemeris(
      this._orbitalMechanics.simulationDate
    );
    forEachBody(CELESTIAL_CONFIG, ({ name, config: cfg }) => {
      if (cfg.kind !== 'skybox') bodies[name]?.setScaleMode('educ');
    });
    this._recomputeOrbits();
    // Synchronise _orbitsGloballyVisible avec l'état réel des lignes (educ au démarrage).
    // Sans cet appel, le flag reste false alors que les lignes THREE.Line sont visibles
    // par défaut, ce qui casse le toggle master OFF→ON avant le premier changement de mode.
    this.systems.scene?.setOrbitLinesVisible(true);

    progressCallback(98, t('loader.starting'));
    this.systems.animation.run();
  }

  /** Recalcule le cercle éducatif ou la trajectoire réelle du mode courant. */
  private _recomputeOrbits(): void {
    const om = this._orbitalMechanics!;
    const scene = this.systems.scene!;
    const bodies = this.bodyCache!;
    const date = om.simulationDate;
    const mode = om.scaleMode;

    forEachBody(CELESTIAL_CONFIG, ({ name, config: cfg }) => {
      if (cfg.kind === 'skybox') return;
      bodies[name]?.setScaleMode(mode);
      if (cfg.kind === 'star') return;
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
    this._spkProvider?.dispose();
    this._spkProvider = null;
    this.bodyCache = null;
    this.initialized = false;
    Logger.success('Cleanup complete.');
  }
}
