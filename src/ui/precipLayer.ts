/**
 * Couche PLUIE mondiale (NASA IMERG) superposée à la Terre. Affiche la précipitation
 * RÉELLE correspondant à l'instant de simulation (frame IMERG de la demi-heure courante),
 * remappée en nuages d'orage réalistes par le matériau (createPrecipMaterial).
 *
 * PAS d'animation « time-lapse » artificielle : la pluie change au rythme réel des
 * données (nouvelle image IMERG toutes les 30 min). Elle « bouge » donc quand le temps
 * de simulation avance (lecture accélérée) ou en time-travel — jamais plus vite que le
 * réel. En temps réel ×1, l'image reste stable sur la demi-heure courante (comme la vraie
 * météo à cet instant), et se rafraîchit dès qu'une nouvelle demi-heure IMERG est publiée.
 *
 * Préchargement doux de la demi-heure suivante pour une transition sans à-coup. Chargement
 * par URL (TextureLoader dédié, hors TextureSystem). Repli silencieux si le réseau échoue.
 */
import * as THREE from 'three';
import Logger from '@/utils/Logger';
import { PRECIP_SETTINGS } from '@/config/engine';
import { imergEndForDate, imergUrl } from '@/core/gibsPrecip';
import type { PublicAPI } from '@/SolarSystemApp';

const EARTH_NAME = 'earth';
const HALF_HOUR_MS = 30 * 60 * 1000;

export function setupPrecipLayer(api: PublicAPI): () => void {
  const settings = PRECIP_SETTINGS;
  if (!settings.enabled) return () => {};

  const earth = api.sceneSystem.getBody(EARTH_NAME);
  if (!earth) return () => {};

  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');

  // Cache par instant IMERG (clé ISO de la demi-heure). Réutilisé entre rafraîchissements.
  const cache = new Map<string, THREE.Texture>();
  const inFlight = new Map<string, Promise<THREE.Texture>>();

  // Frame IMERG (ISO) demandée / réellement appliquée à la couche.
  let requestedKey: string | null = null;
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

  /** Affiche la frame de précipitation réelle correspondant à l'instant de simulation. */
  function applyForSimulationDate(simDate: Date): void {
    const end = imergEndForDate(simDate, {
      latencyHours: settings.latencyHours,
      minDate: settings.minDate,
    });
    // Hors plage (avant le début IMERG) : on garde la dernière frame, rien à recharger.
    if (end === null) return;

    const key = end.toISOString();
    if (key === requestedKey) return; // même demi-heure → rien à faire
    requestedKey = key;

    void loadKey(key)
      .then((texture) => {
        if (key !== requestedKey) return; // une demi-heure plus récente a pris le relais
        if (key === appliedKey) return;
        earth!.setPrecipTexture(texture, { opacity: settings.opacity });
        appliedKey = key;
      })
      .catch((err) => {
        requestedKey = appliedKey; // autorise un nouvel essai
        Logger.warn(`[PrecipLayer] Frame IMERG indisponible (${key}).`, err);
      });

    // Préchargement doux de la demi-heure suivante (transition sans à-coup quand le
    // temps de simulation avance) — sans latence, borné par la disponibilité.
    const next = new Date(end.getTime() + HALF_HOUR_MS);
    const nextEnd = imergEndForDate(next, {
      latencyHours: settings.latencyHours,
      minDate: settings.minDate,
    });
    if (nextEnd) void loadKey(nextEnd.toISOString()).catch(() => {});
  }

  applyForSimulationDate(api.orbitalMechanics.simulationDate);

  // On réévalue l'instant à ~2×/s ; le gating à la demi-heure IMERG évite tout
  // rechargement inutile (l'image ne change qu'aux demi-heures réelles).
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
