/**
 * Relevé d'approche d'une surface, activé uniquement par `?debug-surface` (lot 9, phase 9B).
 *
 * Répond à une seule question, avec des chiffres plutôt qu'une impression : quand on descend
 * vers un corps, qu'est-ce qui casse en premier ? Le panneau affiche, pour la cible suivie,
 * l'altitude réelle, les plans de coupe que `CameraSystem` vient de calculer, la précision
 * de profondeur qui en découle, la dentelure de la sphère à sa densité courante,
 * l'agrandissement de la texture affichée et le nombre d'images par seconde.
 *
 * Tout le calcul vit dans `core/surfaceApproach.ts` (pur, testé) : ce module ne fait que lire
 * l'état rendu et le mettre en forme. Il est inerte sans le drapeau, comme `?debug-geo` et
 * `?debug-earth`, et il ne publie rien en production.
 */
import type { PublicAPI } from '@/SolarSystemApp';
import { flattenBodies } from '@/config/catalog';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { CAMERA_SETTINGS } from '@/config/engine';
import { KM_PER_AU, SQRT_K } from '@/core/ScaleService';
import {
  depthResolutionKm,
  facetDeviationKm,
  groundTexelKm,
  texelMagnification,
} from '@/core/surfaceApproach';
import { hasDebugFlag } from '@/utils/debugFlags';

const NEWLINE = String.fromCharCode(10);

/** Kilomètres par unité de scène : l'échelle Explo, où la Terre (1 UA) tombe à 35 unités. */
const KM_PER_UNIT = KM_PER_AU / SQRT_K;

/** Repli si le contexte ne répond pas `DEPTH_BITS` (WebGL2 peut renvoyer null). */
const DEFAULT_DEPTH_BITS = 24;

const round = (value: number, digits: number): string =>
  Number.isFinite(value) ? value.toFixed(digits) : 'n/a';

export function setupSurfaceProbe(api: PublicAPI): () => void {
  if (!hasDebugFlag('debug-surface')) {
    return () => undefined;
  }

  const radiiKm = new Map<string, number>();
  for (const [name, cfg] of flattenBodies(CELESTIAL_CONFIG)) {
    const km = cfg.realData?.radiusKm;
    if (km) radiiKm.set(name, km);
  }

  const gl = api.sceneSystem.renderer.getContext();
  const depthBits =
    (gl.getParameter(gl.DEPTH_BITS) as number | null) ?? DEFAULT_DEPTH_BITS;

  const panel = document.createElement('pre');
  panel.id = 'surface-probe';
  panel.style.cssText = [
    'position:fixed',
    'left:8px',
    'top:8px',
    'z-index:10000',
    'margin:0',
    'padding:8px 10px',
    'background:rgba(0,0,0,.82)',
    'color:#9fe7ff',
    'font:12px/1.35 monospace',
    'white-space:pre',
    'pointer-events:none',
  ].join(';');
  document.body.appendChild(panel);

  // Images par seconde sur une fenêtre glissante d'une seconde : une moyenne depuis le
  // démarrage lisserait précisément le décrochage qu'on cherche à voir en descendant.
  let frames = 0;
  let windowStart = performance.now();
  let fps = 0;

  const update = (): void => {
    frames += 1;
    const now = performance.now();
    if (now - windowStart >= 1000) {
      fps = (frames * 1000) / (now - windowStart);
      frames = 0;
      windowStart = now;
    }

    const camera = api.cameraSystem.camera;
    const name = api.cameraSystem.targetName;
    const distanceUnits = api.cameraSystem.getDistanceToTargetSceneUnits();
    const body = name ? api.sceneSystem.getBody(name) : undefined;

    const lines = [`SURFACE PROBE (?debug-surface)  depth ${depthBits} bits`];

    if (!name || distanceUnits === null) {
      lines.push('cible           aucune (vue d’ensemble)');
      panel.textContent = lines.join(NEWLINE);
      return;
    }

    // Rayon de la SPHÈRE RENDUE (celui qu'écrit `_applyScaleFactor`, donc le morph compris)
    // et rayon publié : leur rapport EST l'échelle courante, ce qui évite de supposer le
    // mode et donne la même altitude en Éducatif qu'en Exploration.
    const frameRadiusUnits =
      (body?.group.userData['radius'] as number | undefined) ?? 0;
    const radiusKm = radiiKm.get(name) ?? 0;
    const kmPerUnit =
      frameRadiusUnits > 0 && radiusKm > 0
        ? radiusKm / frameRadiusUnits
        : KM_PER_UNIT;

    const distanceKm = distanceUnits * kmPerUnit;
    const altitudeKm = distanceKm - radiusKm;
    const viewportHeightPx = api.sceneSystem.renderer.domElement.clientHeight;

    const surface = body?.getLayerDiagnostics('surface');
    // Finesse RÉELLEMENT servie : l'imagerie tuilée, quand elle peint, remplace la texture
    // livrée dans ce calcul, exactement comme elle le fait pour le plancher d'approche
    // (cf. `CelestialObject.getApproachFloorFactor`). Lire la seule texture ici donnerait un
    // agrandissement seize fois trop grand pendant que les carreaux sont à l'écran.
    const tilesWidthPx = Number(
      document.getElementById('surface-imagery')?.dataset['width'] ?? 0
    );
    const textureWidthPx = Math.max(surface?.map?.width ?? 0, tilesWidthPx);
    const vertexCount = surface?.geometry?.vertexCount ?? 0;
    // (segments + 1)² sommets pour une SphereGeometry : on remonte à la densité réelle
    // du mesh plutôt qu'à la constante de configuration, qui peut mentir après un swap.
    const segments =
      vertexCount > 0 ? Math.round(Math.sqrt(vertexCount)) - 1 : 0;

    const nearKm = camera.near * kmPerUnit;
    const farKm = camera.far * kmPerUnit;
    const depthAt = (z: number): string =>
      round(
        depthResolutionKm({ nearKm, farKm, distanceKm: z, depthBits }) * 1000,
        3
      );
    // Le near est-il DEVANT la surface la plus proche ? Sinon le corps est coupé en entier,
    // et rien à l'écran ne dit pourquoi : c'est la première chose à voir en descendant.
    const clipped = nearKm >= altitudeKm;

    lines.push(
      `cible           ${name}`,
      `rayon           ${round(radiusKm, 1)} km  (${frameRadiusUnits.toExponential(3)} u)`,
      `distance        ${round(distanceKm, 3)} km`,
      `altitude        ${round(altitudeKm, 3)} km  (${round(distanceKm / (radiusKm || 1), 6)} R)`,
      `near / far      ${nearKm.toExponential(3)} km / ${farKm.toExponential(3)} km`,
      `far/near        ${round(camera.far / camera.near, 0)}`,
      `near vs sol     ${clipped ? 'COUPE LE CORPS' : 'ok'} (${round(nearKm / (altitudeKm || 1), 3)} × altitude)`,
      `profondeur sol  ${depthAt(altitudeKm)} m`,
      `profondeur      ${depthAt(distanceKm)} m à la cible`,
      `segments        ${segments} (${vertexCount} sommets)`,
      `dentelure       ${round(facetDeviationKm(radiusKm, segments), 3)} km`,
      `texture         ${textureWidthPx || 'n/a'} px → ${round(groundTexelKm(textureWidthPx, radiusKm), 3)} km/texel`,
      `agrandissement  ${round(
        texelMagnification({
          textureWidthPx,
          radiusKm,
          altitudeKm,
          fovDeg: camera.fov,
          viewportHeightPx,
        }),
        2
      )} px/texel`,
      `fov             ${round(camera.fov, 1)}° (base ${CAMERA_SETTINGS.fov}°)`,
      `fps             ${round(fps, 1)}`
    );

    panel.textContent = lines.join(NEWLINE);
  };

  const unsubscribe = api.animationSystem.onFrame(update);
  update();
  return () => {
    unsubscribe();
    panel.remove();
  };
}
