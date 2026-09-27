import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * CE QUE LE PROJET DIT DE LUI-MÊME QUAND ON LE CITE (lot 18).
 *
 * Trois fichiers décrivent la MÊME version : `package.json`, `CITATION.cff` et le `CHANGELOG.md`.
 * Rien ne les tenait ensemble, et une version qui dérive d'un fichier à l'autre est un mensonge
 * publié d'une espèce particulièrement fâcheuse : elle est recopiée par tous ceux qui citent le
 * projet, et une citation ne se corrige pas après coup.
 *
 * Ce fichier ne recopie AUCUNE valeur. Il lit les trois et exige qu'elles concordent, ce qui est
 * la seule forme de garde qui survive à la prochaine release.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (name: string): string =>
  readFileSync(resolve(ROOT, name), 'utf-8');

const packageVersion = (JSON.parse(read('package.json')) as { version: string })
  .version;
const citation = read('CITATION.cff');
const changelog = read('CHANGELOG.md');

/** La version déclarée par `CITATION.cff`, telle qu'un outil de citation la lira. */
const citationVersion = /^version:\s*(.+)$/m.exec(citation)?.[1]?.trim();
/** La date de publication déclarée par `CITATION.cff`, entre apostrophes en YAML. */
const citationDate = /^date-released:\s*'?([0-9]{4}-[0-9]{2}-[0-9]{2})'?$/m
  .exec(citation)?.[1]
  ?.trim();

describe('métadonnées de citation', () => {
  it('déclare une version dans les deux fichiers', () => {
    // Sans cette borne, un `CITATION.cff` restructuré rendrait `undefined` des deux côtés et les
    // comparaisons suivantes passeraient en ne comparant rien.
    expect(packageVersion, 'package.json sans version').toMatch(
      /^\d+\.\d+\.\d+$/
    );
    expect(citationVersion, 'CITATION.cff sans `version:`').toMatch(
      /^\d+\.\d+\.\d+$/
    );
  });

  it('dit la MÊME version dans package.json et CITATION.cff', () => {
    expect(citationVersion).toBe(packageVersion);
  });

  it('a une section de CHANGELOG pour cette version exacte', () => {
    // Publier une release dont le journal ne parle pas, c'est demander à quelqu'un de citer un
    // travail qu'il ne peut pas lire.
    const heading = new RegExp(
      `^## \\[${packageVersion.replace(/\./g, '\\.')}\\] - (\\d{4}-\\d{2}-\\d{2})`,
      'm'
    );
    const match = heading.exec(changelog);
    expect(
      match,
      `aucune section « ## [${packageVersion}] - AAAA-MM-JJ » dans CHANGELOG.md`
    ).not.toBeNull();
    // …et à la même date que la citation, sinon les deux se contredisent sur le jour de parution.
    expect(match![1]).toBe(citationDate);
  });

  it('ne laisse aucune section « Non publié » derrière une version datée', () => {
    // Le piège inverse : oublier de refermer la section en publiant, donc annoncer comme à venir
    // ce qui vient d'être livré.
    const unreleased = /^## \[Non publié\]\s*$/m.exec(changelog);
    if (unreleased === null) return;
    const after = changelog.slice(unreleased.index + unreleased[0].length);
    const nextVersion = /^## \[\d+\.\d+\.\d+\]/m.exec(after);
    const content = nextVersion ? after.slice(0, nextVersion.index) : after;
    expect(
      content.trim(),
      'la section « Non publié » existe et porte du contenu : soit elle décrit du travail non ' +
        'publié, soit elle a été oubliée en refermant la version'
    ).not.toBe('');
  });
});
