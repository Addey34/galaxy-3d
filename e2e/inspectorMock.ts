import type { Page } from '@playwright/test';

/**
 * Les champs SIMULÉS de l'inspecteur météo (GAL-METEO-INSPECT-003) : des fonctions de la position,
 * donc des valeurs que l'on sait recalculer à la main en un point connu, au lieu d'une constante.
 * Une valeur uniforme ne prouverait jamais qu'on lit le BON point.
 *
 *  - température : 28 − 0,5·|lat| °C (Paris 48,85° N : 3,6 °C ; l'équateur : 28 °C) ;
 *  - pression, humidité, nuages : des valeurs fixes, lisibles ;
 *  - pluie : 0 mm au nord de l'équateur (vrai zéro), 1,5 mm au sud, ABSENTE (null) à l'est de
 *    120° E, pour distinguer un zéro d'une donnée manquante ;
 *  - vent : 20 km/h d'ouest (270°) partout, nul sous 60° S (calme : la direction manque aussi).
 */
export const FIELDS: Record<
  string,
  (lat: number, lon: number) => number | null
> = {
  temperature_2m: (lat) => 28 - 0.5 * Math.abs(lat),
  pressure_msl: () => 1013,
  relative_humidity_2m: () => 65,
  cloud_cover: () => 60,
  precipitation: (lat, lon) => (lon > 120 ? null : lat >= 0 ? 0 : 1.5),
  wind_speed_10m: (lat) => (lat < -60 ? 0 : 20),
  wind_direction_10m: (lat) => (lat < -60 ? null : 270),
};

export interface InspectorMock {
  /** Requêtes Open-Meteo reçues (le compte ne doit pas bouger quand on inspecte). */
  readonly requests: () => number;
  /** Retient les réponses suivantes jusqu'à `release()` : rend l'état « mise à jour » observable. */
  hold(): void;
  release(): void;
}

export async function mockInspectorFields(page: Page): Promise<InspectorMock> {
  let count = 0;
  let held: Promise<void> | null = null;
  let open: (() => void) | null = null;

  const respond = async (
    route: Parameters<Parameters<Page['route']>[1]>[0],
    fixedHours?: number
  ): Promise<void> => {
    count++;
    if (held) await held;
    const body = route.request().postDataJSON() as {
      latitude?: number[];
      longitude?: number[];
      hourly?: string[];
      past_days?: number;
      forecast_days?: number;
    };
    const hours =
      fixedHours ?? ((body.past_days ?? 0) + (body.forecast_days ?? 1)) * 24;
    const variables = body.hourly?.length ? body.hourly : ['cloud_cover'];
    const lats = body.latitude ?? [];
    const lons = body.longitude ?? [];
    const points = lats.map((lat, i) => ({
      hourly: Object.fromEntries(
        variables.map((variable) => {
          const value = FIELDS[variable]?.(lat, lons[i] ?? 0) ?? null;
          return [variable, Array.from({ length: hours }, () => value)];
        })
      ),
    }));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(points),
    });
  };

  await page.route('**/galaxy-data.adrianguichard.dev/**', (route) =>
    route.abort()
  );
  await page.route('**/api.open-meteo.com/**', (route) => respond(route));
  await page.route('**/archive-api.open-meteo.com/**', (route) =>
    respond(route, 24)
  );

  return {
    requests: () => count,
    hold() {
      held = new Promise<void>((resolve) => (open = resolve));
    },
    release() {
      open?.();
      held = null;
    },
  };
}
