import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { citationLine, doiUrl, parseCitation } from './citation';

/**
 * LA CITATION SE LIT, ELLE NE SE RETAPE PAS (lot 18).
 *
 * Deux moitiés : la lecture de `CITATION.cff` (ce fichier), et la confrontation du DOI publié dans
 * le README au même fichier (`src/config/citationMetadata.test.ts`). Un DOI recopié dans quatre
 * endroits finit par différer dans l'un d'eux, et une citation fausse est reprise par tous ceux
 * qui citent le projet.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CFF = readFileSync(resolve(ROOT, 'CITATION.cff'), 'utf-8');

const MINIMAL = `cff-version: 1.2.0
title: 'Galaxy: 3D Solar System'
type: software
authors:
  - given-names: Adrian
    family-names: Guichard
repository-code: 'https://github.com/Addey34/galaxy-3d'
url: 'https://galaxy.adrianguichard.dev/'
doi: 10.5281/zenodo.1234567
version: 0.10.0
date-released: '2026-09-27'
`;

describe('lecture de CITATION.cff', () => {
  it('lit le fichier RÉELLEMENT livré', () => {
    // Le vrai fichier, pas une copie : c'est lui que GitHub et Zenodo lisent.
    const meta = parseCitation(CFF);
    expect(meta.title).toBeTruthy();
    expect(meta.authors.length).toBeGreaterThan(0);
    expect(meta.doi).toMatch(/^10\.\d{4,9}\/\S+$/);
    expect(meta.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(meta.released).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('rend les auteurs dans l’ordre déclaré, en « Nom, P. »', () => {
    expect(parseCitation(MINIMAL).authors).toEqual(['Guichard, A.']);
  });

  it('compose une référence d’une ligne avec l’année et le DOI résolvable', () => {
    const meta = parseCitation(MINIMAL);
    expect(citationLine(meta)).toBe(
      'Guichard, A. (2026). Galaxy: 3D Solar System (version 0.10.0) [Software]. Zenodo. https://doi.org/10.5281/zenodo.1234567'
    );
    expect(doiUrl(meta)).toBe('https://doi.org/10.5281/zenodo.1234567');
  });

  it.each([
    ['doi', /champ\(s\) manquant/],
    ['version', /champ\(s\) manquant/],
    ['date-released', /champ\(s\) manquant/],
    ['repository-code', /champ\(s\) manquant/],
    ['title', /champ\(s\) manquant/],
    ['url', /champ\(s\) manquant/],
  ])(
    'REFUSE un fichier sans %s au lieu de citer à moitié',
    (field, message) => {
      const broken = MINIMAL.split('\n')
        .filter((line) => !line.startsWith(`${field}:`))
        .join('\n');
      expect(() => parseCitation(broken)).toThrow(message);
    }
  );

  it('refuse une chaîne qui n’est pas un DOI', () => {
    // Le cas qui compte : quelqu'un colle l'URL complète au lieu du DOI, et tout « marche »
    // jusqu'à ce qu'un lecteur clique sur https://doi.org/https://doi.org/…
    expect(() =>
      parseCitation(
        MINIMAL.replace(
          'doi: 10.5281/zenodo.1234567',
          'doi: https://doi.org/10.5281/zenodo.1234567'
        )
      )
    ).toThrow(/n'est pas un DOI/);
  });

  it('refuse une date qui n’est pas ISO', () => {
    expect(() =>
      parseCitation(
        MINIMAL.replace(
          "date-released: '2026-09-27'",
          'date-released: 27/09/2026'
        )
      )
    ).toThrow(/n'est pas ISO/);
  });

  it('refuse un fichier sans auteur lisible', () => {
    const noAuthor = MINIMAL.replace(
      '  - given-names: Adrian\n    family-names: Guichard\n',
      '  - name: Anonyme\n'
    );
    expect(() => parseCitation(noAuthor)).toThrow(/aucun auteur lisible/);
  });
});
