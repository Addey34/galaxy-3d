/**
 * Petits partages entre toutes les COUCHES MÉTÉO de la Terre (nuages, pluie, température,
 * vent) : le nom du corps, l'accès à l'objet Terre (avec avertissement centralisé), et le
 * contrat de handle uniforme que chaque `setup*Layer` renvoie.
 *
 * Un handle uniforme permet au registre (MainSolarSystemApp) de collecter les couches sans
 * connaître leur nature, et au panneau (weatherLayers) de construire ses rangées par simple
 * itération — plus de câblage en dur couche par couche.
 */
import Logger from '@/utils/Logger';
import type CelestialObject from '@/components/celestial/CelestialObject';
import type { SourceCandidate } from '@/core/layerSource';
import type { MeteoLayerDiagnostics } from '@/core/meteoDiagnostics';
import type { PublicAPI } from '@/SolarSystemApp';

/** Nom catalogue du corps Terre (source unique, ex-duplication dans 5 fichiers). */
export const EARTH_NAME = 'earth';

/**
 * Récupère l'objet Terre. `warnIfMissing` (défaut true) journalise une fois si absent, avec
 * le préfixe de la couche appelante — évite de répéter le même bloc getBody+warn partout.
 */
export function getEarth(
  api: PublicAPI,
  layerName?: string,
  warnIfMissing = true
): CelestialObject | undefined {
  const earth = api.sceneSystem.getBody(EARTH_NAME);
  if (!earth && warnIfMissing) {
    Logger.warn(
      `[${layerName ?? 'EarthLayer'}] Terre introuvable — couche désactivée.`
    );
  }
  return earth;
}

/**
 * Contrat commun d'une couche météo, tel que consommé par le registre et le panneau.
 * `setVisible`/`dispose` sont toujours présents (handle inerte si la couche est désactivée) ;
 * `legendUrl`/`noteKey` alimentent le détail replié sous le toggle dans le panneau.
 */
export function createLoadStateRelay(): {
  push: (state: MeteoLayerDiagnostics['phase']) => void;
  subscribe: (cb: (state: MeteoLayerDiagnostics['phase']) => void) => void;
} {
  let state: MeteoLayerDiagnostics['phase'] = 'idle';
  let cb: ((state: MeteoLayerDiagnostics['phase']) => void) | undefined;
  return {
    push: (next) => {
      state = next;
      cb?.(next);
    },
    subscribe: (next) => {
      cb = next;
      next(state);
    },
  };
}
export interface WeatherLayerHandle {
  /** Identifiant stable de la couche (`clouds`, `precip`, `thermal`, `wind`). */
  id: string;
  /** Clé i18n du libellé du toggle. */
  labelKey: string;
  /** État affiché au démarrage (case cochée ou non). */
  initial: boolean;
  /** Montre/masque la couche (piloté par le toggle du panneau). */
  setVisible(visible: boolean): void;
  /** Notifie le panneau du cycle de chargement de la couche. */
  onLoadStateChange?: (
    cb: (state: MeteoLayerDiagnostics['phase']) => void
  ) => void;
  /** Arrête la couche et libère ses ressources (cleanup global). */
  dispose(): void;
  /** URL d'une légende image (SVG GIBS) affichée sous le toggle quand la couche est active. */
  legendUrl?: string;
  /**
   * Légende en barre de dégradé CSS (pour les couches dont on maîtrise la palette, ex. la
   * pluie remappée en bleu). `css` = valeur de `background` ; `loKey`/`hiKey` = clés i18n des
   * libellés min/max sous la barre. Alternative sans dépendance réseau à `legendUrl`.
   */
  legendGradient?: { css: string; loKey: string; hiKey: string };
  /** Clé i18n d'un texte explicatif (couleurs arbitraires) sous le toggle. */
  noteKey?: string;
  /**
   * S'abonne à la source RÉELLEMENT appliquée (fallback en chaîne, étape B) : le panneau
   * l'utilise pour afficher un badge de traçabilité (source · date réelle · approché).
   * Absent si la couche n'a pas de résolution multi-sources.
   */
  onResolved?: (cb: (candidate: SourceCandidate) => void) => void;
  /** Snapshot de diagnostic activable par ?debug-meteo, sans effet sur le rendu normal. */
  diagnostics?: () => MeteoLayerDiagnostics;
}

/**
 * Petit relais 1→1 entre le socle (qui POUSSE la source retenue) et le panneau (qui S'ABONNE).
 * Mémorise la dernière source pour la livrer immédiatement à un abonné tardif (le badge peut
 * s'abonner après le premier chargement). Factorise le câblage identique des 3 couches.
 */
export function createResolvedRelay(): {
  push: (candidate: SourceCandidate) => void;
  subscribe: (cb: (candidate: SourceCandidate) => void) => void;
} {
  let cb: ((c: SourceCandidate) => void) | undefined;
  let last: SourceCandidate | undefined;
  return {
    push: (candidate) => {
      last = candidate;
      cb?.(candidate);
    },
    subscribe: (next) => {
      cb = next;
      if (last) next(last); // rejoue la dernière source connue
    },
  };
}
