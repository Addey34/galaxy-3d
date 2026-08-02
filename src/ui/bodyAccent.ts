import type { CelestialBodyConfig } from '@/types';

/** Shared scene-overlay accents. Catalog colors remain the source for each body. */
export const DEFAULT_BODY_ACCENT = 0x9acaff;
export const SUN_ACCENT = 0xffc857;

export function bodyAccentColor(
  config: Pick<CelestialBodyConfig, 'kind' | 'orbitalColor'> | undefined
): number {
  if (config?.kind === 'star') return SUN_ACCENT;
  return config?.orbitalColor || DEFAULT_BODY_ACCENT;
}

export function hexToRgbTriplet(hex: number): string {
  return `${(hex >> 16) & 0xff}, ${(hex >> 8) & 0xff}, ${hex & 0xff}`;
}

export function bodyAccentTriplet(
  config: Pick<CelestialBodyConfig, 'kind' | 'orbitalColor'> | undefined
): string {
  return hexToRgbTriplet(bodyAccentColor(config));
}
