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
import { allBodies, flattenBodies, texturePath } from '@/config/catalog';
import {
  assertSafeTexturePath,
  assertSafeTextureQuality,
} from '@/config/catalogValidation';
import { t } from '@/i18n';
import { bodyDisplayName } from '@/i18n/bodyText';
import Logger from '@/utils/Logger';

/** Données d'initialisation du TextureSystem (chemins, réglages par défaut, corps). */
export interface TextureQualityThreshold {
  distance: number;
  quality: string;
}

/** Pixel size represented by the quality suffix used by the local texture assets. */
const TEXTURE_QUALITY_PIXELS: Readonly<Record<string, number>> = {
  '1k': 1024,
  '2k': 2048,
  '4k': 4096,
  '8k': 8192,
};
function fitsMaxTextureSize(quality: string, maxTextureSize: number): boolean {
  return (
    (TEXTURE_QUALITY_PIXELS[quality] ?? Number.POSITIVE_INFINITY) <=
    maxTextureSize
  );
}
export function chooseTextureQuality(
  levels: readonly TextureQualityThreshold[],
  resolutions: readonly string[],
  normalizedDistance: number,
  maxTextureSize = Number.POSITIVE_INFINITY
): string {
  for (const level of levels) {
    if (
      normalizedDistance <= level.distance &&
      resolutions.includes(level.quality) &&
      fitsMaxTextureSize(level.quality, maxTextureSize)
    )
      return level.quality;
  }
  const supportedFallback = [...resolutions]
    .reverse()
    .find((quality) => fitsMaxTextureSize(quality, maxTextureSize));
  if (supportedFallback) return supportedFallback;
  return resolutions[resolutions.length - 1];
}

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

  // Renderer optionnel, branché après la création de la scène. Sert à uploader la texture
  // au GPU (initTexture) DÈS son décodage, hors de la boucle de rendu — sinon le premier
  // renderer.render() qui suit un changement de LOD paie l'upload synchrone (un pic de
  // frame-time = le micro-freeze ressenti au déplacement caméra). Absent avant le boot scène.
  private renderer: THREE.WebGLRenderer | null = null;
  // Limite materielle du contexte WebGL. Certains mobiles refusent les maps 4K alors que
  // le profil medium les autorise ; le LOD doit respecter la limite reelle du GPU.
  private maxTextureSize = Number.POSITIVE_INFINITY;

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
   * Branche le renderer une fois la scène créée, pour uploader les textures au GPU hors
   * de la boucle de rendu (cf. champ `renderer`). Appelé par `SolarSystemApp` après
   * `SceneSystem.init()`. Idempotent.
   */
  setRenderer(renderer: THREE.WebGLRenderer): void {
    this.renderer = renderer;
    this.maxTextureSize = renderer.capabilities.maxTextureSize;
  }

  /**
   * Charge une texture (ou la renvoie depuis le cache). Si un chargement du même fichier
   * est déjà en cours, renvoie la promesse existante au lieu d'en lancer un second.
   */
  async loadTexture(
    relativePath: string,
    quality: TextureQuality | string
  ): Promise<THREE.Texture> {
    assertSafeTexturePath(relativePath, 'TextureSystem asset path');
    assertSafeTextureQuality(String(quality), 'TextureSystem quality');
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
          // Upload GPU immédiat, hors boucle de rendu : sans ça, le premier render()
          // après un changement de LOD paie l'upload synchrone (pic de frame-time =
          // micro-freeze au déplacement caméra). initTexture décode + transfère la
          // texture maintenant, pendant qu'on est déjà hors du chemin critique.
          try {
            this.renderer?.initTexture(texture);
          } catch {
            // Contexte WebGL indisponible/perdu : on laisse le rendu faire l'upload.
          }
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
   * Précharge uniquement une surface légère par corps prioritaire. Les couches secondaires
   * et les hautes résolutions arrivent ensuite via le LOD, sans bloquer le premier rendu.
   */
  async preloadCriticalTextures(
    progressCallback: (percent: number, msg: string) => void = () => {}
  ): Promise<void> {
    const lowQuality = this.config.performance.textureQuality.low.quality;
    const preloadTasks = allBodies({ bodies: this.config.bodies })
      .filter(({ config }) => config.loadPriority !== undefined)
      .sort((a, b) => a.config.loadPriority! - b.config.loadPriority!)
      .flatMap(({ name: bodyName, config }) => {
        const resolutions = config.textureResolutions.surface;
        if (!resolutions?.length) return [];
        const textureBasePath =
          config.textures?.surface ?? texturePath(bodyName, 'surface');
        const quality = resolutions.includes(lowQuality)
          ? lowQuality
          : resolutions[resolutions.length - 1];
        return [{ bodyName, textureBasePath, quality }];
      });
    const total = preloadTasks.length;
    let loaded = 0;

    Logger.info(
      '[TextureSystem] Preloading ' + total + ' lightweight surface textures'
    );
    if (total === 0) {
      progressCallback(1, t('loader.texturesDone'));
      return;
    }

    for (const { bodyName, textureBasePath, quality } of preloadTasks) {
      progressCallback(
        loaded / total,
        t('loader.loadingBody', { body: bodyDisplayName(bodyName) })
      );
      try {
        await this.loadTexture(textureBasePath, quality);
      } catch {
        Logger.warn(
          '[TextureSystem] Failed preload: ' + textureBasePath + '_' + quality
        );
      }
      loaded++;
      progressCallback(
        loaded / total,
        t('loader.loadingBody', { body: bodyDisplayName(bodyName) })
      );
    }

    progressCallback(1, t('loader.texturesDone'));
    Logger.success('[TextureSystem] Lightweight surface textures loaded');
  }

  async getRingLODTexture(
    textureBasePath: string,
    resolutions: TextureQuality[],
    normalizedDistance: number
  ): Promise<THREE.Texture> {
    const chosenQuality = this._chooseQuality(
      normalizedDistance,
      resolutions
    ) as TextureQuality;
    return this.loadTexture(textureBasePath, chosenQuality);
  }

  /**
   * Palier de qualité (`ultra`/`high`/…) que servirait la couche `surface` d'un corps à cette
   * distance normalisée — SANS rien charger. Sert au LOD à ne relancer un chargement que lorsque
   * le palier CHANGE réellement (cf. hystérésis dans CelestialObject), au lieu de recharger à
   * chaque petit déplacement caméra. Renvoie une chaîne opaque (quelconque marqueur de palier).
   */
  resolveSurfaceQuality(bodyName: string, distance: number): string | null {
    const bodyConfig = this._resolveBodyConfig(bodyName);
    const resolutions = bodyConfig?.textureResolutions.surface;
    if (!resolutions?.length) return null;
    return this._chooseQuality(distance, resolutions);
  }

  /** Renvoie la texture d'un corps à la résolution adaptée à la distance caméra. */
  async getLODTexture(
    bodyName: string,
    textureKey: string,
    distance: number
  ): Promise<THREE.Texture> {
    const bodyConfig = this._resolveBodyConfig(bodyName);
    if (!bodyConfig) throw new Error(`Unknown body: ${bodyName}`);

    const resolutions =
      bodyConfig.textureResolutions[
        textureKey as keyof typeof bodyConfig.textureResolutions
      ];
    if (!resolutions) {
      throw new Error(
        `Texture key "${textureKey}" not found for body "${bodyName}"`
      );
    }
    const textureBasePath =
      bodyConfig.textures?.[textureKey as keyof typeof bodyConfig.textures] ??
      texturePath(bodyName, textureKey);

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
    return chooseTextureQuality(
      this._sortedQuality,
      resolutions,
      distance,
      this.maxTextureSize
    );
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
