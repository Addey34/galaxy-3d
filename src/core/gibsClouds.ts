/**
 * Construction d'URL et normalisation de date pour la couverture nuageuse réelle
 * NASA GIBS (Global Imagery Browse Services). Module PUR : pas de DOM, pas de three,
 * pas de réseau — juste des chaînes et des dates → unit-testable comme les autres
 * modules `core/`. Le chargement effectif de la texture vit dans `ui/realtimeClouds`.
 *
 * Endpoint WMS 1.3.0 GetMap en projection géographique (EPSG:4326), qui renvoie une
 * seule image équirectangulaire globale directement mappable sur la sphère. CORS
 * ouvert (`Access-Control-Allow-Origin: *`), aucune clé API. Couche VIIRS SNPP
 * Corrected Reflectance True Color : quotidienne, fauchée large (peu de bandes noires
 * vs MODIS), rendu nuages blancs réaliste.
 */

/** Endpoint WMS GetMap GIBS en projection géographique (EPSG:4326). */
export const GIBS_WMS_ENDPOINT =
  'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';

/** Couche par défaut : nuages « vrais » quotidiens, fauchée large. */
export const GIBS_DEFAULT_LAYER = 'VIIRS_SNPP_CorrectedReflectance_TrueColor';

/**
 * Première date où la couche VIIRS SNPP est disponible sur GIBS (~fin 2015). Avant
 * cette borne, aucune image → l'appelant garde le fallback statique.
 */
export const GIBS_MIN_DATE = '2015-11-24';

export interface GibsCloudUrlOptions {
  /** Identifiant de couche GIBS (défaut : VIIRS SNPP True Color). */
  layer?: string;
  /** Largeur de l'image demandée (px). Défaut 2048. */
  width?: number;
  /** Hauteur de l'image demandée (px). Défaut = width / 2 (équirectangulaire 2:1). */
  height?: number;
  /** Format image renvoyé. Défaut JPEG (léger ; le fond noir sert d'alpha). */
  format?: string;
}

export interface GibsCloudDateOptions {
  /**
   * Latence de publication en jours. GIBS publie l'imagerie du jour avec du retard :
   * pour « aujourd'hui » on vise J-latencyDays pour avoir une image complète. Défaut 1.
   */
  latencyDays?: number;
  /** Borne basse ISO `YYYY-MM-DD` (défaut GIBS_MIN_DATE). */
  minDate?: string;
  /** « Maintenant » injectable pour les tests. Défaut new Date(). */
  now?: Date;
}

/** Formate une date en `YYYY-MM-DD` sur le calendrier UTC (GIBS raisonne en UTC). */
export function toGibsDateString(date: Date): string {
  const y = date.getUTCFullYear().toString().padStart(4, '0');
  const m = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = date.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Tronque une date à minuit UTC (compare des jours, pas des instants). */
function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

/**
 * Normalise la date de simulation vers la date d'imagerie GIBS à réellement charger.
 * Renvoie `null` quand aucune image n'est disponible (avant la borne basse) → dans ce
 * cas l'appelant conserve la texture nuages statique.
 *
 * Règles :
 * - date >= (aujourd'hui - latence) → clampée au dernier jour disponible (J-latence) ;
 *   couvre le « temps réel » et évite de demander une image du jour encore incomplète.
 * - borne basse → `null` si la date demandée est antérieure au début de la couche.
 * - sinon (date passée dans la plage) → cette date telle quelle (time-travel).
 */
export function gibsCloudDateFor(
  date: Date,
  options: GibsCloudDateOptions = {}
): string | null {
  const latencyDays = options.latencyDays ?? 1;
  const now = options.now ?? new Date();
  const minDate = options.minDate ?? GIBS_MIN_DATE;

  const requested = startOfUtcDay(date);
  const latest = startOfUtcDay(now);
  latest.setUTCDate(latest.getUTCDate() - latencyDays);

  // Trop récent (aujourd'hui / futur) → dernière image disponible.
  const target = requested.getTime() > latest.getTime() ? latest : requested;

  // Sous la borne basse de la couche → pas d'image.
  const floor = startOfUtcDay(new Date(`${minDate}T00:00:00Z`));
  if (target.getTime() < floor.getTime()) return null;

  return toGibsDateString(target);
}

/**
 * URL WMS GetMap pour la couverture nuageuse globale à une date GIBS déjà normalisée
 * (chaîne `YYYY-MM-DD`, telle que renvoyée par {@link gibsCloudDateFor}). BBOX global
 * `-90,-180,90,180` en ordre lat,lon (WMS 1.3.0 + EPSG:4326 impose l'axe lat en premier).
 */
export function gibsCloudUrl(
  gibsDate: string,
  options: GibsCloudUrlOptions = {}
): string {
  const width = options.width ?? 2048;
  const height = options.height ?? Math.round(width / 2);
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    REQUEST: 'GetMap',
    VERSION: '1.3.0',
    LAYERS: options.layer ?? GIBS_DEFAULT_LAYER,
    CRS: 'EPSG:4326',
    BBOX: '-90,-180,90,180',
    WIDTH: String(width),
    HEIGHT: String(height),
    FORMAT: options.format ?? 'image/jpeg',
    TIME: gibsDate,
  });
  return `${GIBS_WMS_ENDPOINT}?${params.toString()}`;
}
