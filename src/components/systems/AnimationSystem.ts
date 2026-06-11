/**
 * Boucle de rendu (`requestAnimationFrame`) et orchestrateur de chaque frame.
 *
 * À chaque frame : avance OrbitalMechanics (positions/orientations), calcule le frustum
 * pour le culling, met à jour tous les `IUpdatable` (rotation propre, shaders), suit la
 * caméra et, périodiquement, ajuste le LOD des textures. Plafonne le delta pour éviter un
 * saut de simulation après un onglet masqué, et gère la pause.
 */
import { Group as TweenGroup } from '@tweenjs/tween.js';
import * as THREE from 'three';
import { FPSCounter } from '../../utils/FPSCounter';
import Logger from '../../utils/Logger';
import type { IUpdatable } from '../../types';
import type { OrbitalMechanics } from '../../core/OrbitalMechanics';
import type { CameraSystem } from './CameraSystem';
import type { CelestialBodies } from './SceneSystem';

// LOD revu toutes les 5 frames seulement : un changement de texture déclenche un upload
// GPU coûteux ; le faire à chaque frame provoquerait des à-coups (spikes de frame-time).
const LOD_UPDATE_INTERVAL = 5;
const LOD_MAX_DISTANCE = 100;      // au-delà, on ne recharge plus de textures (corps trop petit à l'écran)
const LOD_DISTANCE_THRESHOLD = 5;  // variation de distance mini avant de reconsidérer le LOD

export class AnimationSystem {
  // Timing
  private readonly clock = new THREE.Clock();
  private readonly targetFPS: number;
  private lastFrameTime = 0;
  private lodUpdateFrame = 0;

  // State
  private isRunning = false;
  private isPaused = false;
  private animationFrame: number | null = null;

  // Updatable objects
  private readonly updatables = new Set<IUpdatable>();
  private _updatablesList: IUpdatable[] = [];
  private _updatablesDirty = false;

  // External systems (set via init)
  readonly tweenGroup = new TweenGroup();
  private readonly fpsCounter = new FPSCounter();
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private cameraSystem!: CameraSystem;
  private celestialBodies!: CelestialBodies;
  private orbitalMechanics: OrbitalMechanics | null = null;

  // Reusable vectors (avoid per-frame allocations)
  private readonly _cameraPos = new THREE.Vector3();
  private readonly _sunWorldPos = new THREE.Vector3();
  private readonly _bodyWorldPos = new THREE.Vector3();

  // Frustum culling — objets réutilisés pour éviter les allocations à chaque frame
  private readonly _frustum = new THREE.Frustum();
  private readonly _projScreenMatrix = new THREE.Matrix4();
  private readonly _tmpSphere = new THREE.Sphere();

  constructor(targetFPS = 60) {
    this.targetFPS = targetFPS;
    Logger.info('[AnimationSystem] Instance created ✅');
  }

  init(params: {
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    cameraSystem: CameraSystem;
    celestialBodies: CelestialBodies;
  }): void {
    this.scene          = params.scene;
    this.camera          = params.camera;
    this.renderer        = params.renderer;
    this.cameraSystem    = params.cameraSystem;
    this.celestialBodies = params.celestialBodies;

    // Share tween group with camera system
    this.cameraSystem.tweenGroup = this.tweenGroup;

    this.fpsCounter.init();
    Logger.success('[AnimationSystem] Initialized');
  }

  run(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.clock.start();
    this._animate();
  }

  private _animate(): void {
    this.animationFrame = requestAnimationFrame(() => this._animate());

    const rawDelta = Math.min(this.clock.getDelta(), 0.1);
    const now = performance.now();
    const frameInterval = 1000 / this.targetFPS;

    this.tweenGroup.update(now);

    if (now - this.lastFrameTime >= frameInterval) {
      const delta = this.isPaused ? 0 : rawDelta;
      this._update(delta, rawDelta);
      this._render();
      this.fpsCounter.update(now);
      this.lastFrameTime = now;
    }
  }

  private _update(delta: number, rawDelta: number = delta): void {
    // delta = 0 si paused → positions Kepler figées ; rawDelta = vrai temps écoulé (non utilisé)
    this.orbitalMechanics?.update(delta, rawDelta);

    const sunWorldPosition = this._getSunWorldPosition();

    // Frustum calculé une fois par frame (réutilise les matrices de la frame précédente — acceptable)
    this.camera.updateMatrixWorld();
    this._projScreenMatrix.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse
    );
    this._frustum.setFromProjectionMatrix(this._projScreenMatrix);

    // Rotation physique : utilise les secondes de simulation réelles (pas le delta d'animation).
    // rotationSpeed est en rad/sim-seconde → précis en Réel, 1h/s, 3h/s, 6h/s et éducatif.
    const simRot = this.orbitalMechanics?.simDeltaSeconds ?? delta;
    this._updateObjects(simRot, sunWorldPosition);
    this.cameraSystem?.update(delta);
    this._updateLOD();
  }

  private _getSunWorldPosition(): THREE.Vector3 | null {
    const sunBody = this.celestialBodies?.['sun'];
    if (!sunBody?.group) return null;
    sunBody.group.getWorldPosition(this._sunWorldPos);
    return this._sunWorldPos;
  }

  private _updateObjects(delta: number, sunWorldPosition: THREE.Vector3 | null): void {
    this._cameraPos.copy(this.camera.position);

    // Array.from(Set) est O(n) et alloue un tableau : on le recrée uniquement
    // quand un objet est ajouté ou retiré, pas à chaque frame.
    if (this._updatablesDirty) {
      this._updatablesList = Array.from(this.updatables);
      this._updatablesDirty = false;
    }

    // Sort in-place by distance to camera (must run every frame — positions change)
    this._updatablesList.sort((a, b) => {
      const dA = a.group?.position.distanceToSquared(this._cameraPos) ?? Infinity;
      const dB = b.group?.position.distanceToSquared(this._cameraPos) ?? Infinity;
      return dA - dB;
    });

    const sorted = this._updatablesList;

    for (const obj of sorted) {
      // Test de visibilité via le frustum ; la position orbitale est mise à jour même hors-champ
      let visible = true;
      if (obj.group) {
        obj.group.getWorldPosition(this._bodyWorldPos);
        this._tmpSphere.center.copy(this._bodyWorldPos);
        this._tmpSphere.radius = ((obj.group.userData['radius'] as number | undefined) ?? 10) * 2;
        visible = this._frustum.intersectsSphere(this._tmpSphere);
      }
      obj.update(delta, sunWorldPosition, visible, this._cameraPos);
    }
  }

  private _updateLOD(): void {
    this.lodUpdateFrame++;
    if (this.lodUpdateFrame % LOD_UPDATE_INTERVAL !== 0) return;
    if (!this.celestialBodies) return;

    for (const body of Object.values(this.celestialBodies)) {
      if (typeof body.updateLODTextures === 'function' && body.group) {
        // fire-and-forget; CelestialObject guards concurrent calls with _lodPending
        void body.updateLODTextures(this.camera, LOD_MAX_DISTANCE, LOD_DISTANCE_THRESHOLD);
      }
    }
  }

  private _render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  addUpdatable(obj: IUpdatable): void {
    if (typeof obj.update !== 'function') return;
    this.updatables.add(obj);
    this._updatablesDirty = true;
  }

  removeUpdatable(obj: IUpdatable): void {
    this.updatables.delete(obj);
    this._updatablesDirty = true;
  }

  togglePause(): boolean {
    this.isPaused = !this.isPaused;
    return this.isPaused;
  }

  setOrbitalMechanics(om: OrbitalMechanics): void {
    this.orbitalMechanics = om;
  }

  getOrbitalMechanics(): OrbitalMechanics | null {
    return this.orbitalMechanics;
  }

  dispose(): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    this.updatables.clear();
    this.fpsCounter.dispose();
    this.isRunning = false;
    Logger.warn('[AnimationSystem] Disposed');
  }
}
