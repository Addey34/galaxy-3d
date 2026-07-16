/**
 * Itération et résolution sur le catalogue des corps — source unique.
 *
 * Aplati la hiérarchie corps → satellites en une séquence unique, pour supprimer les
 * boucles `if (cfg.satellites) { for … }` dupliquées dans les systèmes. Les consommateurs
 * filtrent sur `kind`/`frame` plutôt que sur le nom du corps.
 */
import type { CelestialBodyConfig, CelestialConfig } from '../types';

export interface BodyEntry {
  name: string;
  config: CelestialBodyConfig;
  /** Nom du corps parent (planète) pour un satellite, sinon null. */
  parentName: string | null;
}

/** Applique `cb` à chaque corps du catalogue, satellites inclus (profondeur 1). */
export function forEachBody(config: CelestialConfig, cb: (entry: BodyEntry) => void): void {
  for (const [name, cfg] of Object.entries(config.bodies)) {
    cb({ name, config: cfg, parentName: null });
    if (cfg.satellites) {
      for (const [satName, satCfg] of Object.entries(cfg.satellites)) {
        cb({ name: satName, config: satCfg, parentName: name });
      }
    }
  }
}

/** Liste aplatie de tous les corps (ordre : parents puis leurs satellites). */
export function allBodies(config: CelestialConfig): BodyEntry[] {
  const out: BodyEntry[] = [];
  forEachBody(config, (e) => out.push(e));
  return out;
}

/** Table nom → config (satellites inclus), construite une fois. */
export function flattenBodies(config: CelestialConfig): Map<string, CelestialBodyConfig> {
  const map = new Map<string, CelestialBodyConfig>();
  forEachBody(config, ({ name, config: cfg }) => map.set(name, cfg));
  return map;
}

/**
 * Vérifie que chaque nom de corps est unique sur tout le catalogue (planètes et
 * satellites confondus). Les noms servent de clés (boutons de nav, `flattenBodies`,
 * textures) : un doublon écraserait silencieusement une entrée. Lève une erreur au
 * chargement plutôt que d'échouer en aval de façon opaque.
 */
export function assertUniqueBodyNames(config: CelestialConfig): void {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  forEachBody(config, ({ name }) => {
    if (seen.has(name)) duplicates.push(name);
    else seen.add(name);
  });
  if (duplicates.length > 0) {
    throw new Error(`Catalogue invalide — noms de corps en doublon : ${duplicates.join(', ')}`);
  }
}
