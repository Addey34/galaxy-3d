import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import { describe, expect, it } from 'vitest';
import { BUILD_ONLY_DIRS } from '@/buildOnly';
import { cardEn } from './dict-card-en';
import { cardFr } from './dict-card-fr';
import { cardEs } from './dict-card-es';
import { cardPtBR } from './dict-card-pt-BR';
import { en } from './dict-en';
import { messages } from './allDictionaries';
import { LOCALES } from './locales';

/**
 * LES PHRASES DES BLOCS HORS DÉMARRAGE NE SONT LUES QUE PAR EUX (lot 52, piste C).
 *
 * `t()` ne connaît ces clés qu'une fois `loadDeferredMessages()` passé, et seuls les chargeurs de
 * ces morceaux l'attendent. Un module du DÉMARRAGE qui en lirait une afficherait la clé brute, sans
 * erreur : la liste ci-dessous est celle des modules hors démarrage autorisés, chacun avec le
 * morceau qui le charge.
 */
const DEFERRED_READERS: Record<string, string> = {
  'ui/atmosphereBlock.ts': 'cardBlocks',
  'ui/citiesBlock.ts': 'cardBlocks',
  'ui/discoveryBlock.ts': 'cardBlocks',
  'ui/instrumentsBlock.ts': 'cardBlocks',
  'ui/missionsBlock.ts': 'cardBlocks',
  'ui/placesBlock.ts': 'cardBlocks',
  'ui/paletteSearch.ts': 'paletteSearch',
  'components/surface/compareCurtain.ts': 'compareCurtain',
};

const SRC = join(__dirname, '..');

function shippedModules(dir = SRC): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(SRC, full).split(sep).join('/');
    if (statSync(full).isDirectory()) {
      if (!BUILD_ONLY_DIRS.some((d) => rel === d || rel.startsWith(`${d}/`)))
        out.push(...shippedModules(full));
    } else if (/\.ts$/.test(name) && !/\.(test|d)\.ts$/.test(name))
      out.push(rel);
  }
  return out;
}

describe('phrases des blocs hors démarrage (lot 52, piste C)', () => {
  it('aucun module du démarrage ne lit une de ces clés', () => {
    const keys = Object.keys(cardEn);
    const readers = new Set<string>();
    for (const rel of shippedModules()) {
      if (/^i18n\/dict-/.test(rel)) continue;
      const code = readFileSync(join(SRC, rel), 'utf8');
      if (keys.some((k) => code.includes(`'${k}'`) || code.includes(`"${k}"`)))
        readers.add(rel);
    }
    // LE TÉMOIN : chaque lecteur autorisé lit bien au moins une clé.
    expect([...readers].sort()).toEqual(Object.keys(DEFERRED_READERS).sort());
  });

  it('aucune clé n’est dans les deux dictionnaires d’une langue', () => {
    for (const key of Object.keys(cardEn))
      expect(en, key).not.toHaveProperty(key);
  });

  it('les quatre langues ont les mêmes clés, et les pages générées les voient toutes', () => {
    const keys = Object.keys(cardEn).sort();
    for (const dict of [cardFr, cardEs, cardPtBR])
      expect(Object.keys(dict).sort()).toEqual(keys);
    for (const locale of LOCALES)
      for (const key of keys)
        expect(messages[locale], `${locale} ${key}`).toHaveProperty(key);
  });
});
