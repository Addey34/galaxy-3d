import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * LA BALISE D'AUDIENCE N'EST PAS DANS LA COQUILLE SOURCE (2026-10-20).
 *
 * `index.html` est ce que sert le serveur de développement, donc ce que chargent les tests de
 * navigateur : une balise écrite là compte `localhost` sous le jeton du site réel. Elle est
 * injectée au build par `analyticsBeacon()` (`vite.config.ts`) ; `e2e/built-pages.spec.ts` vérifie
 * qu'elle y est, une fois.
 */
describe('balise d’audience', () => {
  const source = readFileSync(resolve(__dirname, '../../index.html'), 'utf-8');

  it('la coquille source ne la porte pas', () => {
    expect(source).not.toContain('cloudflareinsights');
    expect(source).not.toContain('data-cf-beacon');
  });
});
