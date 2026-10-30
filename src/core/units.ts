/**
 * Préférence d'unités (métrique/impérial) — affecte uniquement la PRÉSENTATION. Le catalogue
 * et tout le calcul restent en unités SI ; seuls les formateurs consommateurs lisent cette
 * préférence pour choisir l'unité affichée. Module `core/` pur (lecture/écriture localStorage
 * seulement, pas de DOM) — testable comme les autres.
 *
 * Ce que le bouton convertit (audit des panneaux, lot 1) : longueurs (km, m), vitesses (m/s,
 * km/h), masses (kg), accélérations (m/s²), masses volumiques (kg/m³), pressions (bar, hPa),
 * taux de pluie (mm/h) et températures (°C). Ce qui ne change JAMAIS : le kelvin (échelle
 * absolue des deux systèmes), l'unité astronomique, le temps, les angles, les pourcentages et la
 * masse molaire (g/mol, sans équivalent impérial).
 */
import { STORAGE_KEYS } from '@/config/storageKeys';

export type UnitSystem = 'metric' | 'imperial';

const KM_PER_MI = 1.609344;

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : undefined;
  } catch {
    return undefined; // accès localStorage bloqué (mode privé)
  }
}

function readStored(): UnitSystem {
  return safeStorage()?.getItem(STORAGE_KEYS.units) === 'imperial'
    ? 'imperial'
    : 'metric';
}

let current: UnitSystem = readStored();
const listeners = new Set<() => void>();

export function getUnitSystem(): UnitSystem {
  return current;
}

/** Bascule le système d'unités et persiste le choix. No-op si déjà à cet état. */
export function setUnitSystem(system: UnitSystem): void {
  if (system === current) return;
  current = system;
  try {
    safeStorage()?.setItem(STORAGE_KEYS.units, system);
  } catch {
    // stockage plein/refusé : le choix reste actif pour la session
  }
  listeners.forEach((cb) => cb());
}

/** Abonnement au changement de système d'unités. Renvoie une fonction de désabonnement. */
export function onUnitSystemChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * km → valeur + unité dans le système courant. L'appelant garde son propre formatage
 * numérique (séparateurs de milliers, arrondi) — cette fonction ne fait que convertir.
 */
export function convertDistanceKm(km: number): { value: number; unit: string } {
  return current === 'metric'
    ? { value: km, unit: 'km' }
    : { value: km / KM_PER_MI, unit: 'mi' };
}

/**
 * Nombre de décimales pour afficher une distance, selon son ordre de grandeur.
 *
 * L'arrondi à l'entier convient aux planètes parce qu'elles se comptent en milliers de
 * kilomètres, pas parce qu'il serait correct en général : appliqué à Bennu, 242 mètres de
 * rayon, il affichait « 0 km ». Une donnée juste présentée comme un zéro se lit comme un bug
 * de données, et personne ne va vérifier le catalogue pour s'en assurer.
 */
export function distanceDecimals(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude < 1) return 3;
  if (magnitude < 100) return 1;
  return 0;
}

/** °C → valeur + unité dans le système courant. */
export function convertTemperatureC(celsius: number): {
  value: number;
  unit: string;
} {
  return current === 'metric'
    ? { value: celsius, unit: '°C' }
    : { value: (celsius * 9) / 5 + 32, unit: '°F' };
}

export interface Quantity {
  readonly value: number;
  readonly unit: string;
}

const FT_PER_M = 1 / 0.3048;
const LB_PER_KG = 1 / 0.45359237;
const MPH_PER_MS = 3600 / 1609.344;
const MPH_PER_KMH = 1 / KM_PER_MI;
const PSI_PER_BAR = 14.503773773;
const INHG_PER_HPA = 0.029529983071;
const IN_PER_MM = 1 / 25.4;
// 1 lb/ft³ = 16,01846337 kg/m³
const LB_FT3_PER_KG_M3 = 1 / 16.01846337;

/**
 * Une hauteur ou une résolution exprimée en km : le petit multiple de l'unité sous le seuil
 * (mètre ou pied sous 1 km / 1 mi), l'unité de route au-delà (km ou mi). Le seuil est celui de
 * l'unité de route de chaque système, pas la même valeur : 1 km n'est pas 1 mi.
 */
export function convertHeightKm(km: number): Quantity {
  if (current === 'metric')
    return Math.abs(km) < 1
      ? { value: km * 1000, unit: 'm' }
      : { value: km, unit: 'km' };
  const mi = km / KM_PER_MI;
  return Math.abs(mi) < 1
    ? { value: km * 1000 * FT_PER_M, unit: 'ft' }
    : { value: mi, unit: 'mi' };
}

/** m/s → m/s ou mi/h. */
export function convertSpeedMs(ms: number): Quantity {
  return current === 'metric'
    ? { value: ms, unit: 'm/s' }
    : { value: ms * MPH_PER_MS, unit: 'mph' };
}

/** km/h → km/h ou mi/h. */
export function convertSpeedKmh(kmh: number): Quantity {
  return current === 'metric'
    ? { value: kmh, unit: 'km/h' }
    : { value: kmh * MPH_PER_KMH, unit: 'mph' };
}

/** kg → kg ou lb. */
export function convertMassKg(kg: number): Quantity {
  return current === 'metric'
    ? { value: kg, unit: 'kg' }
    : { value: kg * LB_PER_KG, unit: 'lb' };
}

/** m/s² → m/s² ou ft/s². */
export function convertAcceleration(ms2: number): Quantity {
  return current === 'metric'
    ? { value: ms2, unit: 'm/s²' }
    : { value: ms2 * FT_PER_M, unit: 'ft/s²' };
}

/** kg/m³ → kg/m³ ou lb/ft³. */
export function convertDensity(kgM3: number): Quantity {
  return current === 'metric'
    ? { value: kgM3, unit: 'kg/m³' }
    : { value: kgM3 * LB_FT3_PER_KG_M3, unit: 'lb/ft³' };
}

/** bar → bar ou psi (la pression d'une atmosphère planétaire, du mbar à la dizaine de bars). */
export function convertPressureBar(bar: number): Quantity {
  return current === 'metric'
    ? { value: bar, unit: 'bar' }
    : { value: bar * PSI_PER_BAR, unit: 'psi' };
}

/** hPa → hPa ou inHg (la pression au niveau de la mer d'une carte météo). */
export function convertPressureHpa(hpa: number): Quantity {
  return current === 'metric'
    ? { value: hpa, unit: 'hPa' }
    : { value: hpa * INHG_PER_HPA, unit: 'inHg' };
}

/** mm/h → mm/h ou in/h. */
export function convertRainRateMmH(mmPerHour: number): Quantity {
  return current === 'metric'
    ? { value: mmPerHour, unit: 'mm/h' }
    : { value: mmPerHour * IN_PER_MM, unit: 'in/h' };
}
