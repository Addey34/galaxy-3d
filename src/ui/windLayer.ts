/**
 * Couche VENT : particules advectées par le champ de vent réel à 10 m, plaquées sur la Terre.
 *
 * La DONNÉE vient du socle météo commun (`fetchMeteoGrids`, 2026-10-12), comme la température ou
 * la pression : prévision Open-Meteo ou archive ERA5 selon la date de la scène, vitesse et
 * direction dans la même requête, grille des autres modèles. Le cycle (quand charger, dédup,
 * backoff, synchro sur l'heure de simulation) est délégué à `datedDataLayer` ; seul le RENDU
 * (advection des particules par image) vit ici.
 *
 * Trois défauts du prototype, corrigés en la rallumant :
 *   - hors archive, la couche demandait toujours `forecast_days: 1` puis prenait l'heure de la
 *     scène : une scène à J+3 recevait le vent d'AUJOURD'HUI à la même heure ;
 *   - elle lançait son chargeur au démarrage, éteinte ou non : une couche éteinte ne demande
 *     désormais rien à personne, comme les événements terrestres ;
 *   - elle n'avait ni badge de source ni légende.
 */
import { WIND_SETTINGS } from '@/config/engine';
import { intlLocale } from '@/i18n';
import { windBound } from '@/core/legendBounds';
import { meteoHourKey } from '@/core/meteoTimeTravel';
import { fetchMeteoGrids } from '@/core/meteoClient';
import { LAYER_RADIUS_SCALE } from '@/config/layerConfig';
import {
  WIND_VARIABLES,
  windGridFromScalars,
  type WindGrid,
} from '@/core/windField';
import { paletteToCss, WIND_DOMAIN, WIND_PALETTE } from '@/core/meteoPalette';
import type { WindParticles } from '@/components/celestial/WindParticles';
import { createDatedDataLayer } from './datedDataLayer';
import {
  getEarth,
  createLoadStateRelay,
  createResolvedRelay,
  type WeatherLayerHandle,
} from './earthLayer';
import { meteoSourceCandidate } from './meteoModelLayer';
import {
  describeMeteoGrid,
  type MeteoLayerDiagnostics,
} from '@/core/meteoDiagnostics';
import type { PublicAPI } from '@/SolarSystemApp';

/**
 * Monte la couche vent. Renvoie `null` si désactivée (palier `low`) ou si la Terre est absente :
 * le registre l'ignore alors (pas de ligne « Vent » dans le panneau).
 */
export function setupWindLayer(api: PublicAPI): WeatherLayerHandle | null {
  const settings = WIND_SETTINGS;
  if (!settings.enabled) return null;

  const earth = getEarth(api, 'WindLayer');
  if (!earth) return null;

  // Les particules (et leur module) ne naissent qu'à la PREMIÈRE activation : la couche est
  // éteinte au démarrage, et le budget JS du démarrage n'a pas à les payer (lot 46).
  let particles: WindParticles | null = null;
  let creating: Promise<void> | null = null;
  const ensureParticles = (): Promise<void> =>
    (creating ??= import('@/components/celestial/WindParticles').then(
      ({ WindParticles }) => {
        if (disposed) return;
        particles = new WindParticles({
          radius: earth.layerRadius * (LAYER_RADIUS_SCALE['wind'] ?? 1.012),
          count: settings.particleCount,
          speedScale: settings.speedScale,
          lifeSeconds: settings.lifeSeconds,
          opacity: settings.opacity,
          size: settings.size,
          maxLat: settings.particleMaxLat,
          calmKmh: settings.calmKmh,
        });
        particles.points.visible = false;
        earth.attachSpinningChild(particles.points);
        syncPoints();
      }
    ));
  let disposed = false;

  // Grille courante, lue à chaque image par l'advection. null tant qu'aucune grille ne décrit la
  // date de la scène (avant le premier chargement, ou hors de la plage du modèle) : les
  // particules sont alors masquées (`syncPoints`).
  let grid: WindGrid | null = null;
  let gridDiagnostics: MeteoLayerDiagnostics['grid'];
  let lastSource: MeteoLayerDiagnostics['source'];
  let phase: MeteoLayerDiagnostics['phase'] = 'idle';
  const loadState = createLoadStateRelay();
  const relay = createResolvedRelay();
  /** Choix du panneau ; l'affichage exige en plus une grille pour la date de la scène. */
  let wanted = false;
  const syncPoints = (): void => {
    if (particles) particles.points.visible = wanted && grid !== null;
  };

  let stopData: (() => void) | null = null;
  const startData = (): void => {
    if (stopData) return;
    stopData = createDatedDataLayer(api, {
      name: 'WindLayer',
      enabled: true,
      keyForDate: meteoHourKey,
      fetchForKey: (key, signal) =>
        fetchMeteoGrids(new Date(`${key}:00:00Z`), {
          variables: WIND_VARIABLES,
          forecastGrid: { step: settings.gridStep, maxLat: settings.maxLat },
          archiveGrid: {
            step: settings.archiveGridStep,
            maxLat: settings.maxLat,
          },
          signal,
        }),
      onStateChange: (next) => {
        phase = next;
        loadState.push(next);
      },
      apply: (data) => {
        // Hors de la plage du modèle (avant 1940, au-delà de l'horizon de prévision) : AUCUNE
        // grille. Garder la précédente ferait souffler, pour cette date, le vent d'une autre.
        const speed = data.grids?.[WIND_VARIABLES[0]];
        const direction = data.grids?.[WIND_VARIABLES[1]];
        grid =
          speed && direction ? windGridFromScalars(speed, direction) : null;
        gridDiagnostics = speed ? describeMeteoGrid(speed) : undefined;
        syncPoints();
        phase = 'ready';
        const source = meteoSourceCandidate({ id: 'wind' }, data);
        lastSource = source;
        relay.push(source);
      },
      checkIntervalMs: 1000,
    });
  };

  // Advection à chaque image (rendu), seulement quand les particules se voient.
  let last = performance.now();
  const unsubscribe = api.animationSystem.onFrame(() => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (particles?.points.visible) particles.update(dt, grid);
  });

  return {
    id: 'wind',
    labelKey: 'weather.wind',
    onLoadStateChange: loadState.subscribe,
    onResolved: relay.subscribe,
    // Éteinte au démarrage : le vent est un INSTRUMENT, pas l'apparence de la Terre.
    initial: false,
    noteKey: 'weather.wind.note',
    // La palette même des particules, bornes tirées de son domaine.
    legendGradient: {
      css: paletteToCss(WIND_PALETTE),
      loText: () => windBound(WIND_DOMAIN.min, { locale: intlLocale() }),
      hiText: () =>
        windBound(WIND_DOMAIN.max, { saturates: true, locale: intlLocale() }),
    },
    setVisible: (visible) => {
      wanted = visible;
      if (visible) {
        startData();
        void ensureParticles();
      }
      syncPoints();
    },
    diagnostics: () => ({
      id: 'wind',
      family: 'vector',
      targetLayer: 'wind',
      visible: wanted,
      phase,
      updatedAt: Date.now(),
      source: lastSource,
      grid: gridDiagnostics,
    }),
    dispose: () => {
      stopData?.();
      stopData = null;
      unsubscribe();
      disposed = true;
      particles?.points.removeFromParent();
      particles?.dispose();
    },
  };
}
