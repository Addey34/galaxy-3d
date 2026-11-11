import { createHash } from 'node:crypto';
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ImportError,
  importCapture,
} from '../../scripts/ode-import-capture.mjs';

/**
 * IMPORT D'UNE CAPTURE (GAL-A003-11B, partie B). Données synthétiques, caches jetables, aucun réseau. Les garanties
 * éprouvées : ordre de publication, aucune copie de repli, aucun écrasement, erreur d'origine jamais masquée par un
 * nettoyage, retour arrière limité aux fichiers liés par l'appel, état partiel annoncé.
 */
const roots: string[] = [];
const scratch = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), p));
  roots.push(d);
  return d;
};
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function source() {
  const dir = scratch('imp-src-');
  const raw = Buffer.from('contenu brut de la capture '.repeat(50));
  const digest = sha(raw);
  const main = join(dir, 'cap.raw');
  writeFileSync(main, raw);
  writeFileSync(`${main}.sha256`, `${digest}  cap.raw\n`);
  writeFileSync(
    `${main}.json`,
    JSON.stringify({ sha256: digest, receivedBytes: raw.length })
  );
  return { dir, main, raw };
}
function destination() {
  const dest = scratch('imp-dst-');
  writeFileSync(join(dest, 'counts.json'), '{}');
  return dest;
}
const diag = (dest: string) => join(dest, 'diagnostics');
const names = (dest: string) => {
  try {
    return readdirSync(diag(dest)).sort();
  } catch {
    return [];
  }
};
const snap = (dir: string) =>
  Object.fromEntries(
    readdirSync(dir).map((f) => [f, sha(readFileSync(join(dir, f)))])
  );
const eperm = () => Object.assign(new Error('refusé'), { code: 'EPERM' });

describe('importCapture : garanties de publication', () => {
  it('import normal de trois fichiers, dans l’ordre provenance, somme, contenu principal', () => {
    const s = source();
    const dest = destination();
    const before = snap(s.dir);
    const order: string[] = [];
    const r = importCapture({
      cacheDir: dest,
      mainFile: s.main,
      write: true,
      fs: {
        linkSync: (a: string, b: string) => {
          order.push(basename(b));
          linkSync(a, b);
        },
      },
    });
    expect(r.status).toBe('imported');
    expect(order).toEqual(['cap.raw.json', 'cap.raw.sha256', 'cap.raw']);
    expect(names(dest)).toEqual(['cap.raw', 'cap.raw.json', 'cap.raw.sha256']);
    expect(readFileSync(join(diag(dest), 'cap.raw')).equals(s.raw)).toBe(true);
    expect(snap(s.dir)).toEqual(before);
  });

  it('collision avec un contenu différent : refus avant toute écriture', () => {
    const s = source();
    const dest = destination();
    mkdirSync(diag(dest));
    writeFileSync(join(diag(dest), 'cap.raw.sha256'), 'AUTRE');
    const before = snap(diag(dest));
    expect(() =>
      importCapture({ cacheDir: dest, mainFile: s.main, write: true })
    ).toThrow(/collision/);
    expect(snap(diag(dest))).toEqual(before);
  });

  it('concurrence : un autre processus crée le contenu principal entre le contrôle et le lien, il reste intact', () => {
    const s = source();
    const dest = destination();
    const rival = Buffer.from('fichier d’un autre processus');
    let n = 0;
    expect(() =>
      importCapture({
        cacheDir: dest,
        mainFile: s.main,
        write: true,
        fs: {
          linkSync: (a: string, b: string) => {
            if (++n === 3) writeFileSync(b, rival);
            linkSync(a, b);
          },
        },
      })
    ).toThrow(/collision.*apparu pendant l'import/);
    // Les deux premiers fichiers (les nôtres) sont retirés ; celui du rival n'est jamais touché.
    expect(names(dest)).toEqual(['cap.raw']);
    expect(readFileSync(join(diag(dest), 'cap.raw')).equals(rival)).toBe(true);
  });

  it('lien dur refusé : aucun repli par copie, rien n’est laissé', () => {
    const s = source();
    const dest = destination();
    let copies = 0;
    expect(() =>
      importCapture({
        cacheDir: dest,
        mainFile: s.main,
        write: true,
        fs: {
          linkSync: () => {
            throw eperm();
          },
          copyFileSync: () => {
            copies++;
          },
        },
      })
    ).toThrow(/lien dur impossible.*aucun repli/);
    expect(copies).toBe(0);
    expect(names(dest)).toEqual([]);
  });

  it('échec d’écriture du temporaire (disque plein) : l’erreur d’origine est rendue, aucun fichier', () => {
    const s = source();
    const dest = destination();
    expect(() =>
      importCapture({
        cacheDir: dest,
        mainFile: s.main,
        write: true,
        fs: {
          writeSync: () => {
            throw Object.assign(new Error('disque plein'), { code: 'ENOSPC' });
          },
        },
      })
    ).toThrow(/disque plein/);
    expect(names(dest)).toEqual([]);
  });

  it('échec d’écriture ET du retrait du temporaire : l’erreur d’origine n’est pas masquée', () => {
    const s = source();
    const dest = destination();
    let message = '';
    try {
      importCapture({
        cacheDir: dest,
        mainFile: s.main,
        write: true,
        fs: {
          writeSync: () => {
            throw Object.assign(new Error('disque plein'), { code: 'ENOSPC' });
          },
          rmSync: () => {
            throw Object.assign(new Error('verrou'), { code: 'EBUSY' });
          },
        },
      });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/^disque plein/);
    expect(message).toMatch(/à retirer à la main/);
    expect(message).toMatch(/EBUSY/);
  });

  it('lien réussi puis retrait du temporaire impossible : échec, fichiers liés retirés, temporaire signalé', () => {
    const s = source();
    const dest = destination();
    let message = '';
    try {
      importCapture({
        cacheDir: dest,
        mainFile: s.main,
        write: true,
        fs: {
          rmSync: (f: string, o: object) => {
            if (String(f).endsWith('.tmp'))
              throw Object.assign(new Error('verrou'), { code: 'EBUSY' });
            rmSync(f, o);
          },
        },
      });
    } catch (e) {
      expect(e).toBeInstanceOf(ImportError);
      message = (e as Error).message;
    }
    expect(message).toMatch(/plusieurs noms/);
    expect(message).toMatch(/à retirer à la main/);
    // Le fichier lié a été retiré par le retour arrière ; seul le temporaire (non retirable) subsiste.
    expect(names(dest).filter((f) => !f.endsWith('.tmp'))).toEqual([]);
  });

  it('échec du retour arrière : ÉTAT PARTIEL annoncé avec le chemin, l’erreur d’origine reste la première information', () => {
    const s = source();
    const dest = destination();
    let n = 0;
    let message = '';
    try {
      importCapture({
        cacheDir: dest,
        mainFile: s.main,
        write: true,
        fs: {
          linkSync: (a: string, b: string) => {
            if (++n === 3) throw eperm();
            linkSync(a, b);
          },
          rmSync: (f: string, o: object) => {
            if (String(f).endsWith('cap.raw.sha256'))
              throw Object.assign(new Error('verrou'), { code: 'EBUSY' });
            rmSync(f, o);
          },
        },
      });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/^ÉTAT PARTIEL, intervention manuelle : /);
    expect(message).toMatch(/lien dur impossible/);
    expect(message).toMatch(/cap\.raw\.sha256 \(EBUSY\)/);
    expect(names(dest)).toEqual(['cap.raw.sha256']);
  });

  it('retour arrière : un fichier qui n’est plus celui que nous avons lié est laissé et signalé', () => {
    const s = source();
    const dest = destination();
    let n = 0;
    let message = '';
    try {
      importCapture({
        cacheDir: dest,
        mainFile: s.main,
        write: true,
        fs: {
          linkSync: (a: string, b: string) => {
            if (++n === 3) {
              // Un autre processus remplace notre somme par un fichier à lui avant l'échec.
              const mine = join(diag(dest), 'cap.raw.sha256');
              rmSync(mine);
              writeFileSync(mine, 'remplacé par un tiers');
              throw eperm();
            }
            linkSync(a, b);
          },
        },
      });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/ÉTAT PARTIEL/);
    expect(message).toMatch(/n'est plus notre fichier/);
    expect(readFileSync(join(diag(dest), 'cap.raw.sha256'), 'utf8')).toBe(
      'remplacé par un tiers'
    );
    expect(names(dest)).toEqual(['cap.raw.sha256']);
  });

  it('interruption après un import partiel : les fichiers créés par l’appel sont retirés, les antérieurs intacts', () => {
    const s = source();
    const dest = destination();
    mkdirSync(diag(dest));
    writeFileSync(join(diag(dest), 'ancien.txt'), 'garde');
    let n = 0;
    expect(() =>
      importCapture({
        cacheDir: dest,
        mainFile: s.main,
        write: true,
        fs: {
          linkSync: (a: string, b: string) => {
            if (++n === 3) throw eperm();
            linkSync(a, b);
          },
        },
      })
    ).toThrow(ImportError);
    expect(names(dest)).toEqual(['ancien.txt']);
    expect(readFileSync(join(diag(dest), 'ancien.txt'), 'utf8')).toBe('garde');
  });

  it('reprise après des fichiers déjà présents et identiques : seuls les manquants sont liés, rien n’est réécrit', () => {
    const s = source();
    const dest = destination();
    mkdirSync(diag(dest));
    for (const f of ['cap.raw.json', 'cap.raw.sha256'])
      writeFileSync(join(diag(dest), f), readFileSync(join(s.dir, f)));
    const linked: string[] = [];
    const r = importCapture({
      cacheDir: dest,
      mainFile: s.main,
      write: true,
      fs: {
        linkSync: (a: string, b: string) => {
          linked.push(basename(b));
          linkSync(a, b);
        },
      },
    });
    expect(r.imported).toEqual(['cap.raw']);
    expect(r.alreadyPresent).toHaveLength(2);
    expect(linked).toEqual(['cap.raw']);
  });
});
