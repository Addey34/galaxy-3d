import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sameWithinShippedWindow } from '../../scripts/perihelia-compare.mjs';

const shippedText = readFileSync(
  resolve(import.meta.dirname, '../seo/perihelia.json'),
  'utf8'
);
const shipped = JSON.parse(shippedText);

/** Ce que Horizons rend un jour plus tard : mêmes minima, date de lecture et fenêtre avancées. */
function aDayLater(): string {
  const next = structuredClone(shipped);
  for (const b of next.bounds) {
    b.retrieved = '2999-01-01';
    b.to = '2999-01-02T00:00:00Z';
  }
  for (const p of next.perihelia) p.retrieved = '2999-01-01';
  next.perihelia.push({
    ...next.perihelia.at(-1),
    at: '2999-01-01T00:00:00Z',
  });
  return JSON.stringify(next);
}

describe('périhélies : --check compare la source, pas le calendrier', () => {
  it('le fichier livré est à jour contre lui-même', () => {
    expect(sameWithinShippedWindow(shippedText, shippedText)).toBe(true);
  });

  it('une relecture plus tardive (dates, fin de fenêtre, périhélie ajouté plus loin) est à jour', () => {
    expect(sameWithinShippedWindow(shippedText, aDayLater())).toBe(true);
  });

  it('un minimum déplacé dans la fenêtre livrée est une dérive (falsifié)', () => {
    const moved = structuredClone(shipped);
    moved.perihelia[3].distanceKm += 1;
    expect(sameWithinShippedWindow(shippedText, JSON.stringify(moved))).toBe(
      false
    );
  });

  it('un périhélie disparu est une dérive, et un fichier absent aussi', () => {
    const lost = structuredClone(shipped);
    lost.perihelia.splice(5, 1);
    expect(sameWithinShippedWindow(shippedText, JSON.stringify(lost))).toBe(
      false
    );
    expect(sameWithinShippedWindow('', shippedText)).toBe(false);
  });
});
