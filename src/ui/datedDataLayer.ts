/**
 * Socle générique des couches de DONNÉES datées synchronisées sur le temps de simulation
 * (champ de vent Open-Meteo, et futures sources météo « Chemin B »). Symétrique de
 * `datedTextureLayer`, mais applique une DONNÉE arbitraire `T` (grille, tableau…) et non une
 * `THREE.Texture` : le rendu de cette donnée (particules, etc.) reste à la charge de
 * l'appelant, ce socle ne gère que le cycle « quand/quoi charger ».
 *
 * Cycle commun factorisé : dériver une clé stable depuis la date → fetch (dédup des requêtes
 * en vol) → appliquer, en gardant toujours la plus récente, avec repli silencieux + backoff
 * exponentiel sur échec (pas de cascade de requêtes qui échouent hors-ligne).
 *
 * Une nouvelle couche de données = une config, pas une copie du squelette.
 */
import Logger from '@/utils/Logger';
import { createBackoff, type BackoffOptions } from '@/core/retryBackoff';
import type { MeteoLayerPhase } from '@/core/meteoDiagnostics';
import type { PublicAPI } from '@/SolarSystemApp';

export interface DatedDataLayerConfig<T> {
  /** Nom de la couche (préfixe des logs). */
  name: string;
  /** Désactive entièrement la couche si false (renvoie un cleanup inerte). */
  enabled: boolean;
  /** Date de simulation → clé stable (heure/instant) ou null si hors plage. Pur (core/). */
  keyForDate: (date: Date) => string | null;
  /** Clé → promesse de donnée (fetch + parse). Rejette sur échec réseau/parse. */
  fetchForKey: (key: string, signal?: AbortSignal) => Promise<T>;
  /** Applique la donnée chargée (stocke la grille de vent courante, etc.). */
  apply: (data: T) => void;
  /** Notifie l'état observable du chargement au panneau. */
  onStateChange?: (state: MeteoLayerPhase) => void;
  /** Intervalle de réévaluation de la date (ms). Défaut 1000 (données horaires). */
  checkIntervalMs?: number;
  /** Réglages du backoff exponentiel après échec réseau (défauts de createBackoff). */
  retry?: BackoffOptions;
}

/**
 * Monte une couche de données datée. Renvoie une fonction de nettoyage (désabonnement du
 * flux de frames). L'appelant reste responsable de disposer ses propres ressources de rendu.
 */
export function createDatedDataLayer<T>(
  api: PublicAPI,
  config: DatedDataLayerConfig<T>
): () => void {
  if (!config.enabled) return () => {};

  // Dédup des requêtes en vol (pas de cache par clé : la donnée est volatile, on garde
  // seulement la plus récente appliquée).
  type InFlightRequest = {
    promise: Promise<T>;
    controller: AbortController;
  };
  const inFlight = new Map<string, InFlightRequest>();
  let disposed = false;

  // Backoff sur échec : après un échec réseau, on ne réessaie pas la même clé dès la frame
  // suivante (Open-Meteo rate-limite en 429 ; le time-travel rapide aggrave la cascade).
  const backoff = createBackoff(config.retry);

  let appliedKey: string | null = null;
  let lastRequestedKey: string | null = null;
  let failedKey: string | null = null;
  let activeRequest: InFlightRequest | null = null;

  const isAbortError = (error: unknown): boolean =>
    error instanceof DOMException && error.name === 'AbortError';

  function fetchForKey(key: string): InFlightRequest {
    const existing = inFlight.get(key);
    if (existing) return existing;

    const controller = new AbortController();
    const promise = Promise.resolve()
      .then(() => config.fetchForKey(key, controller.signal))
      .finally(() => {
        if (inFlight.get(key)?.promise === promise) inFlight.delete(key);
      });
    const request = { promise, controller };
    inFlight.set(key, request);

    // Une requête annulée ne doit pas bloquer un futur retour vers la même clé si le chargeur
    // injecté ignore AbortSignal et met du temps à se résoudre.
    controller.signal.addEventListener(
      'abort',
      () => {
        if (inFlight.get(key)?.promise === promise) inFlight.delete(key);
      },
      { once: true }
    );

    return request;
  }

  function applyForSimulationDate(simDate: Date): void {
    const key = config.keyForDate(simDate);
    // Hors plage : on ne touche à rien (l'état précédent reste).
    if (key === null) {
      activeRequest?.controller.abort();
      activeRequest = null;
      lastRequestedKey = null;
      return;
    }
    // Même clé que la dernière demande → rien à faire (gating principal).
    if (key === lastRequestedKey) return;
    // Ré-essai de la MÊME clé qui vient d'échouer → throttlé par le backoff. Une AUTRE clé
    // (time-travel) passe toujours immédiatement.
    if (key === failedKey && !backoff.shouldRetry(performance.now())) return;
    activeRequest?.controller.abort();
    const request = fetchForKey(key);
    activeRequest = request;
    lastRequestedKey = key;
    config.onStateChange?.('loading');

    void request.promise
      .then((data) => {
        // Une demande plus récente a pu changer la cible : n'appliquer que si toujours
        // la dernière, et pas déjà appliquée.
        if (
          disposed ||
          request.controller.signal.aborted ||
          key !== lastRequestedKey
        )
          return;
        if (key === appliedKey) return;
        config.apply(data);
        config.onStateChange?.('ready');
        appliedKey = key;
        failedKey = null;
        if (activeRequest === request) activeRequest = null;
        backoff.noteSuccess();
        Logger.success(`[${config.name}] Donnée appliquée (${key}).`);
      })
      .catch((err) => {
        // Annulation ou résultat d'une ancienne demande : aucun backoff et aucun état d'erreur.
        if (
          disposed ||
          request.controller.signal.aborted ||
          isAbortError(err) ||
          key !== lastRequestedKey
        )
          return;
        // Repli silencieux + backoff : ré-essai autorisé plus tard (réaligne lastRequested
        // sur ce qui est réellement appliqué), le ré-essai de CETTE clé est différé.
        lastRequestedKey = appliedKey;
        failedKey = key;
        if (activeRequest === request) activeRequest = null;
        backoff.noteFailure(performance.now());
        config.onStateChange?.('error');
        Logger.warn(`[${config.name}] Échec du chargement (${key}).`, err);
      });
  }

  // Première tentative immédiate puis observation par frame (throttlée).
  applyForSimulationDate(api.orbitalMechanics.simulationDate);

  let lastCheck = 0;
  const interval = config.checkIntervalMs ?? 1000;
  const unsubscribe = api.animationSystem.onFrame(() => {
    const now = performance.now();
    if (now - lastCheck < interval) return;
    lastCheck = now;
    applyForSimulationDate(api.orbitalMechanics.simulationDate);
  });

  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    activeRequest?.controller.abort();
    activeRequest = null;
    [...inFlight.values()].forEach(({ controller }) => controller.abort());
    inFlight.clear();
  };
}
