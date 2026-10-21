import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { TILESET_PRODUCTS } from '@/registry/products';

/**
 * LES MOSAÏQUES CUITES PAR NOUS (lot 66) : trois documents décrivent la même cuisson, et aucun
 * ne doit pouvoir dériver des deux autres sans qu'un test rougisse.
 *
 *   - la RECETTE `scripts/imagery-tile-targets.json` (ce qu'on veut cuire) ;
 *   - le MANIFESTE `public/assets/imagery/<id>/manifest.json`, écrit par `pnpm imagery:bake`
 *     (ce qui a été cuit, avec le hachage du répertoire et le SHA-256 de la source) ;
 *   - la FICHE `src/registry/products/tilesets/` (ce que le moteur demande), dont l'adresse
 *     NOMME ce répertoire haché.
 *
 * Les tuiles elles-mêmes ne sont pas dans le dépôt (36,9 Mo pour Pluton, sur le service de
 * données) : ce test ne peut pas les relire, il tient donc ce que le dépôt connaît. Le téléversement
 * AVANT la livraison est une étape de procédure (`services/galaxy-data/README.md`), pas une garde.
 */
const ROOT = resolve(import.meta.dirname, '../..');
const RECIPE = JSON.parse(
  readFileSync(resolve(ROOT, 'scripts/imagery-tile-targets.json'), 'utf8')
) as {
  targets: Record<
    string,
    {
      body: string;
      source: {
        url: string;
        bytes: number;
        width: number;
        height: number;
        channels: number;
      };
      centerLongitude?: 180;
      tileSizePx: number;
      maxLevel: number;
    }
  >;
};

interface Manifest {
  id: string;
  body: string;
  source: {
    url: string;
    bytes: number;
    sha256: string;
    width: number;
    height: number;
    channels: number;
    centerLongitude: number;
  };
  matrix: {
    columnsAtLevelZero: number;
    rowsAtLevelZero: number;
    tileSizePx: number;
  };
  maxLevel: number;
  format: string;
  path: string;
  hash: string;
  tileCount: number;
  totalBytes: number;
}

const readManifest = (id: string): Manifest =>
  JSON.parse(
    readFileSync(
      resolve(ROOT, `public/assets/imagery/${id}/manifest.json`),
      'utf8'
    )
  ) as Manifest;

/** Les fiches dont l'adresse est celle du service de données de Galaxy. */
const OWN_TILESETS = TILESET_PRODUCTS.filter((t) =>
  t.service.template.startsWith(
    'https://galaxy-data.adrianguichard.dev/assets/imagery/'
  )
);

describe('mosaïques cuites : recette, manifeste, fiche', () => {
  it('chaque cible de la recette a son manifeste, fidèle à la recette', () => {
    expect(Object.keys(RECIPE.targets).length).toBeGreaterThan(0);
    for (const [id, target] of Object.entries(RECIPE.targets)) {
      const manifest = readManifest(id);
      expect(manifest.id, id).toBe(id);
      expect(manifest.body, id).toBe(target.body);
      expect(manifest.source.url, id).toBe(target.source.url);
      expect(manifest.source.bytes, id).toBe(target.source.bytes);
      expect(manifest.source.width, id).toBe(target.source.width);
      expect(manifest.source.height, id).toBe(target.source.height);
      expect(manifest.source.channels, id).toBe(target.source.channels);
      expect(manifest.source.centerLongitude, id).toBe(
        target.centerLongitude ?? 0
      );
      expect(manifest.matrix.tileSizePx, id).toBe(target.tileSizePx);
      expect(manifest.maxLevel, id).toBe(target.maxLevel);
      expect(manifest.source.sha256, id).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('aucun manifeste n’existe sans cible, et chaque manifeste a sa fiche', () => {
    const dir = resolve(ROOT, 'public/assets/imagery');
    const ids = readdirSync(dir).filter((d) =>
      existsSync(resolve(dir, d, 'manifest.json'))
    );
    expect(ids.sort()).toEqual(Object.keys(RECIPE.targets).sort());
    expect(OWN_TILESETS.map((t) => t.id).sort()).toEqual(ids.sort());
  });

  it('compte exactement les tuiles de la pyramide 2 × 1, 256 px, niveaux 0 à maxLevel', () => {
    for (const id of Object.keys(RECIPE.targets)) {
      const m = readManifest(id);
      let expected = 0;
      for (let level = 0; level <= m.maxLevel; level++)
        expected += 2 ** (level + 1) * 2 ** level;
      expect(m.tileCount, id).toBe(expected);
      expect(m.totalBytes, id).toBeGreaterThan(m.tileCount * 100);
    }
  });

  it('la pyramide ne sous-échantillonne pas la source de plus d’un facteur 2', () => {
    // Un niveau maximal trop BAS jetterait du détail publié ; un niveau trop HAUT n'en ajoute pas.
    // La borne est celle que la fiche annonce : sa finesse en pixels par degré.
    for (const id of Object.keys(RECIPE.targets)) {
      const m = readManifest(id);
      const pyramidWidth =
        m.matrix.tileSizePx * m.matrix.columnsAtLevelZero * 2 ** m.maxLevel;
      expect(pyramidWidth, id).toBeGreaterThanOrEqual(m.source.width);
      expect(pyramidWidth, id).toBeLessThan(m.source.width * 2);
    }
  });

  it('l’adresse de la fiche nomme le répertoire haché du manifeste, et rien d’autre', () => {
    expect(OWN_TILESETS.length).toBeGreaterThan(0);
    for (const tileset of OWN_TILESETS) {
      const m = readManifest(tileset.id);
      const { service } = tileset;
      expect(service.template, tileset.id).toBe(
        `https://galaxy-data.adrianguichard.dev/assets/imagery/${m.id}/${m.hash}/` +
          '{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.jpg'
      );
      // Le chemin que le cuiseur écrit est `<style>/<matrice>/…` : c'est ce que la fiche déclare.
      expect(`${service.style}/${service.tileMatrixSet}`, tileset.id).toBe(
        m.path
      );
      expect(service.format, tileset.id).toBe(m.format);
      expect(service.maxLevel, tileset.id).toBe(m.maxLevel);
      expect(service.minLevel, tileset.id).toBe(0);
      expect(service.matrix, tileset.id).toEqual(m.matrix);
      expect(tileset.body, tileset.id).toBe(m.body);
      // Les tuiles sont DÉJÀ à l'orientation de l'application : un `centerLongitude` ici les
      // tournerait d'un demi-tour une seconde fois.
      expect(
        (service as { centerLongitude?: number }).centerLongitude,
        tileset.id
      ).toBeUndefined();
    }
  });

  it('le service de données sert ces tuiles en cache immuable', () => {
    // Le RÉPERTOIRE est haché, donc une adresse ne change jamais d'octets : sans cette règle le
    // navigateur réinterroge le serveur de la VM à chaque visite.
    const caddy = readFileSync(
      resolve(ROOT, 'services/galaxy-data/Caddyfile'),
      'utf8'
    );
    expect(caddy).toMatch(/@imagery path \/assets\/imagery\/\*/);
    expect(caddy).toMatch(
      /header @imagery Cache-Control "public, max-age=31536000, immutable"/
    );
  });
});
