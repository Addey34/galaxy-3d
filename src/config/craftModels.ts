/**
 * LES MODÈLES 3D D'ENGINS DISPONIBLES POUR L'INSPECTION (GAL-OBJECT-IMMERSION-001).
 *
 * Deux fichiers du registre, jointure par `id` : `registry/craft/models.json` (à qui sert le modèle,
 * son nom, ses pièces nommées) et `registry/craft/files.json` (écrit par `scripts/import-craft-models.mjs` :
 * adresse exacte de la source à un commit épinglé, empreinte, taille, triangles). Un modèle sans
 * fichier, ou un fichier sans modèle, est une erreur au chargement : la provenance n'a pas de trou.
 *
 * Importé seulement par le morceau des blocs de fiche et par l'inspecteur, jamais par le démarrage.
 */
import filesFile from '@/registry/craft/files.json';
import modelsFile from '@/registry/craft/models.json';
import type { LocalizedText } from '@/types';
import { heavyAssetUrl } from './assetOrigin';

export interface CraftPart {
  /** Noeuds du fichier NASA qui forment la pièce (leurs descendants comptent avec eux). */
  nodes: readonly string[];
  label: LocalizedText;
}

export interface CraftModel {
  id: string;
  /** Les engins servis : ids du registre des sondes, ou `iss`. */
  targets: readonly string[];
  name: LocalizedText;
  parts: readonly CraftPart[];
  /** Où le navigateur lit le fichier (origine des gros fichiers). */
  url: string;
  sourceUrl: string;
  repository: string;
  /** Le commit épinglé (dépôt GitHub de la NASA), ou `''` pour un fichier de `science.nasa.gov` scellé par son empreinte. */
  commit: string;
  /** La page de la NASA qui publie le fichier (`science.nasa.gov`), absente pour le dépôt GitHub. */
  sourcePage?: string;
  /** Le crédit de la page source, tel que la NASA le donne. */
  credit?: string;
  /** Date de lecture du fichier (`science.nasa.gov`), ISO 8601. */
  retrieved?: string;
  sha256: string;
  bytes: number;
  triangles: number;
}

interface FileEntry {
  sourceUrl: string;
  repository?: string;
  sourcePage?: string;
  credit?: string;
  retrieved?: string;
  bytes: number;
  sha256: string;
  triangles: number;
}

export const CRAFT_MODEL_DIR = '/assets/models/craft';

/**
 * Le dossier du décodeur Draco JavaScript de three, NOMMÉ PAR L'EMPREINTE de son contenu (dix premiers
 * hexadécimaux du SHA-256) : `/assets/**` est servi « immutable » un an, un nom stable resterait donc
 * périmé chez les visiteurs si three le changeait. Un test confronte le nom au contenu.
 */
export const DRACO_DECODER_DIR = '/assets/draco/8625489da7/';

export function buildCraftModels(
  models: typeof modelsFile.models,
  files: {
    repository: string;
    commit: string;
    files: Record<string, FileEntry>;
  }
): CraftModel[] {
  const ids = new Set<string>();
  const out = models.map((model) => {
    const file = files.files[model.id];
    if (!file)
      throw new Error(`registre craft : pas de fichier pour ${model.id}`);
    if (ids.has(model.id))
      throw new Error(`registre craft : doublon ${model.id}`);
    ids.add(model.id);
    return {
      id: model.id,
      targets: model.targets,
      name: model.name as LocalizedText,
      parts: model.parts as CraftPart[],
      url: heavyAssetUrl(`${CRAFT_MODEL_DIR}/${model.id}.glb`),
      sourceUrl: file.sourceUrl,
      repository: file.repository ?? files.repository,
      // Un fichier qui a sa propre source (page de science.nasa.gov) n'a pas de commit : son empreinte le scelle.
      commit: file.repository ? '' : files.commit,
      ...(file.sourcePage ? { sourcePage: file.sourcePage } : {}),
      ...(file.credit ? { credit: file.credit } : {}),
      ...(file.retrieved ? { retrieved: file.retrieved } : {}),
      sha256: file.sha256,
      bytes: file.bytes,
      triangles: file.triangles,
    };
  });
  for (const id of Object.keys(files.files))
    if (!ids.has(id))
      throw new Error(`registre craft : fichier sans modèle ${id}`);
  return out;
}

export const CRAFT_MODELS: readonly CraftModel[] = buildCraftModels(
  modelsFile.models,
  filesFile as Parameters<typeof buildCraftModels>[1]
);

/** Le modèle de cet engin (id de sonde ou `iss`), ou `null` : l'appelant dit alors qu'il n'y en a pas. */
export function craftModelFor(target: string): CraftModel | null {
  return CRAFT_MODELS.find((m) => m.targets.includes(target)) ?? null;
}

export function craftModelById(id: string): CraftModel | null {
  return CRAFT_MODELS.find((m) => m.id === id) ?? null;
}
