import { readdirSync, readFileSync } from 'node:fs';
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

  /**
   * CHAQUE DOSSIER LIVRÉ SOUS `public/assets/` EST CLASSÉ, et la liste se LIT sur le disque
   * (2026-10-15). Les deux listes ci-dessous (service worker, Firebase) ne se comparaient qu'entre
   * elles : un dossier NOUVEAU échappait aux deux à la fois, et c'est arrivé. Le profil de Jupiter
   * du lot 51 (`atmosphere-profiles/`, nom stable) est sorti en production avec l'« immutable »
   * d'un an de `/assets/**` ; l'image de partage (`social/og.jpg`) l'était depuis toujours. Un
   * dossier est donc soit servi « réseau d'abord » (et Firebase le revalide, garde suivante), soit
   * écarté ici AVEC SA RAISON.
   */
  const OUTSIDE_THE_RULE: Record<string, string> = {
    ephemerides:
      'noms hachés par contenu ; seul le manifeste a un nom stable, et sa règle propre le revalide',
    'height-tiles':
      'répertoires hachés par contenu ; le manifeste a sa règle, tenue par la garde suivante',
    kernels:
      'non déployé (exclu par `ignore` dans firebase.json), et absent de git : posé en local par `pnpm spk:stage`',
    social:
      'jamais demandé par l’application, donc pas de règle de service worker ; Firebase le revalide',
    imagery:
      'seul le manifeste de cuisson est ici, jamais demandé par l’application (les tuiles hachées sont sur galaxy-data) ; Firebase le revalide',
  };
  it('classe chaque dossier livré sous public/assets, lu sur le disque', () => {
    const shipped = readdirSync(resolve(ROOT, 'public/assets'), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const prefixes = new Set(networkFirstPrefixes());
    for (const dir of shipped)
      expect(
        prefixes.has(`/assets/${dir}/`) || dir in OUTSIDE_THE_RULE,
        `public/assets/${dir}/ : ni servi « réseau d'abord », ni écarté avec sa raison`
      ).toBe(true);
    // Une exception sans dossier est une exception morte, SAUF `kernels`, qui n'existe que sur une
    // machine où le noyau optionnel a été posé (`.gitignore`) : la CI l'a montré au premier passage.
    for (const dir of Object.keys(OUTSIDE_THE_RULE))
      if (dir !== 'kernels')
        expect(shipped, `exception sans dossier : ${dir}`).toContain(dir);
    const social = firebase.hosting.headers.find(
      (entry) => entry.source === '/assets/social/**'
    );
    expect(social?.headers.find((h) => h.key === 'Cache-Control')?.value).toBe(
      'public, max-age=3600, must-revalidate'
    );
  });

  it('lit bien une liste de préfixes dans la règle du service worker', () => {
    // Si la forme de la règle change, ce test doit ÉCHOUER plutôt que vérifier le vide.
    expect(networkFirstPrefixes().length).toBeGreaterThanOrEqual(3);
  });

  /**
   * LE MANIFESTE DES TUILES DE HAUTEURS suit la même règle, par un autre chemin (lot 9, 9D).
   *
   * Les tuiles, elles, portent un répertoire nommé par le HACHAGE de leur contenu : leur
   * adresse ne désigne qu'un seul contenu possible, donc l'`immutable` d'un an leur convient et
   * un aller-retour réseau par carreau serait du gaspillage. C'est le manifeste — nom stable,
   * octets réécrits à chaque cuisson, et qui pointe le répertoire haché — qui doit revalider :
   * servi depuis un cache, il désignerait des tuiles supprimées, donc un relief absent sans la
   * moindre erreur.
   */
  it('fait revalider le manifeste des hauteurs des DEUX côtés', () => {
    const rule = /cacheName: 'ssv-height-manifest'/.exec(viteConfig);
    expect(rule, 'règle « ssv-height-manifest » introuvable').toBeTruthy();
    const before = viteConfig.slice(0, rule!.index);
    const start = before.lastIndexOf('urlPattern:');
    const pattern = before.slice(start);
    expect(pattern).toContain("startsWith('/assets/height-tiles/')");
    expect(pattern).toContain("endsWith('/manifest.json')");
    expect(before.slice(start)).toContain('NetworkFirst');

    const firebaseRule = firebase.hosting.headers.find(
      (entry) => entry.source === '/assets/height-tiles/**/manifest.json'
    );
    expect(
      firebaseRule,
      'sans règle Firebase, le manifeste retomberait sur l’« immutable » d’un an de /assets/**'
    ).toBeTruthy();
    const value = firebaseRule?.headers.find(
      (header) => header.key === 'Cache-Control'
    )?.value;
    expect(value).toContain('must-revalidate');
    expect(value).not.toContain('immutable');
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
