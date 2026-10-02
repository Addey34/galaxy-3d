import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { BodyAdoptions } from '@/core/nameAdoption';

/**
 * LES ADOPTIONS LIVRÉES (ligne 22.10, front des noms) : l'index que la fiche lit est-il bien le
 * décompte des fichiers du gazetteer livrés, et la précision des dates y est-elle tenue ?
 *
 * `pnpm gazetteer:generate --check` dit si un fichier a dérivé de sa source, mais il demande le
 * réseau ou un cache. Cette garde vérifie ce qu'aucune régénération ne verrait : deux fichiers
 * livrés (l'index et les noms) qui ne disent plus la même chose.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = join(ROOT, 'public/assets/gazetteer');

const adoptions = JSON.parse(
  readFileSync(join(ROOT, 'src/config/gazetteerAdoptionIndex.json'), 'utf-8')
) as { provider: { url: string }; bodies: Record<string, BodyAdoptions> };
const names = JSON.parse(
  readFileSync(join(ROOT, 'src/config/gazetteerIndex.json'), 'utf-8')
) as { bodies: Record<string, { count: number }> };

const featuresOf = (body: string): { approved: string; type: string }[] =>
  JSON.parse(readFileSync(join(DIR, `${body}.json`), 'utf-8')) as {
    approved: string;
    type: string;
  }[];

describe('adoptions de noms livrées', () => {
  it('couvre exactement les corps nommés, avec le même total', () => {
    const shipped = readdirSync(DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5))
      .sort();
    expect(Object.keys(adoptions.bodies).sort()).toEqual(shipped);
    for (const [body, entry] of Object.entries(adoptions.bodies))
      expect(entry.total, body).toBe(names.bodies[body]?.count);
  });

  it('est le décompte EXACT des fichiers de noms, date par date', () => {
    for (const [body, entry] of Object.entries(adoptions.bodies)) {
      const steps = new Map<string, [number, number]>();
      for (const f of featuresOf(body)) {
        const step = steps.get(f.approved) ?? [0, 0];
        step[0] += 1;
        if (f.type === 'Satellite Feature') step[1] += 1;
        steps.set(f.approved, step);
      }
      const recount = [...steps.entries()]
        .map(([on, [n, l]]) => [on, n, l])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      expect(entry.steps, body).toEqual(recount);
      expect(entry.lettered, body).toBe(
        entry.steps.reduce((sum, [, , l]) => sum + l, 0)
      );
    }
  });

  /**
   * LA PRÉCISION DES DATES. Le KML de l'UAI écrit « AAAA/01/01 » pour une adoption que sa fiche ne
   * date qu'à l'ANNÉE (mesuré sur 124 fiches le 2026-10-02). Une date livrée au 1er janvier
   * voudrait dire que cette règle a sauté, et l'application annoncerait un jour qu'aucune source
   * ne publie.
   */
  it('livre une année seule ou un jour, jamais un 1er janvier', () => {
    for (const [body, entry] of Object.entries(adoptions.bodies))
      for (const [on] of entry.steps) {
        expect(on, body).toMatch(/^\d{4}(-\d{2}-\d{2})?$/);
        expect(on.endsWith('-01-01'), `${body} ${on}`).toBe(false);
      }
    // Et dans les fichiers de noms eux-mêmes, que le bloc « Formations observées » charge.
    for (const body of Object.keys(adoptions.bodies))
      for (const f of featuresOf(body))
        expect(f.approved.endsWith('-01-01'), `${body} ${f.approved}`).toBe(
          false
        );
    // Bornes : les deux précisions existent, sinon ce test ne prouverait rien.
    const all = Object.values(adoptions.bodies).flatMap((b) =>
      b.steps.map(([on]) => on)
    );
    expect(all.some((on) => on.length === 4)).toBe(true);
    expect(all.some((on) => on.length === 10)).toBe(true);
  });

  it('ne trouve de désignations lettrées que sur la Lune', () => {
    const withLettered = Object.entries(adoptions.bodies)
      .filter(([, b]) => b.lettered > 0)
      .map(([body]) => body);
    expect(withLettered).toEqual(['moon']);
  });
});
