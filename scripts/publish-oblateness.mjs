#!/usr/bin/env node
/* global console, process */
/**
 * L'APLATISSEMENT DES PLANÈTES, PUBLIÉ AU MANIFESTE DES ÉPHÉMÉRIDES (ligne 45.10, pas 2,
 * 2026-10-11).
 *
 * Un segment relatif à une planète (BepiColombo autour de Mercure, un survol, Juno autour de
 * Jupiter) se propage entre ses ancres sous la gravité de cette planète. La conique seule ment
 * au ras d'une géante : Juno à 4 000 km des nuages de Jupiter s'en écarte de plusieurs milliers
 * de km en quelques heures. Le service ajoute donc le terme J2 (`core/oblatePropagation.ts`)
 * quand la planète du segment publie ici :
 *
 *   - `j2` : la ligne « J2 (x 10-6) » de sa fiche du NSSDCA ;
 *   - `radiusKm` : le rayon équatorial de la MÊME fiche, rayon de référence de ce coefficient ;
 *   - `poleRaDeg`, `poleDecDeg` : les termes constants du pôle IAU du noyau PCK de NAIF.
 *
 * Tout est LU dans `src/config/factSources.snapshot.json` (`pnpm facts:snapshot`), rien n'est
 * saisi. Le manifeste et non le catalogue, parce que le catalogue voyage dans le JavaScript du
 * démarrage et que seul le service des éphémérides s'en sert. `--check` ne touche à rien et
 * sort en code 1 si une valeur publiée a dérivé du relevé. Garde : `ephemerisOblateness.test.ts`.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = join(ROOT, 'public/assets/ephemerides/manifest.json');
const SNAPSHOT_PATH = join(ROOT, 'src/config/factSources.snapshot.json');
const checkOnly = process.argv.includes('--check');

const original = await readFile(MANIFEST_PATH, 'utf8');
const manifest = JSON.parse(original);
const snapshot = JSON.parse(await readFile(SNAPSHOT_PATH, 'utf8'));

/** L'aplatissement que le relevé donne pour ce corps, ou `undefined`. */
export function oblatenessOf(name, snap) {
  const sheet = snap.nssdca.bodies[name];
  const rotation = snap.naifRotation.bodies[name]?.rotation;
  if (sheet?.j2e6 === undefined) return undefined;
  if (!rotation)
    throw new Error(`${name} : un J2 publié mais aucun pôle au relevé`);
  return {
    j2: Number((sheet.j2e6 * 1e-6).toPrecision(12)),
    radiusKm: sheet.equatorialRadiusKm,
    poleRaDeg: rotation.poleRaDeg[0],
    poleDecDeg: rotation.poleDecDeg[0],
  };
}

const changed = [];
for (const [name, entry] of Object.entries(manifest.bodies)) {
  // Seuls les fichiers d'un corps lui-même : un segment n'est pas une planète.
  const published = entry.segmentOf ? undefined : oblatenessOf(name, snapshot);
  const before = JSON.stringify(entry.oblateness);
  if (published) entry.oblateness = published;
  else delete entry.oblateness;
  if (JSON.stringify(entry.oblateness) !== before)
    changed.push(
      `${name} : ${before ?? 'absent'} -> ${JSON.stringify(entry.oblateness) ?? 'absent'}`
    );
}

const updated = `${JSON.stringify(manifest, null, 2)}\n`;
if (checkOnly) {
  if (updated !== original) {
    console.error(
      'Le manifeste ne porte pas l’aplatissement que le relevé donne :'
    );
    for (const line of changed) console.error(`  ${line}`);
    console.error('Lance : pnpm ephemeris:oblateness');
    process.exitCode = 1;
  } else console.log('Manifeste à jour.');
} else if (updated === original)
  console.log('Manifeste déjà à jour, rien à écrire.');
else {
  await writeFile(MANIFEST_PATH, updated);
  console.log(`Manifeste réécrit, ${changed.length} entrée(s) :`);
  for (const line of changed) console.log(`  ${line}`);
}
