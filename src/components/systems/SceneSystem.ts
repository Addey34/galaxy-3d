/**
 * Socle de rendu Three.js : possède la scène, la caméra perspective, le WebGLRenderer
 * et le fond étoilé. Construit aussi la hiérarchie de transformation des corps et les lignes
 * d'orbite éducatives ; celles-ci sont masquées en Exploration.
 */
import * as THREE from 'three';
import {
  CAMERA_SETTINGS,
  RENDER_SETTINGS,
  currentMaxPixelRatio,
} from '@/config/engine';
import { educRadius } from '@/core/ScaleService';
import { ORBIT_SAMPLE_COUNT } from '@/core/OrbitalMechanics';
import type { CelestialBodyConfig, CelestialConfig } from '@/types';
import Logger from '@/utils/Logger';
import type { TextureSystem } from './TextureSystem';
import type CelestialObject from '@/components/celestial/CelestialObject';

/** Table nom → corps céleste, partagée entre les systèmes. */
export type CelestialBodies = Record<string, CelestialObject>;

export class SceneSystem {
  readonly scene = new THREE.Scene();
  readonly orbitGroups: Record<string, THREE.Group> = {};

  camera!: THREE.PerspectiveCamera;
  renderer!: THREE.WebGLRenderer;

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

  init(): this {
    this.setupCamera();
    this.setupRenderer();
    this.setupStarfield();
    this.setupEventListeners();
    return this;
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
    document.body.appendChild(this.renderer.domElement);
  }

  private setupStarfield(): void {
    this.textureSystem
      .loadTexture('stars/starsSurface', '8k')
      .then((tex) => {
        // Fond équirectangulaire posé en `scene.background` plutôt qu'une sphère mesh :
        // un décor à l'infini, insensible aux plans near/far. L'ancienne sphère de rayon
        // 10000 était entièrement au-delà du far Explo (3000) → ciel noir en Exploration.
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        this.scene.background = tex;
      })
      .catch((err) =>
        Logger.warn('[SceneSystem] Starfield texture failed', err)
      );
  }

  private setupEventListeners(): void {
    const onResize = (): void => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      // Ré-applique le plafond de pixel ratio : franchir le seuil mobile (768px)
      // par redimensionnement bascule 2 ↔ 1.5 sans recréer le renderer.
      this.renderer.setPixelRatio(
        Math.min(window.devicePixelRatio, currentMaxPixelRatio())
      );
    };
    window.addEventListener('resize', onResize, { passive: true });
    this.disposeFunctions.push(() =>
      window.removeEventListener('resize', onResize)
    );
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
      // et les petits corps sans mesh. Elles servent de repère global ; aucune n'est affichée
      // en Exploration.
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

  private createOrbitVisual(bodyName: string, color: number): THREE.Line {
    const positions = new Float32Array((ORBIT_SAMPLE_COUNT + 1) * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.25,
    });
    const line = new THREE.Line(geometry, material);
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
    if (line) line.visible = this._orbitsGloballyVisible && this._orbitMasterEnabled && visible;
  }

  applyOrbitPoints(): void {
    for (const [bodyName, line] of this._orbitLines) {
      const points = this._orbitPts.get(bodyName);
      if (!points) continue;
      const attr = line.geometry.getAttribute(
        'position'
      ) as THREE.BufferAttribute;
      for (let i = 0; i < attr.count; i++) {
        const i3 = i * 3;
        attr.setXYZ(i, points[i3], points[i3 + 1], points[i3 + 2]);
      }
      attr.needsUpdate = true;
      line.geometry.computeBoundingSphere();
    }
  }

  dispose(): void {
    Object.values(this.orbitGroups).forEach((group) => {
      group.traverse((child) => {
        if (child instanceof THREE.Line) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
    });
    this.disposeFunctions.forEach((fn) => fn());
    this.renderer.dispose();
    this.renderer.domElement.remove();
    Logger.warn('[SceneSystem] Disposed');
  }
}
