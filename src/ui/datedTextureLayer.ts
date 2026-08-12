/**
 * Socle générique des couches d'imagerie DATÉE synchronisées sur le temps de simulation
 * (nuages GIBS, pluie IMERG, et futures couches météo). Factorise le cycle commun :
 * dériver une clé stable depuis la date → charger l'image (cache + dédup) → l'appliquer
 * au corps, en gardant toujours la plus récente, avec repli silencieux sur erreur.
 *
 * Aucune logique spécifique à une couche : les variations (comment dériver clé/URL depuis
 * une date, comment appliquer la texture, quoi précharger) sont injectées via `config`.
 * Une nouvelle couche météo = une config, pas une copie du squelette.
 *
 * Le chargement passe par un `THREE.TextureLoader` dédié (URL distante, crossOrigin) —
 * hors de `TextureSystem`, réservé aux fichiers locaux versionnés.
 */
import * as THREE from 'three';
import Logger from '@/utils/Logger';
import type { PublicAPI } from '@/SolarSystemApp';

export interface DatedTextureLayerConfig {
  /** Nom de la couche (préfixe des logs). */
  name: string;
  /** Désactive entièrement la couche si false (renvoie un cleanup inerte). */
  enabled: boolean;
  /** Date de simulation → clé stable (jour/instant) ou null si hors plage. Pur (core/). */
  keyForDate: (date: Date) => string | null;
  /** Clé → URL WMS de l'image. Pur (core/). */
  urlForKey: (key: string) => string;
  /** Applique la texture chargée au corps (setRealCloudsTexture / setPrecipTexture / …). */
  apply: (texture: THREE.Texture) => void;
  /** Optionnel : clés supplémentaires à précharger autour de `key` (ex. instant suivant). */
  prefetchKeys?: (key: string) => string[];
  /** Intervalle de réévaluation de la date (ms). Défaut 500. */
  checkIntervalMs?: number;
  /**
   * Chargeur de texture injectable (tests). Défaut : un THREE.TextureLoader crossOrigin.
   * Doit résoudre une THREE.Texture ou rejeter.
   */
  loadTexture?: (url: string) => Promise<THREE.Texture>;
}

/**
 * Monte une couche d'imagerie datée. Renvoie une fonction de nettoyage (désabonnement +
 * libération du cache de textures).
 */
export function createDatedTextureLayer(
  api: PublicAPI,
  config: DatedTextureLayerConfig
): () => void {
  if (!config.enabled) return () => {};

  const defaultLoader = new THREE.TextureLoader();
  defaultLoader.setCrossOrigin('anonymous');
  const loadTexture =
    config.loadTexture ??
    ((url: string) =>
      new Promise<THREE.Texture>((resolve, reject) => {
        defaultLoader.load(
          url,
          (t) => resolve(t),
          undefined,
          (err) => reject(err instanceof Error ? err : new Error(String(err)))
        );
      }));

  // Cache par clé (image réutilisée entre visites) + dédup des requêtes en vol.
  const cache = new Map<string, THREE.Texture>();
  const inFlight = new Map<string, Promise<THREE.Texture>>();

  // Dernière clé effectivement appliquée / demandée : évite tout rechargement inutile
  // tant que la clé (dérivée de la date) ne change pas.
  let appliedKey: string | null = null;
  let lastRequestedKey: string | null = null;

  function loadForKey(key: string): Promise<THREE.Texture> {
    const cached = cache.get(key);
    if (cached) return Promise.resolve(cached);
    const existing = inFlight.get(key);
    if (existing) return existing;
    const promise = loadTexture(config.urlForKey(key))
      .then((texture) => {
        cache.set(key, texture);
        inFlight.delete(key);
        return texture;
      })
      .catch((err) => {
        inFlight.delete(key);
        throw err;
      });
    inFlight.set(key, promise);
    return promise;
  }

  function applyForSimulationDate(simDate: Date): void {
    const key = config.keyForDate(simDate);
    // Hors plage : on ne touche à rien (l'état précédent — ex. texture statique — reste).
    if (key === null) {
      lastRequestedKey = null;
      return;
    }
    // Même clé que la dernière demande → rien à faire (gating principal).
    if (key === lastRequestedKey) return;
    lastRequestedKey = key;

    // Préchargement optionnel des clés voisines (transition sans à-coup).
    config.prefetchKeys?.(key).forEach((k) => {
      void loadForKey(k).catch(() => {});
    });

    void loadForKey(key)
      .then((texture) => {
        // Une demande plus récente a pu changer la cible : n'appliquer que si toujours
        // la dernière, et pas déjà appliquée.
        if (key !== lastRequestedKey) return;
        if (key === appliedKey) return;
        config.apply(texture);
        appliedKey = key;
        Logger.success(`[${config.name}] Image appliquée (${key}).`);
      })
      .catch((err) => {
        // Repli silencieux : on autorise un nouvel essai en réalignant lastRequested
        // sur ce qui est réellement appliqué.
        lastRequestedKey = appliedKey;
        Logger.warn(`[${config.name}] Échec du chargement (${key}).`, err);
      });
  }

  // Première tentative immédiate puis observation par frame (throttlée).
  applyForSimulationDate(api.orbitalMechanics.simulationDate);

  let lastCheck = 0;
  const interval = config.checkIntervalMs ?? 500;
  const unsubscribe = api.animationSystem.onFrame(() => {
    const now = performance.now();
    if (now - lastCheck < interval) return;
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
