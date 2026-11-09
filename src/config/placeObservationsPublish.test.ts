import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
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
  checkPageNames,
  publishStaged,
  recoverPublish,
  scanDataset,
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
    'journal:écrit',
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
      expect(existsSync(`${staging}.journal.json`)).toBe(false);
    });

  it('échec après la validation du journal : l’état nouveau est conservé, rien ne traîne', () => {
    seedLive();
    seedStaged('mars', 1);
    expect(() =>
      publishStaged({
        staging,
        outRoot,
        indexPath,
        indexText: '{"v":"index-nouveau"}\n',
        bodies: [{ body: 'mars', shards: 1 }],
        hooks: {
          afterStep: (l) => {
            if (l === 'committé') throw new Error('crash simulé');
          },
        },
      })
    ).toThrow(/crash simulé/);
    expect(readFileSync(indexPath, 'utf8')).toBe('{"v":"index-nouveau"}\n');
    expect(existsSync(`${staging}.backup`)).toBe(false);
    expect(existsSync(`${staging}.journal.json`)).toBe(false);
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

/** Un jeu de `count` produits en pages de `page` : fichiers N.ndjson.gz, ids p<n>. */
function writeDataset(dir: string, count: number, page: number): void {
  mkdirSync(dir, { recursive: true });
  for (let off = 0; off < count; off += page) {
    const lines: string[] = [];
    for (let i = off; i < Math.min(count, off + page); i++)
      lines.push(JSON.stringify({ id: `p${i}`, shapes: {} }));
    writeFileSync(join(dir, `${off}.ndjson.gz`), gzipSync(lines.join('\n')));
  }
}

describe('pages ODE : offsets exacts, pas un simple compte de fichiers', () => {
  it('classe manquantes, en trop et mal nommées', () => {
    expect(
      checkPageNames(
        ['0.ndjson.gz', '5000.ndjson.gz', '10000.ndjson.gz'],
        12000,
        5000
      )
    ).toEqual({ missing: [], extra: [], misnamed: [] });
    expect(
      checkPageNames(
        ['0.ndjson.gz', '10000.ndjson.gz', '15000.ndjson.gz'],
        12000,
        5000
      )
    ).toEqual({ missing: [5000], extra: ['15000.ndjson.gz'], misnamed: [] });
    expect(
      checkPageNames(
        [
          '0.ndjson.gz',
          '5000.ndjson.gz',
          '2500.ndjson.gz',
          '10000.gz',
          '010000.ndjson.gz',
        ],
        12000,
        5000
      )
    ).toEqual({
      missing: [10000],
      extra: ['2500.ndjson.gz'],
      misnamed: ['10000.gz', '010000.ndjson.gz'],
    });
  });

  it('jeu complet : accepté, chaque produit distinct lu une fois', () => {
    const dir = join(work, 'ds');
    writeDataset(dir, 12, 5);
    const seen: string[] = [];
    const r = scanDataset(dir, 12, 5, (p) => seen.push(p.id));
    expect(r.problems).toEqual([]);
    expect(r.distinct).toBe(12);
    expect(seen).toHaveLength(12);
  });

  it('une page remplacée par une autre, même nombre de fichiers : refusée', () => {
    const dir = join(work, 'ds');
    writeDataset(dir, 12, 5); // 0, 5, 10
    const page5 = readFileSync(join(dir, '5.ndjson.gz'));
    rmSync(join(dir, '5.ndjson.gz'));
    writeFileSync(join(dir, '15.ndjson.gz'), page5);
    expect(readdirSync(dir)).toHaveLength(3); // le total n'a pas bougé
    const r = scanDataset(dir, 12, 5);
    expect(r.missing).toEqual([5]);
    expect(r.extra).toEqual(['15.ndjson.gz']);
    expect(r.problems.join('|')).toMatch(/manquante/);
    expect(r.problems.join('|')).toMatch(/hors attendu/);
  });

  it('page illisible (gzip ou JSON), fichier mal nommé : refusés', () => {
    const dir = join(work, 'ds');
    writeDataset(dir, 12, 5);
    writeFileSync(join(dir, '5.ndjson.gz'), 'pas du gzip');
    writeFileSync(join(dir, 'notes.txt'), 'x');
    let r = scanDataset(dir, 12, 5);
    expect(r.unreadable).toEqual(['5.ndjson.gz']);
    expect(r.misnamed).toEqual(['notes.txt']);
    writeFileSync(join(dir, '5.ndjson.gz'), gzipSync('{pas du json'));
    r = scanDataset(dir, 12, 5);
    expect(r.unreadable).toEqual(['5.ndjson.gz']);
  });

  it('produits distincts différents du compte déclaré : refusé ; doublons écartés', () => {
    const dir = join(work, 'ds');
    writeDataset(dir, 12, 5);
    expect(scanDataset(dir, 12, 5).problems).toEqual([]);
    // la page 5 recopie la page 0 : ids dupliqués, 7 distincts pour 12 déclarés
    writeFileSync(
      join(dir, '5.ndjson.gz'),
      readFileSync(join(dir, '0.ndjson.gz'))
    );
    const dup = scanDataset(dir, 12, 5);
    expect(dup.duplicates).toBe(5);
    expect(dup.problems.join('|')).toMatch(/7 produits distincts pour 12/);
  });

  it('un dossier absent : toutes les pages sont manquantes', () => {
    const r = scanDataset(join(work, 'absent'), 12, 5);
    expect(r.missing).toEqual([0, 5, 10]);
    expect(r.distinct).toBe(0);
  });

  it('verifyBodyResult relaie les problèmes de pages', () => {
    expect(() =>
      verifyBodyResult(
        'mars',
        {
          ...good,
          pageProblems: ['Mars|X|Y|Z : page(s) illisible(s) : 5.ndjson.gz'],
        },
        opts
      )
    ).toThrow(/illisible/);
  });
});

describe('interruption brutale : SIGKILL réel d’un sous-processus, récupération au lancement suivant', () => {
  const moduleUrl = pathToFileURL(
    join(process.cwd(), 'scripts', 'place-observations-publish.mjs')
  ).href;

  /** Lance la publication dans un autre processus qui se tue lui-même à l'étape `killAt`. */
  function publishAndKillAt(killAt: string): {
    status: number | null;
    out: string;
  } {
    const code = `
      import { publishStaged } from ${JSON.stringify(moduleUrl)};
      const a = JSON.parse(process.env.ARGS);
      publishStaged({ ...a, hooks: { afterStep: (l) => {
        if (l === a.killAt) process.kill(process.pid, 'SIGKILL');
      } } });
      console.log('FIN-NORMALE');
    `;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      env: {
        ...process.env,
        ARGS: JSON.stringify({
          staging,
          outRoot,
          indexPath,
          indexText: '{"v":"index-nouveau"}\n',
          bodies: [
            { body: 'mars', shards: 1 },
            { body: 'venus', shards: 3 },
          ],
          killAt,
        }),
      },
      encoding: 'utf8',
    });
    return { status: r.status, out: r.stdout };
  }

  for (const killAt of [
    'journal:écrit',
    'mars:ancien-écarté',
    'mars:nouveau-posé',
    'venus:ancien-écarté',
    'venus:nouveau-posé',
    'index:écrit',
    'index:posé',
  ])
    it(`tué à « ${killAt} » : le lancement suivant remet l’état livré octet pour octet`, () => {
      seedLive();
      seedStaged('mars', 1);
      seedStaged('venus', 3);
      const liveBefore = snapshot(outRoot);
      const indexBefore = readFileSync(indexPath, 'utf8');
      const r = publishAndKillAt(killAt);
      // le processus est bien mort en cours de route
      expect(r.out).not.toContain('FIN-NORMALE');
      expect(r.status).not.toBe(0);
      expect(existsSync(`${staging}.journal.json`)).toBe(true);
      if (killAt !== 'journal:écrit')
        expect(snapshot(outRoot)).not.toEqual(liveBefore); // état à moitié basculé
      expect(recoverPublish(staging)).toBe('rolled-back');
      expect(snapshot(outRoot)).toEqual(liveBefore);
      expect(readFileSync(indexPath, 'utf8')).toBe(indexBefore);
      expect(existsSync(`${staging}.journal.json`)).toBe(false);
      expect(existsSync(`${staging}.backup`)).toBe(false);
      expect(existsSync(`${indexPath}.tmp`)).toBe(false);
      expect(recoverPublish(staging)).toBe('none');
    });

  it('tué juste après la validation : l’état nouveau est conservé, le journal est nettoyé', () => {
    seedLive();
    seedStaged('mars', 1);
    seedStaged('venus', 3);
    const r = publishAndKillAt('committé');
    expect(r.status).not.toBe(0);
    expect(readFileSync(indexPath, 'utf8')).toBe('{"v":"index-nouveau"}\n');
    expect(recoverPublish(staging)).toBe('cleaned');
    expect(readFileSync(indexPath, 'utf8')).toBe('{"v":"index-nouveau"}\n');
    expect(existsSync(join(outRoot, 'venus', '2.json'))).toBe(true);
    expect(existsSync(`${staging}.backup`)).toBe(false);
  });

  it('la publication suivante récupère d’abord, puis publie', () => {
    seedLive();
    seedStaged('mars', 1);
    seedStaged('venus', 3);
    publishAndKillAt('venus:ancien-écarté');
    // comme le générateur : un staging neuf, après la récupération
    rmSync(staging, { recursive: true, force: true });
    seedStaged('mars', 1);
    seedStaged('venus', 3);
    publishStaged({
      staging,
      outRoot,
      indexPath,
      indexText: '{"v":"index-final"}\n',
      bodies: [
        { body: 'mars', shards: 1 },
        { body: 'venus', shards: 3 },
      ],
    });
    expect(readFileSync(indexPath, 'utf8')).toBe('{"v":"index-final"}\n');
    expect(existsSync(join(outRoot, 'venus', '2.json'))).toBe(true);
    expect(existsSync(`${staging}.journal.json`)).toBe(false);
  });

  it('journal illisible : on s’arrête sans rien deviner ni supprimer', () => {
    seedLive();
    writeFileSync(`${staging}.journal.json`, '{tronqué');
    mkdirSync(`${staging}.backup`, { recursive: true });
    const liveBefore = snapshot(outRoot);
    expect(() => recoverPublish(staging)).toThrow(
      /journal de publication illisible/
    );
    expect(snapshot(outRoot)).toEqual(liveBefore);
    expect(existsSync(`${staging}.backup`)).toBe(true);
  });
});
