/**
 * Prototype couche VENT : particules advectées par le champ de vent réel (Open-Meteo GFS),
 * plaquées sur la Terre. Récupère une grille de vent mondiale, crée `WindParticles`,
 * l'attache au groupe rotatif de la Terre, et advecte les particules à chaque frame.
 *
 * Le champ est rafraîchi quand l'heure de simulation change (Open-Meteo est horaire).
 * Repli : si le fetch échoue, pas de particules (la Terre reste normale).
 */
import Logger from '@/utils/Logger';
import { WIND_SETTINGS } from '@/config/engine';
import { LAYER_RADIUS_SCALE } from '@/config/layerConfig';
import {
  buildWindGridUrl,
  parseWindGrid,
  type WindGrid,
} from '@/core/windField';
import { WindParticles } from '@/components/celestial/WindParticles';
import type { PublicAPI } from '@/SolarSystemApp';

const EARTH_NAME = 'earth';

export function setupWindLayer(api: PublicAPI): () => void {
  const settings = WIND_SETTINGS;
  if (!settings.enabled) return () => {};

  const earth = api.sceneSystem.getBody(EARTH_NAME);
  if (!earth) return () => {};

  const particles = new WindParticles({
    radius: earth.layerRadius * (LAYER_RADIUS_SCALE['wind'] ?? 1.012),
    count: settings.particleCount,
    speedScale: settings.speedScale,
    lifeSeconds: settings.lifeSeconds,
    color: settings.color,
    opacity: settings.opacity,
    lonOffset: settings.lonOffset,
  });
  earth.attachSpinningChild(particles.points);

  let grid: WindGrid | null = null;
  let lastHourKey: string | null = null;
  let fetching = false;

  function hourKey(date: Date): string {
    return date.toISOString().slice(0, 13); // YYYY-MM-DDTHH
  }
  function hourIndex(date: Date): number {
    return date.getUTCHours();
  }

  function refreshField(simDate: Date): void {
    const key = hourKey(simDate);
    if (key === lastHourKey || fetching) return;
    lastHourKey = key;
    fetching = true;
    fetch(buildWindGridUrl({ step: settings.gridStep }))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => {
        grid = parseWindGrid(
          json,
          { step: settings.gridStep },
          hourIndex(simDate)
        );
        Logger.success('[WindLayer] Champ de vent chargé.');
      })
      .catch((err) => {
        lastHourKey = null; // autorise un nouvel essai
        Logger.warn('[WindLayer] Échec du chargement du vent.', err);
      })
      .finally(() => {
        fetching = false;
      });
  }

  refreshField(api.orbitalMechanics.simulationDate);

  // Advection à chaque frame ; réévaluation de l'heure throttlée.
  let last = performance.now();
  let lastHourCheck = 0;
  const unsubscribe = api.animationSystem.onFrame(() => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (now - lastHourCheck > 1000) {
      lastHourCheck = now;
      refreshField(api.orbitalMechanics.simulationDate);
    }
    particles.update(dt, grid);
  });

  return () => {
    unsubscribe();
    particles.points.removeFromParent();
    particles.dispose();
  };
}
