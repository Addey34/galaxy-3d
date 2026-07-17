/**
 * Contrôle de la caméra : OrbitControls (rotation/zoom à la souris) + transitions
 * animées avec TWEEN.js pour voler d'un corps à l'autre.
 *
 * Une fois une cible choisie (`setTarget`), la caméra suit le corps qui orbite en
 * conservant l'offset calculé au moment du clic. `setScaleMode` ajuste near/far et les
 * distances min/max selon le mode (Éducatif : grandes distances ; Explo : vraie échelle,
 * planètes à quelques millièmes d'unité).
 */
import TWEEN, { Group as TweenGroup } from '@tweenjs/tween.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  CAMERA_CONTROLS_SETTINGS,
  CAMERA_SETTINGS,
} from '../../config/settings';
import Logger from '../../utils/Logger';
import type { CelestialBodies } from './SceneSystem';

export class CameraSystem {
  camera!: THREE.PerspectiveCamera;
  renderer!: THREE.WebGLRenderer;
  controls!: OrbitControls;
  tweenGroup!: TweenGroup;

  private celestialBodies!: CelestialBodies;
  private isAnimating = false;
  private currentTarget: {
    name: string;
    group: THREE.Group;
    distance: number;
  } | null = null;
  private _scaleMode: 'educ' | 'explo' = 'educ';

  private readonly smoothness = CAMERA_CONTROLS_SETTINGS.smoothness;
  private readonly minDistanceMultiplier =
    CAMERA_CONTROLS_SETTINGS.minDistanceMultiplier;

  private readonly targetWorldPosition = new THREE.Vector3();
  private readonly cameraOffset = new THREE.Vector3();

  constructor() {
    Logger.info('[CameraSystem] Camera instance created ✅');
  }

  init(
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    celestialBodies: CelestialBodies,
    _sceneSystem?: unknown
  ): void {
    this.camera = camera;
    this.renderer = renderer;
    this.celestialBodies = celestialBodies;
    this.initializeControls();
    Logger.success('[CameraSystem] Initialized');
  }

  private initializeControls(): void {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.screenSpacePanning =
      CAMERA_CONTROLS_SETTINGS.screenSpacePanning;
    this.controls.maxPolarAngle = CAMERA_CONTROLS_SETTINGS.maxPolarAngle;
    this.controls.minPolarAngle = CAMERA_CONTROLS_SETTINGS.minPolarAngle;
    this.controls.enablePan = CAMERA_CONTROLS_SETTINGS.enablePan;
    this.controls.enableZoom = CAMERA_CONTROLS_SETTINGS.enableZoom;
    this.controls.enableRotate = CAMERA_CONTROLS_SETTINGS.enableRotate;
    this.controls.minDistance = CAMERA_CONTROLS_SETTINGS.educMinDistance;
    this.controls.maxDistance = CAMERA_CONTROLS_SETTINGS.educMaxDistance;
    this.controls.rotateSpeed = CAMERA_CONTROLS_SETTINGS.rotateSpeed;
    this.controls.zoomSpeed = CAMERA_CONTROLS_SETTINGS.zoomSpeed;
    this.controls.target.set(0, 0, 0);
  }

  /**
   * Cible un corps : calcule une distance de visite confortable (selon son rayon et le
   * mode) et lance un vol animé de la caméra vers lui. Le corps sera ensuite suivi.
   */
  setTarget(bodyName: string): void {
    const body = this.celestialBodies[bodyName]?.group;
    if (!body) {
      Logger.warn(`[CameraSystem] Body "${bodyName}" not found`);
      return;
    }

    body.updateWorldMatrix(true, false);
    body.getWorldPosition(this.targetWorldPosition);

    const radius = (body.userData['radius'] as number | undefined) ?? 1;
    const defaultDistance = this.getDefaultDistance(bodyName);
    const distance = Math.max(
      defaultDistance,
      radius * this.minDistanceMultiplier
    );

    const direction = new THREE.Vector3()
      .subVectors(this.camera.position, this.controls.target)
      .normalize();
    if (direction.length() < 0.1) direction.set(1, 0.3, 1).normalize();

    const cameraPosition = this.targetWorldPosition
      .clone()
      .add(direction.multiplyScalar(distance));

    this.currentTarget = { name: bodyName, group: body, distance };
    this.cameraOffset.subVectors(cameraPosition, this.targetWorldPosition);

    this.animateToTarget(cameraPosition, this.targetWorldPosition.clone());
  }

  private animateToTarget(
    cameraPosition: THREE.Vector3,
    targetPosition: THREE.Vector3
  ): void {
    // Un nouveau clic remplace le vol en cours. Sans cette annulation, plusieurs paires de
    // tweens écrivaient caméra/cible pendant les mêmes frames et produisaient un mouvement
    // latéral de va-et-vient lors d'une navigation rapide entre les planètes.
    this.tweenGroup.removeAll();
    this.isAnimating = true;
    this.controls.enabled = false; // bloque les inputs utilisateur pendant le tween pour éviter un conflit de position

    // Suivi de la cible MOBILE pendant le vol : à vitesse accélérée le corps avance pendant
    // les 1,2 s de transition. On mémorise sa position au départ et, à chaque frame, on
    // décale caméra + cible du déplacement accumulé (drift) — sinon le corps glisse
    // latéralement et sort de sa ligne d'orbite jusqu'au recalage final. `camTo`/`tgtTo`
    // restent les valeurs figées au clic ; le drift les recale vers la position vivante.
    const followGroup = this.currentTarget?.group ?? null;
    const trackStart = new THREE.Vector3();
    const drift = new THREE.Vector3();
    if (followGroup) followGroup.getWorldPosition(trackStart);

    const updateDrift = (): void => {
      if (!followGroup) return;
      followGroup.getWorldPosition(this.targetWorldPosition);
      drift.subVectors(this.targetWorldPosition, trackStart);
    };

    const camFrom = {
      x: this.camera.position.x,
      y: this.camera.position.y,
      z: this.camera.position.z,
    };
    const camTo = {
      x: cameraPosition.x,
      y: cameraPosition.y,
      z: cameraPosition.z,
    };
    // Toujours partir de la cible OrbitControls réellement affichée. La précédente valeur
    // mémorisée devenait obsolète dès qu'un corps suivi avançait sur son orbite.
    const tgtFrom = {
      x: this.controls.target.x,
      y: this.controls.target.y,
      z: this.controls.target.z,
    };
    const tgtTo = {
      x: targetPosition.x,
      y: targetPosition.y,
      z: targetPosition.z,
    };

    new TWEEN.Tween(camFrom, this.tweenGroup)
      .to(camTo, 1200)
      .easing(TWEEN.Easing.Cubic.InOut)
      // Ce tween est ajouté en premier : son onUpdate rafraîchit `drift` pour la frame,
      // que le tween de la cible (ci-dessous) réutilise ensuite.
      .onUpdate(() => {
        updateDrift();
        this.camera.position.set(
          camFrom.x + drift.x,
          camFrom.y + drift.y,
          camFrom.z + drift.z
        );
      })
      .start();

    new TWEEN.Tween(tgtFrom, this.tweenGroup)
      .to(tgtTo, 1200)
      .easing(TWEEN.Easing.Cubic.InOut)
      .onUpdate(() => {
        this.controls.target.set(
          tgtFrom.x + drift.x,
          tgtFrom.y + drift.y,
          tgtFrom.z + drift.z
        );
      })
      .onComplete(() => {
        // La cible a pu avancer pendant les 1,2 s du vol (visible à vitesse accélérée).
        // Translate caméra et target du même delta pour terminer exactement sur sa position
        // courante sans saut lors de la première frame de suivi.
        if (this.currentTarget?.group) {
          this.cameraOffset.subVectors(
            this.camera.position,
            this.controls.target
          );
          this.currentTarget.group.getWorldPosition(this.targetWorldPosition);
          this.controls.target.copy(this.targetWorldPosition);
          this.camera.position
            .copy(this.targetWorldPosition)
            .add(this.cameraOffset);
        }
        this.isAnimating = false;
        this.controls.enabled = true;
        this.controls.update();
        Logger.success('[CameraSystem] Camera animation completed');
      })
      .start();
  }

  /** Appelé chaque frame : maintient la caméra collée au corps suivi pendant qu'il orbite. */
  update(_delta: number): void {
    if (!this.controls) return;

    if (this.currentTarget?.group && !this.isAnimating) {
      // Conserve l'offset caméra→cible calculé au moment du setTarget() et
      // le réapplique à la nouvelle position mondiale du corps (qui orbite).
      // Sans ça la caméra resterait fixe pendant que la planète s'éloigne.
      const offsetX = this.camera.position.x - this.controls.target.x;
      const offsetY = this.camera.position.y - this.controls.target.y;
      const offsetZ = this.camera.position.z - this.controls.target.z;

      this.currentTarget.group.getWorldPosition(this.targetWorldPosition);
      this.controls.target.copy(this.targetWorldPosition);
      this.camera.position.set(
        this.targetWorldPosition.x + offsetX,
        this.targetWorldPosition.y + offsetY,
        this.targetWorldPosition.z + offsetZ
      );
    }

    this.controls.update();
  }

  /** Vue d'ensemble Éducatif : recule la caméra à (0,160,220) pour cadrer tout le système (Neptune à 192u). */
  goToOverview(): void {
    this.currentTarget = null;
    this.animateToTarget(
      new THREE.Vector3(0, 160, 220),
      new THREE.Vector3(0, 0, 0)
    );
  }

  /**
   * Bascule le mode d'échelle : ajuste near/far, min/max distance et la cible par défaut.
   *   educ  → vue d'ensemble (tout le système solaire visible)
   *   explo → cible la Terre (perspective vraie échelle, le Soleil apparaît à ~0.5°)
   */
  setScaleMode(mode: 'educ' | 'explo'): void {
    if (this._scaleMode === mode) return;

    this._scaleMode = mode;
    this.controls.minDistance =
      mode === 'explo'
        ? CAMERA_CONTROLS_SETTINGS.exploMinDistance
        : CAMERA_CONTROLS_SETTINGS.educMinDistance;
    this.controls.maxDistance =
      mode === 'explo'
        ? CAMERA_CONTROLS_SETTINGS.exploMaxDistance
        : CAMERA_CONTROLS_SETTINGS.educMaxDistance;

    // Near/far : en Explo les planètes sont à 0.003–0.12u → near=0.1 les clipperait.
    this.camera.near =
      mode === 'explo' ? CAMERA_SETTINGS.exploNear : CAMERA_SETTINGS.educNear;
    this.camera.far =
      mode === 'explo' ? CAMERA_SETTINGS.exploFar : CAMERA_SETTINGS.educFar;
    this.camera.updateProjectionMatrix();

    if (mode === 'explo') {
      // Mode Explo : perspective depuis la Terre (le Soleil apparaît à ~0.5° — réel)
      this.setTarget('earth');
    } else {
      // Mode Éducatif : vue d'ensemble — tout le système solaire visible
      this.goToOverview();
    }
  }

  /** Nom du corps actuellement suivi, ou null en vue libre / vue d'ensemble. */
  get targetName(): string | null {
    return this.currentTarget?.name ?? null;
  }

  /** Distance caméra → cible suivie en unités scène, ou null si aucune cible. */
  getDistanceToTargetSceneUnits(): number | null {
    if (!this.currentTarget) return null;
    return this.camera.position.distanceTo(this.controls.target);
  }

  private getDefaultDistance(bodyName: string): number {
    const cd = this.celestialBodies[bodyName]?.cameraDistance;
    if (!cd) return CAMERA_SETTINGS.defaultBodyDistance;
    return this._scaleMode === 'explo' ? cd.explo : cd.educ;
  }

  dispose(): void {
    this.controls?.dispose();
    Logger.warn('[CameraSystem] Controls disposed');
  }
}
