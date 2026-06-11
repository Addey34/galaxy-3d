/**
 * Éclairage de la scène : une lumière ambiante très faible (pour que la face nuit
 * ne soit pas totalement noire) et une lumière ponctuelle au centre représentant le
 * Soleil. La PointLight porte aussi les ombres portées (planètes ↔ satellites).
 *
 * Tous les paramètres (couleurs, intensités, qualité des ombres) viennent de
 * `LIGHTING_SETTINGS` ; la qualité des ombres est réduite sur mobile.
 */
import * as THREE from 'three';
import { LIGHTING_SETTINGS } from '../../config/settings';
import Logger from '../../utils/Logger';

export class LightingSystem {
  private lights: { ambient?: THREE.AmbientLight; sun?: THREE.PointLight } = {};
  private scene: THREE.Scene | null = null;

  constructor() {
    Logger.info('[LightingSystem] Instance created ✅');
  }

  /** Crée la lumière ambiante et le Soleil (PointLight à l'origine), puis les ajoute à la scène. */
  setup(scene: THREE.Scene): this {
    if (!scene) {
      Logger.error('[LightingSystem] No scene provided');
      return this;
    }
    this.scene = scene;

    this.lights.ambient = new THREE.AmbientLight(
      LIGHTING_SETTINGS.ambient.color,
      LIGHTING_SETTINGS.ambient.intensity
    );
    this.scene.add(this.lights.ambient);

    const shadowConfig = LIGHTING_SETTINGS.sun.shadow;
    this.lights.sun = new THREE.PointLight(
      LIGHTING_SETTINGS.sun.color,
      LIGHTING_SETTINGS.sun.intensity,
      LIGHTING_SETTINGS.sun.distance,
      LIGHTING_SETTINGS.sun.decay
    );
    this.lights.sun.position.set(0, 0, 0);

    if (shadowConfig.enabled) {
      this.lights.sun.castShadow = true;
      this.lights.sun.shadow.mapSize.width  = shadowConfig.mapSize;
      this.lights.sun.shadow.mapSize.height = shadowConfig.mapSize;
      this.lights.sun.shadow.bias           = shadowConfig.bias;
      this.lights.sun.shadow.normalBias     = shadowConfig.normalBias;
      this.lights.sun.shadow.radius         = shadowConfig.radius;
      this.lights.sun.shadow.camera.near    = shadowConfig.near;
      this.lights.sun.shadow.camera.far     = shadowConfig.far;
      Logger.success(`[LightingSystem] Shadows enabled (${shadowConfig.mapSize}px)`);
    }

    this.scene.add(this.lights.sun);
    Logger.success('[LightingSystem] Sun light added at (0,0,0)');
    return this;
  }

  /** Retire les lumières de la scène et libère leurs ressources GPU. */
  dispose(): void {
    if (!this.scene) return;
    Object.values(this.lights).forEach((light) => {
      if (light) {
        this.scene!.remove(light);
        light.dispose();
      }
    });
    this.lights = {};
    Logger.warn('[LightingSystem] Lights disposed');
  }
}
