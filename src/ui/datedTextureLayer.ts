/**
 * Socle générique des couches d'imagerie DATÉE synchronisées sur le temps de simulation
 * (nuages GIBS, pluie IMERG, température MERRA-2). Factorise le cycle commun : dériver depuis
 * la date une LISTE ORDONNÉE de candidats (sources par préférence décroissante) → charger le
 * premier NON VIDE (détection de tuile vide) → l'appliquer, en gardant toujours la plus
 * récente, avec repli silencieux + backoff sur erreur.
 *
 * Étape B : le fallback en chaîne (VIIRS→MODIS, IMERG recul de 30 min, MERRA-2 recul de mois)
 * garantit qu'on n'affiche JAMAIS une tuile vide — toujours la meilleure donnée réelle
 * existante pour la date. La source retenue est remontée via `onResolved` (badge de traçabilité).
 *
 * Deux modes de config, exclusifs :
 * - `resolveSources(simDate, now)` → candidats (mode étape B, fallback + content-check) ;
 * - `keyForDate`+`urlForKey` (mode simple hérité : un seul candidat, sans content-check).
 */
import * as THREE from 'three';
import Logger from '@/utils/Logger';
import { createBackoff, type BackoffOptions } from '@/core/retryBackoff';
import {
  fetchTileWithContentCheck,
  EmptyTileError,
} from '@/core/tileContent';
import type {
  LayerSourceResolver,
  SourceCandidate,
} from '@/core/layerSource';
import type { PublicAPI } from '@/SolarSystemApp';

export interface DatedTextureLayerConfig {
  /** Nom de la couche (préfixe des logs). */
  name: string;
  /** Désactive entièrement la couche si false (renvoie un cleanup inerte). */
  enabled: boolean;
  /**
   * Mode étape B : date → liste ordonnée de candidats (fallback). Prioritaire sur
   * `keyForDate`/`urlForKey`. Chaque candidat est tenté dans l'ordre ; le premier non vide gagne.
   */
  resolveSources?: LayerSourceResolver;
  /** Mode simple hérité : date → clé stable (ou null hors plage). Ignoré si `resolveSources`. */
  keyForDate?: (date: Date) => string | null;
  /** Mode simple hérité : clé → URL WMS. Ignoré si `resolveSources`. */
  urlForKey?: (key: string) => string;
  /** Applique la texture chargée au corps (setRealCloudsTexture / setPrecipTexture / …). */
  apply: (texture: THREE.Texture) => void;
  /** Notifie la source réellement appliquée (badge de traçabilité). */
  onResolved?: (candidate: SourceCandidate) => void;
  /** Seuil d'octets sous lequel une tuile est jugée vide (mode fallback). Défaut du core. */
  minTileBytes?: number;
  /** Optionnel : clés supplémentaires à précharger (mode hérité uniquement). */
  prefetchKeys?: (key: string) => string[];
  /** Intervalle de réévaluation de la date (ms). Défaut 500. */
  checkIntervalMs?: number;
  /** Réglages du backoff exponentiel après échec réseau (défauts de createBackoff). */
  retry?: BackoffOptions;
  /**
   * Chargeur de texture injectable (tests). Reçoit l'URL, résout une THREE.Texture, rejette
   * (échec réseau) ou rejette `EmptyTileError` (tuile vide → candidat suivant).
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

  // Chargeur : par défaut un fetch→blob→texture avec détection de tuile vide (mode fallback).
  // Injectable pour les tests. Reçoit une URL, renvoie une texture ou rejette (EmptyTileError
  // pour une tuile vide, Error pour un échec réseau).
  const loadTexture =
    config.loadTexture ??
    ((url: string) =>
      fetchTileWithContentCheck(url, { minBytes: config.minTileBytes }));

  // Adaptateur du mode hérité (keyForDate/urlForKey) vers un resolver à un seul candidat.
  const resolveSources: LayerSourceResolver =
    config.resolveSources ??
    ((simDate: Date): SourceCandidate[] => {
      const key = config.keyForDate?.(simDate) ?? null;
      if (key === null) return [];
      const url = config.urlForKey?.(key) ?? key;
      return [{ id: key, label: config.name, url, realDate: key, approx: false }];
    });

  // Cache par id de candidat (image réutilisée entre visites) + dédup des requêtes en vol.
  const cache = new Map<string, THREE.Texture>();
  const inFlight = new Map<string, Promise<THREE.Texture>>();

  // Backoff sur échec : après un échec réseau, on ne réessaie pas la même cible dès la frame
  // suivante (cascade de requêtes qui échouent, surtout hors-ligne) mais après un délai croissant.
  const backoff = createBackoff(config.retry);

  // Clé de la DEMANDE courante = id du premier candidat (représente « la date voulue »). Sert
  // au gating (ne pas retravailler la même demande) et au backoff (freiner la même demande ratée).
  let appliedRequestKey: string | null = null;
  let lastRequestedKey: string | null = null;
  let failedRequestKey: string | null = null;

  function loadCandidate(cand: SourceCandidate): Promise<THREE.Texture> {
    const cached = cache.get(cand.id);
    if (cached) return Promise.resolve(cached);
    const existing = inFlight.get(cand.id);
    if (existing) return existing;
    const promise = loadTexture(cand.url)
      .then((texture) => {
        cache.set(cand.id, texture);
        inFlight.delete(cand.id);
        return texture;
      })
      .catch((err) => {
        inFlight.delete(cand.id);
        throw err;
      });
    inFlight.set(cand.id, promise);
    return promise;
  }

  /**
   * Essaie les candidats DANS L'ORDRE : le premier qui charge non vide gagne. Une tuile vide
   * (EmptyTileError) ou un échec réseau → candidat suivant. Rejette si tous échouent.
   */
  async function loadFirstAvailable(
    candidates: SourceCandidate[]
  ): Promise<{ texture: THREE.Texture; candidate: SourceCandidate }> {
    let lastErr: unknown;
    for (const cand of candidates) {
      try {
        const texture = await loadCandidate(cand);
        return { texture, candidate: cand };
      } catch (err) {
        lastErr = err;
        if (err instanceof EmptyTileError) {
          Logger.info(`[${config.name}] Tuile vide (${cand.label} ${cand.realDate}) → fallback.`);
        }
      }
    }
    throw lastErr ?? new Error('Aucun candidat');
  }

  function applyForSimulationDate(simDate: Date): void {
    // `now` = instant RÉEL, jamais la date de simulation. Les couches d'imagerie satellite
    // (GIBS) n'existent que jusqu'à `now − latence` : une donnée FUTURE n'a pas de tuile.
    // En passant `simDate` comme `now`, aller dans le futur faisait croire au resolver qu'une
    // image future existait → tuile vide → cascade de fallbacks ratés à chaque frame (les
    // textures « déchiraient »). Avec l'instant réel, le futur reste clampé à la dernière
    // observation (nuages figés, rien d'inventé) et le passé charge la vraie archive datée.
    const candidates = resolveSources(simDate, new Date());
    // Hors plage (aucun candidat) : on ne touche à rien (l'état précédent reste).
    if (candidates.length === 0) {
      lastRequestedKey = null;
      return;
    }
    const requestKey = candidates[0].id;
    // Même demande que la dernière fois → rien à faire (gating principal).
    if (requestKey === lastRequestedKey) return;
    // Ré-essai de la MÊME demande qui vient d'échouer → throttlé par le backoff. Une AUTRE
    // demande (time-travel) passe toujours immédiatement.
    if (requestKey === failedRequestKey && !backoff.shouldRetry(performance.now())) return;
    lastRequestedKey = requestKey;

    // Préchargement optionnel (mode hérité) des clés voisines.
    if (config.prefetchKeys && config.urlForKey) {
      config.prefetchKeys(requestKey).forEach((k) => {
        const url = config.urlForKey!(k);
        void loadCandidate({ id: k, label: config.name, url, realDate: k, approx: false }).catch(
          () => {}
        );
      });
    }

    void loadFirstAvailable(candidates)
      .then(({ texture, candidate }) => {
        // Une demande plus récente a pu changer la cible : n'appliquer que si toujours la dernière.
        if (requestKey !== lastRequestedKey) return;
        if (requestKey === appliedRequestKey) return;
        config.apply(texture);
        config.onResolved?.(candidate);
        appliedRequestKey = requestKey;
        failedRequestKey = null;
        backoff.noteSuccess();
        Logger.success(
          `[${config.name}] Image appliquée (${candidate.label} ${candidate.realDate}).`
        );
      })
      .catch((err) => {
        // Repli silencieux + backoff : ré-essai autorisé plus tard (réaligne lastRequested sur
        // ce qui est réellement appliqué), le ré-essai de CETTE demande est différé.
        lastRequestedKey = appliedRequestKey;
        failedRequestKey = requestKey;
        backoff.noteFailure(performance.now());
        Logger.warn(`[${config.name}] Aucun candidat chargé (${requestKey}).`, err);
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
