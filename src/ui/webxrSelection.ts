/**
 * Sélection d'un corps par rayon laser depuis un contrôleur VR — équivalent VR de
 * `ui/bodyPicker.ts`. Un seul geste décisif (pression gâchette) confirme, pas de machine à
 * états visée/maintien/relâche : le rayon est toujours visible pendant la session, "viser"
 * c'est juste pointer le contrôleur — comme le picker desktop utilise déjà le clic seul, pas
 * un survol puis confirmation.
 *
 * En Explo, une sélection déclenche aussi une téléportation (voir `teleportToBody` — câblé
 * par `ui/webxr.ts`, ce module ne fait que la sélection/le raycast).
 */
import * as THREE from 'three';
import { raycastTargets, resolveBodyName } from './bodyPicker';
import type { PlanetNavigation } from './planetNav';

const raycaster = new THREE.Raycaster();
const _controllerQuat = new THREE.Quaternion();

function aimRaycaster(controller: THREE.XRTargetRaySpace): void {
  raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
  controller.getWorldQuaternion(_controllerQuat);
  raycaster.ray.direction.set(0, 0, -1).applyQuaternion(_controllerQuat);
}

/** Distance de repli du réticule quand le rayon ne touche rien — évite qu'il file à l'infini. */
const RETICLE_FALLBACK_DISTANCE = 5;

export interface AimResult {
  /** Nom du corps visé, ou `null` si le rayon ne touche rien de valide. */
  name: string | null;
  /** Point d'impact (sur le corps si touché, sinon un point de repli le long du rayon). */
  point: THREE.Vector3;
}

/** Comme `pickBodyFromController`, mais renvoie aussi le point d'impact pour le réticule. */
export function aimController(
  controller: THREE.XRTargetRaySpace,
  scene: THREE.Scene,
  validNames: ReadonlySet<string>
): AimResult {
  aimRaycaster(controller);
  for (const hit of raycaster.intersectObjects(raycastTargets(scene), false)) {
    const name = resolveBodyName(hit.object, validNames);
    if (name) return { name, point: hit.point.clone() };
  }
  const fallback = raycaster.ray.origin
    .clone()
    .addScaledVector(raycaster.ray.direction, RETICLE_FALLBACK_DISTANCE);
  return { name: null, point: fallback };
}

/** Corps touché par le rayon d'un contrôleur, ou `null` si rien de valide dans sa ligne de mire. */
export function pickBodyFromController(
  controller: THREE.XRTargetRaySpace,
  scene: THREE.Scene,
  validNames: ReadonlySet<string>
): string | null {
  return aimController(controller, scene, validNames).name;
}

/**
 * Position cible pour une téléportation instantanée vers un corps : recule de `viewDistance`
 * depuis la position du corps, le long de la direction actuelle joueur→corps (approche du même
 * côté d'où l'on regardait déjà). Réutilise `CelestialObject.cameraDistance.explo` — le même
 * "combien reculer pour bien cadrer ce corps" que le vol caméra desktop, pas une nouvelle math.
 */
export function computeTeleportTarget(
  bodyWorldPos: THREE.Vector3,
  viewDistance: number,
  playerOffset: THREE.Vector3
): THREE.Vector3 {
  const approach = playerOffset.clone().sub(bodyWorldPos);
  if (approach.lengthSq() < 1e-6) approach.set(0, 0, 1); // déjà quasi sur place : direction arbitraire
  approach.normalize();
  return bodyWorldPos.clone().addScaledVector(approach, viewDistance);
}

const RETICLE_VALID_COLOR = 0x6ecbff;
const RETICLE_EMPTY_COLOR = 0x555a66;

export interface WebXRReticle {
  mesh: THREE.Mesh;
  /** Repositionne/recolore le réticule selon le résultat de visée courant. */
  update(aim: AimResult, controller: THREE.XRTargetRaySpace): void;
  setVisible(visible: boolean): void;
}

/**
 * Réticule de confort pendant la visée — rayon droit implicite (juste la position), pas d'arc
 * parabolique : la téléportation est un déplacement instantané point-à-point, pas balistique,
 * un simple point d'atterrissage coloré est honnête vis-à-vis de ce qui se passe réellement.
 */
export function createReticle(): WebXRReticle {
  const geometry = new THREE.RingGeometry(0.03, 0.05, 24);
  const material = new THREE.MeshBasicMaterial({
    color: RETICLE_EMPTY_COLOR,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 998;

  return {
    mesh,
    update(aim, controller) {
      mesh.position.copy(aim.point);
      const toController = controller.position.clone().sub(aim.point).normalize();
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), toController);
      material.color.set(aim.name ? RETICLE_VALID_COLOR : RETICLE_EMPTY_COLOR);
    },
    setVisible(visible) {
      mesh.visible = visible;
    },
  };
}

export interface WebXRSelectionHandle {
  dispose(): void;
}

/** Câble la gâchette d'un contrôleur : pression → raycast → sélection si une cible est touchée. */
export function setupControllerSelection(
  controller: THREE.XRTargetRaySpace,
  scene: THREE.Scene,
  validNames: ReadonlySet<string>,
  nav: PlanetNavigation,
  onSelect?: (name: string) => void
): WebXRSelectionHandle {
  const onSelectStart = (): void => {
    const name = pickBodyFromController(controller, scene, validNames);
    if (!name) return;
    nav.selectBody(name);
    onSelect?.(name);
  };
  controller.addEventListener('selectstart', onSelectStart);
  return {
    dispose: () => controller.removeEventListener('selectstart', onSelectStart),
  };
}
