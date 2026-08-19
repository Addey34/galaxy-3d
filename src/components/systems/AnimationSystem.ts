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
import { FPSCounter } from '@/utils/FPSCounter';
import Logger from '@/utils/Logger';
import type { IUpdatable } from '@/types';
import type { OrbitalMechanics } from '@/core/OrbitalMechanics';
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import type { Starfield } from '@/components/celestial/Starfield';
import {
  computeLightAttenuation,
  solarIrradianceFactor,
  type SphericalOccluder,
} from '@/core/eclipse';
import { SQRT_K } from '@/core/ScaleService';
import type { CameraSystem } from './CameraSystem';
import type { CelestialBodies } from './SceneSystem';

// LOD revu toutes les 5 frames seulement : un changement de texture déclenche un upload
// GPU coûteux ; le faire à chaque frame provoquerait des à-coups (spikes de frame-time).
const LOD_UPDATE_INTERVAL = 5;
const LOD_MAX_NORMALIZED_DISTANCE = 250;
const LOD_NORMALIZED_DISTANCE_THRESHOLD = 2;

export class AnimationSystem {
  // Timing
  private readonly clock = new THREE.Clock();
  private lodUpdateFrame = 0;
  private lightingUpdateFrame = 0;
  private lastLightingMode: 'educ' | 'explo' | null = null;

  // State
  private isRunning = false;
  private isPaused = false;
  private animationFrame: number | null = null;

  // Updatable objects
  private readonly updatables = new Set<IUpdatable>();
  private _updatablesList: IUpdatable[] = [];
  private _updatablesDirty = false;

  // Callbacks exécutés en fin de frame (couche UI : HUD explo, etc.). Pas de rendu ici.
  private readonly _frameCallbacks = new Set<() => void>();

  // External systems (set via init)
  readonly tweenGroup = new TweenGroup();
  private readonly fpsCounter = new FPSCounter();
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private starfield: Starfield | null = null;
  private cameraSystem!: CameraSystem;
  private celestialBodies!: CelestialBodies;
  private orbitalMechanics: OrbitalMechanics | null = null;

  // Reusable vectors (avoid per-frame allocations)
  private readonly _cameraPos = new THREE.Vector3();
  private readonly _sunWorldPos = new THREE.Vector3();
  private readonly _moonWorldPos = new THREE.Vector3();
  private readonly _bodyWorldPos = new THREE.Vector3();

  // Frustum culling — objets réutilisés pour éviter les allocations à chaque frame
  private readonly _frustum = new THREE.Frustum();
  private readonly _projScreenMatrix = new THREE.Matrix4();
  private readonly _tmpSphere = new THREE.Sphere();

  // Éclipse explo — instantané réutilisé des corps (position monde + rayon), reconstruit
  // en place à chaque passe d'éclairage. Évitait ~n² allocations de Vector3 + un tableau
  // d'occludeurs par corps et par frame (pression GC → micro-saccades). Le pool grandit
  // au besoin puis est réutilisé ; `_occluderList` sert d'argument aux appels sans réallouer.
  // Type = `SphericalOccluder` (celui qu'attend `computeLightAttenuation`), position mutable.
  private readonly _lightingSnapshot: SphericalOccluder[] = [];
  private readonly _occluderList: SphericalOccluder[] = [];

  constructor(_targetFPS = 60) {
    Logger.info('[AnimationSystem] Instance created ✅');
  }

  init(params: {
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    composer?: EffectComposer | null;
    starfield?: Starfield | null;
    cameraSystem: CameraSystem;
    celestialBodies: CelestialBodies;
  }): void {
    this.scene = params.scene;
    this.camera = params.camera;
    this.renderer = params.renderer;
    this.composer = params.composer ?? null;
    this.starfield = params.starfield ?? null;
    this.cameraSystem = params.cameraSystem;
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

    // Le requestAnimationFrame se synchronise déjà sur le vsync du navigateur :
    // laisser le RAF dicter le rythme évite les sauts de frame du throttle manuel.
    this.tweenGroup.update(now);

    const delta = this.isPaused ? 0 : rawDelta;
    this._update(delta, rawDelta);
    this._render();
    this.fpsCounter.update(now);
  }

  private _update(delta: number, rawDelta: number = delta): void {
    // delta = 0 si paused → positions Kepler figées ; rawDelta = vrai temps écoulé (non utilisé)
    this.orbitalMechanics?.update(delta, rawDelta);

    const sunWorldPosition = this._getSunWorldPosition();
    this._updatePhysicalLighting(sunWorldPosition);

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
    const moonWorldPosition = this._getMoonWorldPosition();
    this._updateObjects(simRot, sunWorldPosition, moonWorldPosition);
    this.cameraSystem?.update(delta);
    // OrbitControls peut déplacer la caméra après le calcul de frustum ; les callbacks HUD
    // doivent projeter avec sa matrice monde de la frame courante.
    this._updateLOD();

    // Après le suivi caméra : la couche UI lit des positions à jour (HUD explo).
    for (const cb of this._frameCallbacks) cb();
  }

  private _getSunWorldPosition(): THREE.Vector3 | null {
    const sunBody = this.celestialBodies?.['sun'];
    if (!sunBody?.group) return null;
    sunBody.group.getWorldPosition(this._sunWorldPos);
    return this._sunWorldPos;
  }

  private _getMoonWorldPosition(): THREE.Vector3 | null {
    const moonBody = this.celestialBodies?.['moon'];
    if (!moonBody?.group) return null;
    moonBody.group.getWorldPosition(this._moonWorldPos);
    return this._moonWorldPos;
  }

  private _updatePhysicalLighting(
    sunWorldPosition: THREE.Vector3 | null
  ): void {
    if (!sunWorldPosition) return;
    const mode = this.orbitalMechanics?.scaleMode ?? 'educ';
    const modeChanged = mode !== this.lastLightingMode;
    this.lastLightingMode = mode;

    if (mode === 'educ') {
      if (modeChanged) {
        for (const body of Object.values(this.celestialBodies)) {
          body.setLightAttenuation(1);
        }
      }
      this._updateEducEarthMoonEclipse(modeChanged);
      return;
    }

    this.lightingUpdateFrame++;
    if (!modeChanged && this.lightingUpdateFrame % 6 !== 0) return;

    const sunBody = this.celestialBodies['sun'];
    const sunRadius =
      (sunBody?.group.userData['radius'] as number | undefined) ?? 0;
    const entries = Object.entries(this.celestialBodies);

    // Instantané des positions monde + rayons, calculé UNE fois par passe (pas une fois
    // par corps). Chaque `getWorldPosition` écrit dans un Vector3 déjà alloué du pool ;
    // l'index i du snapshot correspond à entries[i]. Le pool grandit puis est réutilisé.
    for (let i = 0; i < entries.length; i++) {
      let slot = this._lightingSnapshot[i];
      if (!slot) {
        slot = { position: new THREE.Vector3(), radius: 0 };
        this._lightingSnapshot[i] = slot;
      }
      const group = entries[i][1].group;
      group.getWorldPosition(slot.position);
      slot.radius = (group.userData['radius'] as number | undefined) ?? 0;
    }

    for (let i = 0; i < entries.length; i++) {
      const [name, body] = entries[i];
      if (name === 'sun') {
        body.setLightAttenuation(1);
        continue;
      }

      const bodyPosition = this._lightingSnapshot[i].position;
      // Réutilise le tableau d'occludeurs : on le vide (length=0) puis on y réinsère les
      // slots du snapshot (autres que ce corps et le Soleil). Aucun Vector3 alloué ici.
      this._occluderList.length = 0;
      for (let j = 0; j < entries.length; j++) {
        if (j === i) continue;
        if (entries[j][0] === 'sun') continue;
        this._occluderList.push(this._lightingSnapshot[j]);
      }

      const eclipse = computeLightAttenuation(
        bodyPosition,
        sunWorldPosition,
        sunRadius,
        this._occluderList
      );
      const distanceAU = bodyPosition.distanceTo(sunWorldPosition) / SQRT_K;
      body.setLightAttenuation(eclipse * solarIrradianceFactor(distanceAU));
    }
  }

  /**
   * En educ, applique l'éclipse Terre-Lune-Soleil calculée sur la vraie géométrie
   * (cf. OrbitalMechanics.getEarthMoonEclipse) aux seuls corps `earth` et `moon`.
   * Pas d'irradiance solaire ici : educ garde une luminosité uniforme, seule
   * l'ombre d'éclipse module ces deux corps.
   */
  private _updateEducEarthMoonEclipse(modeChanged: boolean): void {
    if (!this.orbitalMechanics) return;
    this.lightingUpdateFrame++;
    if (!modeChanged && this.lightingUpdateFrame % 6 !== 0) return;

    const earth = this.celestialBodies['earth'];
    const moon = this.celestialBodies['moon'];
    if (!earth && !moon) return;

    const eclipse = this.orbitalMechanics.getEarthMoonEclipse();
    earth?.setLightAttenuation(eclipse.earth);
    moon?.setLightAttenuation(eclipse.moon);
  }

  private _updateObjects(
    delta: number,
    sunWorldPosition: THREE.Vector3 | null,
    moonWorldPosition: THREE.Vector3 | null
  ): void {
    this._cameraPos.copy(this.camera.position);

    // Array.from(Set) est O(n) et alloue un tableau : on le recrée uniquement
    // quand un objet est ajouté ou retiré, pas à chaque frame. L'ordre d'itération
    // n'a pas d'importance ici — update() ne fait que rotation/shader, le rendu (et
    // donc l'ordre de transparence) est géré par Three.js indépendamment.
    if (this._updatablesDirty) {
      this._updatablesList = Array.from(this.updatables);
      this._updatablesDirty = false;
    }

    for (const obj of this._updatablesList) {
      // Test de visibilité via le frustum ; la position orbitale est mise à jour même hors-champ
      let visible = true;
      if (obj.group) {
        obj.group.getWorldPosition(this._bodyWorldPos);
        this._tmpSphere.center.copy(this._bodyWorldPos);
        this._tmpSphere.radius =
          ((obj.group.userData['radius'] as number | undefined) ?? 10) * 2;
        visible = this._frustum.intersectsSphere(this._tmpSphere);
      }
      obj.update(
        delta,
        sunWorldPosition,
        visible,
        this._cameraPos,
        moonWorldPosition
      );
    }
  }

  private _updateLOD(): void {
    this.lodUpdateFrame++;
    if (this.lodUpdateFrame % LOD_UPDATE_INTERVAL !== 0) return;
    if (!this.celestialBodies) return;

    for (const body of Object.values(this.celestialBodies)) {
      if (typeof body.updateLODTextures === 'function' && body.group) {
        // fire-and-forget; CelestialObject guards concurrent calls with _lodPending
        void body.updateLODTextures(
          this.camera,
          LOD_MAX_NORMALIZED_DISTANCE,
          LOD_NORMALIZED_DISTANCE_THRESHOLD
        );
      }
    }
  }

  private _render(): void {
    // Recentre le champ d'étoiles sur la caméra (décor à l'infini, cf. Starfield).
    this.starfield?.followCamera(this.camera.position);
    // Le composer (bloom) prend le relais quand il est actif ; sinon rendu direct.
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** Enregistre un callback exécuté en fin de chaque frame. Retourne une fonction de retrait. */
  onFrame(cb: () => void): () => void {
    this._frameCallbacks.add(cb);
    return () => this._frameCallbacks.delete(cb);
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

  /** Force l'état de pause (utilisé quand une action externe fige la simulation). */
  setPaused(paused: boolean): void {
    this.isPaused = paused;
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
    this._updatablesList = [];
    this._frameCallbacks.clear();
    this.orbitalMechanics = null;
    this.fpsCounter.dispose();
    this.isRunning = false;
    Logger.warn('[AnimationSystem] Disposed');
  }
}
