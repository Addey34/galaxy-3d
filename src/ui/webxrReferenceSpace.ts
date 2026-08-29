/**
 * État du joueur VR (position/lacet) et calcul de l'espace de référence WebXR décalé.
 *
 * Aucun helper de locomotion/téléportation ne ships avec Three.js (contrairement à
 * A-Frame/Babylon) — c'est un décalage d'espace de référence entièrement à la main. Toujours
 * recalculé depuis l'espace de BASE capturé une fois au `sessionstart` (jamais composé sur
 * l'espace déjà décalé), pour ne jamais accumuler d'erreur au fil des déplacements/téléportations.
 */
import * as THREE from 'three';

export interface PlayerState {
  /** Position monde du joueur (unités scène — 1 unité = 1 "mètre" WebXR, mappage direct). */
  offset: THREE.Vector3;
  /** Lacet accumulé (radians), autour de l'axe Y monde. */
  yaw: number;
}

export function createPlayerState(): PlayerState {
  return { offset: new THREE.Vector3(), yaw: 0 };
}

const _quat = new THREE.Quaternion();
const _yawAxis = new THREE.Vector3(0, 1, 0);

/**
 * Calcule l'espace de référence décalé pour l'état donné, depuis `baseSpace`.
 * Décaler le joueur de +X revient à décaler l'espace de référence de -X pour que le monde
 * semble se déplacer correctement autour de lui (d'où l'inverse de `state.offset`).
 */
export function computeOffsetReferenceSpace(
  baseSpace: XRReferenceSpace,
  state: PlayerState
): XRReferenceSpace {
  _quat.setFromAxisAngle(_yawAxis, state.yaw);
  return baseSpace.getOffsetReferenceSpace(
    new XRRigidTransform(
      { x: -state.offset.x, y: -state.offset.y, z: -state.offset.z },
      { x: _quat.x, y: _quat.y, z: _quat.z, w: _quat.w }
    )
  );
}

/** Détient l'espace de base + l'état joueur, applique le décalage sur le renderer. */
export class PlayerLocomotionController {
  private baseSpace: XRReferenceSpace | null = null;
  readonly state: PlayerState = createPlayerState();

  /** À appeler en tout premier au `sessionstart`, avant tout autre `setReferenceSpace`. */
  captureBaseSpace(renderer: THREE.WebGLRenderer): void {
    this.baseSpace = renderer.xr.getReferenceSpace();
  }

  reset(): void {
    this.baseSpace = null;
    this.state.offset.set(0, 0, 0);
    this.state.yaw = 0;
  }

  /** Recalcule et applique l'espace de référence depuis l'état courant. */
  applyOffset(renderer: THREE.WebGLRenderer): void {
    if (!this.baseSpace) return;
    renderer.xr.setReferenceSpace(
      computeOffsetReferenceSpace(this.baseSpace, this.state)
    );
  }
}
