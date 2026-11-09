import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertCoveredBody,
  publishStaged,
  verifyBodyResult,
  type BodyResult,
} from '../../scripts/place-observations-publish.mjs';

/**
 * LA PUBLICATION DES OBSERVATIONS DE LIEUX NE DÉPEND JAMAIS DE LA RÉUSSITE D'UNE GÉNÉRATION
 * (GAL-A003-01). Le 2026-11-09, `places:generate --only mars` lancé sans cache d'empreintes aurait
 * effacé les morceaux livrés de Mars puis échoué. Ces tests rejouent chaque point de défaillance
 * et exigent que l'arbre livré (et l'index) reste identique OCTET POUR OCTET.
 */

/** Tout l'arbre : chemin relatif → contenu. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out[full.slice(root.length)] = readFileSync(full, 'utf8');
    }
  };
  walk(root);
  return out;
}

let work: string;
let staging: string;
let outRoot: string;
let indexPath: string;

const write = (path: string, text: string): void => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
};

/** Un arbre livré : deux corps (2 puis 1 morceaux) et un index. */
function seedLive(): void {
  write(join(outRoot, 'mars', '0.json'), '{"observed":{"1":[]},"v":"ancien"}');
  write(join(outRoot, 'mars', '1.json'), '{"observed":{"2":[]},"v":"ancien"}');
  write(join(outRoot, 'venus', '0.json'), '{"observed":{"3":[]},"v":"ancien"}');
  write(indexPath, '{"v":"index-ancien"}\n');
}

/** Un corps préparé : `shards` morceaux d'une génération « nouvelle ». */
function seedStaged(body: string, shards: number): void {
  for (let k = 0; k < shards; k++)
    write(
      join(staging, body, `${k}.json`),
      `{"observed":{},"v":"nouveau-${body}-${k}"}`
    );
}

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'poi-'));
  staging = join(work, 'staging');
  outRoot = join(work, 'public', 'place-observations');
  indexPath = join(work, 'src', 'index.json');
});
afterEach(() => rmSync(work, { recursive: true, force: true }));

const good: BodyResult = {
  missingPages: 0,
  extraPages: 0,
  products: 1000,
  observed: 2,
  formations: 3,
  shards: 2,
  observedIds: ['2', '3'],
  shardOf: (id) => Number(id) % 2,
};
const opts = { featureIds: [1, 2, 3] };

describe('--only', () => {
  it('accepte un corps couvert ou rien, refuse une faute de frappe', () => {
    expect(() => assertCoveredBody(null)).not.toThrow();
    expect(() => assertCoveredBody('mars')).not.toThrow();
    expect(() => assertCoveredBody('marz')).toThrow(/corps inconnu/);
    expect(() => assertCoveredBody('earth')).toThrow(/corps inconnu/);
  });
});

describe('verifyBodyResult : refuse avant toute publication', () => {
  it('laisse passer un résultat complet et cohérent', () => {
    expect(() => verifyBodyResult('mars', good, opts)).not.toThrow();
  });
  it('refuse des pages manquantes, sauf --partial', () => {
    const bad = { ...good, missingPages: 3 };
    expect(() => verifyBodyResult('mars', bad, opts)).toThrow(
      /3 page\(s\) d'empreintes manquante/
    );
    expect(() =>
      verifyBodyResult('mars', bad, { ...opts, partial: true })
    ).not.toThrow();
  });
  it('refuse un cache sans produit (le cas du poste sans pages/)', () => {
    expect(() =>
      verifyBodyResult(
        'mars',
        { ...good, products: 0, missingPages: 1833, observed: 0, shards: 1 },
        opts
      )
    ).toThrow(/rien n'est publié/);
  });
  it('refuse des pages en trop, une formation inconnue, un mauvais morceau', () => {
    expect(() =>
      verifyBodyResult('mars', { ...good, extraPages: 1 }, opts)
    ).toThrow(/en trop/);
    expect(() =>
      verifyBodyResult('mars', { ...good, observedIds: ['99'] }, opts)
    ).toThrow(/n'est pas dans le gazetteer/);
    expect(() =>
      verifyBodyResult('mars', { ...good, shardOf: () => 7 }, opts)
    ).toThrow(/mauvais morceau/);
  });
  it('refuse plus de formations observées que de formations', () => {
    expect(() =>
      verifyBodyResult('mars', { ...good, observed: 4 }, opts)
    ).toThrow(/pour 3 formations/);
  });
  it('refuse une baisse de plus de 1 % des produits, sauf --accept-drop', () => {
    const previous = { products: 1000 };
    expect(() =>
      verifyBodyResult(
        'mars',
        { ...good, products: 989 },
        { ...opts, previous }
      )
    ).toThrow(/baisse/);
    expect(() =>
      verifyBodyResult(
        'mars',
        { ...good, products: 990 },
        { ...opts, previous }
      )
    ).not.toThrow();
    expect(() =>
      verifyBodyResult(
        'mars',
        { ...good, products: 500 },
        { ...opts, previous, acceptDrop: true }
      )
    ).not.toThrow();
  });
});

describe('publishStaged : tout ou rien', () => {
  it('pose les nouveaux morceaux et l’index, garde les corps non traités', () => {
    seedLive();
    seedStaged('mars', 1);
    const venusBefore = snapshot(join(outRoot, 'venus'));
    publishStaged({
      staging,
      outRoot,
      indexPath,
      indexText: '{"v":"index-nouveau"}\n',
      bodies: [{ body: 'mars', shards: 1 }],
    });
    expect(Object.keys(snapshot(join(outRoot, 'mars')))).toHaveLength(1);
    expect(readFileSync(join(outRoot, 'mars', '0.json'), 'utf8')).toContain(
      'nouveau-mars-0'
    );
    expect(snapshot(join(outRoot, 'venus'))).toEqual(venusBefore);
    expect(readFileSync(indexPath, 'utf8')).toBe('{"v":"index-nouveau"}\n');
    expect(existsSync(`${staging}.backup`)).toBe(false);
    expect(existsSync(`${indexPath}.tmp`)).toBe(false);
  });

  it('première publication : pas d’ancien corps, pas d’ancien index', () => {
    seedStaged('mars', 2);
    publishStaged({
      staging,
      outRoot,
      indexPath,
      indexText: '{"v":1}',
      bodies: [{ body: 'mars', shards: 2 }],
    });
    expect(existsSync(join(outRoot, 'mars', '1.json'))).toBe(true);
  });

  // Un crash simulé à CHAQUE étape : l'arbre livré et l'index reviennent identiques.
  for (const label of [
    'mars:ancien-écarté',
    'mars:nouveau-posé',
    'venus:ancien-écarté',
    'venus:nouveau-posé',
    'index:écrit',
    'index:posé',
  ])
    it(`échec à « ${label} » : l'état livré revient octet pour octet`, () => {
      seedLive();
      seedStaged('mars', 1);
      seedStaged('venus', 3);
      const liveBefore = snapshot(outRoot);
      const indexBefore = readFileSync(indexPath, 'utf8');
      expect(() =>
        publishStaged({
          staging,
          outRoot,
          indexPath,
          indexText: '{"v":"index-nouveau"}\n',
          bodies: [
            { body: 'mars', shards: 1 },
            { body: 'venus', shards: 3 },
          ],
          hooks: {
            afterStep: (l) => {
              if (l === label) throw new Error(`crash simulé : ${l}`);
            },
          },
        })
      ).toThrow(/crash simulé/);
      expect(snapshot(outRoot)).toEqual(liveBefore);
      expect(readFileSync(indexPath, 'utf8')).toBe(indexBefore);
      expect(existsSync(`${indexPath}.tmp`)).toBe(false);
      expect(existsSync(`${staging}.backup`)).toBe(false);
    });

  it('échec sans ancien index : l’index écrit par la tentative ne survit pas', () => {
    seedStaged('mars', 1);
    expect(() =>
      publishStaged({
        staging,
        outRoot,
        indexPath,
        indexText: '{"v":1}',
        bodies: [{ body: 'mars', shards: 1 }],
        hooks: {
          afterStep: (l) => {
            if (l === 'index:posé') throw new Error('crash simulé');
          },
        },
      })
    ).toThrow();
    expect(existsSync(indexPath)).toBe(false);
    expect(existsSync(join(outRoot, 'mars'))).toBe(false);
  });

  it('morceaux préparés incomplets, absents ou illisibles : rien n’est touché', () => {
    seedLive();
    const liveBefore = snapshot(outRoot);
    const indexBefore = readFileSync(indexPath, 'utf8');
    const attempt = (shards: number): void =>
      publishStaged({
        staging,
        outRoot,
        indexPath,
        indexText: '{"v":1}',
        bodies: [{ body: 'mars', shards }],
      });
    expect(() => attempt(1)).toThrow(/absents/);
    seedStaged('mars', 1);
    expect(() => attempt(2)).toThrow(/1 morceaux pour 2/);
    write(join(staging, 'mars', '0.json'), '{pas du json');
    expect(() => attempt(1)).toThrow();
    expect(snapshot(outRoot)).toEqual(liveBefore);
    expect(readFileSync(indexPath, 'utf8')).toBe(indexBefore);
  });

  it('index illisible : rien n’est touché', () => {
    seedLive();
    seedStaged('mars', 1);
    const liveBefore = snapshot(outRoot);
    expect(() =>
      publishStaged({
        staging,
        outRoot,
        indexPath,
        indexText: '{pas du json',
        bodies: [{ body: 'mars', shards: 1 }],
      })
    ).toThrow();
    expect(snapshot(outRoot)).toEqual(liveBefore);
    expect(readFileSync(indexPath, 'utf8')).toBe('{"v":"index-ancien"}\n');
  });
});
