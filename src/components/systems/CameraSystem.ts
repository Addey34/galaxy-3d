/**
 * Contrôle de la caméra : OrbitControls (rotation/zoom à la souris) + transitions
 * animées avec TWEEN.js pour voler d'un corps à l'autre.
 *
 * Une fois une cible choisie (`setTarget`), la caméra suit le corps qui orbite en
 * conservant l'offset calculé au moment du clic. `setScaleMode` ajuste near/far et les
 * distances min/max selon le mode (Éducatif : grandes distances ; Explo : vraie échelle,
 * planètes à quelques millièmes d'unité).
 */
import { horizonTiltRad } from '@/core/horizonTilt';
import TWEEN, { Group as TweenGroup } from '@tweenjs/tween.js';
import * as THREE from 'three';
import { viewAnglesFromDirection, viewFromDistance } from '@/core/viewAngles';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAMERA_CONTROLS_SETTINGS, CAMERA_SETTINGS } from '@/config/engine';
import { followNearPlane } from '@/core/surfaceApproach';
import Logger from '@/utils/Logger';
import { prefersReducedMotion } from '@/utils/reducedMotion';
import type { CameraDistance } from '@/types';
import type { CelestialBodies } from './SceneSystem';

/**
 * Ce que la caméra demande d'une cible : un objet à suivre, éventuellement une distance de
 * visite et les deux rayons qui bornent le zoom. Un `CelestialObject` le satisfait sans rien
 * déclarer ; une ancre d'objet d'instrument aussi, avec beaucoup moins.
 */
export interface CameraTarget {
  group: THREE.Group;
  cameraDistance?: CameraDistance;
  getFrameRadius?(mode: 'educ' | 'explo'): number;
  getClearanceRadius?(mode: 'educ' | 'explo', toward?: THREE.Vector3): number;
  /**
   * Plancher d'approche propre à cette cible, en multiples de son rayon, ou rien si elle
   * n'affiche aucune surface — une ancre d'objet d'instrument, un petit corps sans texture.
   * Sans réponse, `targetMinRadiusFactor` s'applique.
   */
  getApproachFloorFactor?(): number | undefined;
  /**
   * Orientation MONDIALE du repère qui tourne avec le corps (son spin compris), pour que la
   * caméra tourne avec lui près du sol. Sans réponse, la caméra ne co-tourne jamais.
   */
  getSpinQuaternion?(out: THREE.Quaternion): THREE.Quaternion;
}

/**
 * Sous cette distance au centre, en multiples du rayon du sol, la caméra TOURNE AVEC le corps
 * suivi (lot 53) : un observateur posé au-dessus d'un lieu y reste. Sans cela, à vitesse réelle,
 * le sol de Paris défilait sous la caméra à ~300 m/s, la visée glissait de 1,5° de longitude en
 * sept minutes, et les tuiles fines changeaient sans cesse sans jamais se poser. Au-dessus, rien
 * ne change : on voit la planète tourner, comme avant.
 */
const CO_ROTATION_RADII = 1.1;

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
  /**
   * Cibles qui ne sont pas des corps du catalogue : sondes et objets interstellaires, dont
   * l'ancre est un `THREE.Group` vide (cf. `ui/navigableAnchors.ts`). Elles vivent dans une
   * table à part plutôt que dans `celestialBodies`, qui est la table des `CelestialObject`
   * de la scène ; ce que la caméra demande d'une cible est plus petit que cela, et c'est
   * exactement ce que décrit `CameraTarget`.
   */
  private externalTargets: Record<string, CameraTarget> = {};
  /** Orientation du spin à l'image précédente, et la cible à laquelle elle appartient. */
  private readonly _lastSpin = new THREE.Quaternion();
  private _lastSpinOf: string | null = null;
  private readonly _spinNow = new THREE.Quaternion();
  private readonly _spinDelta = new THREE.Quaternion();
  private readonly _coOffset = new THREE.Vector3();
  private isAnimating = false;
  /** Actions différées jusqu'à la fin du vol en cours (cf. `whenSettled`). */
  private _whenSettled: (() => void)[] = [];
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
   * Déclare des cibles hors catalogue (sondes, objets interstellaires). Appelé une fois au
   * démarrage ; les positions, elles, sont écrites chaque frame dans leurs ancres.
   */
  registerTargets(targets: Record<string, CameraTarget>): void {
    this.externalTargets = { ...this.externalTargets, ...targets };
  }

  /** La cible portant ce nom, corps du catalogue d'abord, objet d'instrument ensuite. */
  private _target(bodyName: string): CameraTarget | undefined {
    return this.celestialBodies?.[bodyName] ?? this.externalTargets[bodyName];
  }

  /**
   * Cible un corps : calcule une distance de visite confortable (selon son rayon et le
   * mode) et lance un vol animé de la caméra vers lui. Le corps sera ensuite suivi.
   */
  setTarget(bodyName: string): void {
    const body = this._target(bodyName)?.group;
    if (!body) {
      Logger.warn(`[CameraSystem] Body "${bodyName}" not found`);
      return;
    }

    if (this.renderer.xr.isPresenting) {
      // renderer.xr pilote seul la pose caméra pendant une session : les tweens
      // d'animateToTarget écriraient sur camera.position/controls pour rien (écrasés chaque
      // frame). On garde la comptabilité (panneau d'info VR, ui/webxrSelection.ts) sans voler.
      body.updateWorldMatrix(true, false);
      body.getWorldPosition(this.targetWorldPosition);
      this.currentTarget = {
        name: bodyName,
        group: body,
        distance: this.getDefaultDistance(bodyName),
      };
      return;
    }

    this._setFov(
      this._scaleMode === 'explo' ? this._opticalFov : CAMERA_SETTINGS.focusFov
    );
    this.trackingPaused = false;
    body.updateWorldMatrix(true, false);
    body.getWorldPosition(this.targetWorldPosition);
    this._recordSunSide();

    // Rayon CIBLE du mode courant (pas `userData['radius']`, qui peut être en cours de morph
    // Éduc↔Explo au moment précis de cette sélection — cf. CelestialObject.getFrameRadius) :
    // les bornes de zoom doivent refléter la taille FINALE, pas une valeur transitoire.
    const radius =
      this._target(bodyName)?.getFrameRadius?.(this._scaleMode) ??
      (body.userData['radius'] as number | undefined) ??
      1;
    // Ce qu'on ne doit pas traverser, c'est le point le plus SAILLANT du corps (cf.
    // CelestialObject.getClearanceRadius), pas sa sphère moyenne.
    const clearance =
      this._target(bodyName)?.getClearanceRadius?.(this._scaleMode) ?? radius;
    // Bornes de zoom proportionnelles au rayon visuel du corps ciblé : on peut approcher
    // chaque corps (petit ou gros) autant que sa taille le permet, sans traverser la surface.
    this._applyTargetZoomBounds(
      clearance,
      this._target(bodyName)?.getApproachFloorFactor?.() ??
        CAMERA_CONTROLS_SETTINGS.targetMinRadiusFactor
    );
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
      this.controls.enabled = true;
      this.controls.update();
      onArrive?.();
      this._settle();
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
        this.controls.enabled = true;
        this.controls.update();
        Logger.success('[CameraSystem] Camera animation completed');
        // Enchaînement optionnel (ex. après le recul de transition, revenir au corps suivi).
        onArrive?.();
        this._settle();
      })
      .start();
  }

  /** Appelé chaque frame : maintient la caméra collée au corps suivi pendant qu'il orbite. */
  update(_delta: number): void {
    if (!this.controls) return;
    // Session XR active : renderer.xr pilote seul la pose caméra depuis le casque. Continuer
    // le suivi de cible/controls.update() ici écraserait ou ferait vibrer la vue à chaque frame.
    if (this.renderer.xr.isPresenting) return;

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
      this._coOffset.set(offsetX, offsetY, offsetZ);
      this._coRotate(this._coOffset);
      this.camera.position.copy(this.targetWorldPosition).add(this._coOffset);
      this._recordSunSide();
      // Le dégagement dépend de la DIRECTION (ellipsoïde, sol mesuré sous la visée) : on le
      // repose à chaque image, sinon un pan vers l'équateur ferait passer la caméra sous le sol.
      this.refreshApproachBounds();
    }

    this._updateClipPlanes();
    this.controls.update();
    this._tiltTowardsHorizon();
  }

  /**
   * Fait tourner le décalage caméra→cible avec le spin du corps depuis l'image précédente, près
   * du sol seulement (`CO_ROTATION_RADII`). La référence est reprise à chaque image, même loin :
   * en franchissant le seuil, la caméra ne rattrape donc pas d'un coup la rotation accumulée.
   */
  private _coRotate(offset: THREE.Vector3): void {
    const name = this.currentTarget?.name ?? null;
    const target = name ? this._target(name) : undefined;
    if (!name || !target?.getSpinQuaternion) {
      this._lastSpinOf = null;
      return;
    }
    target.getSpinQuaternion(this._spinNow);
    if (this._lastSpinOf === name) {
      const ground =
        target.getClearanceRadius?.(this._scaleMode, this.camera.position) ??
        (this.currentTarget?.group.userData['radius'] as number | undefined) ??
        0;
      if (ground > 0 && offset.length() < CO_ROTATION_RADII * ground) {
        this._spinDelta
          .copy(this._lastSpin)
          .invert()
          .premultiply(this._spinNow);
        offset.applyQuaternion(this._spinDelta);
      }
    }
    this._lastSpin.copy(this._spinNow);
    this._lastSpinOf = name;
  }

  /**
   * Relève la visée vers l'horizon près du sol (`core/horizonTilt.ts`), APRÈS `controls.update()`
   * qui vient de la pointer sur le centre : seule l'orientation change, jamais la position, donc
   * le zoom, le glisser, le plancher et les permaliens restent ceux du suivi. Le rayon est celui
   * du SOL sous la caméra (relief et ellipsoïde), le même que le plancher.
   *
   * EN EXPLO SEULEMENT : la descente est celle du voyage à vraie échelle. L'Éducatif est le
   * planétarium compressé, dont l'étiquette de cible suppose le corps au centre, et un retour
   * d'Explo y pose la caméra à 1,15 rayon (le corps grandit, la caméra ne bouge pas) : relevée,
   * elle y perdait la cible du champ (mesuré : `e2e/modes.spec.ts`, deux scénarios).
   */
  private _tiltTowardsHorizon(): void {
    const name = this.currentTarget?.name;
    if (!name || this._scaleMode !== 'explo') return;
    const distance = this.camera.position.distanceTo(this.controls.target);
    const ground =
      this._target(name)?.getClearanceRadius?.(
        this._scaleMode,
        this.camera.position
      ) ??
      (this.currentTarget?.group.userData['radius'] as number | undefined) ??
      0;
    const tilt = horizonTiltRad(distance, ground, this.camera.fov);
    if (tilt > 0) this.camera.rotateX(tilt);
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
   * large pour garder le reste du système visible.
   *
   * EN ÉDUCATIF, near/far fixes suffisaient tant qu'on ne frôlait pas un corps. SUPERSEDED le
   * 2026-10-16 (lot 53), mesuré en production : le plancher d'approche y descend à ~1,007 rayon
   * de la Terre (la finesse de son image l'autorise), alors que le near fixe vaut 0,1 unité,
   * soit 637 km ; sous cette altitude la Terre était découpée par le plan proche et disparaissait
   * de l'écran (« near vs sol COUPE LE CORPS » sous `?debug-surface`). L'Éducatif suit donc la
   * même règle que l'Explo DÈS QUE le near fixe couperait la cible, et seulement alors.
   */
  private readonly _tgtDelta = new THREE.Vector3();
  private _updateClipPlanes(): void {
    if (this._scaleMode !== 'explo') {
      this._updateEducClipPlanes();
      return;
    }

    const originDist = this.camera.position.length();

    if (this.currentTarget) {
      // Suivi rapproché : near serré juste devant la surface proche (rétablit la précision de
      // profondeur → supprime le scintillement des coques transparentes au limbe). far adaptatif
      // couvrant le système intérieur, borné à exploFar. Les étoiles (scene.background) sont
      // indépendantes du far, donc resserrer ne noircit plus le ciel.
      const d = this._tgtDelta
        .subVectors(this.camera.position, this.controls.target)
        .length();
      // Rayon de DÉGAGEMENT : le near doit rester devant le point le plus saillant, sinon un
      // corps irrégulier approché de près est coupé en deux sans erreur. Pris DANS LA
      // DIRECTION de la caméra (lot 48) : compté depuis la sphère, la moitié de l'altitude
      // valait 2,5 km sur la Terre pour un sol à 0,93 km, et le sol disparaissait tout entier.
      const r =
        this._target(this.currentTarget.name)?.getClearanceRadius?.(
          'explo',
          this.camera.position
        ) ??
        (this.currentTarget.group.userData['radius'] as number | undefined) ??
        0;
      // Moitié de l'altitude, et rien ne doit le relever : la règle et ce qu'elle a coûté
      // vivent dans `core/surfaceApproach.ts`, avec les mesures qui l'ont établie.
      const near = followNearPlane(
        d,
        r,
        CAMERA_CONTROLS_SETTINGS.exploMinFloor
      );
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

  /**
   * Éducatif : near/far FIXES, sauf quand le near fixe couperait la cible suivie. Alors la règle
   * du suivi rapproché (`followNearPlane`, moitié de l'altitude) et un far ramené au système
   * intérieur, pour que le rapport far/near reste celui que l'Explo a mesuré sans scintillement.
   */
  private _updateEducClipPlanes(): void {
    const { educNear, educFar } = CAMERA_SETTINGS;
    if (this.currentTarget) {
      const d = this._tgtDelta
        .subVectors(this.camera.position, this.controls.target)
        .length();
      const r =
        this._target(this.currentTarget.name)?.getClearanceRadius?.(
          'educ',
          this.camera.position
        ) ??
        (this.currentTarget.group.userData['radius'] as number | undefined) ??
        0;
      const near = followNearPlane(
        d,
        r,
        CAMERA_CONTROLS_SETTINGS.exploMinFloor
      );
      if (near < educNear) {
        const originDist = this.camera.position.length();
        this._applyClipPlanes(
          near,
          Math.min(educFar, Math.max(originDist * 2.5, d * 50) + r)
        );
        return;
      }
    }
    this._applyClipPlanes(educNear, educFar);
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
    if (this.renderer.xr.isPresenting) {
      this.currentTarget = null;
      return;
    }
    this.currentTarget = null;
    this.trackingPaused = false;
    this._setFov(CAMERA_SETTINGS.fov);
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
   *
   * `minFactor` est le plancher d'approche DÉCLARÉ PAR LA CIBLE : il vaut ce que la finesse
   * de son image autorise (cf. `CelestialObject.getApproachFloorFactor`), et retombe sur
   * `targetMinRadiusFactor` pour une cible qui n'affiche pas de surface.
   */
  private _applyTargetZoomBounds(
    radius: number,
    minFactor: number = CAMERA_CONTROLS_SETTINGS.targetMinRadiusFactor
  ): void {
    const explo = this._scaleMode === 'explo';
    const minFloor = explo
      ? CAMERA_CONTROLS_SETTINGS.exploMinFloor
      : CAMERA_CONTROLS_SETTINGS.educMinFloor;
    const modeMax = explo
      ? CAMERA_CONTROLS_SETTINGS.exploMaxDistance
      : CAMERA_CONTROLS_SETTINGS.educMaxDistance;

    // Min : on frôle la surface (facteur × rayon), jamais sous le garde-fou du mode.
    this.controls.minDistance = Math.max(minFloor, radius * minFactor);
    // Max : cadrage large du corps (facteur × rayon), plafonné par le max global du mode
    // pour ne jamais permettre de sortir du système.
    this.controls.maxDistance = Math.min(
      modeMax,
      radius * CAMERA_CONTROLS_SETTINGS.targetMaxRadiusFactor
    );
  }

  /**
   * Repose les bornes d'approche de la cible COURANTE, sans la déplacer.
   *
   * `setTarget` ne les calcule qu'à la sélection : elles y figent la finesse de l'image du
   * moment. L'imagerie streamée du lot 9 fait varier cette finesse APRÈS la sélection (un
   * carreau de niveau 8 vaut seize fois une texture 8k), et sans ce rappel le plancher
   * resterait celui de la texture livrée — la descente s'arrêterait quinze fois trop haut,
   * silencieusement.
   */
  refreshApproachBounds(): void {
    const name = this.currentTarget?.name;
    if (!name) return;
    const target = this._target(name);
    const radius =
      target?.getFrameRadius?.(this._scaleMode) ??
      (this.currentTarget?.group.userData['radius'] as number | undefined) ??
      1;
    const clearance =
      target?.getClearanceRadius?.(this._scaleMode, this.camera.position) ??
      radius;
    this._applyTargetZoomBounds(
      clearance,
      target?.getApproachFloorFactor?.() ??
        CAMERA_CONTROLS_SETTINGS.targetMinRadiusFactor
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
    this.controls.enabled = true;
    this.trackingPaused = false;
    this.controls.update();
    this._settle();
  }

  /**
   * Exécute `action` quand plus aucun vol ne peut réécrire la caméra : tout de suite s'il n'y
   * en a pas, sinon à la fin RÉELLE du vol (arrivée, ou vol annulé par un changement de mode).
   * Un vol remplacé par un autre ne compte pas : l'action attend la fin du suivant.
   *
   * Remplace l'attente sondée de `ui/permalink.ts`, plafonnée à 3 s d'horloge murale (ligne
   * 45.2, 2026-10-08). En rendu logiciel, l'envoi d'une texture 8k fige une image plusieurs
   * secondes : le plafond expirait alors PENDANT le vol, la pose « vue depuis la Terre » d'une
   * éclipse de Lune s'appliquait, puis l'arrivée du vol l'écrasait. Mesuré par la sonde
   * d'éclipse sur les Xeon de la CI : caméra à la distance et dans la direction d'approche par
   * défaut, Lune grise (rouge/bleu 1,36).
   */
  whenSettled(action: () => void): void {
    if (this.isAnimating) this._whenSettled.push(action);
    else action();
  }

  /** Fin d'un vol, quelle qu'elle soit : libère les actions qui l'attendaient. */
  private _settle(): void {
    this.isAnimating = false;
    const pending = this._whenSettled;
    this._whenSettled = [];
    for (const action of pending) action();
  }

  /**
   * Direction corps → Soleil du corps suivi, telle qu'elle était quand l'offset de la caméra a
   * été posé ou réappliqué pour la dernière fois (ligne 45.9). C'est la référence d'un saut.
   */
  private readonly _sunSide = new THREE.Vector3();
  private _sunSideValid = false;
  private readonly _jumpRotation = new THREE.Quaternion();
  private readonly _jumpOffset = new THREE.Vector3();

  private _recordSunSide(): void {
    this._sunSide.copy(this.targetWorldPosition).negate();
    this._sunSideValid = this._sunSide.lengthSq() > 1e-12;
    if (this._sunSideValid) this._sunSide.normalize();
  }

  /**
   * GARDE LA FACE VUE quand le corps suivi a SAUTÉ le long de son orbite (ligne 45.9,
   * 2026-10-09). Appelé par `OrbitalMechanics.onPositionsJumped`, positions déjà à jour.
   *
   * L'offset caméra → corps est fixe dans le repère du monde : c'est voulu pendant que le temps
   * s'écoule (la caméra reste inertielle), mais un saut fait tourner le corps autour du Soleil
   * d'un coup, et la face éclairée tournait avec lui hors du champ. Mesuré sur un lien
   * `?body=ceres&mode=explo` : le corps était sélectionné AVANT le premier calcul des
   * positions, encore posé sur l'axe +X, et arrivait vu sous 113° de phase (Mars 117°, contre
   * 37° pour le même corps cliqué après le démarrage). On tourne donc l'offset de la rotation
   * qui mène l'ancienne direction du Soleil à la nouvelle ; pendant un vol, on relance
   * l'approche, qui vise alors le vrai Soleil. Le Soleil suivi n'a pas de face nuit.
   */
  realignAfterPositionJump(): void {
    const target = this.currentTarget;
    if (!target?.group || target.name === 'sun') return;
    if (this.renderer?.xr?.isPresenting || this.trackingPaused) return;
    const reference = this._sunSideValid ? this._sunSide.clone() : null;
    target.group.getWorldPosition(this.targetWorldPosition);
    this._recordSunSide();
    if (!reference || !this._sunSideValid) return;
    this._jumpRotation.setFromUnitVectors(reference, this._sunSide);
    // Pas de saut mesurable (un changement de mode est radial pour un corps héliocentrique).
    if (Math.abs(this._jumpRotation.w) > 1 - 1e-12) return;
    if (this.isAnimating) {
      this.setTarget(target.name);
      return;
    }
    this._jumpOffset
      .subVectors(this.camera.position, this.controls.target)
      .applyQuaternion(this._jumpRotation);
    this.cameraOffset.copy(this._jumpOffset);
    this.controls.target.copy(this.targetWorldPosition);
    this.camera.position.copy(this.targetWorldPosition).add(this._jumpOffset);
    this.controls.update();
  }

  /** Nom du corps actuellement suivi, ou null en vue libre / vue d'ensemble. */
  get targetName(): string | null {
    return this.currentTarget?.name ?? null;
  }

  /**
   * Position monde de l'objet suivi, LUE à l'instant dans son groupe (corps, sonde ou objet
   * interstellaire), ou `false` sans cible. Sert à l'adaptation de l'éclairage au corps suivi
   * (`AnimationSystem`, ligne 45.7) : une valeur mémorisée au clic serait celle du mode d'avant
   * pendant un morph.
   */
  getTargetWorldPosition(out: THREE.Vector3): boolean {
    const group = this.currentTarget?.group;
    if (!group) return false;
    group.getWorldPosition(out);
    return true;
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
  applyViewAngles(
    azimuthDeg: number,
    polarDeg: number,
    distance: number
  ): void {
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

  /**
   * Replace la caméra, sans l'animer, du côté de `referenceBody` : la cible reste la même, on
   * la regarde depuis là. Sert aux éclipses de Lune, dont la seule face colorée est celle
   * tournée vers la Terre (cf. core/viewAngles.ts). Sans effet si le corps de référence est
   * inconnu ou confondu avec la cible.
   */
  viewFromBody(referenceBody: string): void {
    const reference = this.celestialBodies[referenceBody]?.group;
    if (!reference || !this.controls) return;
    const direction = reference
      .getWorldPosition(new THREE.Vector3())
      .sub(this.controls.target);
    const angles = viewAnglesFromDirection(direction);
    if (!angles) return;
    this.applyViewAngles(
      angles.azimuthDeg,
      angles.polarDeg,
      viewFromDistance(
        this.controls.getDistance(),
        direction.length(),
        (reference.userData['radius'] as number | undefined) ?? 0
      )
    );
  }

  private getDefaultDistance(bodyName: string): number {
    const cd = this._target(bodyName)?.cameraDistance;
    if (!cd) return CAMERA_SETTINGS.defaultBodyDistance;
    return this._scaleMode === 'explo' ? cd.explo : cd.educ;
  }

  dispose(): void {
    this.controls?.dispose();
    Logger.warn('[CameraSystem] Controls disposed');
  }
}
