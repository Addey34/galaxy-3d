import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  assertEveryUrlDated,
  cacheKey,
  day,
  sectionDates,
  stampNow,
  stampOf,
} from '../../scripts/fact-source-cache.mjs';

import snapshot from './factSources.snapshot.json';

/**
 * UNE DATE D'EXÉCUTION NE PEUT PLUS SE SUBSTITUER À UNE DATE DE LECTURE (ligne 23.1 de la file).
 *
 * Le relevé des faits portait un seul `retrieved`, écrit avec `new Date()` à la fin du script :
 * un cache chaud héritait donc du jour courant. Le relevé livré au lot 23 annonçait ainsi le
 * 2026-09-28 pour les huit réponses d'articles lues le 2026-09-20, et vingt fiches de corps
 * AFFICHAIENT cette date d'exécution derrière leur nombre de lunes.
 *
 * Ces gardes tiennent la correction dans les deux sens :
 *
 *   1. sur le mécanisme, avec un vrai cache dans un dossier temporaire : une réponse déjà là
 *      garde SA date, une entrée héritée est datée de son fichier puis fixée, et seule une
 *      réponse qui arrive prend l'heure courante ;
 *   2. sur le relevé LIVRÉ : chaque section porte les dates de ses propres réponses, recalculées
 *      ici depuis les réponses elles-mêmes, donc une date écrite à la main dériverait ;
 *   3. sur le SCRIPT : il ne demande l'heure nulle part. C'est la garde la plus directe contre la
 *      faute d'origine, parce qu'elle vise la cause et pas seulement son effet ;
 *   4. sur la REPRISE : les seules réponses sans date sont celles que la source refuse de servir,
 *      elles sont énumérées, et aucun fait affiché ne peut tenir sa date de l'une d'elles.
 */

const SECTIONS = Object.keys(snapshot).filter(
  (key) => key !== 'generatedBy' && key !== 'retrieved'
) as (keyof typeof snapshot)[];

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const scratch = () => mkdtempSync(join(tmpdir(), 'galaxy-fact-dates-'));

/** Une réponse en cache, telle que le relevé l'écrit : un fichier nommé par la clé de son URL. */
function cached(url: string, body = 'réponse') {
  const dir = scratch();
  const path = join(dir, `${cacheKey(url)}.txt`);
  writeFileSync(path, body);
  return path;
}

describe('la date de lecture appartient à la réponse', () => {
  it('un cache chaud garde SA date, et pas celle du jour', () => {
    const path = cached('https://example.invalid/a');
    writeFileSync(path.replace(/\.txt$/, '.at'), '2026-09-20\n');
    // Le défaut, en une ligne : cette réponse-là a été lue le 20, et on n'est plus le 20.
    expect(day(new Date())).not.toBe('2026-09-20');
    expect(stampOf(path)).toBe('2026-09-20');
  });

  it('une entrée héritée est datée de SON FICHIER, puis fixée', () => {
    const path = cached('https://example.invalid/b');
    const written = new Date('2026-09-20T14:13:07Z');
    utimesSync(path, written, written);
    expect(stampOf(path)).toBe('2026-09-20');
    const at = path.replace(/\.txt$/, '.at');
    expect(readFileSync(at, 'utf8').trim()).toBe('2026-09-20');
    // Fixée veut dire fixée : la date d'un fichier peut changer, la lecture relevée non.
    const later = new Date('2026-11-01T00:00:00Z');
    utimesSync(path, later, later);
    expect(stampOf(path)).toBe('2026-09-20');
  });

  it("une réponse qui ARRIVE prend l'heure de son arrivée", () => {
    const path = cached('https://example.invalid/c');
    expect(stampNow(path, new Date('2026-04-05T23:59:59Z'))).toBe('2026-04-05');
    expect(stampOf(path)).toBe('2026-04-05');
  });

  it('un horodatage illisible fait échouer plutôt que de dater faux', () => {
    const path = cached('https://example.invalid/d');
    writeFileSync(path.replace(/\.txt$/, '.at'), 'hier\n');
    expect(() => stampOf(path)).toThrow(/date de lecture illisible/);
  });

  it("le PDF d'un article et le texte qu'on en extrait n'ont qu'UNE date", () => {
    const path = cached('https://example.invalid/e');
    stampNow(path, new Date('2026-09-20T10:00:00Z'));
    // Une seule réponse a été demandée, donc une seule date, quelle que soit l'extension lue.
    expect(stampOf(path.replace(/\.txt$/, '.pdf'))).toBe('2026-09-20');
  });

  it('les dates d’une section se DÉDUISENT de ses réponses', () => {
    expect(
      sectionDates({
        b: { url: 'u', retrieved: '2026-09-28' },
        a: { url: 'u', retrieved: '2026-09-20' },
        c: { nested: { url: 'u', retrieved: '2026-09-20' } },
      })
    ).toEqual(['2026-09-20', '2026-09-28']);
    expect(sectionDates({ url: 'u', retrieved: '2026-09-28' })).toEqual([
      '2026-09-28',
    ]);
  });

  it('une réponse citée SANS sa date fait échouer le relevé, en la nommant', () => {
    expect(() =>
      assertEveryUrlDated({
        sbdb: { ceres: { url: 'u', retrieved: '2026-09-28' } },
        articles: { 'x-2026': { url: 'u', verifiedQuotes: [] } },
      })
    ).toThrow(/articles\['?x-2026'?\]|articles\.x-2026/);
  });
});

describe('le relevé livré : chaque section porte ses propres dates', () => {
  it('une section, une entrée dans le tableau des dates', () => {
    expect(Object.keys(snapshot.retrieved).sort()).toEqual(
      [...SECTIONS].sort()
    );
  });

  it('les dates annoncées sont celles des réponses de la section', () => {
    for (const name of SECTIONS)
      expect(
        (snapshot.retrieved as Record<string, string[]>)[name],
        `section ${name}`
      ).toEqual(sectionDates(snapshot[name]));
  });

  it('toute réponse citée porte sa date de lecture', () => {
    expect(() => assertEveryUrlDated(snapshot)).not.toThrow();
  });

  it('aucune date de lecture n’est malformée ni dans l’avenir', () => {
    const today = day(new Date());
    for (const name of SECTIONS)
      for (const date of sectionDates(snapshot[name])) {
        expect(date, `section ${name}`).toMatch(DAY);
        expect(
          date <= today,
          `section ${name} : lue le ${date}, soit après aujourd’hui (${today})`
        ).toBe(true);
      }
  });
});

/**
 * LES QUATRE FICHES QUE LA SOURCE REFUSE DE SERVIR, NOMMÉES ICI ET NULLE PART AILLEURS.
 *
 * Le 2026-09-28, le Master Catalog du NSSDCA a servi sa page « Errors and Messages » en HTTP 200
 * pour ces quatre fiches, pendant plus de sept heures, les mêmes quatre à chaque tour, quel que
 * soit le client HTTP et par toute autre adresse du site ; les sept autres répondaient. Leur
 * valeur est donc REPRISE du relevé précédent (`--carry-over-unavailable`), et leur date de
 * lecture est écrite ABSENTE plutöt que devinée : le cache qui la portait a été vidé le
 * 2026-09-28, et l'ancien relevé n'en portait qu'une, globale, qui est justement la faute
 * corrigée ici.
 *
 * **Cette liste doit se VIDER dès que la source répond** : relancer `pnpm facts:snapshot` SANS le
 * drapeau, puis la réduire. Le test rougit dans les deux sens, donc ni une reprise de plus ni une
 * reprise résolue ne passe inaperçue.
 */
const CARRIED_OVER = [
  'nssdcaMasterCatalog.bepicolombo',
  'nssdcaMasterCatalog.cassini',
  'nssdcaMasterCatalog.hayabusa2',
  'nssdcaMasterCatalog.rosetta',
];

/** Tout objet du relevé qui cite une `url`, avec le chemin où il se trouve. */
function citedResponses(): { path: string; node: Record<string, unknown> }[] {
  const found: { path: string; node: Record<string, unknown> }[] = [];
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node))
      return node.forEach((item, k) => walk(item, `${path}[${k}]`));
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (typeof record.url === 'string') found.push({ path, node: record });
    for (const [key, value] of Object.entries(record))
      if (key !== 'url') walk(value, path ? `${path}.${key}` : key);
  };
  walk(snapshot, '');
  return found;
}

describe('une réponse reprise le DIT, et elle est nommée', () => {
  it('les seules réponses sans date sont celles que la source refuse de servir', () => {
    const undated = citedResponses()
      .filter(({ node }) => typeof node.retrieved !== 'string')
      .map(({ path }) => path)
      .sort();
    expect(undated).toEqual(CARRIED_OVER);
  });

  it('une réponse sans date DOIT se déclarer reprise', () => {
    for (const { path, node } of citedResponses())
      if (typeof node.retrieved !== 'string')
        expect(node.carriedOver, path).toBe(true);
  });

  it('une réponse reprise garde la valeur du relevé précédent, pas une valeur neuve', () => {
    // Une reprise ne relit rien : elle ne peut donc pas avoir changé de contenu. Si un jour une
    // valeur reprise diffère de celle qui est en production, c'est que la reprise a inventé.
    for (const path of CARRIED_OVER) {
      const [section, key] = path.split('.');
      const entry = (
        snapshot[section as keyof typeof snapshot] as Record<
          string,
          Record<string, unknown>
        >
      )[key!]!;
      expect(entry.launchDate, path).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof entry.massKg, path).toBe('number');
    }
  });

  it('aucun fait AFFICHÉ ne tient sa date d’une réponse reprise', () => {
    // La seule date affichée est `asOf`, et aucune fiche de sonde n'en porte : le Master Catalog
    // ne date pas ses valeurs. Une reprise ne peut donc pas dater un écran.
    const dir = resolve(import.meta.dirname, '../registry/spacecraft');
    // `order.json` porte l'ordre, pas une fiche ; `index.ts` et le test ne sont pas du JSON.
    for (const file of readdirSync(dir).filter(
      (name) => name.endsWith('.json') && name !== 'order.json'
    )) {
      const fiche = JSON.parse(readFileSync(resolve(dir, file), 'utf-8')) as {
        facts?: Record<string, { asOf?: string }>;
      };
      // La clé est `facts`. Ce test a d'abord lu `sources`, qui n'existe pas : il balayait donc
      // un objet vide, c'est-à-dire qu'il ne vérifiait RIEN, et il était vert. D'où le compte.
      expect(Object.keys(fiche.facts ?? {}).length, file).toBeGreaterThan(0);
      for (const [field, provenance] of Object.entries(fiche.facts ?? {}))
        expect(provenance.asOf, `${file} ${field}`).toBeUndefined();
    }
  });
});

describe('le relevé ne demande jamais l’heure', () => {
  /**
   * Le CODE, sans les commentaires. Sans cette précaution la garde se trompe de cible : le
   * module explique le défaut d'origine en citant `new Date()` dans son propre en-tête, et la
   * garde comptait donc une lecture d'horloge qui n'existe pas. Un garde qui accuse un
   * commentaire est un garde qu'on finit par désarmer.
   */
  const code = (file: string) =>
    readFileSync(resolve(import.meta.dirname, '../../scripts', file), 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n');

  /**
   * LA CAUSE, VISÉE DIRECTEMENT. Tant que le script peut lire l'horloge, une date d'exécution
   * peut se glisser dans le relevé sans que rien ne le dise : les dates du relevé sont
   * plausibles par construction, donc aucune relecture ne l'attraperait.
   */
  it('le script du relevé ne lit pas l’horloge', () => {
    const source = code('snapshot-fact-sources.mjs');
    expect(source).not.toMatch(/new Date\(\s*\)/);
    // Sans cette seconde attente, la garde ci-dessus passerait aussi pour un `Date.now()`.
    expect(source).not.toMatch(/Date\.now\(/);
  });

  it('un seul endroit peut la lire : celui qui horodate une réponse qui arrive', () => {
    const source = code('fact-source-cache.mjs');
    expect([...source.matchAll(/new Date\(\s*\)/g)]).toHaveLength(1);
    expect(source).toMatch(
      /export function stampNow\(path, at = new Date\(\)\)/
    );
  });
});
