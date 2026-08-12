/**
 * Couche PLUIE mondiale (NASA IMERG) superposée à la Terre. Fine configuration du socle
 * générique `datedTextureLayer` : affiche la frame de précipitation RÉELLE correspondant à
 * l'instant de simulation (demi-heure courante). La pluie change au rythme réel des données
 * (30 min) — jamais en time-lapse accéléré ; le FONDU ENCHAÎNÉ entre frames est géré côté
 * `CelestialObject.setPrecipTexture` (transition douce, sans clignotement).
 *
 * Préchargement de la demi-heure suivante (transition sans à-coup quand le temps avance).
 * Repli silencieux si le réseau échoue (le socle n'applique rien → la Terre reste normale).
 */
import { PRECIP_SETTINGS } from '@/config/engine';
import { imergEndForDate, imergUrl } from '@/core/gibsPrecip';
import { createDatedTextureLayer } from './datedTextureLayer';
import type { PublicAPI } from '@/SolarSystemApp';

const EARTH_NAME = 'earth';
const HALF_HOUR_MS = 30 * 60 * 1000;

export function setupPrecipLayer(api: PublicAPI): () => void {
  const settings = PRECIP_SETTINGS;
  const earth = api.sceneSystem.getBody(EARTH_NAME);

  const dateOptions = {
    latencyHours: settings.latencyHours,
    minDate: settings.minDate,
  };

  return createDatedTextureLayer(api, {
    name: 'PrecipLayer',
    enabled: settings.enabled && !!earth,
    // Clé = instant IMERG (ISO) de la demi-heure courante ; null hors plage.
    keyForDate: (date) => imergEndForDate(date, dateOptions)?.toISOString() ?? null,
    urlForKey: (key) =>
      imergUrl(new Date(key), {
        layer: settings.layer,
        width: settings.resolution,
      }),
    apply: (texture) =>
      earth!.setPrecipTexture(texture, { opacity: settings.opacity }),
    // Précharge la demi-heure suivante pour une transition sans à-coup.
    prefetchKeys: (key) => {
      const next = new Date(new Date(key).getTime() + HALF_HOUR_MS);
      const nextEnd = imergEndForDate(next, dateOptions);
      return nextEnd ? [nextEnd.toISOString()] : [];
    },
  });
}
