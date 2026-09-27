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
const readme = read('README.md');

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

/**
 * LE DOI DU README EST CONFRONTÉ À SON UNIQUE PROPRIÉTAIRE.
 *
 * Le README est du Markdown que rien ne construit : il porte donc la valeur en clair, là où les
 * pages générées la LISENT dans `CITATION.cff`. C'est la seule copie du DOI dans le dépôt, et une
 * copie sans garde est une divergence en attente. Une citation fausse est reprise par tous ceux
 * qui citent le projet et ne se corrige pas après coup.
 */
describe('DOI publié', () => {
  const doi = /^doi:\s*(\S+)\s*$/m.exec(citation)?.[1];

  it('est déclaré dans CITATION.cff, sous forme de DOI et non d’URL', () => {
    expect(doi, 'CITATION.cff sans `doi:`').toBeTruthy();
    expect(doi).toMatch(/^10\.\d{4,9}\/\S+$/);
  });

  it('ne mentionne AUCUN DOI que CITATION.cff ne déclare', () => {
    // Formulation trouvée en FALSIFIANT la précédente, qui était trop faible : elle exigeait « au
    // moins deux occurrences égales au DOI de concept », or le README en porte trois. En corrompre
    // UNE en laissait deux, donc la garde restait verte pour un badge qui pointait ailleurs.
    // La propriété juste ne compte pas les occurrences : elle n'en tolère aucune d'inconnue.
    const declared = new Set(
      [
        doi,
        ...[...citation.matchAll(/^\s+value:\s*(10\.\S+)\s*$/gm)].map(
          (m) => m[1]
        ),
      ].filter((value): value is string => Boolean(value))
    );
    // Le badge de Zenodo s'écrit `.../DOI/10.5281/zenodo.NNN.svg` : le `.svg` fait partie de l'URL
    // de l'image, pas du DOI. On le retire, sans quoi la garde refuserait son propre badge.
    const inReadme = [
      ...new Set(
        [...readme.matchAll(/10\.\d{4,9}\/[^\s)\]<]+/g)].map((m) =>
          m[0].replace(/\.svg$/, '')
        )
      ),
    ];
    expect(inReadme.length, 'aucun DOI dans le README').toBeGreaterThan(0);
    expect(
      inReadme.filter((value) => !declared.has(value)),
      `le README mentionne un DOI absent de CITATION.cff, qui déclare ${JSON.stringify([...declared])}`
    ).toEqual([]);
  });

  it('cite le DOI de CONCEPT plus souvent que celui de la version', () => {
    // Les deux sont légitimes, mais c'est le concept qu'un lecteur doit prendre par défaut : il
    // doit donc dominer le texte, badge compris.
    // Compté par découpage plutôt que par expression régulière : un DOI contient `/` et `.`, donc
    // le construire en motif demande un échappement que rien ne vérifie.
    const count = (value: string): number => readme.split(value).length - 1;
    const version = [...citation.matchAll(/^\s+value:\s*(10\.\S+)\s*$/gm)]
      .map((m) => m[1])
      .find((value) => value !== doi);
    expect(
      version,
      'CITATION.cff ne déclare pas de DOI de version'
    ).toBeTruthy();
    expect(count(doi!)).toBeGreaterThan(count(version!));
  });

  it('n’apparaît que sous forme résolvable, jamais en DOI nu non cliquable', () => {
    // Un DOI qu'on ne peut pas cliquer oblige le lecteur à le recopier, donc à se tromper.
    expect(readme).toContain(`https://doi.org/${doi}`);
  });

  it('déclare aussi le DOI de CETTE version, distinct du DOI de concept', () => {
    // Zenodo en frappe deux ; confondre les deux, c'est citer un état figé en croyant citer l'œuvre.
    const identifiers = [
      ...citation.matchAll(/^\s+value:\s*(10\.\S+)\s*$/gm),
    ].map((m) => m[1]);
    expect(identifiers).toContain(doi);
    expect(identifiers.filter((value) => value !== doi).length).toBeGreaterThan(
      0
    );
  });
});
