import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bakedTileProbes,
  canonicalOf,
  expectedHeaders,
  judgeBakedTile,
  judgeStableAsset,
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
  describe('un jeu RÉGIONAL (GAL-PRODUCTION-PROBE-001, issue #554)', () => {
    // Le manifeste d'Apollo 11 : [ouest, sud, est, nord] et les niveaux publiés.
    const regional = {
      ...set,
      id: 'demo-regional',
      maxLevel: 13,
      region: {
        bbox: [
          23.433361766824664, -0.030999213043799535, 23.605354279304922,
          0.9144767847920869,
        ],
        levels: [11, 12, 13],
      },
    };

    it('sonde la tuile qui contient le centre de la région, jamais le niveau 0 ni le coin de la grille', () => {
      const [first, last] = bakedTileProbes(regional);
      expect(first.url).toMatch(
        /\/0123456789ab\/default\/galaxy-eq2x1\/11\/1018\/2315\.jpg$/
      );
      expect(last.url).toMatch(/\/13\/4075\/9262\.jpg$/);
      // C'est la sonde du niveau 0 qui déclarait la production « non saine » : ce niveau n'existe pas ici.
      expect(first.url).not.toMatch(/\/0\/0\/0\.jpg$/);
      // Le coin de la grille du dernier niveau n'existe pas non plus (2 x 1, 13 : 8 192 x 16 384).
      expect(last.url).not.toMatch(/\/8191\/16383\.jpg$/);
    });

    it('fait mordre le témoin sur la VRAIE première tuile : seul le hachage change', () => {
      const [first, , ghost] = bakedTileProbes(regional);
      expect(ghost.kind).toBe('témoin');
      expect(ghost.url.replace('000000000000', '0123456789ab')).toBe(first.url);
    });

    it('un jeu global garde ses sondes : le niveau 0 et le dernier coin', () => {
      const [first, last] = bakedTileProbes(set);
      expect(first.url).toMatch(/\/0\/0\/0\.jpg$/);
      expect(last.url).toMatch(/\/5\/31\/63\.jpg$/);
    });

    it('refuse une région illisible plutôt que de sonder au hasard', () => {
      for (const region of [
        { bbox: [1, 2, 3], levels: [11] },
        { bbox: [1, 2, 3, Number.NaN], levels: [11] },
        { bbox: [1, 2, 3, 4], levels: [] },
      ])
        expect(() => bakedTileProbes({ ...regional, region })).toThrow(
          /région illisible/
        );
    });

    it('chaque jeu régional livré est sondé sur des tuiles PUBLIÉES, lues dans son inventaire', () => {
      const imagery = resolve(__dirname, '../../public/assets/imagery');
      let regionalSets = 0;
      for (const id of readdirSync(imagery)) {
        const manifestPath = resolve(imagery, id, 'manifest.json');
        if (!existsSync(manifestPath)) continue;
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        if (!manifest.region) continue;
        regionalSets += 1;
        const fiche = JSON.parse(
          readFileSync(
            resolve(__dirname, `../registry/products/tilesets/${id}.json`),
            'utf8'
          )
        );
        const [first, last] = bakedTileProbes({
          id,
          ...fiche.service,
          region: manifest.region,
        });
        const tail = (url: string) => /\/(\d+)\/(\d+)\/(\d+)\.jpg$/.exec(url)!;
        const [, firstLevel] = tail(first!.url);
        const [, lastLevel] = tail(last!.url);
        expect(Number(firstLevel)).toBe(Math.min(...manifest.region.levels));
        expect(Number(lastLevel)).toBe(Math.max(...manifest.region.levels));
        // L'inventaire des objets écrits par le cuiseur, tant qu'il est gardé avec la publication.
        const inventory = resolve(
          __dirname,
          `../../scripts/pending-publication/${id}/objects.json`
        );
        if (existsSync(inventory)) {
          const published = new Set(
            (
              JSON.parse(readFileSync(inventory, 'utf8')).objects as {
                path: string;
              }[]
            ).map((o) => o.path.split('/').slice(-3).join('/'))
          );
          expect(published.size).toBe(manifest.tileCount);
          for (const probe of [first!, last!])
            expect(
              published.has(tail(probe.url).slice(1).join('/') + '.jpg')
            ).toBe(true);
        }
      }
      expect(regionalSets).toBeGreaterThan(0);
    });
  });

  it('refuse une fiche dont le gabarit ne porte pas de hachage', () => {
    expect(() =>
      bakedTileProbes({
        ...set,
        template: set.template.replace('0123456789ab', 'x'),
      })
    ).toThrow(/hachage/);
  });
  it('juge un actif au nom stable : CORS de la page, cache présent et non immuable', () => {
    const stable = {
      status: 200,
      headers: {
        'access-control-allow-origin': ORIGIN,
        'cache-control': 'public, max-age=300',
      },
    };
    expect(judgeStableAsset(stable, ORIGIN).ok).toBe(true);
    expect(judgeStableAsset({ ...stable, status: 404 }, ORIGIN).ok).toBe(false);
    expect(
      judgeStableAsset(
        { ...stable, headers: { 'cache-control': 'max-age=300' } },
        ORIGIN
      ).detail
    ).toMatch(/CORS/);
    expect(
      judgeStableAsset(
        {
          ...stable,
          headers: { ...stable.headers, 'cache-control': 'immutable' },
        },
        ORIGIN
      ).detail
    ).toMatch(/immuable/);
    expect(
      judgeStableAsset(
        {
          ...stable,
          headers: { 'access-control-allow-origin': ORIGIN },
        },
        ORIGIN
      ).detail
    ).toMatch(/absent/);
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
      const probes = bakedTileProbes({
        id,
        ...fiche.service,
        region: manifest.region,
      });
      expect(probes).toHaveLength(3);
      expect(probes[0].url).toContain(`/${manifest.hash}/`);
    }
  });
});
