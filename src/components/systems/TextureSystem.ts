/**
 * Chargement, cache et sélection de résolution (LOD) des textures.
 *
 * Singleton partagé par toute l'application : le cache et la déduplication des requêtes
 * en vol garantissent qu'un même fichier n'est jamais téléchargé ni décodé deux fois.
 * `getLODTexture` choisit la résolution selon la distance caméra (plafonnée sur mobile).
 */
import * as THREE from 'three';
import type { CelestialBodyConfig, TextureQuality } from '@/types';
import type {
  PerformanceSettings,
  TextureDefaultSettings,
} from '@/config/engine';
import { allBodies, flattenBodies } from '@/config/catalog';
import Logger from '@/utils/Logger';

/** Données d'initialisation du TextureSystem (chemins, réglages par défaut, corps). */
export interface TextureSystemConfig {
  basePath: string;
  defaultSettings: TextureDefaultSettings;
  bodies: Record<string, CelestialBodyConfig>;
  performance: PerformanceSettings;
}

/**
 * Singleton : une seule instance partagée par toute l'application.
 * Cela garantit qu'une même texture (ex. earthSurface_8k.jpg) n'est jamais
 * chargée deux fois, même si CelestialObject et updateLODTextures la demandent
 * simultanément — la Map `loadingPromises` déduplique les requêtes en vol.
 */
export class TextureSystem {
  static #instance: TextureSystem | undefined;

  private readonly textureLoader = new THREE.TextureLoader();
  private readonly config: TextureSystemConfig;
  private readonly cache = new Map<string, THREE.Texture>();
  private readonly loadingPromises = new Map<string, Promise<THREE.Texture>>();

  // Table nom → config (satellites inclus), construite une fois — évite un scan linéaire à chaque LOD.
  private readonly _bodyByName: Map<string, CelestialBodyConfig>;

  // Niveaux de qualité triés par distance croissante, calculés une fois au démarrage
  // puis réutilisés à chaque sélection LOD (_chooseQuality).
  private readonly _sortedQuality: { distance: number; quality: string }[];

  private constructor(config: TextureSystemConfig) {
    this.config = config;
    this._bodyByName = flattenBodies({ bodies: config.bodies });
    this._sortedQuality = (
      Object.values(config.performance.textureQuality) as {
        distance: number;
        quality: string;
      }[]
    ).sort((a, b) => a.distance - b.distance);
    Logger.info('[TextureSystem] Instance created ✅');
  }

  static getInstance(config: TextureSystemConfig): TextureSystem {
    if (!TextureSystem.#instance) {
      TextureSystem.#instance = new TextureSystem(config);
    }
    return TextureSystem.#instance;
  }

  /**
   * Charge une texture (ou la renvoie depuis le cache). Si un chargement du même fichier
   * est déjà en cours, renvoie la promesse existante au lieu d'en lancer un second.
   */
  async loadTexture(
    relativePath: string,
    quality: TextureQuality | string
  ): Promise<THREE.Texture> {
    const fullPath = `${this.config.basePath}${relativePath}_${quality}.jpg`;

    const cached = this.cache.get(fullPath);
    if (cached) {
      Logger.debug(`[TextureSystem] Cache hit: ${fullPath}`);
      return cached;
    }

    // Si un chargement est déjà en cours pour ce chemin, on retourne la même promesse
    // plutôt que de démarrer un second fetch parallèle vers le même fichier.
    const existing = this.loadingPromises.get(fullPath);
    if (existing) return existing;

    Logger.debug(`[TextureSystem] Loading: ${fullPath}`);

    const promise = new Promise<THREE.Texture>((resolve, reject) => {
      this.textureLoader.load(
        fullPath,
        (texture) => {
          Logger.success(`[TextureSystem] Loaded: ${fullPath}`);
          const settings = this.config.defaultSettings;
          (Object.keys(settings) as (keyof TextureDefaultSettings)[]).forEach(
            (key) => {
              (texture as unknown as Record<string, unknown>)[key] =
                settings[key];
            }
          );
          texture.needsUpdate = true;
          this.cache.set(fullPath, texture);
          this.loadingPromises.delete(fullPath);
          resolve(texture);
        },
        undefined,
        (err) => {
          Logger.warn(`[TextureSystem] Failed: ${fullPath}`, err);
          this.loadingPromises.delete(fullPath);
          reject(err);
        }
      );
    });

    this.loadingPromises.set(fullPath, promise);
    return promise;
  }

  /**
   * Précharge la meilleure résolution des corps prioritaires (cf. `loadPriority`) au
   * démarrage, en remontant la progression (0→1) pour l'écran de chargement.
   */
  async preloadCriticalTextures(
    progressCallback: (percent: number, msg: string) => void = () => {}
  ): Promise<void> {
    // Corps à précharger : ceux qui déclarent un loadPriority, dans l'ordre croissant.
    const priorityList = allBodies({ bodies: this.config.bodies })
      .filter((e) => e.config.loadPriority !== undefined)
      .sort((a, b) => a.config.loadPriority! - b.config.loadPriority!);
    const total = priorityList.length;
    let loaded = 0;

    Logger.info(`[TextureSystem] Preloading ${total} priority bodies`);

    for (const { name: bodyName, config: bodyConfig } of priorityList) {
      const textureKeys = Object.keys(
        bodyConfig.textures
      ) as (keyof typeof bodyConfig.textures)[];
      for (const key of textureKeys) {
        const textureBasePath = bodyConfig.textures[key];
        const resolutions = bodyConfig.textureResolutions[key];
        if (!textureBasePath || !resolutions?.length) continue;

        const bestQuality = resolutions[0];
        progressCallback(
          loaded / total,
          `Loading ${bodyName} ${key} (${bestQuality})`
        );

        try {
          await this.loadTexture(textureBasePath, bestQuality);
        } catch {
          Logger.warn(
            `[TextureSystem] Failed preload: ${textureBasePath}_${bestQuality}`
          );
        }
      }

      loaded++;
      progressCallback(loaded / total, `Loaded ${bodyName}`);
    }

    progressCallback(1, 'All critical textures loaded');
    Logger.success('[TextureSystem] Priority textures loaded');
  }

  /** Renvoie la texture d'un corps à la résolution adaptée à la distance caméra. */
  async getLODTexture(
    bodyName: string,
    textureKey: string,
    distance: number
  ): Promise<THREE.Texture> {
    const bodyConfig = this._resolveBodyConfig(bodyName);
    if (!bodyConfig) throw new Error(`Unknown body: ${bodyName}`);

    const textureBasePath =
      bodyConfig.textures[textureKey as keyof typeof bodyConfig.textures];
    const resolutions =
      bodyConfig.textureResolutions[
        textureKey as keyof typeof bodyConfig.textureResolutions
      ];
    if (!textureBasePath || !resolutions) {
      throw new Error(
        `Texture key "${textureKey}" not found for body "${bodyName}"`
      );
    }

    const chosenQuality = this._chooseQuality(distance, resolutions);
    Logger.debug(
      `[TextureSystem] LOD ${bodyName}:${textureKey} -> ${chosenQuality} (dist: ${distance.toFixed(1)})`
    );
    return this.loadTexture(textureBasePath, chosenQuality);
  }

  private _resolveBodyConfig(
    bodyName: string
  ): CelestialBodyConfig | undefined {
    return this._bodyByName.get(bodyName);
  }

  private _chooseQuality(distance: number, resolutions: string[]): string {
    for (const level of this._sortedQuality) {
      if (distance <= level.distance && resolutions.includes(level.quality)) {
        return level.quality;
      }
    }
    return resolutions[resolutions.length - 1];
  }

  dispose(): void {
    Logger.warn('[TextureSystem] Disposing textures cache...');
    this.cache.forEach((texture) => texture.dispose());
    this.cache.clear();
    this.loadingPromises.clear();
    // Réinitialise le singleton pour autoriser une nouvelle instance après dispose
    TextureSystem.#instance = undefined;
    Logger.success('[TextureSystem] Cleanup complete');
  }
}
