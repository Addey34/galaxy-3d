/**
 * TOURNER LA CAMÉRA VERS UNE FORMATION NOMMÉE : partagé par la recherche (`paletteSearch.ts`) et,
 * depuis le lot 55, par l'adresse `?place=` qu'ouvrent les pages des grands lieux. Chargé À LA
 * DEMANDE dans les deux cas : rien de ce module n'entre dans le démarrage.
 */
import * as THREE from 'three';
import { iauLongitudeToSceneLongitude } from '@/core/gazetteer';
import { viewAnglesFromDirection } from '@/core/viewAngles';
import { loadFormations } from '@/config/placeObservations';
import type { PublicAPI } from '@/SolarSystemApp';

/**
 * La caméra face à une formation : la direction va du centre du corps RENDU au point de surface
 * que `surfacePointToWorld` donne (la chaîne qui oriente la texture et les noms du gazetteer),
 * appliquée une fois le vol fini, sinon le vol l'écraserait à son arrivée.
 */
export async function lookAtFormation(
  api: PublicAPI,
  body: string,
  name: string,
  onDone: () => void
): Promise<void> {
  const features = await loadFormations(body);
  const feature = features?.find((f) => f.name === name);
  const camera = api.cameraSystem;
  if (!feature) return;
  camera.whenSettled(() => {
    const object = api.sceneSystem.getBody(body);
    const view = camera.getViewAngles();
    if (!object || !view) return;
    const centre = object.group.getWorldPosition(new THREE.Vector3());
    const point = object.surfacePointToWorld(
      feature.lat,
      iauLongitudeToSceneLongitude(feature.lon)
    );
    const angles = viewAnglesFromDirection(point.clone().sub(centre));
    if (!angles) return;
    camera.applyViewAngles(angles.azimuthDeg, angles.polarDeg, view.distance);
    publishFocus(name, point, centre, camera.camera);
    onDone();
  });
}

/**
 * OÙ TOMBE LA FORMATION À L'ÉCRAN une fois cadrée, publié sur le canvas comme les autres couches
 * d'instrument publient leurs comptes : son nom, sa distance au centre de l'image (coordonnées
 * normalisées, 0 au centre, 1 au bord) et sa face (`front` si la caméra voit sa surface).
 * `e2e/search.spec.ts` le lit : sans lui, rien ne distinguerait « la Lune » de « Tycho ».
 */
function publishFocus(
  name: string,
  point: THREE.Vector3,
  centre: THREE.Vector3,
  camera: THREE.PerspectiveCamera
): void {
  const canvas = document.querySelector('canvas');
  if (!canvas) return;
  camera.updateMatrixWorld();
  const normal = point.clone().sub(centre).normalize();
  const toCamera = camera.position.clone().sub(point).normalize();
  const projected = point.clone().project(camera);
  const offset = Math.hypot(projected.x, projected.y);
  canvas.dataset['searchFocus'] =
    `${name}|${offset.toFixed(3)}|${normal.dot(toCamera) > 0 ? 'front' : 'back'}`;
}
