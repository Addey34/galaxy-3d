/**
 * Fabrique qui lit `CELESTIAL_CONFIG` et instancie tous les `CelestialObject`.
 * Parcourt la hierarchie (les satellites sont imbriques sous leur planete) et renvoie
 * une table plate nom -> corps. Les creations sont parallelisees.
 */
import type { CelestialBodyConfig, CelestialConfig } from '@/types';
import Logger from '@/utils/Logger';
import type { AnimationSystem } from '@/components/systems/AnimationSystem';
import type { TextureSystem } from '@/components/systems/TextureSystem';
import type { CelestialBodies } from '@/components/systems/SceneSystem';
import { allBodies } from '@/config/catalog';
import { t } from '@/i18n';
import { bodyDisplayName } from '@/i18n/bodyText';
import CelestialObject from './CelestialObject';

type FactoryProgressCallback = (percent: number, msg: string) => void;

export default class CelestialObjectFactory {
  // Evite de creer deux fois le meme CelestialObject si _createBodyWithHierarchy
  // est appele en parallele sur le meme nom.
  private readonly classCache = new Map<string, CelestialObject>();

  constructor(
    private readonly textureSystem: TextureSystem,
    private readonly objectConfig: CelestialConfig,
    private readonly animationSystem: AnimationSystem
  ) {}

  /** Cree tous les corps (hors fond etoile) et renvoie la table nom -> corps. */
  async createAll(
    progressCallback: FactoryProgressCallback = () => {}
  ): Promise<CelestialBodies> {
    const bodies: CelestialBodies = {};
    Logger.info('[CelestialObjectFactory] Creating all celestial bodies...');

    const total = allBodies(this.objectConfig).filter(
      ({ name }) => name !== 'stars'
    ).length;
    let created = 0;

    const reportCreated = (name: string): void => {
      created++;
      progressCallback(
        total > 0 ? created / total : 1,
        t('loader.creatingBody', { body: bodyDisplayName(name) })
      );
    };

    const promises = Object.entries(this.objectConfig.bodies)
      .filter(([name]) => name !== 'stars')
      .map(([name, config]) =>
        this._createBodyWithHierarchy(name, config, null, bodies, reportCreated)
      );

    await Promise.all(promises);
    Logger.success('[CelestialObjectFactory] All celestial bodies created');
    return bodies;
  }

  private async _createBodyWithHierarchy(
    name: string,
    config: CelestialBodyConfig,
    parentName: string | null,
    bodies: CelestialBodies,
    reportCreated: (name: string) => void
  ): Promise<CelestialObject | null> {
    const cached = this.classCache.get(name);
    if (cached) return cached;

    let body: CelestialObject;
    try {
      body = new CelestialObject(
        this.textureSystem,
        config,
        name,
        this.animationSystem
      );
      body.group.userData = {
        config,
        type: 'celestial-body',
        parent: parentName,
        radius: config.radius,
      };
      bodies[name] = body;
      this.classCache.set(name, body);
      Logger.success(`[CelestialObjectFactory] Body created: ${name}`);
      reportCreated(name);
    } catch (error) {
      Logger.error(
        `[CelestialObjectFactory] Failed to create body: ${name}`,
        error
      );
      return null;
    }

    if (config.satellites) {
      await Promise.all(
        Object.entries(config.satellites).map(([satName, satConfig]) =>
          this._createBodyWithHierarchy(
            satName,
            satConfig,
            name,
            bodies,
            reportCreated
          )
        )
      );
    }

    return body;
  }
}
