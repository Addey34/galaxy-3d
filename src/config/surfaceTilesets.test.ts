import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SURFACE_TILESETS, tilesetProduct } from './surfaceTilesets';
import { CELESTIAL_CONFIG } from './bodies';
import { flattenBodies } from './catalog';
import { TILESET_PRODUCTS } from '@/registry/products';
import { TILE_PROVIDERS } from '@/registry/providers/runtimeServices';
import { tileServiceHost, tileUrl } from '@/core/tileUrl';
import {
  groundResolutionKm,
  oversamplingFactor,
  tileIndexAt,
} from '@/core/tilePyramid';
import { classifyTemporal } from '@/core/temporal';

const ROOT = resolve(import.meta.dirname, '../..');

/**
 * LA FICHE DOIT SUFFIRE, ET ELLE DOIT ÊTRE VRAIE.
 *
 * Le moteur d'imagerie ne connaît aucun nom de corps : tout ce qu'il fait vient de ces fiches.
 * Une valeur fausse ici n'échoue donc pas, elle produit des requêtes vers le mauvais endroit
 * (ou, pour un niveau maximal trop haut, vers des adresses que Trek refuse sans en-tête CORS).
 * Ce fichier confronte chaque champ à une autorité extérieure à lui : le catalogue, le registre
 * des fournisseurs, la CSP servie.
 */
describe('fiches de jeux de tuiles', () => {
  it('expose exactement les fiches du registre, indexées par corps', () => {
    expect(SURFACE_TILESETS.size).toBe(TILESET_PRODUCTS.length);
    expect(SURFACE_TILESETS.size).toBeGreaterThan(0);
    for (const product of TILESET_PRODUCTS)
      expect(SURFACE_TILESETS.get(product.body)?.id).toBe(product.id);
  });

  it('ne recouvre que des corps du catalogue, dont le rayon est publié', () => {
    const radii = new Map(
      [...flattenBodies(CELESTIAL_CONFIG)].map(([name, cfg]) => [
        name,
        cfg.realData?.radiusKm,
      ])
    );
    for (const [body] of SURFACE_TILESETS) {
      expect(radii.has(body), `${body} absent du catalogue`).toBe(true);
      // Sans rayon publié, le moteur ne saurait convertir ni altitude ni résolution au sol.
      expect(radii.get(body), `${body} sans rayon publié`).toBeGreaterThan(0);
    }
  });

  it('cite un fournisseur du registre, dont l’hôte est bien celui du gabarit', () => {
    for (const [body, tileset] of SURFACE_TILESETS) {
      const provider = (TILE_PROVIDERS as Record<string, { host: string }>)[
        tileset.providerId
      ];
      expect(
        provider,
        `${body} : fournisseur ${tileset.providerId}`
      ).toBeTruthy();
      expect(tileServiceHost(tileset.service)).toBe(provider!.host);
    }
  });

  it('ordonne les jetons du gabarit comme WMTS les publie', () => {
    // Trouvé en falsifiant : intervertir `{TileRow}` et `{TileCol}` dans la fiche passait tous
    // les autres tests. L'application émettrait alors des adresses VALIDES montrant un autre
    // endroit du corps, ce que ni une erreur ni un 404 ne signaleraient. Le gabarit se recopie
    // des capacités, et cet ordre — niveau, LIGNE, colonne — est celui du RESTful WMTS.
    for (const [body, tileset] of SURFACE_TILESETS) {
      expect(tileset.service.template, body).toContain(
        '{TileMatrix}/{TileRow}/{TileCol}'
      );
      expect(tileset.service.template, body).toContain('{Style}');
      expect(tileset.service.template, body).toContain('{TileMatrixSet}');
    }
  });

  it('affiche un crédit non vide qui nomme la NASA, comme ses conditions l’exigent', () => {
    // « NASA should be acknowledged as the source of the material », lu à la source
    // le 2026-09-21. Un crédit vide rendrait l'usage non conforme, en silence.
    for (const [body, tileset] of SURFACE_TILESETS) {
      expect(tileset.credit.length, body).toBeGreaterThan(0);
      expect(tileset.credit, body).toMatch(/NASA/);
    }
  });

  it('décrit une campagne passée, bornée et ordonnée', () => {
    const now = Date.now();
    for (const [body, tileset] of SURFACE_TILESETS) {
      expect(Number.isFinite(tileset.acquired.from), body).toBe(true);
      expect(Number.isFinite(tileset.acquired.to), body).toBe(true);
      expect(tileset.acquired.from, body).toBeLessThan(tileset.acquired.to);
      expect(tileset.acquired.to, body).toBeLessThan(now);
    }
  });
});

/**
 * La fiche du FOURNISSEUR déclare la couverture temporelle du SERVICE, celle du PRODUIT la
 * campagne d'une mosaïque : deux choses différentes qui coïncident tant qu'un service ne sert
 * qu'un jeu. Recopier l'une dans l'autre serait la divergence habituelle, donc on vérifie que
 * la première ENVELOPPE bien les secondes — même règle que `horizons-binary` face au manifeste.
 */
describe('couverture déclarée par le fournisseur', () => {
  it('contient la campagne de chacun de ses jeux de tuiles', () => {
    for (const [id, provider] of Object.entries(TILE_PROVIDERS)) {
      const [from, to] = provider.extent.temporal.interval[0]!;
      const fromMs = from === null ? -Infinity : Date.parse(from);
      const toMs = to === null ? Infinity : Date.parse(to);
      const own = [...SURFACE_TILESETS.values()].filter(
        (t) => t.providerId === id
      );
      expect(own.length, `${id} ne sert aucun jeu de tuiles`).toBeGreaterThan(
        0
      );
      for (const tileset of own) {
        expect(tileset.acquired.from, tileset.id).toBeGreaterThanOrEqual(
          fromMs
        );
        expect(tileset.acquired.to, tileset.id).toBeLessThanOrEqual(toMs);
      }
    }
  });
});

describe('ce que la fiche fait produire au moteur', () => {
  const moon = SURFACE_TILESETS.get('moon');

  it('adresse une tuile réelle au niveau maximal déclaré', () => {
    expect(moon).toBeTruthy();
    const index = tileIndexAt(moon!.maxLevel, 0, 0, moon!.matrix);
    expect(() => tileUrl(moon!.service, index)).not.toThrow();
    expect(tileUrl(moon!.service, index)).toContain(`/${moon!.maxLevel}/`);
  });

  it('sert 83 m/px au niveau maximal, et le déclare sur-échantillonné', () => {
    const radiusKm = 1737.4;
    expect(
      groundResolutionKm(moon!.maxLevel, radiusKm, moon!.matrix) * 1000
    ).toBeCloseTo(83.286, 3);
    // Ce que le bandeau doit dire : la mosaïque est publiée à 303 px/degré, le niveau 8
    // l'agrandit de 1,20. Se taire afficherait une finesse que la source n'a pas.
    expect(
      oversamplingFactor(
        moon!.maxLevel,
        moon!.publishedPixelsPerDegree,
        moon!.matrix
      )
    ).toBeGreaterThan(1);
  });

  it('se classe « observé » quelle que soit la date de la scène', () => {
    // Une mosaïque ne décrit pas la date de la scène mais la surface : elle reste une mesure,
    // passée, y compris pour une scène en 2050 ou en 1610.
    const product = tilesetProduct(moon!);
    const now = new Date('2026-09-21T00:00:00Z');
    for (const iso of ['1610-01-07', '2026-09-21', '2050-01-01']) {
      expect(
        classifyTemporal(product, new Date(`${iso}T00:00:00Z`), now).category,
        iso
      ).toBe('observed');
    }
  });
});

/**
 * L'hôte est déclaré en QUATRE endroits (CSP `connect-src` et `img-src`, `LIVE_DATA_SERVICES`,
 * fiche de fournisseur, `privacy.html` dans les deux langues). Les deux premiers et la fiche
 * sont croisés par `core/gibsLegend.test.ts` et `seo/docPages.test.ts` ; la page de
 * confidentialité l'est par `config/privacyDisclosure.test.ts`, mais par suffixe et sur la seule
 * CSP. On ajoute ici le lien direct fiche → page, dans les DEUX langues.
 */
describe('divulgation de l’hôte des tuiles', () => {
  const privacy = readFileSync(resolve(ROOT, 'public/privacy.html'), 'utf8');

  it('nomme l’hôte dans la page de confidentialité, deux fois', () => {
    for (const provider of Object.values(TILE_PROVIDERS)) {
      const occurrences = privacy.split(provider.host).length - 1;
      expect(occurrences, `${provider.host} dans privacy.html`).toBe(2);
    }
  });
});
