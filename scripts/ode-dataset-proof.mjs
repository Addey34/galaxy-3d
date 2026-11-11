/**
 * LECTEUR COMMUN DES PREUVES D'UN JEU (GAL-A003-11C-23) : ce que le croisement des observations (`generate-place-observations`)
 * doit savoir d'un jeu dont le catalogue dépasse les empreintes, quel que soit le format du manifeste qui le prouve.
 *
 *   - manifeste HISTORIQUE (`reconciliation/<jeu>.json`, une page) : `loadReconciliation`, chemin de validation inchangé,
 *     objet rendu tel quel (plus un champ `format`) ;
 *   - manifeste MULTIPAGE v3 (`reconciliation/<jeu>.multipage.json`) : `loadQualifiedDataset` (validation, sources de toutes
 *     les fenêtres, REQUALIFICATION depuis les captures), jamais transformé en manifeste historique ;
 *   - aucun manifeste : `null`, le comportement historique (le catalogue doit être égal aux empreintes) ;
 *   - un manifeste v3 invalide, ou DEUX manifestes pour un même jeu : refus, jamais de repli silencieux.
 *
 * Les preuves complètes (exclusions détaillées, sources) restent dans le cache scientifique : l'objet rendu les porte pour la
 * validation des pages, la publication n'en recopie qu'un résumé compact. Ce module n'écrit rien.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  loadQualifiedDataset,
  multipageManifestPath,
} from './ode-multipage.mjs';
import { loadReconciliation, manifestPath } from './ode-reconciliation.mjs';
import { expectedOffsets } from './place-observations-publish.mjs';

export class DatasetProofError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DatasetProofError';
  }
}
const fail = (message) => {
  throw new DatasetProofError(message);
};

/**
 * @returns {null | object} `null` sans manifeste ; sinon un objet qui porte (au minimum) `excludedIds`, `footprintIds`,
 *   `catalogued`, `footprints`, `format`. Le format multipage ajoute `excluded`, `offsets`, `pages`, `windowIds`, `strict`,
 *   `sources`, `status`, `geometryKind`, `manifestSha256`.
 */
export function loadDatasetProof({
  cacheDir,
  key,
  freeze,
  catalogueCount,
  pageSize,
  checkSources = true,
  exists = existsSync,
  loadHistoric = loadReconciliation,
  loadMultipage = loadQualifiedDataset,
}) {
  const hasHistoric = exists(manifestPath(cacheDir, key));
  const hasMultipage = exists(multipageManifestPath(cacheDir, key));
  if (hasHistoric && hasMultipage)
    fail(
      `${key} : deux manifestes pour un même jeu (historique et multipage v3) : refus, aucun n'est choisi à la place de l'autre`
    );
  if (!hasMultipage) {
    const historic = loadHistoric({
      cacheDir,
      key,
      freeze,
      catalogueCount,
      pageSize,
      checkSources,
    });
    return historic ? { ...historic, format: 'historique' } : null;
  }
  // Un manifeste v3 présent est TOUJOURS validé par `loadQualifiedDataset` : ses erreurs se propagent, aucun repli.
  const ctx = loadMultipage({ cacheDir, key });
  const m = ctx.manifest;
  const problems = [];
  if (m.status !== 'qualifie') problems.push(`statut ${m.status} ≠ qualifie`);
  if (m.pageSize !== pageSize)
    problems.push(`taille de page ${m.pageSize} ≠ ${pageSize}`);
  if (m.catalogueCount !== catalogueCount)
    problems.push(
      `catalogue ${m.catalogueCount} ≠ ${catalogueCount} du dénombrement`
    );
  if (
    m.freeze?.mincreationtime !== freeze?.mincreationtime ||
    m.freeze?.maxcreationtime !== freeze?.maxcreationtime
  )
    problems.push('gel du manifeste ≠ gel du tirage');
  const offsets = expectedOffsets(catalogueCount, pageSize);
  const have = (m.windows ?? []).map((w) => w.offset);
  if (JSON.stringify(have) !== JSON.stringify(offsets))
    problems.push(
      `fenêtres ${have.join(',')} ≠ pages attendues ${offsets.join(',')}`
    );
  const footprintIds = new Set();
  const excludedIds = new Set();
  const windowIds = new Map();
  const pages = new Map();
  let footprints = 0;
  let excluded = 0;
  for (const w of m.windows ?? []) {
    const ids = new Set(w.footprintIds.map(String));
    windowIds.set(w.offset, ids);
    pages.set(w.offset, { sha256: w.page?.sha256, bytes: w.page?.bytes });
    if (!/^[0-9a-f]{64}$/.test(String(w.page?.sha256)))
      problems.push(`@${w.offset} : SHA-256 de page absent`);
    for (const id of ids) {
      if (footprintIds.has(id))
        problems.push(`@${w.offset} : ODEId ${id} dans deux fenêtres`);
      footprintIds.add(id);
    }
    for (const e of w.excluded) {
      const id = String(e.odeId);
      if (excludedIds.has(id))
        problems.push(`@${w.offset} : exclu ${id} dans deux fenêtres`);
      excludedIds.add(id);
    }
    footprints += ids.size;
    excluded += w.excluded.length;
  }
  for (const id of excludedIds)
    if (footprintIds.has(id))
      problems.push(`ODEId ${id} à la fois empreinte et exclu`);
  if (
    footprints !== m.counts?.footprints ||
    excluded !== m.counts?.excluded ||
    footprints + excluded !== catalogueCount
  )
    problems.push(
      `comptes ${footprints} + ${excluded} ≠ ${catalogueCount} catalogués (manifeste : ${m.counts?.footprints} + ${m.counts?.excluded})`
    );
  if (problems.length) fail(`${key} : ${problems.join(' ; ')}`);
  return {
    format: 'multipage-v3',
    manifest: m,
    file: ctx.file,
    geometryKind: m.geometryKind,
    catalogued: catalogueCount,
    footprints,
    excluded,
    excludedIds,
    footprintIds,
    offsets,
    pages,
    windowIds,
    /** Une page dupliquée ou hors de sa fenêtre est un refus (le format historique ne le distingue pas). */
    strict: true,
    status: m.status,
    sources: m.windows.map((w) => ({
      offset: w.offset,
      metadataSha256: w.sources.metadata.sha256,
      coverageSha256: w.sources.coverage.sha256,
    })),
    manifestSha256: createHash('sha256')
      .update(readFileSync(ctx.file))
      .digest('hex'),
  };
}

/** Résumé COMPACT publiable d'un jeu multipage : jamais les exclusions détaillées (elles restent dans le cache). */
export function compactProof(proof, key) {
  return {
    key,
    contract: { kind: proof.manifest.kind, version: proof.manifest.version },
    pagination: proof.manifest.pagination.profile,
    catalogued: proof.catalogued,
    withFootprint: proof.footprints,
    withoutGeometry: proof.excluded,
    windows: proof.offsets.length,
    evidence: { manifestSha256: proof.manifestSha256 },
  };
}
