import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LocalStorageError,
  collectPages,
  inspectExistingPages,
  isLocalStorageError,
  pageName,
  validatePageBuffer,
  writePageAtomic,
  type PageTask,
} from '../../scripts/ode-pages.mjs';
import { scanDataset } from '../../scripts/place-observations-publish.mjs';

/**
 * UNE INTERRUPTION PENDANT L'ÉCRITURE D'UNE PAGE ODE NE FAIT JAMAIS PASSER UN FICHIER INCOMPLET
 * POUR UNE PAGE VALIDE (GAL-A003-04). Aucun test ne touche le réseau.
 */

const product = (i: number) => ({ id: `p${i}`, shapes: { footprint: [[i]] } });
const products = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, k) => product(from + k));
const gz = (items: unknown[]) =>
  gzipSync(items.map((p) => JSON.stringify(p)).join('\n'));
const errno = (code: string) =>
  Object.assign(new Error(`${code}: simulé`), { code });

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'odepg-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const pageFile = (offset: number) => join(dir, pageName(offset));

describe('validatePageBuffer', () => {
  it('accepte une page complète (et une page vide)', () => {
    expect(validatePageBuffer(gz(products(0, 5)))).toBe(5);
    expect(validatePageBuffer(gzipSync(''))).toBe(0);
  });
  it('refuse un gzip tronqué, un JSON cassé, un produit sans id ou sans shapes', () => {
    const whole = gz(products(0, 50));
    expect(() =>
      validatePageBuffer(whole.subarray(0, whole.length - 9))
    ).toThrow(/gzip invalide/);
    expect(() =>
      validatePageBuffer(gzipSync('{"id":"a","shapes":{}}\n{pas'))
    ).toThrow(/JSON invalide/);
    expect(() => validatePageBuffer(gz([{ shapes: {} }]))).toThrow(/sans id/);
    expect(() => validatePageBuffer(gz([{ id: 'a' }]))).toThrow(/sans shapes/);
    expect(() => validatePageBuffer(Buffer.from('pas du gzip'))).toThrow(
      /gzip invalide/
    );
  });
});

describe('writePageAtomic', () => {
  it('écrit la page, valide le temporaire, ne laisse rien derrière', () => {
    writePageAtomic(pageFile(0), products(0, 5));
    expect(readdirSync(dir)).toEqual(['0.ndjson.gz']);
    expect(validatePageBuffer(readFileSync(pageFile(0)))).toBe(5);
  });

  it('un contenu invalide est refusé AVANT publication : ni page ni temporaire', () => {
    expect(() => writePageAtomic(pageFile(0), [{ id: 'x' }])).toThrow(
      /sans shapes/
    );
    expect(readdirSync(dir)).toEqual([]);
  });

  it('une page déjà valide n’est jamais remplacée par un échec', () => {
    writePageAtomic(pageFile(0), products(0, 5));
    const before = readFileSync(pageFile(0));
    expect(() => writePageAtomic(pageFile(0), [{ id: 'x' }])).toThrow();
    expect(readFileSync(pageFile(0)).equals(before)).toBe(true);
    expect(readdirSync(dir)).toEqual(['0.ndjson.gz']);
  });

  // disque indisponible : chaque appel système peut échouer, l'erreur est LOCALE et rien ne reste
  for (const [op, code] of [
    ['openSync', 'EACCES'],
    ['writeSync', 'ENOSPC'],
    ['fsyncSync', 'EIO'],
    ['renameSync', 'EROFS'],
  ] as const)
    it(`${op} → ${code} : LocalStorageError, pas de page, pas de temporaire`, () => {
      const fs = {
        [op]: () => {
          throw errno(code);
        },
      } as never;
      let caught: unknown;
      try {
        writePageAtomic(pageFile(0), products(0, 5), { fs });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(LocalStorageError);
      expect((caught as LocalStorageError).code).toBe(code);
      expect(isLocalStorageError(caught)).toBe(true);
      expect(existsSync(pageFile(0))).toBe(false);
      expect(existsSync(`${pageFile(0)}.tmp`)).toBe(false);
    });

  it('rename en échec sur une page invalide existante : l’ancienne reste, rien n’est supprimé', () => {
    const old = gz(products(0, 50)).subarray(0, 20); // tronquée
    writeFileSync(pageFile(0), old);
    expect(() =>
      writePageAtomic(pageFile(0), products(0, 5), {
        fs: {
          renameSync: () => {
            throw errno('EIO');
          },
        } as never,
      })
    ).toThrow(LocalStorageError);
    expect(readFileSync(pageFile(0)).equals(old)).toBe(true);
  });

  it('volume disparu (dossier supprimé) : erreur locale ENOENT', () => {
    const gone = join(dir, 'disparu');
    expect(() =>
      writePageAtomic(join(gone, pageName(0)), products(0, 1))
    ).toThrow(LocalStorageError);
  });
});

describe('SIGKILL réel pendant l’écriture d’une page', () => {
  const moduleUrl = pathToFileURL(
    join(process.cwd(), 'scripts', 'ode-pages.mjs')
  ).href;

  function writeAndKillAt(file: string, killAt: string) {
    const code = `
      import { writePageAtomic } from ${JSON.stringify(moduleUrl)};
      const a = JSON.parse(process.env.ARGS);
      const products = Array.from({ length: 400 }, (_, i) => ({ id: 'p' + i, shapes: { f: [[i, i * 2]] } }));
      writePageAtomic(a.file, products, { hooks: { afterStep: (l) => {
        if (l === a.killAt) process.kill(process.pid, 'SIGKILL');
      } } });
      console.log('FIN-NORMALE');
    `;
    return spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      env: { ...process.env, ARGS: JSON.stringify({ file, killAt }) },
      encoding: 'utf8',
    });
  }

  for (const killAt of ['half-written', 'tmp-written', 'tmp-validated'])
    it(`tué à « ${killAt} » : aucune page définitive, la reprise retire le temporaire`, () => {
      const r = writeAndKillAt(pageFile(5000), killAt);
      expect(r.status).not.toBe(0);
      expect(r.stdout).not.toContain('FIN-NORMALE');
      // l'état laissé : un temporaire, JAMAIS un fichier au nom définitif
      expect(readdirSync(dir)).toEqual(['5000.ndjson.gz.tmp']);
      expect(existsSync(pageFile(5000))).toBe(false);
      const found = inspectExistingPages(dir, [5000]);
      expect(found.valid.size).toBe(0);
      expect(found.staleTmp).toEqual(['5000.ndjson.gz.tmp']);
      expect(readdirSync(dir)).toEqual([]);
    });

  it('tué pendant le remplacement d’une page invalide : l’ancienne reste en place', () => {
    const old = gz(products(0, 50)).subarray(0, 30);
    writeFileSync(pageFile(5000), old);
    writeAndKillAt(pageFile(5000), 'tmp-validated');
    expect(readFileSync(pageFile(5000)).equals(old)).toBe(true); // pas supprimée
    const found = inspectExistingPages(dir, [5000]);
    expect(found.invalid.map((i) => i.offset)).toEqual([5000]);
    expect(found.staleTmp).toEqual(['5000.ndjson.gz.tmp']);
    expect(readFileSync(pageFile(5000)).equals(old)).toBe(true);
  });

  it('une page complète précédente n’est pas touchée par un processus tué sur la suivante', () => {
    writePageAtomic(pageFile(0), products(0, 5));
    const before = readFileSync(pageFile(0));
    writeAndKillAt(pageFile(5000), 'half-written');
    const found = inspectExistingPages(dir, [0, 5000]);
    expect([...found.valid]).toEqual([0]);
    expect(readFileSync(pageFile(0)).equals(before)).toBe(true);
  });
});

describe('inspectExistingPages : reprise avec pages invalides', () => {
  it('valide les bonnes, signale les mauvaises SANS les supprimer, ignore les absentes', () => {
    writePageAtomic(pageFile(0), products(0, 5));
    writeFileSync(pageFile(5), gz(products(5, 10)).subarray(0, 25)); // gzip tronqué
    writeFileSync(pageFile(10), gzipSync('{"id":"a","shapes":{}}\n{coupé')); // JSON coupé
    const found = inspectExistingPages(dir, [0, 5, 10, 15]);
    expect([...found.valid]).toEqual([0]);
    expect(found.invalid.map((i) => i.offset)).toEqual([5, 10]);
    expect(found.invalid[0].reason).toMatch(/gzip invalide/);
    expect(found.invalid[1].reason).toMatch(/JSON invalide/);
    // rien supprimé
    expect(readdirSync(dir).sort()).toEqual(
      ['0.ndjson.gz', '10.ndjson.gz', '5.ndjson.gz'].sort()
    );
  });
  it('gzip tronqué par un ancien écrivain non atomique : détecté', () => {
    writePageAtomic(pageFile(0), products(0, 200));
    truncateSync(pageFile(0), 40);
    expect(inspectExistingPages(dir, [0]).invalid).toHaveLength(1);
  });
  it('un dossier absent : rien de valide, aucune erreur', () => {
    expect(inspectExistingPages(join(dir, 'absent'), [0, 5]).valid.size).toBe(
      0
    );
  });
});

describe('collectPages : erreurs locales séparées des erreurs de téléchargement', () => {
  const mk = (key: string, offsets: number[]): PageTask[] =>
    offsets.map((offset) => ({ key, offset, file: pageFile(offset) }));
  const base = () => {
    const unavailable: Record<string, unknown> = {};
    const marked: string[] = [];
    return {
      unavailable,
      marked,
      markUnavailable: (t: PageTask) => {
        unavailable[t.key] = { offset: t.offset };
        marked.push(t.key);
      },
    };
  };

  it('une erreur de téléchargement déclare le jeu indisponible, la collecte continue', async () => {
    const b = base();
    const r = await collectPages({
      tasks: [...mk('A', [0, 5]), ...mk('B', [0])],
      pull: async (t) => {
        if (t.key === 'A') throw new Error('HTTP 500');
        return products(0, 5);
      },
      write: writePageAtomic as never,
      concurrency: 1,
      ...b,
    });
    expect(r.fatal).toBeNull();
    expect(b.marked).toEqual(['A']); // la 2e page de A est sautée (jeu déclaré)
    expect(r.failed).toBe(1);
  });

  it('ENOSPC à l’écriture : arrêt propre, le jeu n’est JAMAIS déclaré indisponible', async () => {
    const b = base();
    const r = await collectPages({
      tasks: mk('A', [0, 5, 10, 15]),
      pull: async () => products(0, 5),
      write: () => {
        throw errno('ENOSPC');
      },
      concurrency: 2,
      ...b,
    });
    expect(r.fatal).toBeInstanceOf(LocalStorageError);
    expect((r.fatal as LocalStorageError | null)?.code).toBe('ENOSPC');
    expect(b.marked).toEqual([]);
    expect(b.unavailable).toEqual({});
    expect(r.remaining).toBeGreaterThan(0); // des pages n'ont pas été prises
  });

  for (const code of ['EIO', 'EROFS', 'EACCES', 'ENOENT', 'ENODEV'])
    it(`${code} à l’écriture : erreur locale, pas un jeu indisponible`, async () => {
      const b = base();
      const r = await collectPages({
        tasks: mk('A', [0, 5]),
        pull: async () => products(0, 5),
        write: () => {
          throw errno(code);
        },
        concurrency: 1,
        ...b,
      });
      expect((r.fatal as LocalStorageError | null)?.code).toBe(code);
      expect(b.marked).toEqual([]);
    });

  it('erreur locale survenue PENDANT le tirage (marqueur méta) : locale aussi', async () => {
    const b = base();
    const r = await collectPages({
      tasks: mk('A', [0]),
      pull: async () => {
        throw errno('ENOSPC');
      },
      write: writePageAtomic as never,
      concurrency: 1,
      ...b,
    });
    expect(r.fatal).toBeInstanceOf(LocalStorageError);
    expect(b.marked).toEqual([]);
  });

  it('unavailable.json impossible à écrire (disque plein) : arrêt local', async () => {
    const r = await collectPages({
      tasks: mk('A', [0, 5]),
      pull: async () => {
        throw new Error('HTTP 503');
      },
      write: writePageAtomic as never,
      unavailable: {},
      markUnavailable: () => {
        throw errno('ENOSPC');
      },
      concurrency: 1,
    });
    expect(r.fatal).toBeInstanceOf(LocalStorageError);
  });

  it('contenu reçu invalide (sans shapes) : échec de JEU, pas d’erreur locale', async () => {
    const b = base();
    const r = await collectPages({
      tasks: mk('A', [0]),
      pull: async () => [{ id: 'x' }],
      write: writePageAtomic as never,
      concurrency: 1,
      ...b,
    });
    expect(r.fatal).toBeNull();
    expect(b.marked).toEqual(['A']);
    expect(existsSync(pageFile(0))).toBe(false);
  });

  it('volume disparu au milieu : arrêt local, puis reprise réussie sur le volume rétabli', async () => {
    // jeu de 12 produits en pages de 5 : offsets 0, 5, 10
    const all = [0, 5, 10];
    const pull = async (t: PageTask) =>
      products(t.offset, Math.min(12, t.offset + 5));
    let writes = 0;
    const flaky = (file: string, items: readonly unknown[]) => {
      if (++writes === 2) {
        // le volume disparaît : la 2e page échoue
        throw errno('EIO');
      }
      writePageAtomic(file, items);
    };
    const b = base();
    const first = await collectPages({
      tasks: mk('A', all),
      pull,
      write: flaky,
      concurrency: 1,
      ...b,
    });
    expect((first.fatal as LocalStorageError | null)?.code).toBe('EIO');
    expect(b.marked).toEqual([]); // jamais inscrit à tort
    expect(readdirSync(dir)).toEqual(['0.ndjson.gz']);

    // reprise : seules les pages non valides sont tirées
    const found = inspectExistingPages(dir, all);
    expect([...found.valid]).toEqual([0]);
    const second = await collectPages({
      tasks: mk(
        'A',
        all.filter((o) => !found.valid.has(o))
      ),
      pull,
      write: writePageAtomic as never,
      concurrency: 1,
      ...b,
    });
    expect(second.fatal).toBeNull();
    expect(second.done).toBe(2);
    const report = scanDataset(dir, 12, 5);
    expect(report.problems).toEqual([]);
    expect(report.distinct).toBe(12);
  });
});

describe('câblage de pull-ode-footprints.mjs', () => {
  const source = readFileSync(
    join(process.cwd(), 'scripts', 'pull-ode-footprints.mjs'),
    'utf8'
  );
  it('n’écrit plus une page sous son nom définitif et ne tient plus un fichier présent pour acquis', () => {
    expect(source).toContain("from './ode-pages.mjs'");
    expect(source).toContain('collectPages(');
    expect(source).toContain('inspectExistingPages(');
    expect(source).not.toMatch(/writeFileSync\(\s*t\.file/);
    expect(source).not.toContain('gzipSync');
    expect(source).not.toMatch(/have\.has\(/);
  });
  it('les mécanismes existants restent : gel, --body, serrure, pagination, débit', () => {
    for (const marker of [
      'freezeAction(CACHE)',
      'selectDatasets(',
      'acquireLock(',
      'assertMetadataComplete(',
      'const MIN_GAP_MS',
      'THROTTLED',
      'PAGE',
    ])
      expect(source).toContain(marker);
  });
  it('un arrêt local sort avec un code distinct et ne passe pas par unavailable', () => {
    expect(source).toContain('EXIT_LOCAL_STORAGE');
    expect(source).toMatch(/erreur de stockage LOCAL/);
  });
});
