import type { CelestialBodyConfig } from '@/types';
import { colorblindSafeColor } from '@/core/colorblindPalette';

/** Shared scene-overlay accents. Catalog colors remain the source for each body. */
export const DEFAULT_BODY_ACCENT = 0x9acaff;
export const SUN_ACCENT = 0xffc857;

let colorblindEnabled = false;
const accentChangeListeners = new Set<() => void>();

/** Abonnement aux changements d'accent (mode daltonien). Renvoie une fonction de désabonnement. */
export function onAccentChange(cb: () => void): () => void {
  accentChangeListeners.add(cb);
  return () => accentChangeListeners.delete(cb);
}

export function isColorblindEnabled(): boolean {
  return colorblindEnabled;
}

/** Bascule la palette daltonienne (voir `core/colorblindPalette.ts`). No-op si déjà à cet état. */
export function setColorblindEnabled(enabled: boolean): void {
  if (enabled === colorblindEnabled) return;
  colorblindEnabled = enabled;
  accentChangeListeners.forEach((cb) => cb());
}

export function bodyAccentColor(
  config: Pick<CelestialBodyConfig, 'kind' | 'orbitalColor'> | undefined,
  name?: string
): number {
  // Le Soleil garde toujours son propre accent : source de lumière au rendu distinct (glow),
  // jamais confondu avec un autre corps — pas besoin de le faire passer par la palette daltonienne.
  if (config?.kind === 'star') return SUN_ACCENT;
  const base = config?.orbitalColor || DEFAULT_BODY_ACCENT;
  return colorblindEnabled ? colorblindSafeColor(base, name) : base;
}

export function hexToRgbTriplet(hex: number): string {
  return `${(hex >> 16) & 0xff}, ${(hex >> 8) & 0xff}, ${hex & 0xff}`;
}

export function bodyAccentTriplet(
  config: Pick<CelestialBodyConfig, 'kind' | 'orbitalColor'> | undefined,
  name?: string
): string {
  return hexToRgbTriplet(bodyAccentColor(config, name));
}
