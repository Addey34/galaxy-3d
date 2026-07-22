/**
 * Accès localisé au contenu documentaire du catalogue (nom d'affichage + description).
 *
 * Le catalogue reste la source unique : ce module ne fait que choisir la bonne langue.
 * Nom : `displayName[locale]` sinon la clé capitalisée (correcte en anglais pour tous les
 * corps actuels). Description : `description[locale]` sinon repli anglais, sinon vide.
 */
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { flattenBodies } from '@/config/catalog';
import type { CelestialBodyConfig } from '@/types';
import { getLocale } from './index';

const CONFIGS = flattenBodies(CELESTIAL_CONFIG);

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Nom d'affichage localisé d'un corps (clé du catalogue → nom). */
export function bodyDisplayName(name: string): string {
  const cfg = CONFIGS.get(name);
  return cfg?.displayName?.[getLocale()] ?? capitalize(name);
}

/** Description localisée d'un corps (chaîne vide si absente). Accepte la config directement. */
export function bodyDescription(cfg: CelestialBodyConfig): string {
  const d = cfg.realData?.description;
  if (!d) return '';
  return d[getLocale()] ?? d.en;
}
