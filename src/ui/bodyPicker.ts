/**
 * Sélection d'un corps par clic 3D (raycasting) — complément direct des labels Explo.
 *
 * En mode Éducatif, les corps sont des meshes visibles : cliquer dessus les cible via la même
 * commande de navigation partagée (`PlanetNavigation`) que la barre et les labels. Un clic est
 * distingué d'un glisser-pivoter (OrbitControls) par le déplacement du pointeur ; un tir qui ne
 * touche aucun corps ne fait rien. En Explo les corps sont des points sous-pixel : le raycast
 * les rate presque toujours, et ce sont alors les labels qui prennent le relais — inoffensif.
 */
import * as THREE from 'three';
import { isForwardedControlEvent } from './controlEventForwarding';
import type { PlanetNavigation } from './planetNav';

/** Déplacement max (px) entre pointerdown et pointerup pour rester un « clic » (sinon glisser). */
const CLICK_MOVE_TOLERANCE = 5;

interface PointerStart {
  id: number;
  x: number;
  y: number;
}

/**
 * Remonte la hiérarchie depuis l'objet touché jusqu'au premier ancêtre dont le nom est un
 * corps du catalogue (le `group` d'un `CelestialObject` porte le nom du corps).
 */
function resolveBodyName(
  object: THREE.Object3D,
  validNames: ReadonlySet<string>
): string | null {
  let o: THREE.Object3D | null = object;
  while (o) {
    if (validNames.has(o.name)) return o.name;
    o = o.parent;
  }
  return null;
}

export function setupBodyPicker(
  scene: THREE.Scene,
  camera: THREE.Camera,
  domElement: HTMLElement,
  nav: PlanetNavigation,
  validNames: ReadonlySet<string>
): () => void {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let pointerStart: PointerStart | null = null;

  const onPointerDown = (event: PointerEvent): void => {
    // Les labels Explo réémettent leur pointerdown au canvas pour OrbitControls. Le picker
    // l'ignore : sinon le pointerup capturé par le canvas sélectionnerait le mesh situé dessous.
    if (
      isForwardedControlEvent(event) ||
      !event.isPrimary ||
      event.button !== 0
    ) {
      return;
    }
    pointerStart = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (!pointerStart || event.pointerId !== pointerStart.id) return;

    const start = pointerStart;
    pointerStart = null;

    // Un glisser (rotation caméra) ne doit pas sélectionner.
    if (
      Math.hypot(event.clientX - start.x, event.clientY - start.y) >
      CLICK_MOVE_TOLERANCE
    ) {
      return;
    }

    const rect = domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    // Coordonnées normalisées relativement au canvas : celui-ci peut ne pas remplir le viewport
    // (embed, plein écran sur un élément, barre de navigateur mobile).
    ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);

    // Intersections triées par distance croissante : le premier corps touché gagne (les
    // corps proches passent avant la sphère lointaine du fond étoilé).
    for (const hit of raycaster.intersectObjects(scene.children, true)) {
      const name = resolveBodyName(hit.object, validNames);
      if (name) {
        nav.selectBody(name);
        return;
      }
    }
  };

  const onPointerCancel = (event: PointerEvent): void => {
    if (pointerStart?.id === event.pointerId) pointerStart = null;
  };

  domElement.addEventListener('pointerdown', onPointerDown);
  domElement.addEventListener('pointerup', onPointerUp);
  domElement.addEventListener('pointercancel', onPointerCancel);

  return () => {
    pointerStart = null;
    domElement.removeEventListener('pointerdown', onPointerDown);
    domElement.removeEventListener('pointerup', onPointerUp);
    domElement.removeEventListener('pointercancel', onPointerCancel);
  };
}
