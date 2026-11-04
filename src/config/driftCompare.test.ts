import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  READ_DATE_KEYS,
  sameIgnoringReadDates,
  withoutReadDates,
} from '../../scripts/drift-compare.mjs';

const doc = (retrieved: string, km: number) =>
  `{\n "retrieved": "${retrieved}",\n "at": "2026-11-05",\n "km": ${km}\n}\n`;

describe('comparaison d’un fichier livré sans ses dates de lecture', () => {
  it('ignore une date de lecture qui seule a changé', () => {
    expect(
      sameIgnoringReadDates(doc('2026-10-23', 5), doc('2026-11-03', 5))
    ).toBe(true);
  });

  it('voit toujours une valeur qui a changé', () => {
    expect(
      sameIgnoringReadDates(doc('2026-10-23', 5), doc('2026-11-03', 6))
    ).toBe(false);
  });

  it('ne touche jamais une date qui fait partie de la donnée', () => {
    const a = doc('2026-11-03', 5);
    const b = a.replace('"at": "2026-11-05"', '"at": "2026-11-06"');
    expect(sameIgnoringReadDates(a, b)).toBe(false);
  });

  it('un fichier absent dérive', () => {
    expect(sameIgnoringReadDates(null, doc('2026-11-03', 5))).toBe(false);
  });

  it('couvre chaque clé de date de lecture que les générateurs écrivent', () => {
    // Un champ de lecture oublié ici rendrait de nouveau le contrôle faux : on lit les clés
    // dans les fichiers livrés plutôt que de les supposer.
    const found = new Set<string>();
    const dirs = ['src/seo', 'src/config', 'public/assets/atmosphere-profiles'];
    for (const dir of dirs)
      for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
        const text = readFileSync(`${dir}/${f}`, 'utf8');
        for (const m of text.matchAll(
          /"(\w*(?:[Rr]etrieved|accessed))"\s*:\s*"\d{4}-/g
        ))
          found.add(m[1]!);
      }
    for (const key of found) expect(READ_DATE_KEYS, key).toContain(key);
    expect(withoutReadDates('"accessed": "2026-11-03"')).not.toContain('2026');
  });
});
