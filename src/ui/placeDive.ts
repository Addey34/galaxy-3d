/**
 * LA PLONGÉE SUR UN LIEU NOMMÉ (lot 63, pas A) : un clic sur un nom de la surface fait voler la
 * caméra jusqu'à la formation et la cadre à la taille qu'on lui connaît. Le calcul de distance
 * est pur (`core/placeDive.ts`) ; ici ne vivent que l'animation et le branchement.
 *
 * Rien ne se charge ici : les tuiles de surface s'approchent d'elles-mêmes à mesure que la
 * distance baisse, et la date de la scène les pilote déjà (imagerie annuelle, couches du jour).
 * La plongée ne choisit donc aucune donnée, elle ne fait que rapprocher.
 */
import * as THREE from 'three';
import { iauLongitudeToSceneLongitude } from '@/core/gazetteer';
import { altitudeToFrame, diveDistance } from '@/core/placeDive';
import { viewAnglesFromDirection } from '@/core/viewAngles';
import { t } from '@/i18n';
import { bodyDisplayName } from '@/i18n/bodyText';
import { prefersReducedMotion } from '@/utils/reducedMotion';
import type { CameraSystem } from '@/components/systems/CameraSystem';
import type { SceneSystem } from '@/components/systems/SceneSystem';
import { getAnnouncer } from './announcer';
import type { DrawnPlace } from './gazetteerOverlay';

/** Durée du vol de la dernière approche, en ms (nulle sous `prefers-reduced-motion`). */
const DIVE_DURATION_MS = 1600;

/** Plus court chemin entre deux azimuts, en degrés. */
export function shortestAzimuthDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

const ease = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

export function setupPlaceDive(
  cameraSystem: CameraSystem,
  sceneSystem: SceneSystem,
  radiusKm: (body: string) => number | undefined
): { dive: (place: DrawnPlace) => boolean } {
  let frame = 0;

  const cancel = (): void => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };

  // Un geste de l'utilisateur reprend la main : la plongée ne lutte pas contre lui.
  const canvas = cameraSystem.renderer.domElement;
  canvas.addEventListener('pointerdown', cancel);
  canvas.addEventListener('wheel', cancel, { passive: true });

  const dive = (place: DrawnPlace): boolean => {
    const object = sceneSystem.getBody(place.body);
    const km = radiusKm(place.body);
    const sceneRadius =
      (object?.group.userData['radius'] as number | undefined) ?? 0;
    if (!object || !km || sceneRadius <= 0) return false;
    // Un vol de corps en cours (sélection) écraserait la pose : on n'ajoute rien par-dessus.
    if (cameraSystem.isFlying) return false;

    const view = cameraSystem.getViewAngles();
    if (!view) return false;
    const centre = object.group.getWorldPosition(new THREE.Vector3());
    const point = object.surfacePointToWorld(
      place.lat,
      iauLongitudeToSceneLongitude(place.lon)
    );
    const target = viewAnglesFromDirection(point.clone().sub(centre));
    if (!target) return false;

    const camera = cameraSystem.camera;
    const altitude = altitudeToFrame(
      place.diameterKm,
      camera.fov,
      camera.aspect
    );
    const distance = diveDistance(sceneRadius, km, altitude);
    if (!(distance > 0)) return false;

    cancel();
    // Les noms sont sur un canevas : sans cette annonce, la plongée serait muette pour un
    // lecteur d'écran, qui n'a de toute façon aucun moyen de cliquer un nom.
    getAnnouncer().announce(
      t('a11y.placeDive', {
        place: place.name,
        body: bodyDisplayName(place.body),
      }),
      'place-dive'
    );
    const publish = (): void => {
      canvas.dataset['placeDive'] = `${place.name}|${distance.toFixed(4)}`;
    };
    if (prefersReducedMotion()) {
      cameraSystem.applyViewAngles(
        target.azimuthDeg,
        target.polarDeg,
        distance
      );
      publish();
      return true;
    }

    const start = performance.now();
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / DIVE_DURATION_MS);
      const k = ease(t);
      cameraSystem.applyViewAngles(
        view.azimuthDeg +
          shortestAzimuthDelta(view.azimuthDeg, target.azimuthDeg) * k,
        view.polarDeg + (target.polarDeg - view.polarDeg) * k,
        // Distance interpolée en LOG : l'approche garde la même vitesse apparente, un
        // interpolateur linéaire resterait lent puis plongerait d'un coup.
        view.distance * (distance / view.distance) ** k
      );
      if (t < 1) frame = requestAnimationFrame(step);
      else {
        frame = 0;
        publish();
      }
    };
    frame = requestAnimationFrame(step);
    return true;
  };

  return { dive };
}
