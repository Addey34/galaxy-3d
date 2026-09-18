/**
 * Catalogue des corps célestes : le `CelestialConfig` que lit toute l'application.
 *
 * **Depuis le lot 7 (phase 4), la DONNÉE n'est plus ici.** Chaque corps est une fiche JSON dans
 * `src/registry/entities/` (valeurs, faits sourcés, textures déclarées, éléments orbitaux), l'ordre
 * de premier niveau est `src/registry/entities/order.json`, et `src/registry/load.ts` reconstruit
 * ce catalogue à l'identité de bits près. Ajouter un corps, c'est ajouter une fiche (et son
 * dossier de textures), pas écrire du TypeScript : le contrat et les formes de calcul déclarées
 * sont dans `src/registry/load.ts`, le schéma dans `src/registry/schema/entity.ts`.
 *
 * Ce module garde ce qui est du CODE : la dérivation des chemins de texture et les contrôles
 * structurels exécutés au chargement.
 */
import type { CelestialConfig } from '@/types';
import { loadEntityCatalogue } from '@/registry/entities';
import {
  assertUniqueBodyNames,
  deriveTextures,
  forEachBody,
  ringTexturePath,
} from './catalog';
import { assertValidCelestialCatalog } from './catalogValidation';

export const CELESTIAL_CONFIG: CelestialConfig = {
  bodies: loadEntityCatalogue(),
};

// Dérive les chemins de texture depuis la clé du corps + les couches déclarées dans
// `textureResolutions` (nommage snake_case `{body}/{body}_{layer}`). Aucun chemin n'est écrit
// dans les fiches : c'est `catalog.texturePath` qui fait foi.
forEachBody(CELESTIAL_CONFIG, ({ name, config }) => {
  config.textures = deriveTextures(name, config);
  if (config.ring && !config.ring.textures) {
    config.ring.textures = ringTexturePath(name);
  }
});

// Fail-fast : un nom en doublon (corps ou satellite) écraserait silencieusement une entrée.
assertUniqueBodyNames(CELESTIAL_CONFIG);
// Fail-fast: a body without fallback, LOD or safe asset path must fail at startup.
assertValidCelestialCatalog(CELESTIAL_CONFIG);
