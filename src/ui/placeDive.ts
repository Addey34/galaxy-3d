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
import { createMarkerIntent } from '@/core/markerIntent';
import { altitudeToFrame, diveDistance } from '@/core/placeDive';
import { viewAnglesFromDirection } from '@/core/viewAngles';
import { t } from '@/i18n';
import { bodyDisplayName } from '@/i18n/bodyText';
import { prefersReducedMotion } from '@/utils/reducedMotion';
import type { CameraSystem } from '@/components/systems/CameraSystem';
import type { SceneSystem } from '@/components/systems/SceneSystem';
import { getAnnouncer } from './announcer';
import { loadDeferredMessages } from '@/i18n/deferredMessages';
import { FORMATION_MARKER_ID } from './formationMarkerId';
import type { DrawnPlace } from './gazetteerOverlay';

/** Ce dont la plongée a besoin d'un lieu : un nom dessiné en porte plus, un nom cherché moins. */
export type DivePlace = Pick<
  DrawnPlace,
  'body' | 'name' | 'lat' | 'lon' | 'diameterKm'
>;

/** Durée du vol de la dernière approche, en ms (nulle sous `prefers-reduced-motion`). */
const DIVE_DURATION_MS = 1600;

/** Combien de temps (ms) une plongée persistante rejoue le vol avant d'y renoncer. */
const PERSIST_MS = 60_000;

/** Cadence (ms) à laquelle une plongée persistante vérifie qu'elle est arrivée. */
const PERSIST_INTERVAL_MS = 700;

/** Écart toléré entre la distance voulue et la distance obtenue, avant de dire « arrivée ». */
const REACHED_TOLERANCE = 1.05;

/** Durée d'affichage du repère d'une plongée, ms : le temps d'une visite guidée, pas plus. */
const MARKER_MS = 90_000;

/** Plus court chemin entre deux azimuts, en degrés. */
/**
 * Le geste de plonger, offert aux blocs de la fiche (`ui/citiesBlock`) qui n'ont pas la caméra :
 * la racine de composition le branche une fois la plongée construite, un bloc le demande.
 */
let requested: ((place: DivePlace) => boolean) | null = null;

export function registerPlaceDive(dive: (place: DivePlace) => boolean): void {
  requested = dive;
}

export function requestPlaceDive(place: DivePlace): boolean {
  return requested ? requested(place) : false;
}

export function shortestAzimuthDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

const ease = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

export function setupPlaceDive(
  cameraSystem: CameraSystem,
  sceneSystem: SceneSystem,
  radiusKm: (body: string) => number | undefined,
  onFrame?: (callback: () => void) => () => void
): {
  dive: (place: DivePlace) => boolean;
  /**
   * Plonge puis REJOUE la plongée à mesure que les carreaux arrivent, jusqu'à la distance voulue :
   * les bornes d'approche suivent la finesse de l'imagerie DÉJÀ servie (voir `reached`), donc un
   * seul vol s'arrête haut. Un geste de l'utilisateur sur la scène l'interrompt, et elle renonce
   * après `PERSIST_MS` plutôt que de lutter indéfiniment.
   */
  diveUntilReached: (place: DivePlace) => boolean;
  /**
   * Plonge sur un lieu NOMMÉ, sans l'avoir sous les yeux (une visite guidée). `frameKm` remplace
   * la taille qu'on lui connaît : la Terre n'en a pas (le niveau de zoom d'un nom de Natural
   * Earth n'est pas un diamètre), et un delta se cadre à l'échelle où l'on voit ce qui change.
   */
  diveToName: (
    body: string,
    name: string,
    frameKm?: number
  ) => Promise<boolean>;
  /** Vrai tant que l'animation d'approche court : le fait qu'une visite attend. */
  isDiving: () => boolean;
  /**
   * La caméra est-elle arrivée à la distance voulue ? Pas toujours : ses bornes d'approche suivent
   * la finesse de l'imagerie DÉJÀ servie, qui ne s'affine qu'en approchant. La première plongée
   * s'arrête donc à 470 km là où la cible en demandait 100 ; il faut la rejouer à mesure que les
   * carreaux arrivent.
   */
  reached: () => boolean;
} {
  let frame = 0;
  /** Distance (unités de scène) de la dernière plongée lancée, `0` avant la première. */
  let wanted = 0;
  /**
   * L'INTENTION du repère (`core/markerIntent.ts`) : un repère dont le chargement finit APRÈS un
   * abandon (geste, Échap, autre corps) ne se pose pas, et une plongée rejouée ne le repose que
   * si le chargement a ÉCHOUÉ, jamais après un abandon.
   */
  const markerIntent = createMarkerIntent();

  /**
   * Le REPÈRE du lieu visé (`ui/formationMarker`, une couche d'instrument, jamais un mesh) : sur un
   * terrain sans détail reconnaissable, rien d'autre ne dit à l'écran quel lieu la plongée vise.
   * Il suit la pose RENDUE du corps (`surfacePointToWorld`, donc la rotation datée de la Lune et
   * de Mars), se masque derrière le limbe, et disparaît au premier geste, sur Échap, au
   * changement de cible, au remplacement par un autre lieu ou après `MARKER_MS`.
   */
  const markTarget = (place: DivePlace, replay: boolean): void => {
    const key = `${place.body}|${place.name}`;
    const mine = markerIntent.request(
      key,
      replay,
      !!document.getElementById(FORMATION_MARKER_ID)
    );
    if (mine === null) return;
    const target = cameraSystem.currentTarget;
    void Promise.all([
      import('./formationMarker'),
      loadDeferredMessages(),
    ]).then(
      ([marker]) => {
        // Une autre demande, un abandon ou un autre corps a pris la main pendant le chargement.
        if (cameraSystem.currentTarget !== target) {
          // Seule la tentative COURANTE peut abandonner : une réponse obsolète (autre cible, demande
          // déjà remplacée) ne doit pas annuler l'intention qui l'a remplacée.
          if (markerIntent.isCurrent(mine)) markerIntent.abandon();
          return;
        }
        if (!markerIntent.resolved(mine)) return;
        const lon = iauLongitudeToSceneLongitude(place.lon);
        marker.showFormationMarker({
          camera: cameraSystem,
          body: place.body,
          place: place.name,
          target,
          hint: null,
          onFrame,
          announce: false,
          lifetimeMs: MARKER_MS,
          point: (out) => {
            const live = sceneSystem.getBody(place.body);
            if (!live) return false;
            out.copy(live.surfacePointToWorld(place.lat, lon));
            return true;
          },
          centre: (out) => {
            const live = sceneSystem.getBody(place.body);
            if (!live) return false;
            live.group.getWorldPosition(out);
            return true;
          },
        });
      },
      () => markerIntent.rejected(mine)
    );
  };

  const cancel = (): void => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };

  // Un geste de l'utilisateur reprend la main : la plongée ne lutte pas contre lui.
  const canvas = cameraSystem.renderer.domElement;
  const abandon = (): void => {
    cancel();
    markerIntent.abandon();
  };
  canvas.addEventListener('pointerdown', abandon);
  canvas.addEventListener('wheel', abandon, { passive: true });
  // Échap abandonne le repère demandé, même si son module n'est pas encore arrivé (le gestionnaire
  // du repère n'existe qu'une fois posé). Ni la plongée ni sa persistance ne sont touchées, et
  // l'événement n'est ni retenu ni arrêté : les autres usages d'Échap (fiches, visites) restent.
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') markerIntent.abandon();
    },
    true
  );

  const dive = (place: DivePlace, replay = false): boolean => {
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

    // Une plongée rejouée ne change pas d'intention : elle ne doit pas invalider le repère en attente.
    if (!replay) cancel();
    wanted = distance;
    // Le lieu visé reste au centre : sans cela le relevé vers l'horizon le rejette sous l'écran.
    cameraSystem.holdLevelView();
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
      markTarget(place, replay);
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
    markTarget(place, replay);
    return true;
  };

  const diveToName = async (
    body: string,
    name: string,
    frameKm?: number
  ): Promise<boolean> => {
    // À la demande : `placeObservations` n'entre pas dans le démarrage (`NON_BOOT_CHUNKS`), et
    // seule une visite guidée passe ici.
    const { loadFormations } = await import('@/config/placeObservations');
    const feature = (await loadFormations(body))?.find((f) => f.name === name);
    if (!feature) return false;
    return dive({
      body,
      name,
      lat: feature.lat,
      lon: feature.lon,
      diameterKm: frameKm ?? feature.diameterKm,
    });
  };

  const reached = (): boolean => {
    const view = cameraSystem.getViewAngles();
    return wanted > 0 && !!view && view.distance <= wanted * REACHED_TOLERANCE;
  };

  let persistTimer: number | null = null;
  let halted = false;
  const halt = (): void => {
    halted = true;
    if (persistTimer !== null) window.clearInterval(persistTimer);
    persistTimer = null;
  };
  canvas.addEventListener('pointerdown', halt);
  canvas.addEventListener('wheel', halt, { passive: true });

  const diveUntilReached = (place: DivePlace): boolean => {
    if (persistTimer !== null) window.clearInterval(persistTimer);
    persistTimer = null;
    if (!dive(place)) return false;
    halted = false;
    const startedAt = performance.now();
    persistTimer = window.setInterval(() => {
      if (halted || reached() || performance.now() - startedAt > PERSIST_MS) {
        halt();
        return;
      }
      // Encore en vol : on laisse finir. Sinon on rejoue, la borne d'approche a pu descendre.
      if (frame === 0) dive(place, true);
    }, PERSIST_INTERVAL_MS);
    return true;
  };

  return {
    dive,
    diveUntilReached,
    diveToName,
    isDiving: () => frame !== 0,
    reached,
  };
}
