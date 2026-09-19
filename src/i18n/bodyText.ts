/**
 * Accès localisé au contenu documentaire du catalogue (nom d'affichage + description).
 *
 * Le catalogue reste la source unique : ce module ne fait que choisir la bonne langue.
 * Nom : `displayName[locale]` sinon la clé capitalisée (correcte en anglais pour tous les
 * corps actuels). Description : `description[locale]` sinon repli anglais, sinon vide.
 */
import { NAVIGABLE_BODIES } from '@/config/navigable';
import type { CelestialBodyConfig } from '@/types';
import { getLocale } from './index';

// Corps du catalogue ET objets d'instrument (sondes, interstellaires) : un nom s'affiche de
// la même façon des deux côtés, sinon une sonde sélectionnée n'aurait pas de nom (cf.
// `config/navigable.ts`).
const CONFIGS = NAVIGABLE_BODIES;

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
