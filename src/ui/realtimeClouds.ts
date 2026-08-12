/**
 * Couverture nuageuse RÉELLE de la Terre (NASA GIBS), synchronisée sur la date de la
 * simulation. Module DOM-aware de la couche `src/ui/` : reçoit la `PublicAPI`, observe
 * la date courante (via `AnimationSystem.onFrame`, throttlé au changement de jour UTC)
 * et charge/applique l'image satellite du jour à la couche nuages de la Terre.
 *
 * - URL + normalisation de date : `core/gibsClouds` (pur, testé).
 * - Application shader (extraction nuage + fin de la dérive fictive) :
 *   `CelestialObject.setRealCloudsTexture`.
 * - Repli : au premier échec réseau / date hors plage, on garde la texture nuages
 *   statique déjà en place (aucune action destructrice) et on retentera au prochain
 *   changement de jour.
 *
 * Le chargement passe par un `THREE.TextureLoader` dédié (URL distante, `crossOrigin`)
 * — hors de `TextureSystem` qui, lui, ne charge que des fichiers locaux versionnés.
 */
import * as THREE from 'three';
import Logger from '@/utils/Logger';
import { REALTIME_CLOUDS_SETTINGS } from '@/config/engine';
import { gibsCloudDateFor, gibsCloudUrl } from '@/core/gibsClouds';
import type { PublicAPI } from '@/SolarSystemApp';

const EARTH_NAME = 'earth';

export function setupRealtimeClouds(api: PublicAPI): () => void {
  const settings = REALTIME_CLOUDS_SETTINGS;
  if (!settings.enabled) return () => {};

  const earth = api.sceneSystem.getBody(EARTH_NAME);
  if (!earth) {
    Logger.warn('[RealtimeClouds] Terre introuvable — nuages réels désactivés.');
    return () => {};
  }

  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');

  // Cache par date GIBS (chaîne YYYY-MM-DD) : une image partagée entre visites.
  const cache = new Map<string, THREE.Texture>();
  // Dédup des requêtes en vol par date.
  const inFlight = new Map<string, Promise<THREE.Texture>>();

  // Dernière date GIBS effectivement appliquée : évite de recharger tant que le jour
  // UTC de la simulation n'a pas changé. `null` = rien d'appliqué (encore statique).
  let appliedGibsDate: string | null = null;
  // Dernière date demandée (même si null/hors plage) : borne le throttle.
  let lastRequestedGibsDate: string | null = null;

  function loadForDate(gibsDate: string): Promise<THREE.Texture> {
    const cached = cache.get(gibsDate);
    if (cached) return Promise.resolve(cached);
    const existing = inFlight.get(gibsDate);
    if (existing) return existing;

    const url = gibsCloudUrl(gibsDate, {
      layer: settings.layer,
      width: settings.resolution,
    });
    const promise = new Promise<THREE.Texture>((resolve, reject) => {
      loader.load(
        url,
        (texture) => {
          cache.set(gibsDate, texture);
          inFlight.delete(gibsDate);
          resolve(texture);
        },
        undefined,
        (err) => {
          inFlight.delete(gibsDate);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      );
    });
    inFlight.set(gibsDate, promise);
    return promise;
  }

  function applyForSimulationDate(simDate: Date): void {
    const gibsDate = gibsCloudDateFor(simDate, {
      latencyDays: settings.latencyDays,
      minDate: settings.minDate,
    });

    // Date hors plage (futur trop récent déjà clampé, ou avant le début de la couche) :
    // on garde la couche statique. Rien à recharger tant que ça ne change pas.
    if (gibsDate === null) {
      lastRequestedGibsDate = null;
      return;
    }
    // Même jour que la dernière requête → rien à faire (throttle principal).
    if (gibsDate === lastRequestedGibsDate) return;
    lastRequestedGibsDate = gibsDate;

    void loadForDate(gibsDate)
      .then((texture) => {
        // Une requête plus récente a pu changer la cible entre-temps : on n'applique
        // que si cette date est toujours la dernière demandée.
        if (gibsDate !== lastRequestedGibsDate) return;
        if (gibsDate === appliedGibsDate) return;
        earth!.setRealCloudsTexture(texture, {
          opacity: settings.opacity,
          lumLow: settings.cloudLuminanceLow,
          lumLowLand: settings.cloudLuminanceLowLand,
          lumHigh: settings.cloudLuminanceHigh,
          satMax: settings.cloudSaturationMax,
        });
        appliedGibsDate = gibsDate;
        Logger.success(`[RealtimeClouds] Nuages réels appliqués (${gibsDate}).`);
      })
      .catch((err) => {
        // Repli silencieux sur la texture statique ; on autorise un nouvel essai en
        // remettant lastRequestedGibsDate à ce qui est réellement appliqué.
        lastRequestedGibsDate = appliedGibsDate;
        Logger.warn(
          `[RealtimeClouds] Échec du chargement GIBS (${gibsDate}) — texture statique conservée.`,
          err
        );
      });
  }

  // Première tentative immédiate (date courante), puis observation par frame.
  applyForSimulationDate(api.orbitalMechanics.simulationDate);

  // Throttle temporel léger : on ne réévalue la date que ~2× par seconde. La bascule
  // de jour UTC (comparée à lastRequestedGibsDate) fait le vrai gating.
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
