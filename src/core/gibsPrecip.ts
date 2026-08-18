/**
 * URL et cadence temporelle pour la couche de PRÉCIPITATION mondiale NASA IMERG
 * (GPM, taux de pluie toutes les 30 min). Module PUR (pas de DOM/three/réseau) →
 * unit-testable comme `core/gibsClouds`. Le chargement/animation vit dans
 * `ui/precipLayer`.
 *
 * Même endpoint WMS GIBS que les nuages, mais la couche est sub-journalière : le
 * paramètre TIME porte l'heure (arrondie au pas de 30 min). PNG RGBA (transparent hors
 * pluie), CORS ouvert, sans clé.
 */
import { GIBS_WMS_ENDPOINT } from './gibsClouds';

/** Couche IMERG taux de précipitation, pas de temps 30 min (produit principal). */
export const IMERG_LAYER = 'IMERG_Precipitation_Rate_30min';

/**
 * Couche IMERG QUOTIDIENNE (`IMERG_Precipitation_Rate`) — fallback de dernier recours quand la
 * demi-heure exacte manque : plus robuste (une image par jour, moins de trous), même archive
 * (~2000) et même palette que la 30 min. Confirmée disponible sur GIBS (probe réseau). Note :
 * GIBS n'expose PAS de runs Early/Late/Final séparés — le `_30min` sert déjà le meilleur run.
 */
export const IMERG_DAILY_LAYER = 'IMERG_Precipitation_Rate';

/** Première date où IMERG est disponible sur GIBS (mission GPM, ~2000 via reprocessing). */
export const IMERG_MIN_DATE = '2000-06-01';
/**
 * Couverture native du produit IMERG V07 servi par GIBS.
 *
 * Le champ WMS est demandé sur la grille mondiale, mais son canal alpha porte le masque
 * de rendu natif du produit. Le rendu doit donc conserver ce masque, y compris ses zones
 * transparentes : aucune valeur ne doit être prolongée ou inventée vers les pôles.
 * Les anciennes documentations IMERG mentionnant une limite stricte à ±60° ne
 * décrivent pas le produit V07 actuellement référencé par GIBS.
 */
export const IMERG_COVERAGE = {
  minLatitude: -90,
  maxLatitude: 90,
  productVersion: '07',
  policy: 'native-alpha-no-extrapolation',
} as const;

const HALF_HOUR_MS = 30 * 60 * 1000;

export interface ImergUrlOptions {
  layer?: string;
  /** Largeur de l'image (px). Défaut 1024 (2:1 équirectangulaire). */
  width?: number;
  height?: number;
  /** PNG par défaut : la couche est transparente hors pluie (alpha). */
  format?: string;
}

export interface ImergFrameOptions {
  /** Latence de publication (heures). IMERG publie avec du retard. Défaut 4 h. */
  latencyHours?: number;
  /** Borne basse ISO (défaut IMERG_MIN_DATE). */
  minDate?: string;
  /** « Maintenant » injectable pour les tests. */
  now?: Date;
}

/** Arrondit une date au multiple de 30 min INFÉRIEUR, en UTC (grille des frames IMERG). */
export function snapToHalfHour(date: Date): Date {
  return new Date(Math.floor(date.getTime() / HALF_HOUR_MS) * HALF_HOUR_MS);
}

/** Formate un instant en `YYYY-MM-DDTHH:MM:SSZ` (UTC) pour le paramètre WMS TIME. */
export function toImergTimeString(date: Date): string {
  // Toujours sur la grille 30 min → secondes = 00.
  const snapped = snapToHalfHour(date);
  return snapped.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Dernier instant IMERG disponible pour un « maintenant » donné : now - latence, arrondi
 * à la demi-heure. Sert de fin de fenêtre pour la boucle d'animation.
 */
export function imergLatestAvailable(options: ImergFrameOptions = {}): Date {
  const now = options.now ?? new Date();
  const latencyHours = options.latencyHours ?? 4;
  return snapToHalfHour(new Date(now.getTime() - latencyHours * 3_600_000));
}

/**
 * Résout la fin de fenêtre pour une date de simulation : clampe au dernier instant
 * disponible (temps réel/futur → latest), renvoie `null` sous la borne basse IMERG.
 */
export function imergEndForDate(
  date: Date,
  options: ImergFrameOptions = {}
): Date | null {
  const minDate = options.minDate ?? IMERG_MIN_DATE;
  const floor = new Date(`${minDate}T00:00:00Z`);
  const latest = imergLatestAvailable(options);
  const snapped = snapToHalfHour(date);
  const end = snapped.getTime() > latest.getTime() ? latest : snapped;
  if (end.getTime() < floor.getTime()) return null;
  return end;
}

/**
 * Génère `count` instants à 30 min se terminant à `end` (ordre chronologique croissant),
 * pour la boucle d'animation (étape B). Ne descend jamais sous la borne basse.
 */
export function imergFrameTimes(
  end: Date,
  count: number,
  options: ImergFrameOptions = {}
): Date[] {
  const minDate = options.minDate ?? IMERG_MIN_DATE;
  const floor = new Date(`${minDate}T00:00:00Z`).getTime();
  const endSnap = snapToHalfHour(end).getTime();
  const frames: Date[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const t = endSnap - i * HALF_HOUR_MS;
    if (t >= floor) frames.push(new Date(t));
  }
  return frames;
}

/** URL WMS GetMap pour la couche pluie à un instant donné (BBOX global, EPSG:4326). */
export function imergUrl(
  timestamp: Date,
  options: ImergUrlOptions = {}
): string {
  const width = options.width ?? 1024;
  const height = options.height ?? Math.round(width / 2);
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    REQUEST: 'GetMap',
    VERSION: '1.3.0',
    LAYERS: options.layer ?? IMERG_LAYER,
    CRS: 'EPSG:4326',
    BBOX: '-90,-180,90,180',
    WIDTH: String(width),
    HEIGHT: String(height),
    // Transparent hors pluie : PNG obligatoire (l'alpha porte le masque).
    FORMAT: options.format ?? 'image/png',
    TRANSPARENT: 'TRUE',
    TIME: toImergTimeString(timestamp),
  });
  return `${GIBS_WMS_ENDPOINT}?${params.toString()}`;
}
