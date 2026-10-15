import { readFileSync } from 'node:fs';
import { LOCALES } from '@/i18n/locales';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  createDatedChooser,
  DATED_RECHECK_MS,
  DATED_SURFACE_TILESETS,
  DOMAIN_MAX_AGE_MS,
  compareEdition,
  editionFor,
  SURFACE_TILESETS,
  SURFACE_VARIANTS,
  tilesetForDay,
  tilesetProduct,
  type SurfaceTileset,
} from './surfaceTilesets';
import { CELESTIAL_CONFIG } from './bodies';
import { flattenBodies } from './catalog';
import { TILESET_PRODUCTS } from '@/registry/products';
import { TILE_PROVIDERS } from '@/registry/providers/runtimeServices';
import eoxProvider from '@/registry/providers/eox-cloudless.json';
import eoxEditions from './eoxEditions.json';
import eoxEditionYears from './eoxEditionYears.json';
import { tileServiceHost, tileUrl } from '@/core/tileUrl';
import {
  groundResolutionKm,
  oversamplingFactor,
  pyramidWidthPx,
  tileIndexAt,
} from '@/core/tilePyramid';
import { classifyTemporal } from '@/core/temporal';
import { approachFloorRadiusFactor } from '@/core/surfaceApproach';
import { TEXTURE_QUALITY_PIXELS } from '@/components/systems/TextureSystem';

const ROOT = resolve(import.meta.dirname, '../..');

/**
 * TOUS les jeux, mosaïques ET couches datées (lot 48), clé lisible : les gardes ci-dessous
 * valent pour les deux, et une couche datée qui y échapperait serait le défaut habituel d'une
 * liste qu'on oublie d'étendre.
 */
const ALL_TILESETS: ReadonlyArray<[string, SurfaceTileset]> = [
  ...SURFACE_TILESETS.values(),
  ...DATED_SURFACE_TILESETS.values(),
  ...[...SURFACE_VARIANTS.values()].flatMap((variants) =>
    [...variants.values()].flat()
  ),
].map((tileset) => [`${tileset.body} (${tileset.id})`, tileset]);

/**
 * Finesse de la texture de surface LIVRÉE d'un corps, en pixels sur 360°, au meilleur palier
 * que le catalogue déclare. C'est la forme la plus EXIGEANTE de la comparaison : à l'exécution
 * le profil mobile plafonne à 2k (`CelestialObject.shippedSurfaceWidthPx`), donc un jeu de
 * tuiles qui bat le palier maximal bat aussi tous les autres.
 */
function shippedSurfaceWidthPx(body: string): number {
  const cfg = new Map([...flattenBodies(CELESTIAL_CONFIG)]).get(body);
  const tiers = cfg?.textureResolutions?.surface ?? [];
  return Math.max(0, ...tiers.map((tier) => TEXTURE_QUALITY_PIXELS[tier] ?? 0));
}

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
  it('expose exactement les fiches du registre, une mosaïque et au plus une couche datée par corps', () => {
    expect(ALL_TILESETS.length).toBe(TILESET_PRODUCTS.length);
    expect(SURFACE_TILESETS.size).toBeGreaterThan(0);
    for (const product of TILESET_PRODUCTS) {
      const found = product.variant
        ? SURFACE_VARIANTS.get(product.body)
            ?.get(product.variant)
            ?.find((t) => t.edition === product.edition)
        : (product.service.time
            ? DATED_SURFACE_TILESETS
            : SURFACE_TILESETS
          ).get(product.body);
      // Deux fiches au même rôle sur un corps s'écraseraient en silence : une seule gagne.
      expect(found?.id, product.id).toBe(product.id);
    }
    // Plusieurs fiches au même fond ne se départagent que par leur ÉDITION (lot 50) : deux
    // fiches sans année, ou à la même année, s'écraseraient.
    for (const variants of SURFACE_VARIANTS.values())
      for (const [variant, editions] of variants) {
        if (editions.length === 1) continue;
        const years = editions.map((t) => t.edition);
        expect(years.every(Number.isInteger), variant).toBe(true);
        expect(new Set(years).size, variant).toBe(years.length);
      }
    // Un fond de rechange se choisit À LA PLACE de la mosaïque : sans elle, rien à remplacer.
    for (const body of SURFACE_VARIANTS.keys())
      expect(SURFACE_TILESETS.has(body), body).toBe(true);
    // Une couche datée retombe sur la MOSAÏQUE de son corps pour tout jour non publié : sans
    // mosaïque, ce repli n'existerait pas.
    for (const body of DATED_SURFACE_TILESETS.keys())
      expect(SURFACE_TILESETS.has(body), body).toBe(true);
  });

  it('ne recouvre que des corps du catalogue, dont le rayon est publié', () => {
    const radii = new Map(
      [...flattenBodies(CELESTIAL_CONFIG)].map(([name, cfg]) => [
        name,
        cfg.realData?.radiusKm,
      ])
    );
    for (const [, { body }] of ALL_TILESETS) {
      expect(radii.has(body), `${body} absent du catalogue`).toBe(true);
      // Sans rayon publié, le moteur ne saurait convertir ni altitude ni résolution au sol.
      expect(radii.get(body), `${body} sans rayon publié`).toBeGreaterThan(0);
    }
  });

  it('sert, à son niveau maximal, plus fin que la texture livrée du corps', () => {
    // LA RAISON D'ÊTRE D'UNE FICHE, et elle se vérifie ici plutôt qu'à l'écran. Le moteur
    // refuse de peindre un niveau plus grossier que la texture du catalogue (défaut 3 de la
    // phase 9C, mesuré à 1 541 km sur la Lune) : une fiche dont le niveau MAXIMAL n'améliore
    // rien ne peindrait donc jamais rien, sans erreur et sans un mot. C'est exactement le
    // piège qu'un corps ajouté par une fiche seule doit rencontrer ici, et pas en production.
    for (const [label, tileset] of ALL_TILESETS) {
      const body = tileset.body;
      const shippedPx = shippedSurfaceWidthPx(body);
      expect(
        shippedPx,
        `${body} sans texture de surface livrée`
      ).toBeGreaterThan(0);
      expect(
        pyramidWidthPx(tileset.maxLevel, tileset.matrix),
        `${label} : le niveau maximal n’améliore pas la texture livrée`
      ).toBeGreaterThan(shippedPx);
    }
  });

  it('cite un fournisseur du registre, dont l’hôte est bien celui du gabarit', () => {
    for (const [body, tileset] of ALL_TILESETS) {
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

  it('déclare le même format que l’extension de son gabarit', () => {
    // DEUX SOURCES POUR LA MÊME CHOSE, donc un croisement. Le champ `format` de la fiche n'est
    // consommé NULLE PART : ce qui décide vraiment du type servi est l'extension du gabarit, que
    // `core/tileUrl.ts` recopie telle quelle. Une fiche qui annoncerait `image/jpeg` avec un
    // gabarit en `.png` fonctionnerait donc parfaitement tout en mentant dans sa provenance.
    //
    // Ce n'est pas théorique : les couches de Trek mêlent les deux (la Lune, Mars, Mercure et
    // Cérès servent du JPEG, Vénus du PNG), et l'adresse composée à la main en `.jpg` pour une
    // couche PNG a réellement rendu 404 au lot 27.
    // GIBS écrit `.jpeg` là où Trek écrit `.jpg` (capabilities lues le 2026-10-12) : les deux
    // désignent du JPEG, et le gabarit se RECOPIE, il ne se normalise pas.
    const EXTENSIONS: Record<string, string[]> = {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
    };
    expect(TILESET_PRODUCTS.length).toBeGreaterThan(0);
    for (const product of TILESET_PRODUCTS) {
      const expected = EXTENSIONS[product.service.format];
      expect(expected, `${product.id} : format inconnu`).toBeDefined();
      expect(
        expected!.some((ext) => product.service.template.endsWith(ext)),
        `${product.id} déclare ${product.service.format} mais son gabarit finit par ` +
          `« ${product.service.template.slice(-4)} »`
      ).toBe(true);
    }
  });

  it('ordonne les jetons du gabarit comme WMTS les publie', () => {
    // Trouvé en falsifiant : intervertir `{TileRow}` et `{TileCol}` dans la fiche passait tous
    // les autres tests. L'application émettrait alors des adresses VALIDES montrant un autre
    // endroit du corps, ce que ni une erreur ni un 404 ne signaleraient. Le gabarit se recopie
    // des capacités, et cet ordre — niveau, LIGNE, colonne — est celui du RESTful WMTS.
    for (const [body, tileset] of ALL_TILESETS) {
      expect(tileset.service.template, body).toContain(
        '{TileMatrix}/{TileRow}/{TileCol}'
      );
      // Trek publie un jeton `{Style}` ; GIBS écrit son style (`default`) en dur dans le chemin.
      // Les deux sont recopiés des capacités : ce qui compte est que le style DÉCLARÉ soit
      // celui que l'adresse emploie.
      const template = tileset.service.template;
      expect(
        template.includes('{Style}') ||
          template.includes(`/${tileset.service.style}/`),
        `${body} : ni jeton {Style}, ni style « ${tileset.service.style} » dans le chemin`
      ).toBe(true);
      expect(tileset.service.template, body).toContain('{TileMatrixSet}');
    }
  });

  it('affiche le crédit que les conditions de son fournisseur exigent', () => {
    // NASA : « NASA should be acknowledged as the source of the material », lu à la source le
    // 2026-09-21. EOX (lot 48) : son attribution EXACTE, « displayed legibly and in proximity
    // to the usage », lue le 2026-10-13 ; c'est le crédit du bandeau qui la porte à l'écran.
    // Un crédit vide ou tronqué rendrait l'usage non conforme, en silence.
    for (const [body, tileset] of ALL_TILESETS) {
      expect(tileset.credit.length, body).toBeGreaterThan(0);
      const provider =
        TILE_PROVIDERS[tileset.providerId as keyof typeof TILE_PROVIDERS];
      if (provider.publisher.includes('NASA'))
        expect(tileset.credit, body).toMatch(/NASA/);
      else expect(tileset.credit, body).toContain(provider.attribution);
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

  it('une couche datée commence dans le passé et reste EN COURS', () => {
    // STAC : une fin `null` veut dire « en cours ». La fiche ne recopie pas le dernier jour
    // publié, qui change chaque jour : il se lit à l'exécution (`core/timeDomain.ts`).
    for (const [body, tileset] of DATED_SURFACE_TILESETS) {
      expect(tileset.acquired.from, body).toBeLessThan(Date.now());
      expect(tileset.acquired.to, body).toBe(Number.POSITIVE_INFINITY);
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
  it('déclare EXACTEMENT l’union des campagnes qu’il sert, ni plus ni moins', () => {
    // Le contrôle ne portait que dans UN sens : une fiche hors bornes rougissait, une borne
    // devenue trop large ne disait rien. La valeur était donc maintenue à la main, et elle l'a
    // été : le lot 27 a dû l'étendre pour Cérès. Une valeur qu'on entretient est une valeur qui
    // dérive, alors elle est désormais DÉRIVÉE et vérifiée des deux côtés.
    for (const [id, provider] of Object.entries(TILE_PROVIDERS)) {
      const [from, to] = provider.extent.temporal.interval[0]!;
      const own = ALL_TILESETS.map(([, t]) => t).filter(
        (t) => t.providerId === id
      );
      expect(own.length, `${id} ne sert aucun jeu de tuiles`).toBeGreaterThan(
        0
      );

      const union = {
        from: Math.min(...own.map((t) => t.acquired.from)),
        to: Math.max(...own.map((t) => t.acquired.to)),
      };
      expect(
        from === null ? -Infinity : Date.parse(from),
        `${id} : début déclaré ${from}, union des campagnes ` +
          `${new Date(union.from).toISOString()}`
      ).toBe(union.from);
      expect(
        to === null ? Infinity : Date.parse(to),
        `${id} : fin déclarée ${to}, union des campagnes ` +
          // Infini : une couche datée en cours, que seule une fin `null` décrit.
          `${Number.isFinite(union.to) ? new Date(union.to).toISOString() : 'en cours'}`
      ).toBe(union.to);
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
 * MARS : LA PREUVE DE GÉNÉRICITÉ (lot 9, phase 9E).
 *
 * Ce corps a été ajouté par une FICHE et rien d'autre : aucun fichier de
 * `src/components/surface/`, de `src/core/tile*.ts` ni `src/ui/surfacePanel.ts` n'a changé. Ce
 * bloc confronte donc la fiche aux chiffres que le moteur en dérivera, et il dit surtout ce qui
 * DIFFÈRE de la Lune, parce que c'est là qu'un moteur trop accommodant se serait trahi :
 * la matrice s'arrête au niveau 7 et non 8, et le niveau servi reste PLUS GROSSIER que la
 * mosaïque publiée, là où la Lune l'agrandit de 1,20.
 */
describe('ce que la fiche de Mars fait produire au moteur', () => {
  const mars = SURFACE_TILESETS.get('mars');
  /** Rayon PUBLIÉ lu dans le catalogue, comme `ui/surfacePanel.ts` le lit pour le moteur. */
  const radiusKm = new Map([...flattenBodies(CELESTIAL_CONFIG)]).get('mars')!
    .realData!.radiusKm!;

  it('sert 325 m/px au niveau maximal, contre 2,6 km/px pour la texture livrée', () => {
    expect(mars).toBeTruthy();
    expect(mars!.maxLevel).toBe(7);
    const servedM = groundResolutionKm(mars!.maxLevel, radiusKm, mars!.matrix) * 1000; // prettier-ignore
    expect(servedM).toBeCloseTo(324.96, 2);
    // La texture 8k du catalogue, par la même identité `2πr / W`.
    const shippedM = ((2 * Math.PI * radiusKm) / 8192) * 1000;
    expect(shippedM).toBeCloseTo(2599.7, 1);
    expect(shippedM / servedM).toBeCloseTo(8, 2);
  });

  it('ne sur-échantillonne PAS la mosaïque publiée, contrairement à la Lune', () => {
    // 182,04 px/degré servis au niveau 7 contre 256 publiés : le niveau maximal de Trek reste
    // en deçà de la source. Le bandeau se tait alors, et c'est le comportement attendu — il ne
    // parle d'agrandissement que lorsqu'il y en a un (`ui/surfacePanel.ts`, `oversampling > 1`).
    const factor = oversamplingFactor(
      mars!.maxLevel,
      mars!.publishedPixelsPerDegree,
      mars!.matrix
    );
    expect(factor).toBeCloseTo(0.711, 3);
    expect(factor).toBeLessThan(1);
    expect(
      oversamplingFactor(
        SURFACE_TILESETS.get('moon')!.maxLevel,
        SURFACE_TILESETS.get('moon')!.publishedPixelsPerDegree,
        SURFACE_TILESETS.get('moon')!.matrix
      ),
      'la Lune, elle, agrandit sa mosaïque'
    ).toBeGreaterThan(1);
  });

  it('fait tomber le plancher d’approche de 249,7 à 31,2 km', () => {
    // Même formule qu'en 9B, inchangée : `1 + budget × 2π / largeur`. La fiche ne fait que lui
    // donner une largeur huit fois plus grande, et c'est tout ce que 9E ajoute au moteur.
    const withTexture = approachFloorRadiusFactor(8192);
    const withTiles = approachFloorRadiusFactor(
      pyramidWidthPx(mars!.maxLevel, mars!.matrix)
    );
    expect(radiusKm * (withTexture - 1)).toBeCloseTo(249.7, 1);
    expect(radiusKm * (withTiles - 1)).toBeCloseTo(31.2, 1);
  });

  it('ne peint qu’à partir du niveau 5, le 4 valant exactement la texture livrée', () => {
    // Le refus du moteur est `largeur <= texture livrée`, donc une ÉGALITÉ est refusée : au
    // niveau 4 la mosaïque vaut 8 192 px comme la texture 8k, et la recouvrir n'apporterait
    // rien. C'est la borne basse réelle de cette fiche, mesurable sans lancer le moteur.
    expect(pyramidWidthPx(4, mars!.matrix)).toBe(8192);
    expect(pyramidWidthPx(5, mars!.matrix)).toBe(16384);
    expect(groundResolutionKm(5, radiusKm, mars!.matrix)).toBeCloseTo(1.3, 3);
  });

  it('adresse une tuile réelle au niveau maximal, et refuse la ligne d’après', () => {
    // La matrice du niveau 7 a 128 lignes (Trek en publie 256 pour la Lune, qui va au 8) :
    // la ligne 128 répond 404 SANS en-tête CORS, donc `tileUrl` doit refuser avant d'émettre.
    expect(() =>
      tileUrl(mars!.service, { level: 7, row: 127, column: 255 })
    ).not.toThrow();
    expect(() =>
      tileUrl(mars!.service, { level: 7, row: 128, column: 0 })
    ).toThrow(/hors matrice/);
  });
});

/**
 * L'hôte est déclaré en QUATRE endroits (CSP `connect-src` et `img-src`, `LIVE_DATA_SERVICES`,
 * fiche de fournisseur, `privacy.html` dans CHAQUE langue). Les deux premiers et la fiche
 * sont croisés par `core/gibsLegend.test.ts` et `seo/docPages.test.ts` ; la page de
 * confidentialité l'est par `config/privacyDisclosure.test.ts`, mais par suffixe et sur la seule
 * CSP. On ajoute ici le lien direct fiche → page, dans CHAQUE langue.
 *
 * LE NOMBRE ÉTAIT ÉCRIT « 2 » À LA MAIN, et le lot 35 l'a fait tomber en portant la page de
 * deux langues à quatre. C'est précisément ce que ce lot corrige ailleurs : un nombre qu'on
 * entretient n'est pas une garde. Il se DÉRIVE désormais de `LOCALES`.
 */
describe('divulgation de l’hôte des tuiles', () => {
  const privacy = readFileSync(resolve(ROOT, 'public/privacy.html'), 'utf8');

  it('nomme l’hôte dans la page de confidentialité, une fois par langue', () => {
    for (const provider of Object.values(TILE_PROVIDERS)) {
      const occurrences = privacy.split(provider.host).length - 1;
      expect(occurrences, `${provider.host} dans privacy.html`).toBe(
        LOCALES.length
      );
    }
  });
});

/**
 * LA COUCHE DATÉE DE LA TERRE (lot 48) : VIIRS SNPP True Color, un jour par image.
 *
 * Trois choses que ni une capture ni une erreur ne montreraient : le jour est bien écrit dans
 * l'adresse, un gabarit dont le jour n'a PAS été résolu est refusé avant d'émettre (GIBS rend
 * alors 404 sans CORS), et la réponse DescribeDomains interrogée est celle de la MÊME couche,
 * au même jeu de matrices, que les tuiles.
 */
describe('la couche datée de la Terre', () => {
  const viirs = DATED_SURFACE_TILESETS.get('earth');

  it('existe, et va plus loin que la mosaïque Blue Marble', () => {
    expect(viirs).toBeTruthy();
    expect(viirs!.maxLevel).toBe(8);
    expect(pyramidWidthPx(viirs!.maxLevel, viirs!.matrix)).toBeGreaterThan(
      pyramidWidthPx(
        SURFACE_TILESETS.get('earth')!.maxLevel,
        SURFACE_TILESETS.get('earth')!.matrix
      )
    );
  });

  it('écrit le jour figé dans l’adresse, et ne décrit plus que ce jour', () => {
    const day = tilesetForDay(viirs!, '2026-10-11');
    const url = tileUrl(day.service, { level: 8, row: 40, column: 150 });
    expect(url).toBe(
      'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/2026-10-11/250m/8/40/150.jpeg'
    );
    expect(day.day).toBe('2026-10-11');
    expect(new Date(day.acquired.from).toISOString()).toBe(
      '2026-10-11T00:00:00.000Z'
    );
    expect(new Date(day.acquired.to).toISOString()).toBe(
      '2026-10-11T23:59:59.000Z'
    );
    // Le jour du produit est celui de l'image : à la scène du même jour, c'est une mesure.
    expect(
      classifyTemporal(
        tilesetProduct(day),
        new Date('2026-10-11T12:00:00Z'),
        new Date('2026-10-12T12:00:00Z')
      ).category
    ).toBe('observed');
  });

  it('refuse d’émettre tant que le jour n’est pas résolu', () => {
    expect(() =>
      tileUrl(viirs!.service, { level: 3, row: 1, column: 4 })
    ).toThrow(/\{Time\}/);
  });

  it('interroge les jours publiés de la MÊME couche, au même jeu de matrices', () => {
    const layer = /\/best\/([^/]+)\/default\//.exec(
      viirs!.service.template
    )![1];
    expect(viirs!.domainsUrl).toBe(
      `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/${layer}/default/${viirs!.service.tileMatrixSet}/all/all.xml`
    );
  });

  it('déclare la finesse du CAPTEUR, 375 m, et non celle de la pyramide', () => {
    // « The sensor resolution is 750 m and 375 m (M Bands are 750 m, I Bands are 375 m),
    // imagery resolution is 250 m » (description de la couche, lue le 2026-10-12). La bande
    // rouge I1 est à 375 m : c'est la finesse publiée, convertie au rayon du catalogue. Le
    // bandeau dira donc qu'au niveau 8 la pyramide l'agrandit.
    const radiusKm = new Map([...flattenBodies(CELESTIAL_CONFIG)]).get('earth')!
      .realData!.radiusKm!;
    const kmPerDegree = (2 * Math.PI * radiusKm) / 360;
    expect(viirs!.publishedPixelsPerDegree).toBeCloseTo(kmPerDegree / 0.375, 1);
    expect(
      oversamplingFactor(
        viirs!.maxLevel,
        viirs!.publishedPixelsPerDegree,
        viirs!.matrix
      )
    ).toBeGreaterThan(1);
  });
});

/**
 * LE CHOIX, IMAGE APRÈS IMAGE (lot 48) : mosaïque ou couche datée, et jamais un jour non lu.
 * Doublures injectées : horloge, date de la scène et réseau.
 */
describe('choix entre la mosaïque et la couche datée', () => {
  const DOMAINS =
    '<Domain>2015-11-24/2022-07-27/P1D,2022-08-10/2026-10-12/P1D</Domain>';

  function setup(fetchText: (url: string) => Promise<string>) {
    let t = 0;
    let date = new Date('2026-10-11T12:00:00Z');
    const warnings: string[] = [];
    const choose = createDatedChooser({
      date: () => date,
      now: () => t,
      fetchText,
      warn: (m) => warnings.push(m),
    });
    return {
      choose,
      warnings,
      advance: (ms: number) => (t += ms),
      setDate: (iso: string) => (date = new Date(iso)),
    };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const blueMarble = SURFACE_TILESETS.get('earth')!;

  it('réglage éteint : la mosaïque, et rien n’est demandé', () => {
    const fetchText = vi.fn(async () => DOMAINS);
    const { choose } = setup(fetchText);
    expect(choose('earth', 'mosaic')).toBe(blueMarble);
    expect(fetchText).not.toHaveBeenCalled();
    // Un corps sans couche datée reste sur sa mosaïque, réglage allumé ou non.
    expect(choose('moon', 'daily')).toBe(SURFACE_TILESETS.get('moon'));
  });

  it('la mosaïque tant que les jours ne sont pas lus, puis le jour de la scène, même objet', async () => {
    const fetchText = vi.fn(async () => DOMAINS);
    const { choose, advance } = setup(fetchText);
    expect(choose('earth', 'daily')).toBe(blueMarble);
    await flush();
    const first = choose('earth', 'daily');
    expect(first?.day).toBe('2026-10-11');
    advance(DATED_RECHECK_MS + 1);
    // Le moteur compare par IDENTITÉ : un objet neuf à chaque image changerait de génération.
    expect(choose('earth', 'daily')).toBe(first);
    expect(fetchText).toHaveBeenCalledTimes(1);
  });

  it('un jour dans un TROU rend la mosaïque, jamais un jour voisin', async () => {
    const { choose, advance, setDate } = setup(async () => DOMAINS);
    choose('earth', 'daily');
    await flush();
    setDate('2022-08-01T12:00:00Z');
    advance(DATED_RECHECK_MS + 1);
    expect(choose('earth', 'daily')).toBe(blueMarble);
  });

  it('ne relit la date qu’à sa cadence, puis suit le jour', async () => {
    const { choose, advance, setDate } = setup(async () => DOMAINS);
    choose('earth', 'daily');
    await flush();
    expect(choose('earth', 'daily')?.day).toBe('2026-10-11');
    setDate('2026-10-10T12:00:00Z');
    advance(DATED_RECHECK_MS - 1);
    expect(choose('earth', 'daily')?.day).toBe('2026-10-11');
    advance(2);
    expect(choose('earth', 'daily')?.day).toBe('2026-10-10');
  });

  it('une lecture ratée laisse la mosaïque, le dit, et se retente une heure plus tard', async () => {
    const fetchText = vi
      .fn<(url: string) => Promise<string>>()
      .mockRejectedValueOnce(new Error('réseau'))
      .mockResolvedValue(DOMAINS);
    const { choose, warnings, advance } = setup(fetchText);
    choose('earth', 'daily');
    await flush();
    expect(choose('earth', 'daily')).toBe(blueMarble);
    expect(warnings).toHaveLength(1);
    advance(DOMAIN_MAX_AGE_MS - 1);
    choose('earth', 'daily');
    expect(fetchText).toHaveBeenCalledTimes(1);
    advance(2);
    choose('earth', 'daily');
    expect(fetchText).toHaveBeenCalledTimes(2);
    await flush();
    advance(DATED_RECHECK_MS + 1);
    expect(choose('earth', 'daily')?.day).toBe('2026-10-11');
  });
});

describe('les fonds de rechange de la Terre (lot 48)', () => {
  const blueMarble = SURFACE_TILESETS.get('earth')!;
  const choose = createDatedChooser({
    date: () => new Date('2026-10-11T12:00:00Z'),
    fetchText: async () => {
      throw new Error('aucun réseau pour un fond de rechange');
    },
  });

  it('proposent exactement les variantes que le panneau sait nommer', async () => {
    // Le panneau vit au démarrage et ne lit pas les fiches : il porte la liste et ses libellés.
    // Une variante ajoutée sans libellé, ou un libellé sans fiche, rougit ici.
    const { SURFACE_CHOICES } = await import('@/ui/surfaceChoices');
    const offered = SURFACE_CHOICES.filter(
      (choice) => choice !== 'mosaic' && choice !== 'daily'
    );
    expect([...SURFACE_VARIANTS.get('earth')!.keys()].sort()).toEqual(
      [...offered].sort()
    );
  });

  it.each([
    ['shaded-relief', 'BlueMarble_ShadedRelief_Bathymetry'],
    ['night-lights', 'VIIRS_Black_Marble'],
  ] as const)(
    '%s : sa couche GIBS, sur la grille de la mosaïque',
    (choice, layer) => {
      const tileset = choose('earth', choice)!;
      expect(tileset.service.template).toContain(`/${layer}/`);
      expect(tileset.matrix).toEqual(blueMarble.matrix);
      // Une couche statique : aucun jeton de temps ne reste à résoudre.
      expect(tileset.service.template).not.toContain('{Time}');
    }
  );

  it('retombe sur la mosaïque d’un corps qui n’a pas ce fond', () => {
    expect(choose('moon', 'night-lights')).toBe(SURFACE_TILESETS.get('moon'));
    expect(choose('earth', 'mosaic')).toBe(blueMarble);
  });

  it('fige Black Marble sur une année PUBLIÉE, et la décrit', () => {
    // La dimension publiée ne porte que 2012 et 2016 ; une autre année rend 404 sans CORS.
    const night = choose('earth', 'night-lights')!;
    expect(night.service.template).toContain('/2016-01-01/');
    expect(new Date(night.acquired.from).getUTCFullYear()).toBe(2016);
    expect(new Date(night.acquired.to).getUTCFullYear()).toBe(2016);
  });
});

/**
 * LES ÉDITIONS ANNUELLES DE SENTINEL-2 (lot 50), confrontées à ce que `pnpm surface:editions` a
 * lu chez EOX : la page de licence fait foi, une couche qu'elle ne nomme pas est écartée.
 */
describe('les éditions annuelles de Sentinel-2 (lot 50)', () => {
  const editions = SURFACE_VARIANTS.get('earth')!.get('sentinel-2')!;
  const at = (iso: string) => editionFor(editions, new Date(iso))?.edition;

  it('une fiche par édition que la page de licence nomme, et aucune autre', () => {
    expect(editions.map((t) => t.edition)).toEqual(eoxEditions.editions);
    for (const excluded of eoxEditions.excluded)
      expect(editions.map((t) => t.edition)).not.toContain(excluded.year);
  });

  it('chaque édition affiche son attribution, et ses données finissent dans son année', () => {
    for (const edition of editions) {
      expect(edition.credit).toMatch(
        new RegExp(
          String.raw`^EOxCloudless https://cloudless\.eox\.at by EOX IT Services GmbH \(Contains modified Copernicus Sentinel data (\d{4} & )?${edition.edition}( & \d{4})?\)$`
        )
      );
      // Le NOM de l'édition choisit, l'intervalle de ses données se publie : ils doivent se
      // recouvrir, sinon « l'édition de l'année de la scène » ne voudrait rien dire.
      const from = new Date(edition.acquired.from).getUTCFullYear();
      const to = new Date(edition.acquired.to).getUTCFullYear();
      expect(from).toBeLessThanOrEqual(edition.edition!);
      expect(to).toBeGreaterThanOrEqual(edition.edition!);
    }
  });

  it('montre l’édition de l’année de la scène, la précédente dans un trou, une borne au-delà', () => {
    expect(at('2023-06-30T00:00:00Z')).toBe(2023);
    expect(at('2023-01-01T00:00:00Z')).toBe(2023);
    expect(at('2022-12-31T23:59:59Z')).toBe(2022);
    // 2017 n'a pas d'édition : celle de 2016, dont les données portent 2017.
    expect(at('2017-07-01T00:00:00Z')).toBe(2016);
    expect(at('1990-01-01T00:00:00Z')).toBe(editions[0]!.edition);
    expect(at('2040-01-01T00:00:00Z')).toBe(editions.at(-1)!.edition);
    const choose = createDatedChooser({
      date: () => new Date('2021-05-01T00:00:00Z'),
      fetchText: async () => {
        throw new Error('aucun réseau pour une édition');
      },
    });
    const chosen = choose('earth', 'sentinel-2');
    expect(chosen?.edition).toBe(2021);
    // Le moteur compare les jeux par IDENTITÉ : la même année rend le même objet.
    expect(choose('earth', 'sentinel-2')).toBe(chosen);
  });

  it('le réglage du rideau propose exactement les années des fiches', () => {
    // Le réglage vit au démarrage et ne lit pas les fiches : sa liste doit être la leur.
    expect(eoxEditionYears).toEqual(editions.map((t) => t.edition));
  });

  it('compare une autre édition de la série, jamais celle qu’on montre déjà', () => {
    const shown = editionFor(editions, new Date('2023-07-01T00:00:00Z'))!;
    expect(compareEdition('earth', 'sentinel-2', 2022, shown)?.edition).toBe(
      2022
    );
    expect(compareEdition('earth', 'sentinel-2', 2023, shown)).toBeNull();
    expect(compareEdition('earth', 'sentinel-2', null, shown)).toBeNull();
    // 2017 n'a pas d'édition, et un fond qui n'est pas une série n'a pas de rideau.
    expect(compareEdition('earth', 'sentinel-2', 2017, shown)).toBeNull();
    expect(compareEdition('earth', 'mosaic', 2022, shown)).toBeNull();
    expect(compareEdition('earth', 'night-lights', 2016, shown)).toBeNull();
  });

  it('les phrases publiées nomment les éditions et l’écartée que le relevé décrit', () => {
    const years = eoxEditions.editions;
    for (const locale of LOCALES) {
      const use = eoxProvider.use[locale];
      expect(use, locale).toContain(String(years[0]));
      expect(use, locale).toContain(String(years.at(-1)));
      for (const excluded of eoxEditions.excluded)
        expect(eoxProvider.terms[locale], locale).toContain(
          String(excluded.year)
        );
    }
    // « 2016 et 2018 à 2025 » : une suite contiguë après la première, que la prose résume.
    const rest = years.slice(1);
    expect(rest).toEqual(rest.map((_, i) => rest[0]! + i));
  });
});
