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
import { CAMERA_CONTROLS_SETTINGS, CAMERA_SETTINGS } from '@/config/engine';
import Logger from '@/utils/Logger';
import type { CelestialBodies, SceneSystem } from './SceneSystem';

export class CameraSystem {
  camera!: THREE.PerspectiveCamera;
  renderer!: THREE.WebGLRenderer;
  controls!: OrbitControls;
  tweenGroup!: TweenGroup;

  private celestialBodies!: CelestialBodies;
  private sceneSystem: SceneSystem | null = null;
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
    sceneSystem?: SceneSystem
  ): void {
    this.camera = camera;
    this.renderer = renderer;
    this.celestialBodies = celestialBodies;
    this.sceneSystem = sceneSystem ?? null;
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
    this._syncOrbitLinesVisibility();

    this.animateToTarget(cameraPosition, this.targetWorldPosition.clone());
  }

  /**
   * Les lignes d'orbite 3D sont un repère de vue d'ensemble : on les masque en suivi rapproché
   * Explo (collé au corps, le trait n'est ni alignable ni non-clippé, cf. SceneSystem), on les
   * réaffiche en vue d'ensemble et en Éducatif (toujours vues de loin → traits lisses et utiles).
   */
  private _syncOrbitLinesVisibility(): void {
    const followingInExplo =
      this._scaleMode === 'explo' && this.currentTarget !== null;
    this.sceneSystem?.setOrbitLinesVisible(!followingInExplo);
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

    this._updateExploClipPlanes();
    this.controls.update();
  }

  /**
   * Near/far adaptatifs en mode Explo. À vraie échelle, une planète est un mesh minuscule
   * (Terre ≈ 0.0015u) posé loin de l'origine (Neptune ≈ 1050u), observé de très près. Un
   * near fixe de 1e-6 avec far=3000 donne un ratio de 3 milliards:1 : le depth buffer 24-bit
   * ne distingue plus les coques concentriques (surface, nuages, atmosphère) → z-fighting,
   * la surface scintille et la planète paraît « vibrer » sur son axe.
   *
   * On resserre le near sur la distance réelle à la cible (juste devant la surface la plus
   * proche), ce qui rétablit la précision de profondeur sans rien clipper d'utile. far reste
   * large pour garder le reste du système visible. En Éducatif, near/far fixes suffisent.
   */
  private readonly _tgtDelta = new THREE.Vector3();
  private _updateExploClipPlanes(): void {
    if (this._scaleMode !== 'explo') return;

    const originDist = this.camera.position.length();

    if (this.currentTarget) {
      // Suivi rapproché : near serré juste devant la surface proche (rétablit la précision de
      // profondeur → supprime le scintillement des coques transparentes au limbe). far adaptatif
      // couvrant le système intérieur, borné à exploFar. Les étoiles (scene.background) sont
      // indépendantes du far, donc resserrer ne noircit plus le ciel.
      const d = this._tgtDelta
        .subVectors(this.camera.position, this.controls.target)
        .length();
      const r =
        (this.currentTarget.group.userData['radius'] as number | undefined) ??
        0;
      const near = Math.max((d - r) * 0.5, CAMERA_SETTINGS.exploNear);
      const far = Math.min(
        CAMERA_SETTINGS.exploFar,
        Math.max(originDist * 2.5, d * 50) + r
      );
      this._applyClipPlanes(near, far);
    } else {
      // Vue héliocentrique (pas de suivi) : near/far classiques couvrant tout le système, sans
      // le near serré du suivi (qui clipperait les orbites proches de la caméra en vue large).
      const near = Math.max(originDist * 0.1, 0.1);
      const far = Math.min(CAMERA_SETTINGS.exploFar, originDist + 1200);
      this._applyClipPlanes(near, far);
    }
  }

  /** Applique near/far seulement sur variation significative (évite un updateProjectionMatrix/frame). */
  private _applyClipPlanes(near: number, far: number): void {
    if (
      Math.abs(this.camera.near - near) > near * 0.05 ||
      Math.abs(this.camera.far - far) > far * 0.05
    ) {
      this.camera.near = near;
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * Vue d'ensemble héliocentrique : caméra reculée au-dessus de l'écliptique, cadrant tout le
   * système. Aucun suivi → caméra FIXE dans le repère du Soleil, donc AUCUNE parallaxe : les
   * planètes décrivent des orbites lisses et rondes (contrairement au suivi d'une planète, qui
   * embarque la caméra sur son orbite et fait apparaître le mouvement rétrograde des autres).
   * La position est mise à l'échelle du mode : Explo à vraie échelle (Neptune ≈ 1050u) est ~5,5×
   * plus grand que l'Éducatif compressé (Neptune ≈ 192u), d'où le même cadrage × ce facteur.
   */
  goToOverview(): void {
    this.currentTarget = null;
    this._syncOrbitLinesVisibility();
    const pos =
      this._scaleMode === 'explo'
        ? new THREE.Vector3(0, 875, 1205) // vraie échelle : cadre Neptune à ~1050u
        : new THREE.Vector3(0, 160, 220); // éducatif compressé : Neptune à ~192u
    this.animateToTarget(pos, new THREE.Vector3(0, 0, 0));
  }

  /**
   * Bascule le mode d'échelle : ajuste near/far, min/max distance et la vue par défaut.
   *   educ  → vue d'ensemble (tout le système solaire visible)
   *   explo → vue d'ensemble héliocentrique (orbites lisses, sans parallaxe ; le suivi d'une
   *           planète reste disponible en cliquant un corps, pour un voyage rapproché)
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

    // Les deux modes démarrent sur la vue d'ensemble : héliocentrique et FIXE, donc sans
    // parallaxe → orbites lisses. En Explo, cliquer un corps lance ensuite le voyage rapproché.
    this.goToOverview();
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
