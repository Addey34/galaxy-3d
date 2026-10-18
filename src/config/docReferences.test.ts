import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * LES DOCUMENTS DISENT CE QUI EXISTE (2026-10-18). Ce dépôt est maintenu par des agents qui lisent
 * d'abord les documents : un chemin cité qui n'existe plus, ou une commande qui manque à la table,
 * les envoie au mauvais endroit sans qu'aucun test ne rougisse. Mesuré ce jour : 343 chemins cités
 * dans les documents publics, tous présents ; huit scripts absents de la table de `CLAUDE.md`.
 */
const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf-8');

/** Les documents PUBLICS, versionnés, donc lus aussi en CI. */
const PUBLIC_DOCS = [
  'docs/ARCHITECTURE.md',
  'docs/TESTING.md',
  'README.md',
  'CONTRIBUTING.md',
];

/**
 * Un chemin COMPLET entre accents graves. Les formes courtes (`core/x.ts`) et les motifs
 * (`*.json`, `{a,b}`) ne sont pas lus : les premières désignent aussi des modules RETIRÉS, cités
 * comme tels, et les seconds ne sont pas des fichiers.
 */
const CITED_PATH =
  /`((?:src|scripts|e2e|public|docs|\.github|services)\/[A-Za-z0-9_./-]+)`/g;

describe('les documents publics', () => {
  it.each(PUBLIC_DOCS)('%s ne cite que des chemins qui existent', (doc) => {
    const missing: string[] = [];
    for (const match of read(doc).matchAll(CITED_PATH)) {
      const path = match[1]!.replace(/[.]+$/, '').replace(/\/$/, '');
      if (path.startsWith('docs/private/')) continue; // hors dépôt public, par décision
      if (!existsSync(resolve(ROOT, path))) missing.push(path);
    }
    expect([...new Set(missing)]).toEqual([]);
  });
});

/**
 * `CLAUDE.md` est PRIVÉ (ignoré par git) : il n'existe pas sur le coureur de CI. Cette garde ne
 * tourne donc que là où il est, c'est-à-dire là où les agents travaillent, dans `pnpm verify` ;
 * en CI elle est sautée, et son titre le dit plutôt que de passer en silence.
 */
const CLAUDE = resolve(ROOT, 'CLAUDE.md');
const hasClaude = existsSync(CLAUDE);

/** Documentés hors du tableau, dans les lignes qui le suivent ou sous une forme combinée. */
const DOCUMENTED_IN_PROSE = new Set([
  'lint',
  'lint:fix',
  'format:check',
  'spk:verify',
]);

describe.skipIf(!hasClaude)(
  'la table des commandes de CLAUDE.md (sautée sans CLAUDE.md, fichier privé absent en CI)',
  () => {
    it('cite chaque script de package.json', () => {
      const scripts = Object.keys(
        (
          JSON.parse(read('package.json')) as {
            scripts: Record<string, string>;
          }
        ).scripts
      );
      const text = readFileSync(CLAUDE, 'utf-8');
      const start = text.indexOf('```bash');
      const table = text.slice(start, text.indexOf('```', start + 7));
      const absent = scripts.filter(
        (name) =>
          !DOCUMENTED_IN_PROSE.has(name) &&
          !new RegExp(
            `pnpm ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w:-])`
          ).test(table)
      );
      expect(absent).toEqual([]);
    });
  }
);
