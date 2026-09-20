import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const read = (path: string): string =>
  readFileSync(resolve(ROOT, path), 'utf-8');

/**
 * UN ACTIF AU NOM STABLE NE SE MET PAS EN CACHE POUR UN AN.
 *
 * `firebase.json` applique `max-age=31536000, immutable` à tout `/assets/**`, ce qui est juste
 * pour un fichier dont le nom porte un hachage de contenu, et faux pour un fichier dont le nom
 * ne change jamais alors que ses octets, eux, sont réécrits : une release le corrigerait pour
 * les nouveaux visiteurs seulement, et les autres garderaient l'ancien pendant un an. Les
 * familles concernées portent donc une règle explicite qui revalide.
 *
 * Ces familles sont DÉJÀ déclarées une fois, dans la règle « réseau d'abord » du service
 * worker (`vite.config.ts`), pour exactement la même raison. Ce test confronte les deux
 * déclarations : ajouter une famille d'un côté sans l'autre est le défaut qu'il attrape, et
 * c'est celui qui a failli partir avec l'instantané des petits corps.
 */
describe('actifs au nom stable : cache Firebase et service worker d’accord', () => {
  const viteConfig = read('vite.config.ts');
  const firebase = JSON.parse(read('firebase.json')) as {
    hosting: {
      headers: { source: string; headers: { key: string; value: string }[] }[];
    };
  };

  /** Préfixes servis « réseau d'abord » par le service worker, lus dans sa règle. */
  const networkFirstPrefixes = (): string[] => {
    const rule = /cacheName: 'ssv-stable-visual-assets'/.exec(viteConfig);
    expect(rule, 'règle « ssv-stable-visual-assets » introuvable').toBeTruthy();
    const before = viteConfig.slice(0, rule!.index);
    const start = before.lastIndexOf('urlPattern:');
    expect(start, 'urlPattern de la règle introuvable').toBeGreaterThan(0);
    return [
      ...before.slice(start).matchAll(/startsWith\('(\/assets\/[^']+)'\)/g),
    ].map((match) => match[1]!);
  };

  it('lit bien une liste de préfixes dans la règle du service worker', () => {
    // Si la forme de la règle change, ce test doit ÉCHOUER plutôt que vérifier le vide.
    expect(networkFirstPrefixes().length).toBeGreaterThanOrEqual(3);
  });

  it('donne à chacun une règle Firebase qui revalide', () => {
    const rules = new Map(
      firebase.hosting.headers.map((entry) => [
        entry.source,
        entry.headers.find((header) => header.key === 'Cache-Control')?.value,
      ])
    );
    for (const prefix of networkFirstPrefixes()) {
      const source = `${prefix}**`;
      const value = rules.get(source);
      expect(
        value,
        `${source} n'a pas de règle Cache-Control : il retomberait sur l'« immutable » d'un an de /assets/**`
      ).toBeTruthy();
      expect(value, source).toContain('must-revalidate');
      expect(value, source).not.toContain('immutable');
    }
  });
});
