import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import gazetteerIndex from './gazetteerIndex.json';
import index from './placeObservationIndex.json';
import { NON_BOOT_CHUNKS } from '@/core/startupBudget';

/**
 * LA DONNÉE LIVRÉE DES FORMATIONS OBSERVÉES (ligne 40.3), confrontée à elle-même et au gazetteer.
 * Rien ici n'appelle le réseau : les empreintes ont été tirées par `pnpm places:pull` et croisées
 * par `pnpm places:generate`.
 */
const ROOT = resolve(import.meta.dirname, '../..');
const read = (p: string): unknown =>
  JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'));

type Entry = [number, number, string, string, string];
interface Shard {
  instruments: {
    host: string;
    id: string;
    mission: string;
    instrument: string;
  }[];
  observed: Record<string, Entry[]>;
}

describe('placeObservationIndex', () => {
  it('ne se livre PAS incomplet : un tirage partiel est un état de développement', () => {
    expect(index.complete).toBe(true);
  });

  it('ne couvre que des corps qui portent des noms, et en compte les formations exactes', () => {
    for (const [body, cover] of Object.entries(index.bodies)) {
      expect(Object.keys(gazetteerIndex.bodies)).toContain(body);
      const names = read(`public/assets/gazetteer/${body}.json`) as unknown[];
      expect(cover.formations, body).toBe(names.length);
    }
  });

  it('reste hors du démarrage', () => {
    expect(NON_BOOT_CHUNKS.map((c) => c.chunk)).toContain(
      'placeObservationIndex'
    );
  });

  for (const [body, cover] of Object.entries(index.bodies)) {
    describe(body, () => {
      const ids = new Set(
        (
          read(`public/assets/gazetteer/${body}.json`) as { iauId: number }[]
        ).map((f) => f.iauId)
      );
      const shards: Shard[] = [];
      for (let k = 0; k < cover.shards; k++) {
        const p = `public/assets/place-observations/${body}/${k}.json`;
        if (existsSync(resolve(ROOT, p))) shards.push(read(p) as Shard);
      }

      it('livre exactement ses morceaux, et chaque formation dans le SIEN', () => {
        expect(shards).toHaveLength(cover.shards);
        expect(
          existsSync(
            resolve(
              ROOT,
              `public/assets/place-observations/${body}/${cover.shards}.json`
            )
          )
        ).toBe(false);
        let observed = 0;
        shards.forEach((shard, k) => {
          for (const id of Object.keys(shard.observed)) {
            observed++;
            expect(Number(id) % cover.shards, `${body} ${id}`).toBe(k);
            expect(
              ids.has(Number(id)),
              `${body} : ${id} absent du gazetteer`
            ).toBe(true);
          }
        });
        expect(observed).toBe(cover.observed);
      });

      // DÉLAI ÉCRIT, avec sa mesure : seul, ce fichier prend 5,4 s (les 88 morceaux de la Lune), et
      // le défaut de 5 s par test le faisait tomber sous la charge de la suite entière, sans rien
      // dire de la donnée. Mesuré le 2026-10-01.
      it('porte des lignes cohérentes : instrument connu, compte positif, dates ordonnées, source https', () => {
        const DAY = /^\d{4}-\d{2}-\d{2}$/;
        for (const shard of shards)
          for (const [id, entries] of Object.entries(shard.observed)) {
            expect(entries.length, `${body} ${id} vide`).toBeGreaterThan(0);
            for (const [inst, n, first, last, label] of entries) {
              expect(
                shard.instruments[inst],
                `${body} ${id} instrument ${inst}`
              ).toBeDefined();
              expect(Number.isInteger(n) && n > 0).toBe(true);
              // Absente DES DEUX CÔTÉS (Viking n'en publie aucune), ou un jour de chaque côté.
              if (first === '' && last === '') continue;
              expect(first).toMatch(DAY);
              expect(last).toMatch(DAY);
              expect(first <= last, `${body} ${id} : ${first} > ${last}`).toBe(
                true
              );
              expect(
                last <= index.frozenAt,
                `${body} ${id} : ${last} après le gel`
              ).toBe(true);
              expect(label, `${body} ${id}`).toMatch(/^https:\/\//);
            }
          }
      }, 60_000);
    });
  }
});
