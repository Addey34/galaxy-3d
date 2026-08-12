/**
 * Couche PLUIE mondiale (NASA IMERG) superposée à la Terre. Étape A : frame unique (la
 * précipitation la plus récente disponible, ou celle de la date de simulation), remappée
 * en teinte réaliste par le matériau (voir createPrecipMaterial). L'étape B (boucle
 * animée multi-frames) réutilisera `imergFrameTimes` du service pur.
 *
 * Jumeau de `ui/realtimeClouds` : chargement par URL (TextureLoader dédié, hors
 * TextureSystem qui ne gère que des fichiers locaux), observation de la date via
 * `AnimationSystem.onFrame` (throttlé), repli silencieux si le réseau échoue.
 */
import * as THREE from 'three';
import Logger from '@/utils/Logger';
import { PRECIP_SETTINGS } from '@/config/engine';
import { imergEndForDate, imergUrl } from '@/core/gibsPrecip';
import type { PublicAPI } from '@/SolarSystemApp';

const EARTH_NAME = 'earth';

export function setupPrecipLayer(api: PublicAPI): () => void {
  const settings = PRECIP_SETTINGS;
  if (!settings.enabled) return () => {};

  const earth = api.sceneSystem.getBody(EARTH_NAME);
  if (!earth) return () => {};

  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');

  const cache = new Map<string, THREE.Texture>();
  const inFlight = new Map<string, Promise<THREE.Texture>>();

  // Dernier instant IMERG (ISO) appliqué / demandé : évite de recharger tant que la
  // frame cible (arrondie à 30 min) ne change pas.
  let appliedKey: string | null = null;
  let lastRequestedKey: string | null = null;

  function loadForKey(key: string, url: string): Promise<THREE.Texture> {
    const cached = cache.get(key);
    if (cached) return Promise.resolve(cached);
    const existing = inFlight.get(key);
    if (existing) return existing;
    const promise = new Promise<THREE.Texture>((resolve, reject) => {
      loader.load(
        url,
        (texture) => {
          cache.set(key, texture);
          inFlight.delete(key);
          resolve(texture);
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

  function applyForSimulationDate(simDate: Date): void {
    const end = imergEndForDate(simDate, {
      latencyHours: settings.latencyHours,
      minDate: settings.minDate,
    });
    // Hors plage (avant le début IMERG) : rien à afficher.
    if (end === null) {
      lastRequestedKey = null;
      return;
    }
    const key = end.toISOString();
    if (key === lastRequestedKey) return;
    lastRequestedKey = key;

    const url = imergUrl(end, {
      layer: settings.layer,
      width: settings.resolution,
    });
    void loadForKey(key, url)
      .then((texture) => {
        if (key !== lastRequestedKey) return;
        if (key === appliedKey) return;
        earth!.setPrecipTexture(texture, { opacity: settings.opacity });
        appliedKey = key;
        Logger.success(`[PrecipLayer] Pluie appliquée (${key}).`);
      })
      .catch((err) => {
        lastRequestedKey = appliedKey;
        Logger.warn(
          `[PrecipLayer] Échec du chargement IMERG (${key}) — couche pluie masquée.`,
          err
        );
      });
  }

  applyForSimulationDate(api.orbitalMechanics.simulationDate);

  let lastCheck = 0;
  const CHECK_INTERVAL_MS = 500;
  const unsubscribe = api.animationSystem.onFrame(() => {
    const now = performance.now();
    if (now - lastCheck < CHECK_INTERVAL_MS) return;
    lastCheck = now;
    applyForSimulationDate(api.orbitalMechanics.simulationDate);
  });

  return () => {
    unsubscribe();
    cache.forEach((t) => t.dispose());
    cache.clear();
    inFlight.clear();
  };
}
