import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCALES, type Locale } from '@/i18n/locales';

/**
 * CE QU'UNE MACHINE PEUT VÉRIFIER DES TEXTES DU REGISTRE (lot 20, phase 20B).
 *
 * 186 champs localisés — descriptions, noms, crédits de licence, raisons d'une valeur non
 * publiée, conditions d'emploi d'une source — ont reçu l'espagnol et le portugais du Brésil,
 * traduits par Claude et relus par aucun locuteur natif. Le journal du lot le dit.
 *
 * Deux propriétés sont vérifiables, et ce sont celles qui transforment une traduction maladroite
 * en AFFIRMATION FAUSSE :
 *
 *   - COMPLÉTUDE : aucun champ ne doit rester à deux langues. Le compilateur le tient déjà pour
 *     `LocalizedText` (`src/types.ts`) et les schémas Zod le refusent au chargement, mais ce test
 *     lit les FICHIERS, donc il attrape aussi une fiche qu'aucun test n'importerait ;
 *   - LES NOMBRES : « 500 à 1 000 m » ne devient pas « 500 a 100 m », et « 22 km » reste 22. La
 *     comparaison normalise les séparateurs de milliers et le séparateur décimal, parce que ces
 *     deux-là DOIVENT changer d'une langue à l'autre — c'est la valeur qui ne doit pas bouger.
 *
 * Ce que ce test NE vérifie PAS, et qui reste dû à une relecture humaine : la justesse de la
 * tournure, le registre de langue, et le choix d'un nom propre localisé (la règle qui l'a décidé
 * est écrite dans `scripts/display-names.mjs`).
 */

const REGISTRY = resolve(import.meta.dirname);
const DIRS = ['entities', 'spacecraft', 'interstellar', 'providers'];

interface Block {
  readonly file: string;
  readonly path: string;
  readonly values: Partial<Record<Locale, string>>;
}

function collect(
  json: unknown,
  file: string,
  path: string,
  out: Block[]
): void {
  if (json === null || typeof json !== 'object') return;
  if (Array.isArray(json)) {
    for (const item of json) collect(item, file, path, out);
    return;
  }
  const record = json as Record<string, unknown>;
  const keys = Object.keys(record);
  const localeKeys = keys.filter((key) =>
    (LOCALES as readonly string[]).includes(key)
  );
  // Un bloc localisé : au moins une langue, et rien d'autre que des langues (les fiches de fait
  // ajoutent `unsourced`, qui est un drapeau et non une langue).
  const extras = keys.filter(
    (key) => !localeKeys.includes(key) && key !== 'unsourced'
  );
  if (localeKeys.length > 0 && extras.length === 0) {
    const values: Partial<Record<Locale, string>> = {};
    for (const key of localeKeys)
      if (typeof record[key] === 'string')
        values[key as Locale] = record[key] as string;
    out.push({ file, path, values });
    return;
  }
  for (const [key, value] of Object.entries(record))
    collect(value, file, path ? `${path}.${key}` : key, out);
}

function allBlocks(): Block[] {
  const out: Block[] = [];
  for (const dir of DIRS) {
    const full = join(REGISTRY, dir);
    for (const name of readdirSync(full).filter((f) => f.endsWith('.json'))) {
      const json = JSON.parse(
        readFileSync(join(full, name), 'utf8')
      ) as unknown;
      collect(json, `${dir}/${name}`, '', out);
    }
  }
  return out;
}

/**
 * Les NOMBRES d'un texte, indépendamment de la façon dont la langue les écrit.
 *
 * Les séparateurs de milliers (espace fine, espace, virgule) sont retirés, et la virgule décimale
 * devient un point. Sans cela, « 1 000 m » et « 1,000 m » passeraient pour des valeurs
 * différentes alors que c'est la même, et le test refuserait des traductions correctes — c'est-à-
 * dire qu'il serait désarmé en moins d'une semaine.
 */
export function numbersOf(text: string): string[] {
  const normalized = text
    // Séparateur de milliers : un chiffre, un séparateur, EXACTEMENT trois chiffres non suivis
    // d'un autre chiffre. Appliqué deux fois pour « 1 234 567 ».
    .replace(/(\d)[\u202f\u00a0 ,.](\d{3})(?!\d)/g, '$1$2')
    .replace(/(\d)[\u202f\u00a0 ,.](\d{3})(?!\d)/g, '$1$2')
    // Virgule décimale -> point.
    .replace(/(\d),(\d)/g, '$1.$2');
  return (normalized.match(/\d+(?:\.\d+)?/g) ?? []).sort();
}

describe('fidélité des textes localisés du registre', () => {
  const blocks = allBlocks();

  it('trouve bien les fiches et leurs textes', () => {
    // Borne : un balayage vide rendrait tout le reste vert sans rien prouver.
    expect(blocks.length).toBeGreaterThan(150);
    expect(blocks.some((block) => block.file.startsWith('entities/'))).toBe(
      true
    );
  });

  it('déclare les quatre langues dans chaque texte', () => {
    // UN LIEN WIKIPÉDIA PEUT MANQUER EN ESPAGNOL OU EN PORTUGAIS, et c'est une MESURE : le
    // script des liens interlangues (`scripts/wiki-langlinks.mjs`) les DÉRIVE de l'article
    // anglais, et un article qui n'existe pas est omis, la fiche retombant alors sur l'anglais.
    // Aucun corps ne l'exerçait avant le 2026-10-04 : Dinkinesh n'a pas d'article espagnol,
    // Polymele ni espagnol ni portugais. Sa garde est `pnpm i18n:wiki --check`, qui ajouterait
    // tout article apparu. L'anglais et le français restent exigés, eux, comme tout texte.
    const derivedAbsent = (block: Block, locale: Locale): boolean =>
      block.path.endsWith('wiki') && (locale === 'es' || locale === 'pt-BR');
    const incomplete = blocks
      .filter((block) =>
        LOCALES.some(
          (locale) =>
            typeof block.values[locale] !== 'string' &&
            !derivedAbsent(block, locale)
        )
      )
      .map(
        (block) =>
          `${block.file} ${block.path} (${Object.keys(block.values).join('+')})`
      );
    expect(
      incomplete,
      'un texte à deux langues sert de l’anglais sous une étiquette espagnole'
    ).toEqual([]);
  });

  it('garde les mêmes nombres dans les quatre langues', () => {
    const drift: string[] = [];
    for (const block of blocks) {
      // Les liens Wikipédia sont EXCLUS, et pour une raison mesurée : leur encodage pourcent
      // porte des chiffres (`N%C3%A9r%C3%A9ide` en compte quatre), donc comparer les nombres
      // d'une URL à ceux d'une autre n'a aucun sens. Ils ne sont pas traduits non plus : ils
      // sont DÉRIVÉS de l'API interlangue de Wikipédia, et leur garde est
      // `node scripts/wiki-langlinks.mjs --check`, qui les redemande à la source.
      if (block.path.endsWith('wiki')) continue;
      const reference = numbersOf(block.values.en ?? block.values.fr ?? '');
      for (const locale of LOCALES) {
        const value = block.values[locale];
        if (value === undefined) continue;
        const found = numbersOf(value);
        if (found.join(',') !== reference.join(','))
          drift.push(
            `${block.file} ${block.path} [${locale}] : [${found}] ≠ [${reference}]`
          );
      }
    }
    expect(drift).toEqual([]);
  });

  it('ne laisse aucun texte vide', () => {
    const empty: string[] = [];
    for (const block of blocks)
      for (const locale of LOCALES)
        if (block.values[locale]?.trim() === '')
          empty.push(`${block.file} ${block.path} [${locale}]`);
    expect(empty).toEqual([]);
  });

  it('normalise vraiment les séparateurs, et voit vraiment un nombre changé', () => {
    // Falsification INTÉGRÉE de la normalisation : sans elle, ce test refuserait des traductions
    // justes (faux positif) ou accepterait un nombre faux (faux négatif).
    expect(numbersOf('500 à 1 000 m')).toEqual(numbersOf('500 to 1,000 m'));
    expect(numbersOf('2,1e-9 km³/s²')).toEqual(numbersOf('2.1e-9 km³/s²'));
    expect(numbersOf('5,4 grammes')).toEqual(numbersOf('5.4 grams'));
    expect(numbersOf('~22 km')).toEqual(['22']);
    // Et un vrai écart reste vu.
    expect(numbersOf('22 km')).not.toEqual(numbersOf('23 km'));
    expect(numbersOf('1 000 m')).not.toEqual(numbersOf('100 m'));
  });
});
