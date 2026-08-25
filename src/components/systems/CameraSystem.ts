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
  RENDER_SETTINGS,
} from '@/config/engine';
import { solarIrradianceFactor } from '@/core/eclipse';
import { SQRT_K } from '@/core/ScaleService';
import Logger from '@/utils/Logger';
import { prefersReducedMotion } from '@/utils/reducedMotion';
import type { CelestialBodies } from './SceneSystem';

// Bornes de durée du vol caméra (ms). La durée réelle est proportionnelle à la distance
// parcourue, resserrée entre ces bornes : un court saut reste vif, un long voyage posé.
// Le plafond conserve l'ancien ressenti du vol long (1,2 s) désormais réservé aux grands trajets.
const TRANSITION_MIN_MS = 550;
const TRANSITION_MAX_MS = 1200;

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
  /** Keeps the selected label while a mode morph temporarily freezes camera tracking. */
  private trackingPaused = false;
  private _opticalFov = CAMERA_SETTINGS.opticalMaxFov;
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
    celestialBodies: CelestialBodies
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

    this._setFov(
      this._scaleMode === 'explo' ? this._opticalFov : CAMERA_SETTINGS.focusFov
    );
    this.trackingPaused = false;
    body.updateWorldMatrix(true, false);
    body.getWorldPosition(this.targetWorldPosition);
    this._setAdaptiveExposure(bodyName, this.targetWorldPosition);

    // Rayon CIBLE du mode courant (pas `userData['radius']`, qui peut être en cours de morph
    // Éduc↔Explo au moment précis de cette sélection — cf. CelestialObject.getFrameRadius) :
    // les bornes de zoom doivent refléter la taille FINALE, pas une valeur transitoire.
    const radius =
      this.celestialBodies[bodyName]?.getFrameRadius?.(this._scaleMode) ??
      (body.userData['radius'] as number | undefined) ??
      1;
    // Bornes de zoom proportionnelles au rayon visuel du corps ciblé : on peut approcher
    // chaque corps (petit ou gros) autant que sa taille le permet, sans traverser la surface.
    this._applyTargetZoomBounds(radius);
    const defaultDistance = this.getDefaultDistance(bodyName);
    const distance = Math.max(
      defaultDistance,
      radius * this.minDistanceMultiplier
    );

    const direction = this._approachDirection(bodyName);

    const cameraPosition = this.targetWorldPosition
      .clone()
      .add(direction.multiplyScalar(distance));

    this.currentTarget = { name: bodyName, group: body, distance };
    this.cameraOffset.subVectors(cameraPosition, this.targetWorldPosition);
    this.animateToTarget(cameraPosition, this.targetWorldPosition.clone());
  }

  /**
   * Direction d'approche caméra → corps, biaisée vers la face **éclairée**.
   *
   * Le Soleil est à l'origine héliocentrique : le côté jour d'un corps regarde
   * donc vers l'origine (`origin − bodyPos`, normalisé). On place la caméra de ce
   * côté pour que la face éclairée soit face au spectateur à l'arrivée — sinon la
   * direction (héritée de la position caméra précédente) tombait au hasard et un
   * corps bootait souvent côté nuit (Terre « boule noire »). On ajoute une légère
   * élévation et un décalage latéral pour montrer le terminateur (vue 3/4 flatteuse
   * plutôt qu'un disque plein plat), et on garde une composante Y minimale pour ne
   * jamais regarder exactement dans l'axe du Soleil.
   *
   * Le Soleil lui-même n'a pas de face nuit : on conserve pour lui la direction
   * courante (ou un fallback 3/4) afin de ne pas figer un angle arbitraire.
   */
  private _approachDirection(bodyName: string): THREE.Vector3 {
    const current = new THREE.Vector3()
      .subVectors(this.camera.position, this.controls.target)
      .normalize();

    if (bodyName === 'sun') {
      if (current.length() < 0.1) current.set(1, 0.3, 1).normalize();
      return current;
    }

    // Vecteur corps → Soleil (origine) = direction de la face jour.
    const toSun = this.targetWorldPosition.clone().negate();
    if (toSun.lengthSq() < 1e-9) {
      // Corps quasi à l'origine (improbable hors Soleil) : garde la direction courante.
      if (current.length() < 0.1) current.set(1, 0.3, 1).normalize();
      return current;
    }
    toSun.normalize();

    // Si la caméra regarde DÉJÀ suffisamment la face éclairée (produit scalaire élevé avec
    // la direction du jour), on conserve sa direction courante au lieu de la forcer vers
    // l'angle 3/4 canonique. Évite l'arc parasite (« mouvement en trop ») quand on re-cible
    // un corps déjà bien cadré ou qu'on enchaîne des sélections proches. Le seuil 0.55
    // (~57°) garantit qu'on part d'une vue déjà largement diurne, pas côté nuit.
    if (current.length() > 0.1 && current.dot(toSun) > 0.55) {
      return current;
    }

    // Décalage latéral (produit vectoriel avec l'axe monde Y) pour une vue 3/4 :
    // on voit alors le terminateur, plus lisible qu'un disque frontalement éclairé.
    const up = new THREE.Vector3(0, 1, 0);
    const lateral = new THREE.Vector3().crossVectors(toSun, up);
    if (lateral.lengthSq() < 1e-6) lateral.set(1, 0, 0);
    lateral.normalize();

    return toSun
      .multiplyScalar(0.82)
      .addScaledVector(lateral, 0.45)
      .addScaledVector(up, 0.35)
      .normalize();
  }

  private animateToTarget(
    cameraPosition: THREE.Vector3,
    targetPosition: THREE.Vector3,
    onArrive?: () => void
  ): void {
    // Un nouveau clic remplace le vol en cours. Sans cette annulation, plusieurs paires de
    // tweens écrivaient caméra/cible pendant les mêmes frames et produisaient un mouvement
    // latéral de va-et-vient lors d'une navigation rapide entre les planètes.
    this.tweenGroup.removeAll();

    // prefers-reduced-motion : saut instantané au lieu du vol de 550-1200 ms. Chaque
    // sélection de corps passe par ici — sans ce garde-fou, un utilisateur ayant demandé
    // moins de mouvement subirait quand même une animation caméra à chaque navigation.
    if (prefersReducedMotion()) {
      this.camera.position.copy(cameraPosition);
      this.controls.target.copy(targetPosition);
      if (this.currentTarget?.group) {
        this.cameraOffset.subVectors(this.camera.position, this.controls.target);
        this.currentTarget.group.getWorldPosition(this.targetWorldPosition);
        this.controls.target.copy(this.targetWorldPosition);
        this.camera.position.copy(this.targetWorldPosition).add(this.cameraOffset);
      }
      this.isAnimating = false;
      this.controls.enabled = true;
      this.controls.update();
      onArrive?.();
      return;
    }

    this.isAnimating = true;
    this.controls.enabled = false; // bloque les inputs utilisateur pendant le tween pour éviter un conflit de position

    // Suivi de la cible MOBILE pendant le vol : à vitesse accélérée le corps avance pendant
    // les 1,2 s de transition. On mémorise sa position au départ et, à chaque frame, on
    // décale caméra + cible du déplacement accumulé (drift) — sinon le corps glisse
    // latéralement hors du centre jusqu'au recalage final. `camTo`/`tgtTo`
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

    // Durée proportionnelle à la distance parcourue, bornée : un court saut (Terre→Lune)
    // devient vif, un long voyage (Terre→Neptune) reste posé — au lieu d'un 1200 ms fixe
    // qui rend les courts trajets « mous » et les longs trop brusques. On normalise par la
    // distance max de zoom du mode (≈ taille de la scène : ~500u educ, ~3000u explo), pour
    // que la sensation soit cohérente entre les deux échelles.
    const travel = Math.hypot(
      camTo.x - camFrom.x,
      camTo.y - camFrom.y,
      camTo.z - camFrom.z
    );
    const modeSpan = Math.max(this.controls.maxDistance, 1);
    const duration = THREE.MathUtils.clamp(
      (travel / modeSpan) * TRANSITION_MAX_MS,
      TRANSITION_MIN_MS,
      TRANSITION_MAX_MS
    );
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
      .to(camTo, duration)
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
      .to(tgtTo, duration)
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
        // Enchaînement optionnel (ex. après le recul de transition, revenir au corps suivi).
        onArrive?.();
      })
      .start();
  }

  /** Appelé chaque frame : maintient la caméra collée au corps suivi pendant qu'il orbite. */
  update(_delta: number): void {
    if (!this.controls) return;

    if (
      this.currentTarget?.group &&
      !this.isAnimating &&
      !this.trackingPaused
    ) {
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

  private _setAdaptiveExposure(
    bodyName: string | null,
    worldPosition?: THREE.Vector3
  ): void {
    if (!this.renderer) return;
    let exposure = RENDER_SETTINGS.toneMappingExposure;
    if (
      this._scaleMode === 'explo' &&
      bodyName &&
      bodyName !== 'sun' &&
      worldPosition
    ) {
      const distanceAU = worldPosition.length() / SQRT_K;
      const irradiance = solarIrradianceFactor(distanceAU);
      exposure *= THREE.MathUtils.clamp(1 / Math.sqrt(irradiance), 0.65, 4);
    }
    this.renderer.toneMappingExposure = exposure;
  }

  private _setFov(fov: number): void {
    if (Math.abs(this.camera.fov - fov) < 0.01) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }
  /** Ajuste le zoom optique sans modifier la distance ni l'echelle des objets. */
  setOpticalFov(fov: number): void {
    this._opticalFov = THREE.MathUtils.clamp(
      fov,
      CAMERA_SETTINGS.opticalMinFov,
      CAMERA_SETTINGS.opticalMaxFov
    );
    this._setFov(this._opticalFov);
  }

  get opticalFov(): number {
    return this._opticalFov;
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
    this.trackingPaused = false;
    this._setFov(CAMERA_SETTINGS.fov);
    this._setAdaptiveExposure(null);
    // Retour à la vue d'ensemble : restaure les bornes de zoom globales du mode (sinon on
    // resterait limité aux bornes proportionnelles du dernier corps ciblé).
    this._applyGlobalZoomBounds();
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
  /**
   * Bornes de zoom adaptées au corps ciblé : `minDistance`/`maxDistance` deviennent des
   * multiples de son rayon visuel courant. Un petit corps peut donc être approché autant
   * qu'un gros (proportionnellement), et le zoom max reste borné à un cadrage utile plutôt
   * qu'à une constante globale. Sans corps ciblé (vue d'ensemble), on garde les bornes du mode.
   */
  private _applyTargetZoomBounds(radius: number): void {
    const explo = this._scaleMode === 'explo';
    const minFloor = explo
      ? CAMERA_CONTROLS_SETTINGS.exploMinFloor
      : CAMERA_CONTROLS_SETTINGS.educMinFloor;
    const modeMax = explo
      ? CAMERA_CONTROLS_SETTINGS.exploMaxDistance
      : CAMERA_CONTROLS_SETTINGS.educMaxDistance;

    // Min : on frôle la surface (facteur × rayon), jamais sous le garde-fou du mode.
    this.controls.minDistance = Math.max(
      minFloor,
      radius * CAMERA_CONTROLS_SETTINGS.targetMinRadiusFactor
    );
    // Max : cadrage large du corps (facteur × rayon), plafonné par le max global du mode
    // pour ne jamais permettre de sortir du système.
    this.controls.maxDistance = Math.min(
      modeMax,
      radius * CAMERA_CONTROLS_SETTINGS.targetMaxRadiusFactor
    );
  }

  /** Bornes de zoom globales du mode courant (vue d'ensemble, sans corps ciblé). */
  private _applyGlobalZoomBounds(): void {
    const explo = this._scaleMode === 'explo';
    this.controls.minDistance = explo
      ? CAMERA_CONTROLS_SETTINGS.exploMinDistance
      : CAMERA_CONTROLS_SETTINGS.educMinDistance;
    this.controls.maxDistance = explo
      ? CAMERA_CONTROLS_SETTINGS.exploMaxDistance
      : CAMERA_CONTROLS_SETTINGS.educMaxDistance;
  }

  /** Ajuste bornes de distance + plans near/far pour le mode d'échelle (sans bouger la caméra). */
  private _applyScaleModeBounds(mode: 'educ' | 'explo'): void {
    this._scaleMode = mode;
    this._applyGlobalZoomBounds();

    // Near/far : en Explo les planètes sont à 0.003–0.12u → near=0.1 les clipperait.
    this.camera.near =
      mode === 'explo' ? CAMERA_SETTINGS.exploNear : CAMERA_SETTINGS.educNear;
    this.camera.far =
      mode === 'explo' ? CAMERA_SETTINGS.exploFar : CAMERA_SETTINGS.educFar;
    this.camera.updateProjectionMatrix();
  }

  setScaleMode(mode: 'educ' | 'explo'): void {
    if (this._scaleMode === mode) return;
    this._applyScaleModeBounds(mode);

    // Les deux modes démarrent sur la vue d'ensemble : héliocentrique et FIXE, donc sans
    // parallaxe → orbites lisses. En Explo, cliquer un corps lance ensuite le voyage rapproché.
    this.goToOverview();
  }

  /**
   * Prépare la caméra pour le morph de mode sans modifier son cadrage.
   *
   * Le morph concerne uniquement les positions et tailles de la scène. La position, la cible
   * OrbitControls et le FOV restent donc stables ; si un corps était sélectionné, sa sélection
   * reste affichée mais son suivi automatique est suspendu jusqu'à une nouvelle sélection.
   */
  transitionScaleMode(mode: 'educ' | 'explo'): void {
    this._applyScaleModeBounds(mode);
    this.tweenGroup.removeAll();
    this.isAnimating = false;
    this.controls.enabled = true;
    this.trackingPaused = false;
    this._setAdaptiveExposure(null);
    this.controls.update();
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

  /** Vrai pendant un vol caméra (tween en cours) — sert à différer une action jusqu'à l'arrivée. */
  get isFlying(): boolean {
    return this.isAnimating;
  }

  /**
   * Orientation actuelle de la caméra autour de sa cible (azimut/polaire en degrés + distance
   * en unités scène) — assez pour reconstruire exactement le cadrage courant depuis un permalien.
   * `null` avant l'initialisation des controls.
   */
  getViewAngles(): {
    azimuthDeg: number;
    polarDeg: number;
    distance: number;
  } | null {
    if (!this.controls) return null;
    return {
      azimuthDeg: THREE.MathUtils.radToDeg(this.controls.getAzimuthalAngle()),
      polarDeg: THREE.MathUtils.radToDeg(this.controls.getPolarAngle()),
      distance: this.controls.getDistance(),
    };
  }

  /**
   * Réoriente la caméra autour de sa cible COURANTE (`controls.target`, déjà posée par
   * `setTarget`) selon des angles explicites — restaure le cadrage exact d'un permalien.
   * N'anime pas : à appeler une fois le vol vers la cible terminé (cf. `isFlying`), sinon le
   * tween en cours écraserait aussitôt la position posée ici.
   */
  applyViewAngles(azimuthDeg: number, polarDeg: number, distance: number): void {
    const polar = THREE.MathUtils.clamp(
      THREE.MathUtils.degToRad(polarDeg),
      this.controls.minPolarAngle,
      this.controls.maxPolarAngle
    );
    const dist = THREE.MathUtils.clamp(
      distance,
      this.controls.minDistance,
      this.controls.maxDistance
    );
    const offset = new THREE.Vector3().setFromSphericalCoords(
      dist,
      polar,
      THREE.MathUtils.degToRad(azimuthDeg)
    );
    this.camera.position.copy(this.controls.target).add(offset);
    this.cameraOffset.copy(offset);
    this.controls.update();
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
