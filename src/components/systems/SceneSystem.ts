/**
 * Socle de rendu Three.js : possède la scène, la caméra perspective, le WebGLRenderer
 * et le fond étoilé. Construit aussi la hiérarchie des orbites (chaque corps vit dans un
 * `orbitGroup`) et gère la géométrie des lignes d'orbite.
 *
 * Les points d'orbite sont alimentés en deux temps : `setOrbitPoints()` stocke les
 * tableaux calculés par OrbitalMechanics, puis `applyOrbitPoints()` les copie d'un coup
 * dans les géométries GPU.
 */
import * as THREE from 'three';
import { CAMERA_SETTINGS, RENDER_SETTINGS, currentMaxPixelRatio } from '../../config/settings';
import { educRadius } from '../../core/ScaleService';
import { ORBIT_SAMPLE_COUNT } from '../../core/OrbitalMechanics';
import type { CelestialBodyConfig, CelestialConfig } from '../../types';
import Logger from '../../utils/Logger';
import { createStarfield } from '../celestial/Starfield';
import type { TextureSystem } from './TextureSystem';
import type CelestialObject from '../celestial/CelestialObject';

/** Table nom → corps céleste, partagée entre les systèmes. */
export type CelestialBodies = Record<string, CelestialObject>;


export class SceneSystem {
  readonly scene = new THREE.Scene();
  readonly orbitGroups: Record<string, THREE.Group> = {};

  camera!: THREE.PerspectiveCamera;
  renderer!: THREE.WebGLRenderer;

  private readonly _orbitLines   = new Map<string, THREE.Line>();
  private readonly _orbitPts = new Map<string, Float32Array>();

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
    const pixelRatio = Math.min(window.devicePixelRatio, currentMaxPixelRatio());
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = RENDER_SETTINGS.shadowMap.enabled;
    this.renderer.shadowMap.type   = RENDER_SETTINGS.shadowMap.type;
    this.renderer.toneMapping       = RENDER_SETTINGS.toneMapping;
    this.renderer.toneMappingExposure = RENDER_SETTINGS.toneMappingExposure;
    document.body.appendChild(this.renderer.domElement);
  }

  private setupStarfield(): void {
    this.textureSystem
      .loadTexture('stars/starsSurface', '8k')
      .then((tex) => this.scene.add(createStarfield(tex)))
      .catch((err) => Logger.warn('[SceneSystem] Starfield texture failed', err));
  }

  private setupEventListeners(): void {
    const onResize = (): void => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      // Ré-applique le plafond de pixel ratio : franchir le seuil mobile (768px)
      // par redimensionnement bascule 2 ↔ 1.5 sans recréer le renderer.
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, currentMaxPixelRatio()));
    };
    window.addEventListener('resize', onResize, { passive: true });
    this.disposeFunctions.push(() => window.removeEventListener('resize', onResize));
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
      // Dérivée de distanceAU (échelle éducatif √-compressée) si disponible, sinon orbitalRadius du config.
      const initR = config.realData?.distanceAU != null
        ? educRadius(config.realData.distanceAU)
        : (config.orbitalRadius ?? 0);
      body.group.position.set(initR, 0, 0);

      const orbitGroup = new THREE.Group();
      orbitGroup.name = `orbit_${name}`;
      orbitGroup.add(body.group);
      this.orbitGroups[name] = orbitGroup;
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
    const starEntry = Object.entries(this.config.bodies).find(([, cfg]) => cfg.kind === 'star');
    let starGroup: THREE.Group | null = null;
    if (starEntry) {
      addBody(starEntry[0], starEntry[1]);
      starGroup = celestialBodies[starEntry[0]]?.group ?? null;
    }

    Object.entries(this.config.bodies)
      .filter(([, cfg]) => cfg.kind === 'planet')
      .forEach(([name, config]) => addBody(name, config, starGroup));

    Logger.success('[SceneSystem] Celestial bodies added to scene');
  }

  /**
   * Applique `cb` à chaque corps navigable (hors skybox) avec sa position monde à jour.
   * Le vecteur passé est réutilisé entre les appels — le copier si on veut le conserver.
   */
  forEachBodyWorldPosition(cb: (name: string, worldPos: THREE.Vector3) => void): void {
    for (const [name, body] of Object.entries(this._celestialBodies)) {
      if (!body.group || this.config.bodies[name]?.kind === 'skybox') continue;
      body.group.getWorldPosition(this._tmpWorldPos);
      cb(name, this._tmpWorldPos);
    }
  }

  /**
   * Crée la ligne d'orbite avec une géométrie vide (zéros).
   * Les points d'orbite sont injectés via setOrbitPoints() + applyOrbitPoints().
   */
  private createOrbitVisual(bodyName: string, color: number): THREE.Line {
    const N = ORBIT_SAMPLE_COUNT;
    const positions = new Float32Array((N + 1) * 3); // tout à zéro jusqu'au premier calcul Kepler

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.25 });
    const line = new THREE.Line(geometry, material);

    this._orbitLines.set(bodyName, line);
    return line;
  }

  /** Reçoit les points d'orbite calculés par OrbitalMechanics. */
  setOrbitPoints(bodyName: string, points: Float32Array): void {
    this._orbitPts.set(bodyName, points);
  }

  /**
   * Copie les points d'orbite stockés dans les géométries de ligne.
   * Appelé à chaque changement de date ou de mode.
   */
  applyOrbitPoints(): void {
    for (const [bodyName, line] of this._orbitLines) {
      const pts = this._orbitPts.get(bodyName);
      if (!pts) continue;

      const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
      const n = attr.count;

      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        attr.setXYZ(i, pts[i3], pts[i3 + 1], pts[i3 + 2]);
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
