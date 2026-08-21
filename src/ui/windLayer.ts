/**
 * Prototype couche VENT : particules advectées par le champ de vent réel (Open-Meteo GFS),
 * plaquées sur la Terre. Récupère une grille de vent mondiale, crée `WindParticles`,
 * l'attache au groupe rotatif de la Terre, et advecte les particules à chaque frame.
 *
 * Le CYCLE DE DONNÉES (quand/quoi charger, dédup, backoff, synchro sur l'heure de
 * simulation) est délégué au socle générique `datedDataLayer` — seul le RENDU (advection
 * des particules par frame) vit ici. Repli : si le fetch échoue, pas de grille → les
 * particules dérivent doucement (minDrift) sans champ, la Terre reste normale.
 */
import { WIND_SETTINGS } from '@/config/engine';
import { meteoHourKey, planMeteoRequest } from '@/core/meteoTimeTravel';
import { LAYER_RADIUS_SCALE } from '@/config/layerConfig';
import {
  buildWindArchiveUrl,
  buildWindGridUrl,
  parseWindGrid,
  type WindGrid,
} from '@/core/windField';
import { WindParticles } from '@/components/celestial/WindParticles';
import { createDatedDataLayer } from './datedDataLayer';
import {
  getEarth,
  createLoadStateRelay,
  type WeatherLayerHandle,
} from './earthLayer';
import {
  describeMeteoGrid,
  type MeteoLayerDiagnostics,
} from '@/core/meteoDiagnostics';
import type { PublicAPI } from '@/SolarSystemApp';

/**
 * Monte la couche vent. Renvoie `null` si désactivée (WIND_SETTINGS.enabled) ou si la Terre
 * est absente — le registre l'ignore alors (pas de ligne « Vent » dans le panneau).
 */
export function setupWindLayer(api: PublicAPI): WeatherLayerHandle | null {
  const settings = WIND_SETTINGS;
  if (!settings.enabled) return null;

  const earth = getEarth(api, 'WindLayer');
  if (!earth) return null;

  const particles = new WindParticles({
    radius: earth.layerRadius * (LAYER_RADIUS_SCALE['wind'] ?? 1.012),
    count: settings.particleCount,
    speedScale: settings.speedScale,
    lifeSeconds: settings.lifeSeconds,
    opacity: settings.opacity,
    size: settings.size,
    speedMax: settings.speedMax,
    lonOffset: settings.lonOffset,
    maxLat: settings.maxLat,
    minDriftKmh: settings.minDriftKmh,
  });
  earth.attachSpinningChild(particles.points);

  // Grille de vent courante (appliquée par le socle de données ; lue à chaque frame par
  // l'advection). null tant qu'aucun fetch n'a abouti (repli : dérive minimale).
  let grid: WindGrid | null = null;
  let gridDiagnostics: MeteoLayerDiagnostics['grid'];
  let phase: MeteoLayerDiagnostics['phase'] = 'idle';
  const loadState = createLoadStateRelay();

  // Cycle de données délégué : clé = heure de simulation ; fetch = grille Open-Meteo GFS.
  const stopData = createDatedDataLayer<WindGrid>(api, {
    name: 'WindLayer',
    enabled: true,
    keyForDate: meteoHourKey,
    fetchForKey: async (key) => {
      // VOYAGE TEMPS : la clé (YYYY-MM-DDTHH) porte la date de simulation. On route vers
      // l'archive ERA5 (passé lointain) ou le forecast GFS (zone récente + futur ≤ horizon)
      // via le plan partagé. Hors plage (avant 1940 / futur au-delà de l'horizon) → pas de
      // grille : le socle garde la dernière valide, sinon les particules dérivent (minDrift).
      const simDate = new Date(`${key}:00:00Z`);
      const plan = planMeteoRequest(simDate);
      if (plan.outOfRange)
        throw new Error(`wind out of range (${plan.status})`);
      const gridOptions = { step: settings.gridStep, maxLat: settings.maxLat };
      const url =
        plan.source === 'archive' && plan.date
          ? buildWindArchiveUrl(plan.date, gridOptions)
          : buildWindGridUrl(gridOptions);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as unknown;
      // L'index horaire sélectionne l'heure du jour : forecast_days:1 comme archive (24 h/jour)
      // exposent l'heure 0..23 de la journée demandée.
      const hour = simDate.getUTCHours();
      return parseWindGrid(json, gridOptions, hour);
    },
    onStateChange: (next) => {
      phase = next;
      loadState.push(next);
    },
    apply: (loaded) => {
      grid = loaded;
      gridDiagnostics = describeMeteoGrid(loaded);
      phase = 'ready';
    },
    // Réévaluation horaire (chaque seconde suffit ; le gating par clé évite les re-fetch).
    checkIntervalMs: 1000,
  });

  // Advection à chaque frame (rendu) — indépendante du cycle de données.
  let last = performance.now();
  const unsubscribe = api.animationSystem.onFrame(() => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    particles.update(dt, grid);
  });

  return {
    id: 'wind',
    labelKey: 'weather.wind',
    onLoadStateChange: loadState.subscribe,
    initial: true, // présente → affichée par défaut (le panneau la masque au besoin)
    noteKey: 'weather.wind.note',
    setVisible: (visible) => {
      particles.points.visible = visible;
    },
    diagnostics: () => ({
      id: 'wind',
      family: 'vector',
      targetLayer: 'wind',
      visible: particles.points.visible,
      phase,
      updatedAt: Date.now(),
      grid: gridDiagnostics,
    }),
    dispose: () => {
      stopData();
      unsubscribe();
      particles.points.removeFromParent();
      particles.dispose();
    },
  };
}
