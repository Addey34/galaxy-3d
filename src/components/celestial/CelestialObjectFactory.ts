/**
 * Fabrique qui lit `CELESTIAL_CONFIG` et instancie tous les `CelestialObject`.
 * Parcourt la hiérarchie (les satellites sont imbriqués sous leur planète) et renvoie
 * une table plate nom → corps. Les créations sont parallélisées (chargement de textures).
 */
import type { CelestialBodyConfig, CelestialConfig } from '../../types';
import Logger from '../../utils/Logger';
import type { AnimationSystem } from '../systems/AnimationSystem';
import type { TextureSystem } from '../systems/TextureSystem';
import type { CelestialBodies } from '../systems/SceneSystem';
import CelestialObject from './CelestialObject';

export default class CelestialObjectFactory {
  // Évite de créer deux fois le même CelestialObject si _createBodyWithHierarchy
  // est appelé en parallèle sur le même nom (ex. un satellite référencé par deux parents).
  private readonly classCache = new Map<string, CelestialObject>();

  constructor(
    private readonly textureSystem: TextureSystem,
    private readonly objectConfig: CelestialConfig,
    private readonly animationSystem: AnimationSystem
  ) {}

  /** Crée tous les corps (hors fond étoilé) et renvoie la table nom → corps. */
  async createAll(): Promise<CelestialBodies> {
    const bodies: CelestialBodies = {};
    Logger.info('[CelestialObjectFactory] Creating all celestial bodies...');

    const promises = Object.entries(this.objectConfig.bodies)
      .filter(([name]) => name !== 'stars')
      .map(([name, config]) => this._createBodyWithHierarchy(name, config, null, bodies));

    await Promise.all(promises);
    Logger.success('[CelestialObjectFactory] All celestial bodies created');
    return bodies;
  }

  private async _createBodyWithHierarchy(
    name: string,
    config: CelestialBodyConfig,
    parentName: string | null,
    bodies: CelestialBodies
  ): Promise<CelestialObject | null> {
    const cached = this.classCache.get(name);
    if (cached) return cached;

    let body: CelestialObject;
    try {
      body = new CelestialObject(this.textureSystem, config, name, this.animationSystem);
      body.group.userData = {
        config,
        type:   'celestial-body',
        parent: parentName,
        radius: config.radius,
      };
      bodies[name] = body;
      this.classCache.set(name, body);
      Logger.success(`[CelestialObjectFactory] Body created: ${name}`);
    } catch (error) {
      Logger.error(`[CelestialObjectFactory] Failed to create body: ${name}`, error);
      return null;
    }

    if (config.satellites) {
      await Promise.all(
        Object.entries(config.satellites).map(([satName, satConfig]) =>
          this._createBodyWithHierarchy(satName, satConfig, name, bodies)
        )
      );
    }

    return body;
  }
}
