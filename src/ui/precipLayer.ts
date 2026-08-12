/**
 * Couche PLUIE mondiale animée (NASA IMERG) superposée à la Terre. Charge les N
 * dernières frames de précipitation (pas de 30 min) autour de la date de simulation et
 * les joue EN BOUCLE → les systèmes pluvieux/orageux se déplacent réellement. Chaque
 * frame est remappée en nuages d'orage réalistes par le matériau (createPrecipMaterial).
 *
 * Réutilise le service pur `core/gibsPrecip` (URL + génération des instants). Chargement
 * par URL via un TextureLoader dédié (hors TextureSystem, réservé aux fichiers locaux).
 * Fenêtre de frames recalée sur la date (SimulationClock) ; repli silencieux si le
 * réseau échoue (couche masquée).
 */
import * as THREE from 'three';
import Logger from '@/utils/Logger';
import { PRECIP_SETTINGS } from '@/config/engine';
import { imergEndForDate, imergFrameTimes, imergUrl } from '@/core/gibsPrecip';
import type { PublicAPI } from '@/SolarSystemApp';

const EARTH_NAME = 'earth';

export function setupPrecipLayer(api: PublicAPI): () => void {
  const settings = PRECIP_SETTINGS;
  if (!settings.enabled) return () => {};

  const earth = api.sceneSystem.getBody(EARTH_NAME);
  if (!earth) return () => {};

  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');

  // Cache par instant IMERG (ISO). Les textures sont réutilisées entre fenêtres.
  const cache = new Map<string, THREE.Texture>();
  const inFlight = new Map<string, Promise<THREE.Texture>>();

  // Fenêtre courante = liste ordonnée d'instants (clés ISO). La boucle joue les frames
  // de cette fenêtre qui sont chargées.
  let windowKeys: string[] = [];
  // Clé de la fin de fenêtre : évite de recalculer la fenêtre tant que le jour/heure
  // cible (arrondi 30 min) n'a pas changé.
  let lastEndKey: string | null = null;
  // Index de lecture courant dans windowKeys.
  let playIndex = 0;
  // Dernière frame réellement appliquée (évite de re-binder la même texture).
  let appliedKey: string | null = null;

  function loadKey(key: string): Promise<THREE.Texture> {
    const cached = cache.get(key);
    if (cached) return Promise.resolve(cached);
    const existing = inFlight.get(key);
    if (existing) return existing;
    const url = imergUrl(new Date(key), {
      layer: settings.layer,
      width: settings.resolution,
    });
    const promise = new Promise<THREE.Texture>((resolve, reject) => {
      loader.load(
        url,
        (t) => {
          cache.set(key, t);
          inFlight.delete(key);
          resolve(t);
        },
        undefined,
        (err) => {
          inFlight.delete(key);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      );
    });
    inFlight.set(key, promise);
    return promise;
  }

  /** Recalcule la fenêtre de frames pour une date de simulation et précharge tout. */
  function refreshWindow(simDate: Date): void {
    const end = imergEndForDate(simDate, {
      latencyHours: settings.latencyHours,
      minDate: settings.minDate,
    });
    if (end === null) {
      // Hors plage : on garde la dernière fenêtre (rien à recharger).
      lastEndKey = null;
      return;
    }
    const endKey = end.toISOString();
    if (endKey === lastEndKey) return;
    lastEndKey = endKey;

    const frames = imergFrameTimes(end, settings.frameCount, {
      minDate: settings.minDate,
    });
    windowKeys = frames.map((d) => d.toISOString());
    playIndex = 0;
    // Précharge toutes les frames (échec toléré par frame : la boucle saute les trous).
    for (const key of windowKeys) {
      void loadKey(key).catch((err) => {
        Logger.warn(`[PrecipLayer] Frame IMERG indisponible (${key}).`, err);
      });
    }
  }

  // Avance la lecture à la cadence playbackFps et applique la frame chargée courante.
  let lastAdvance = 0;
  const advanceMs = 1000 / Math.max(0.1, settings.playbackFps);

  function tickPlayback(nowMs: number): void {
    if (windowKeys.length === 0) return;
    if (nowMs - lastAdvance < advanceMs) return;
    lastAdvance = nowMs;

    // Cherche la prochaine frame CHARGÉE à partir de playIndex (saute les trous).
    const n = windowKeys.length;
    for (let step = 0; step < n; step++) {
      const idx = (playIndex + step) % n;
      const key = windowKeys[idx];
      const tex = cache.get(key);
      if (tex) {
        if (key !== appliedKey) {
          earth!.setPrecipTexture(tex, { opacity: settings.opacity });
          appliedKey = key;
        }
        playIndex = (idx + 1) % n;
        return;
      }
    }
    // Aucune frame chargée pour l'instant : on réessaiera au prochain tick.
  }

  // Première fenêtre + boucle.
  refreshWindow(api.orbitalMechanics.simulationDate);

  let lastWindowCheck = 0;
  const WINDOW_CHECK_MS = 1000;
  const unsubscribe = api.animationSystem.onFrame(() => {
    const now = performance.now();
    if (now - lastWindowCheck >= WINDOW_CHECK_MS) {
      lastWindowCheck = now;
      refreshWindow(api.orbitalMechanics.simulationDate);
    }
    tickPlayback(now);
  });

  return () => {
    unsubscribe();
    cache.forEach((t) => t.dispose());
    cache.clear();
    inFlight.clear();
    windowKeys = [];
  };
}
