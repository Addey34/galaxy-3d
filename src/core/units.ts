/**
 * Préférence d'unités (métrique/impérial) — affecte uniquement la PRÉSENTATION. Le catalogue
 * et tout le calcul restent en unités SI (km, °C) ; seuls les formateurs consommateurs
 * (`ui/bodyInfo.ts`) lisent cette préférence pour choisir l'unité affichée. Module `core/` pur
 * (lecture/écriture localStorage seulement, pas de DOM) — testable comme les autres.
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

/** °C → valeur + unité dans le système courant. */
export function convertTemperatureC(
  celsius: number
): { value: number; unit: string } {
  return current === 'metric'
    ? { value: celsius, unit: '°C' }
    : { value: (celsius * 9) / 5 + 32, unit: '°F' };
}
