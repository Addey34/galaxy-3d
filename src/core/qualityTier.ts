/**
 * PALIER DE QUALITÉ de rendu (perf adaptative). Module PUR (pas de DOM/WebGL au-delà de
 * localStorage optionnel) → unit-testable comme les autres modules `core/`.
 *
 * Problème : la puissance GPU du visiteur est inconnue et le user-agent seul (mobile vs
 * desktop) ne la reflète pas (un vieux PC de bureau peut être plus faible qu'un mobile récent).
 * Solution produit : un PALIER explicite `low | medium | high`, choisi par l'utilisateur ou
 * déduit en mode `auto`. Un seul point de vérité que tous les leviers de rendu consultent.
 *
 * `auto` reproduit exactement l'ancien comportement binaire `IS_MOBILE` : mobile → `medium`,
 * desktop → `high`. Personne n'est donc dégradé par défaut ; le palier ne fait qu'OUVRIR le
 * choix (forcer `low` sur une machine qui rame, `high` sur un mobile puissant).
 */

import { STORAGE_KEYS } from '@/config/storageKeys';

/** Palier de rendu effectif : bas / moyen / élevé. */
export type QualityTier = 'low' | 'medium' | 'high';

/** Choix utilisateur : un palier fixe, ou `auto` (déduit de l'appareil). */
export type QualityMode = QualityTier | 'auto';

/** Clé localStorage de persistance du choix (réexport de la source unique). */
export const QUALITY_STORAGE_KEY = STORAGE_KEYS.quality;

const MODES: readonly QualityMode[] = ['auto', 'low', 'medium', 'high'];

/** true si `value` est un mode de qualité valide (garde de parsing). */
export function isQualityMode(value: unknown): value is QualityMode {
  return typeof value === 'string' && MODES.includes(value as QualityMode);
}

/**
 * Résout `auto` en palier concret à partir d'un signal « appareil faible » (mobile). Le
 * signal est injecté (pas de dépendance directe au user-agent ici) → pur et testable.
 * Un mode déjà concret (`low`/`medium`/`high`) est renvoyé tel quel.
 */
export function resolveQualityTier(
  mode: QualityMode,
  isLowPowerDevice: boolean
): QualityTier {
  if (mode !== 'auto') return mode;
  return isLowPowerDevice ? 'medium' : 'high';
}

/** Réglages de rendu dérivés d'un palier. Consommés par les leviers (renderer, LOD, post-fx). */
export interface QualityProfile {
  /** Plafond de pixel ratio (netteté vs coût). Ajustable À CHAUD. */
  maxPixelRatio: number;
  /** Antialiasing MSAA du renderer. FIGÉ à l'init → changement au prochain chargement. */
  antialias: boolean;
  /** Post-processing bloom. Ajustable à chaud (activation/désactivation de la passe). */
  bloom: boolean;
  /** Anisotropie max des textures. FIGÉ sur la texture → prochain chargement. */
  maxAnisotropy: number;
  /** Segments de la sphère haute densité (relief au gros plan). Ajustable au prochain LOD. */
  hiResSegments: number;
  /** Résolution de texture maximale servie par le LOD. Ajustable au prochain LOD. */
  maxTextureQuality: '2k' | '4k' | '8k';
}

/** Table des profils par palier : la source unique des compromis qualité/perf. */
export const QUALITY_PROFILES: Record<QualityTier, QualityProfile> = {
  low: {
    maxPixelRatio: 1.0,
    antialias: false,
    bloom: false,
    maxAnisotropy: 4,
    hiResSegments: 128,
    maxTextureQuality: '2k',
  },
  medium: {
    maxPixelRatio: 1.5,
    antialias: false,
    bloom: false,
    maxAnisotropy: 8,
    hiResSegments: 192,
    maxTextureQuality: '4k',
  },
  high: {
    maxPixelRatio: 2.0,
    antialias: true,
    bloom: true,
    maxAnisotropy: 16,
    hiResSegments: 256,
    maxTextureQuality: '8k',
  },
};

/** Profil de rendu pour un palier donné. */
export function qualityProfile(tier: QualityTier): QualityProfile {
  return QUALITY_PROFILES[tier];
}

/**
 * Lit le mode persisté (localStorage), `auto` par défaut si absent ou invalide.
 * Tolère l'absence de `window`/`localStorage` (SSR, tests) → `auto`.
 */
export function readQualityMode(
  storage: Pick<Storage, 'getItem'> | undefined = safeStorage()
): QualityMode {
  const raw = storage?.getItem(QUALITY_STORAGE_KEY);
  return isQualityMode(raw) ? raw : 'auto';
}

/** Persiste le mode choisi. No-op si le stockage est indisponible. */
export function writeQualityMode(
  mode: QualityMode,
  storage: Pick<Storage, 'setItem'> | undefined = safeStorage()
): void {
  try {
    storage?.setItem(QUALITY_STORAGE_KEY, mode);
  } catch {
    // Stockage plein/refusé (mode privé) : le choix reste actif pour la session.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : undefined;
  } catch {
    return undefined; // accès localStorage bloqué (privacy)
  }
}
