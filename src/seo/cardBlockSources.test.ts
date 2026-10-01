import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import missionIndex from '@/config/missionIndex.json';
import discoveryIndex from '@/config/discoveryIndex.json';
import { DOC_LOCALES } from './documentPage';
import {
  CARD_BLOCK_INDEXES,
  blockLabel,
  cardBlockSourceRows,
} from './cardBlockSources';

/** Les index livrés, LUS sur le disque : la liste ne s'écrit nulle part. */
const SHIPPED_INDEXES = readdirSync('src/config')
  .filter((file) => file.endsWith('Index.json'))
  .sort();

describe('sources des blocs de fiche (ligne 44.1)', () => {
  it('couvre exactement les index livrés, ni plus ni moins', () => {
    expect(SHIPPED_INDEXES.length).toBeGreaterThan(0);
    expect(Object.keys(CARD_BLOCK_INDEXES).sort()).toEqual(SHIPPED_INDEXES);
  });

  it('chaque index livré donne au moins une ligne, qui dit de quel fichier elle vient', () => {
    const rows = cardBlockSourceRows();
    for (const index of SHIPPED_INDEXES)
      expect(
        rows.some((row) => row.index === index),
        index
      ).toBe(true);
  });

  it('publie chaque source de la découverte, une ligne par source déclarée', () => {
    const urls = cardBlockSourceRows()
      .filter((row) => row.index === 'discoveryIndex.json')
      .map((row) => row.url);
    expect(urls.sort()).toEqual(
      Object.values(discoveryIndex.sources)
        .map((s) => s.url)
        .sort()
    );
  });

  it('lit ses comptes dans l’index : le nombre de missions est celui de l’index', () => {
    const row = cardBlockSourceRows().find(
      (r) => r.index === 'missionIndex.json'
    )!;
    expect(row.coverage('en')).toContain(`${missionIndex.missions} missions`);
    expect(row.asOf).toBe(missionIndex.retrieved);
  });

  it('date chaque ligne par une date ISO ou une plage de dates ISO', () => {
    for (const row of cardBlockSourceRows())
      expect(row.asOf, row.url).toMatch(
        /^\d{4}-\d{2}-\d{2}( → \d{4}-\d{2}-\d{2})?$/
      );
  });

  it('nomme chaque bloc par un libellé qui existe dans les quatre langues', () => {
    for (const row of cardBlockSourceRows())
      for (const key of row.usedBy)
        for (const locale of DOC_LOCALES)
          expect(blockLabel(key, locale), `${key} ${locale}`).toBeTruthy();
  });
});
