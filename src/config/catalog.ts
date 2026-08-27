/**
 * Itération et résolution sur le catalogue des corps — source unique.
 *
 * Aplati la hiérarchie corps → satellites en une séquence unique, pour supprimer les
 * boucles `if (cfg.satellites) { for … }` dupliquées dans les systèmes. Les consommateurs
 * filtrent sur `kind`/`frame` plutôt que sur le nom du corps.
 */
import type {
  CelestialBodyConfig,
  CelestialConfig,
  TextureConfig,
} from '@/types';

/**
 * Corps dont la texture de surface est **illustrative**, pas une mosaïque scientifique fidèle
 * (aucune image de sonde résolue n'existe, ou noyau irrégulier approximé en sphère). Source de
 * vérité côté app pour le badge « surface fictive » de la fiche d'info et les crédits. Doit
 * rester aligné avec les entrées `illustrative: true` de `scripts/texture-sources.json`.
 */
export const ILLUSTRATIVE_SURFACES: ReadonlySet<string> = new Set([
  'ceres',
  'eris',
  'haumea',
  'makemake',
  'halley',
  'pallas',
  'hygiea',
  'orcus',
  'quaoar',
  'gonggong',
  'sedna',
]);

/** Vrai si la surface affichée du corps est illustrative (pas une mosaïque fidèle). */
export function hasIllustrativeSurface(bodyName: string): boolean {
  return ILLUSTRATIVE_SURFACES.has(bodyName);
}

/** camelCase → snake_case (normalMap → normal_map). */
function toSnake(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/**
 * Chemin de base d'une texture, dérivé de la clé du corps + la couche :
 * `{body}/{body}_{layer}` en snake_case (ex. `earth/earth_normal_map`).
 * Source unique du nommage — aucun chemin n'est écrit à la main dans le catalogue.
 */
export function texturePath(bodyName: string, layer: string): string {
  return `${bodyName}/${bodyName}_${toSnake(layer)}`;
}

/**
 * Construit l'objet `textures` d'un corps en dérivant chaque chemin depuis
 * `textureResolutions` (source de vérité des couches actives). Un chemin explicite
 * dans `config.textures[layer]` reste prioritaire (override rare).
 */
export function deriveTextures(
  bodyName: string,
  config: CelestialBodyConfig
): TextureConfig {
  const out: Record<string, string> = { ...(config.textures ?? {}) };
  for (const layer of Object.keys(config.textureResolutions)) {
    if (!out[layer]) out[layer] = texturePath(bodyName, layer);
  }
  return out as TextureConfig;
}

/** Chemin de base d'une texture d'anneau : `{body}/{body}_ring`. */
export function ringTexturePath(bodyName: string): string {
  return texturePath(bodyName, 'ring');
}

export interface BodyEntry {
  name: string;
  config: CelestialBodyConfig;
  /** Nom du corps parent (planète) pour un satellite, sinon null. */
  parentName: string | null;
}

/** Applique `cb` à chaque corps du catalogue, satellites inclus (profondeur 1). */
export function forEachBody(
  config: CelestialConfig,
  cb: (entry: BodyEntry) => void
): void {
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
export function flattenBodies(
  config: CelestialConfig
): Map<string, CelestialBodyConfig> {
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
    throw new Error(
      `Catalogue invalide — noms de corps en doublon : ${duplicates.join(', ')}`
    );
  }
}
