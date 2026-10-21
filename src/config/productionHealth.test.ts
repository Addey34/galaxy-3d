import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bakedTileProbes,
  canonicalOf,
  expectedHeaders,
  judgeBakedTile,
  judgeConsole,
  judgeHeaders,
  judgePage,
  judgeShell,
  sitemapSamples,
} from '../../scripts/check-production.mjs';

/**
 * LES JUGES DU GUETTEUR DE LA PRODUCTION (`scripts/check-production.mjs`, lot 56), sur des
 * fragments de réponses RÉELLES lues le 2026-10-18. Chaque juge est aussi falsifié en conditions
 * réelles (journal du lot 56) : en-têtes absents sous `vite preview`, page retirée du build rendue
 * comme la coquille, formation inexistante, balise Cloudflare en CORS hors de son origine.
 */
const ORIGIN = 'https://galaxy.adrianguichard.dev';
const shell = {
  status: 200,
  contentType: 'text/html; charset=utf-8',
  body: `<html><head><link rel="canonical" href="${ORIGIN}/" /></head><body>coquille</body></html>`,
};
const page = (path: string) => ({
  status: 200,
  contentType: 'text/html; charset=utf-8',
  body: `<html><head><link rel="canonical" href="${ORIGIN}${path}" /></head><body>page</body></html>`,
});

describe('le témoin', () => {
  it('reconnaît la coquille servie pour un chemin inconnu', () => {
    expect(judgeShell(shell).ok).toBe(true);
    expect(canonicalOf(shell.body)).toBe(`${ORIGIN}/`);
  });
  it('refuse un témoin qui ne serait plus la coquille', () => {
    expect(judgeShell({ ...shell, status: 404 }).ok).toBe(false);
    expect(judgeShell(page('/moon/')).ok).toBe(false);
  });
});

describe('les pages', () => {
  it('accepte une page qui nomme son propre chemin', () => {
    expect(judgePage('/fr/moon/', page('/fr/moon/'), shell).ok).toBe(true);
  });
  it('refuse la coquille, un canonical étranger et un type qui n’est pas du HTML', () => {
    expect(judgePage('/fr/moon/', shell, shell).detail).toMatch(/coquille/);
    expect(judgePage('/fr/moon/', page('/moon/'), shell).ok).toBe(false);
    expect(
      judgePage(
        '/fr/moon/',
        { ...page('/fr/moon/'), contentType: 'application/json' },
        shell
      ).ok
    ).toBe(false);
  });
  it('tire la première et la dernière adresse de chaque famille du sitemap', () => {
    const loc = (p: string) => `<url><loc>${ORIGIN}${p}</loc></url>`;
    const xml = [
      '/',
      '/moon/',
      '/sun/',
      '/fr/moon/',
      '/places/a/x/',
      '/places/b/y/',
      '/places/c/z/',
    ]
      .map(loc)
      .join('');
    const { samples } = sitemapSamples(xml);
    expect(samples).toEqual([
      { family: 'page', path: '/moon/' },
      { family: 'page', path: '/sun/' },
      { family: 'fr/page', path: '/fr/moon/' },
      { family: 'places', path: '/places/a/x/' },
      { family: 'places', path: '/places/c/z/' },
    ]);
  });
});

describe('les en-têtes', () => {
  const firebase = JSON.parse(
    readFileSync(resolve(__dirname, '../../firebase.json'), 'utf8')
  ) as unknown;
  it('lit dans firebase.json les en-têtes de ** et ceux d’une règle de chemin', () => {
    const root = expectedHeaders(firebase, '/');
    expect(Object.keys(root)).toContain('content-security-policy');
    expect(Object.keys(root)).toContain('strict-transport-security');
    const manifest = expectedHeaders(
      firebase,
      '/assets/ephemerides/manifest.json'
    );
    expect(manifest['cache-control']).toMatch(/must-revalidate/);
  });
  it('refuse un en-tête absent ou dont la valeur diffère', () => {
    const expected = {
      'x-frame-options': 'DENY',
      'cache-control': 'max-age=3600',
    };
    expect(judgeHeaders(expected, { ...expected }).ok).toBe(true);
    expect(
      judgeHeaders(expected, { 'x-frame-options': 'DENY' }).detail
    ).toMatch(/absent/);
    expect(
      judgeHeaders(expected, { ...expected, 'x-frame-options': 'SAMEORIGIN' })
        .detail
    ).toMatch(/diffère/);
  });
});

describe('la console', () => {
  it('refuse toute erreur, sans liste d’exceptions', () => {
    expect(judgeConsole([]).ok).toBe(true);
    expect(judgeConsole(['console : Failed to load resource']).ok).toBe(false);
  });
});

describe('les tuiles cuites', () => {
  const set = {
    id: 'demo',
    template:
      'https://galaxy-data.adrianguichard.dev/assets/imagery/demo/0123456789ab/{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.jpg',
    style: 'default',
    tileMatrixSet: 'galaxy-eq2x1',
    matrix: { columnsAtLevelZero: 2, rowsAtLevelZero: 1, tileSizePx: 256 },
    maxLevel: 5,
  };
  const good = {
    status: 200,
    contentType: 'image/jpeg',
    headers: {
      'access-control-allow-origin': ORIGIN,
      'cache-control': 'public, max-age=31536000, immutable',
    },
    bytes: 900,
  };

  it('sonde la première, la dernière et un hachage fantôme, lus dans la fiche', () => {
    const [first, last, ghost] = bakedTileProbes(set);
    expect(first.url).toMatch(
      /\/0123456789ab\/default\/galaxy-eq2x1\/0\/0\/0\.jpg$/
    );
    // Niveau 5 sur 2 x 1 : 32 rangées, 64 colonnes.
    expect(last.url).toMatch(/\/5\/31\/63\.jpg$/);
    expect(ghost.url).toContain('/000000000000/');
    expect(ghost.url).not.toContain('0123456789ab');
  });
  it('refuse une fiche dont le gabarit ne porte pas de hachage', () => {
    expect(() =>
      bakedTileProbes({
        ...set,
        template: set.template.replace('0123456789ab', 'x'),
      })
    ).toThrow(/hachage/);
  });
  it('juge une tuile servie sur son statut, son type, son CORS et son cache', () => {
    expect(judgeBakedTile('première', good, ORIGIN).ok).toBe(true);
    expect(
      judgeBakedTile('première', { ...good, status: 404 }, ORIGIN).ok
    ).toBe(false);
    expect(
      judgeBakedTile('première', { ...good, contentType: 'text/html' }, ORIGIN)
        .ok
    ).toBe(false);
    expect(
      judgeBakedTile(
        'première',
        { ...good, headers: { 'cache-control': 'immutable' } },
        ORIGIN
      ).detail
    ).toMatch(/CORS/);
    expect(
      judgeBakedTile(
        'première',
        {
          ...good,
          headers: { ...good.headers, 'cache-control': 'max-age=3600' },
        },
        ORIGIN
      ).detail
    ).toMatch(/immuable/);
    expect(judgeBakedTile('dernière', { ...good, bytes: 0 }, ORIGIN).ok).toBe(
      false
    );
  });
  it('exige du témoin un 404 : un hachage inconnu servi en 200 ne prouve rien', () => {
    expect(judgeBakedTile('témoin', { ...good, status: 404 }, ORIGIN).ok).toBe(
      true
    );
    expect(judgeBakedTile('témoin', good, ORIGIN).ok).toBe(false);
  });
  it('couvre chaque jeu cuit livré, hachage de la fiche égal à celui du manifeste', () => {
    const imagery = resolve(__dirname, '../../public/assets/imagery');
    const ids = readdirSync(imagery).filter((id) =>
      existsSync(resolve(imagery, id, 'manifest.json'))
    );
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const fiche = JSON.parse(
        readFileSync(
          resolve(__dirname, `../registry/products/tilesets/${id}.json`),
          'utf8'
        )
      );
      const manifest = JSON.parse(
        readFileSync(resolve(imagery, id, 'manifest.json'), 'utf8')
      );
      const probes = bakedTileProbes({ id, ...fiche.service });
      expect(probes).toHaveLength(3);
      expect(probes[0].url).toContain(`/${manifest.hash}/`);
    }
  });
});
