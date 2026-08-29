/**
 * Sondage continu des manettes VR — vol libre (Éduc) + virage snap (les deux modes).
 *
 * Convention : stick GAUCHE = déplacement relatif au lacet de la tête, stick DROIT = virage
 * snap. Sépare mouvement et rotation (une rotation fluide au joystick est une cause connue de
 * mal des transports en VR) ; convention quasi universelle, transfère la mémoire musculaire.
 *
 * Vitesse en unités scène/seconde, PAS une vitesse de marche réelle : l'espace de référence
 * WebXR mappe 1 unité = 1 mètre physique sur les unités de scène, qui sont astronomiques ici
 * (échelle compressée Éduc / réelle Explo) — une vitesse de marche serait inutilisable.
 */
import * as THREE from 'three';
import type { PlayerState } from './webxrReferenceSpace';

/** Unités scène/seconde en vol libre — traverse tout le système Éduc (~200u) en ~6-7 s. */
export const FLIGHT_SPEED = 30;
/** Zone morte standard manette — filtre la dérive/le bruit du stick au repos. */
export const DEADZONE = 0.15;
/** Angle de virage snap, degrés — défaut confort VR courant. */
export const SNAP_TURN_DEG = 30;

/** Ignore un axe sous la zone morte (dérive du stick au repos). */
export function applyDeadzone(
  x: number,
  y: number,
  threshold = DEADZONE
): { x: number; y: number } {
  return Math.hypot(x, y) < threshold ? { x: 0, y: 0 } : { x, y };
}

/**
 * Anti-rebond du virage snap : un cran par passage au-delà de la zone morte, doit repasser en
 * dessous avant de re-déclencher (sinon un stick maintenu tournerait en continu).
 */
export function stepSnapTurn(
  axisX: number,
  armed: boolean,
  deadzone = DEADZONE,
  snapDeg = SNAP_TURN_DEG
): { yawDeltaRad: number; armed: boolean } {
  if (Math.abs(axisX) < deadzone) return { yawDeltaRad: 0, armed: true };
  if (!armed) return { yawDeltaRad: 0, armed: false };
  return {
    yawDeltaRad: Math.sign(axisX) * THREE.MathUtils.degToRad(snapDeg),
    armed: false,
  };
}

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** Lit le stick gauche de chaque source et avance `state.offset` (vol libre, Éduc uniquement). */
export function pollMovement(
  session: XRSession,
  camera: THREE.Camera,
  state: PlayerState,
  dt: number
): boolean {
  let moved = false;
  for (const source of session.inputSources) {
    if (source.handedness !== 'left' || !source.gamepad) continue;
    const axes = source.gamepad.axes;
    const { x, y } = applyDeadzone(axes[2] ?? 0, axes[3] ?? 0);
    if (x === 0 && y === 0) continue;

    _forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    _forward.y = 0; // pas de dérive verticale liée au tangage de la tête
    if (_forward.lengthSq() < 1e-9) continue;
    _forward.normalize();
    _right.crossVectors(_forward, _up).normalize();

    state.offset.addScaledVector(_forward, -y * FLIGHT_SPEED * dt);
    state.offset.addScaledVector(_right, x * FLIGHT_SPEED * dt);
    moved = true;
  }
  return moved;
}

/** État d'armement du virage snap, un flag par main droite trackée (généralement une seule). */
const armedByHand = new Map<string, boolean>();

/** Lit le stick droit de chaque source et applique un virage snap le cas échéant. */
export function pollSnapTurn(session: XRSession, state: PlayerState): boolean {
  let turned = false;
  for (const source of session.inputSources) {
    if (source.handedness !== 'right' || !source.gamepad) continue;
    const key = source.handedness;
    const axisX = source.gamepad.axes[2] ?? 0;
    const armed = armedByHand.get(key) ?? true;
    const { yawDeltaRad, armed: nextArmed } = stepSnapTurn(axisX, armed);
    armedByHand.set(key, nextArmed);
    if (yawDeltaRad !== 0) {
      state.yaw += yawDeltaRad;
      turned = true;
    }
  }
  return turned;
}

/** Réarme le virage snap (à appeler à la sortie de session pour repartir propre). */
export function resetSnapTurnArming(): void {
  armedByHand.clear();
}
