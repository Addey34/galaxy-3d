import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  truncateSync,
  writeSync,
  writeFileSync,
} from 'node:fs';
import { Buffer } from 'node:buffer';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  IncompletePageError,
  LocalStorageError,
  collectPages,
  inspectExistingPages,
  isLocalStorageError,
  pageName,
  validatePageBuffer,
  writeAll,
  writeFileAtomic,
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

describe('complétude : nombre attendu et identifiants distincts', () => {
  const dup = [product(1), product(1), product(2)];

  it('validatePageBuffer refuse une page trop courte, vide, excédentaire ou à doublons', () => {
    expect(validatePageBuffer(gz(products(0, 5)), { expected: 5 })).toBe(5);
    expect(() =>
      validatePageBuffer(gz(products(0, 3)), { expected: 5 })
    ).toThrow(/incomplète : 3 produit\(s\) distinct\(s\) pour 5/);
    expect(() => validatePageBuffer(gzipSync(''), { expected: 5 })).toThrow(
      IncompletePageError
    );
    expect(() =>
      validatePageBuffer(gz(products(0, 7)), { expected: 5 })
    ).toThrow(/excédentaire/);
    expect(() => validatePageBuffer(gz(dup), { expected: 3 })).toThrow(
      /identifiant en double : p1/
    );
    // sans attendu, les doublons sont refusés quand même
    expect(() => validatePageBuffer(gz(dup))).toThrow(IncompletePageError);
  });

  it('writePageAtomic ne publie jamais une page trop courte ou à doublons', () => {
    expect(() =>
      writePageAtomic(pageFile(0), products(0, 3), { expected: 5 })
    ).toThrow(IncompletePageError);
    expect(() => writePageAtomic(pageFile(0), dup, { expected: 3 })).toThrow(
      IncompletePageError
    );
    expect(readdirSync(dir)).toEqual([]);
  });

  it('une page valide gzip/JSON mais trop courte n’est PAS réutilisée à la reprise', () => {
    writePageAtomic(pageFile(0), products(0, 5), { expected: 5 });
    writePageAtomic(pageFile(5), products(5, 8)); // sans attendu : 3 produits sur disque
    const found = inspectExistingPages(dir, [0, 5], () => 5);
    expect([...found.valid]).toEqual([0]);
    expect(found.invalid).toHaveLength(1);
    expect(found.invalid[0].reason).toMatch(/incomplète/);
    expect(existsSync(pageFile(5))).toBe(true); // jamais supprimée
  });

  it('une page à doublons déjà sur disque n’est pas réutilisée non plus', () => {
    writeFileSync(pageFile(0), gz(dup));
    const found = inspectExistingPages(dir, [0], () => 3);
    expect(found.valid.size).toBe(0);
    expect(found.invalid[0].reason).toMatch(/double/);
  });

  it('collectPages déclare l’incomplétude (markIncomplete), pas unavailable, et continue', async () => {
    const unavailable: Record<string, unknown> = {};
    const incomplete: string[] = [];
    const tasks: PageTask[] = [
      { key: 'A', offset: 0, expected: 5, file: pageFile(0) },
      { key: 'A', offset: 5, expected: 5, file: pageFile(5) },
    ];
    const r = await collectPages({
      tasks,
      pull: async (t) => (t.offset === 0 ? products(0, 3) : products(5, 10)),
      unavailable,
      markUnavailable: () => {
        throw new Error('ne doit pas être appelé');
      },
      markIncomplete: (t, e) =>
        incomplete.push(`${t.key}@${t.offset}:${e.got}`),
      concurrency: 1,
    });
    expect(r.incomplete).toBe(1);
    expect(r.failed).toBe(0);
    expect(r.fatal).toBeNull();
    expect(incomplete).toEqual(['A@0:3']);
    expect(unavailable).toEqual({});
    expect(existsSync(pageFile(0))).toBe(false);
    expect(existsSync(pageFile(5))).toBe(true);
  });

  it('incomplete.json impossible à écrire (disque plein) : arrêt local', async () => {
    const r = await collectPages({
      tasks: [{ key: 'A', offset: 0, expected: 5, file: pageFile(0) }],
      pull: async () => products(0, 2),
      unavailable: {},
      markUnavailable: () => {},
      markIncomplete: () => {
        throw errno('ENOSPC');
      },
      concurrency: 1,
    });
    expect(r.fatal).toBeInstanceOf(LocalStorageError);
  });
});

describe('écritures partielles', () => {
  it('writeAll boucle jusqu’à l’écriture intégrale (écritures de 3 octets)', () => {
    const out: number[] = [];
    const data = Buffer.from(Array.from({ length: 10 }, (_, i) => i));
    writeAll(1, data, ((_fd: number, buf: Buffer, off: number, len: number) => {
      const n = Math.min(3, len);
      out.push(...buf.subarray(off, off + n));
      return n;
    }) as never);
    expect(out).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('writePageAtomic écrit la page ENTIÈRE malgré des écritures partielles', () => {
    let calls = 0;
    const fs = {
      writeSync: (fd: number, buf: Buffer, off: number, len: number) => {
        calls++;
        return writeSync(fd, buf, off, Math.min(7, len));
      },
    } as never;
    writePageAtomic(pageFile(0), products(0, 300), { fs, expected: 300 });
    expect(calls).toBeGreaterThan(2);
    expect(
      validatePageBuffer(readFileSync(pageFile(0)), { expected: 300 })
    ).toBe(300);
    expect(readdirSync(dir)).toEqual(['0.ndjson.gz']);
  });

  for (const ret of [0, -1, undefined, 1.5])
    it(`une écriture qui n’avance plus (renvoie ${String(ret)}) : EIO local, pas de boucle, pas de page`, () => {
      const fs = { writeSync: () => ret } as never;
      let caught: unknown;
      try {
        writePageAtomic(pageFile(0), products(0, 5), { fs });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(LocalStorageError);
      expect((caught as LocalStorageError).code).toBe('EIO');
      expect(readdirSync(dir)).toEqual([]);
    });

  it('une écriture partielle puis bloquée n’est jamais renommée', () => {
    let first = true;
    const fs = {
      writeSync: (fd: number, buf: Buffer, off: number, len: number) => {
        if (first) {
          first = false;
          return writeSync(fd, buf, off, Math.min(5, len));
        }
        return 0;
      },
    } as never;
    expect(() => writePageAtomic(pageFile(0), products(0, 50), { fs })).toThrow(
      LocalStorageError
    );
    expect(readdirSync(dir)).toEqual([]);
  });

  it('writeFileAtomic : écriture intégrale malgré des écritures partielles', () => {
    const file = join(dir, 'meta.json');
    const text = JSON.stringify({ a: 'é'.repeat(100) });
    writeFileAtomic(file, text, {
      fs: {
        writeSync: (fd: number, buf: Buffer, off: number, len: number) =>
          writeSync(fd, buf, off, Math.min(4, len)),
      } as never,
    });
    expect(readFileSync(file, 'utf8')).toBe(text);
  });

  it('writeFileAtomic qui n’avance plus : erreur, ancien fichier intact, aucun temporaire', () => {
    const file = join(dir, 'meta.json');
    writeFileSync(file, 'ancien');
    expect(() =>
      writeFileAtomic(file, 'nouveau', { fs: { writeSync: () => 0 } as never })
    ).toThrow(/écriture interrompue/);
    expect(readFileSync(file, 'utf8')).toBe('ancien');
    expect(readdirSync(dir)).toEqual(['meta.json']);
  });

  it('une défaillance d’écriture locale ne pollue pas unavailable', async () => {
    const unavailable: Record<string, unknown> = {};
    const r = await collectPages({
      tasks: [{ key: 'A', offset: 0, expected: 5, file: pageFile(0) }],
      pull: async () => products(0, 5),
      write: (file, items, options) =>
        writePageAtomic(file, items, {
          ...options,
          fs: { writeSync: () => 0 } as never,
        }),
      unavailable,
      markUnavailable: () => {
        throw new Error('ne doit pas être appelé');
      },
      concurrency: 1,
    });
    expect(r.fatal).toBeInstanceOf(LocalStorageError);
    expect(unavailable).toEqual({});
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
    expect(source).toContain('Math.min(PAGE, n[s.key] - off)');
    expect(source).toContain('incomplete.json');
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
