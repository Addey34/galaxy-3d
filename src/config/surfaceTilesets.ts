/**
 * FAÇADE D'EXÉCUTION des jeux de tuiles d'imagerie (lot 9, phase 9C).
 *
 * Même rôle que `config/factSources.ts` vis-à-vis de `registry/providers/` : le registre est de
 * la DONNÉE, ce module est ce que l'application en lit. Ajouter un corps à l'imagerie streamée
 * n'est donc qu'une fiche de plus dans `src/registry/products/tilesets/` — c'est le contrat que
 * la phase 9E vérifiera avec Mars.
 *
 * **Ce module n'est chargé qu'à l'approche d'une surface.** Il n'est importé que par
 * `components/surface/`, lui-même chargé par un `import()` dynamique : les fiches ne pèsent donc
 * rien dans le bundle de démarrage. Il n'importe surtout PAS `registry/products/index.ts`, qui
 * tire TOUTES les fiches de texture, ni `registry/providers/`, dont la prose des conditions en
 * quatre langues n'a rien à faire dans un navigateur (le défaut mesuré au lot 8). Aucun nombre
 * ici : il bouge à chaque fiche ajoutée, et il annonçait 63 pour 64 au 2026-09-28.
 */
import type { ImageryTilesetProduct } from '@/registry/schema/product';
import type { TileMatrixShape } from '@/core/tilePyramid';
import type { TileService } from '@/core/tileUrl';
import type { DatedProduct, TimeInterval } from '@/core/temporal';

import { parseDayDomain, publishedDay, type DayRange } from '@/core/timeDomain';
import Logger from '@/utils/Logger';

/**
 * TypeScript ÉLARGIT les chaînes d'un import JSON (`"type": "tileset"` arrive typé `string`).
 * Le schéma Zod vérifie à l'exécution, fichier par fichier, ce que le compilateur ne voit plus
 * (`product.schema.test.ts`) ; cette assertion ne fait que rendre le littéral attendu.
 */
const asTileset = (record: unknown): ImageryTilesetProduct =>
  record as ImageryTilesetProduct;

const FICHES = Object.values(
  import.meta.glob('../registry/products/tilesets/*.json', {
    eager: true,
    import: 'default',
  })
).map(asTileset);

/** Ce que le moteur et le bandeau lisent d'un jeu de tuiles. */
export interface SurfaceTileset {
  id: string;
  body: string;
  title: string;
  mission: string;
  instrument: string;
  providerId: string;
  service: TileService;
  matrix: TileMatrixShape;
  minLevel: number;
  maxLevel: number;
  /** Finesse de la mosaïque publiée, en pixels par degré. */
  publishedPixelsPerDegree: number;
  /** Intervalle que la mosaïque décrit, prêt pour `core/temporal.ts`. */
  acquired: TimeInterval;
  /** Crédit à afficher, tiré des `providers[]` STAC de la fiche. */
  credit: string;
  /**
   * Couche DATÉE (lot 48) : gabarit de la réponse DescribeDomains, jeton `{TileMatrixSet}`
   * résolu. Absent pour une mosaïque. Une couche datée n'est jamais attachée telle quelle :
   * {@link tilesetForDay} la fige sur un jour publié.
   */
  domainsUrl?: string;
  /** Jour figé (`AAAA-MM-JJ`) d'une couche datée, posé par {@link tilesetForDay}. */
  day?: string;
  /** Année d'une ÉDITION annuelle d'un fond de rechange (lot 50), cf. {@link editionFor}. */
  edition?: number;
}

function toTileset(fiche: ImageryTilesetProduct): SurfaceTileset {
  const [from, to] = fiche.acquired.interval[0]!;
  const time = fiche.service.time;
  return {
    id: fiche.id,
    body: fiche.body,
    title: fiche.title,
    mission: fiche.mission,
    instrument: fiche.instrument,
    providerId: fiche.providerId,
    service: {
      template: fiche.service.template,
      style: fiche.service.style,
      tileMatrixSet: fiche.service.tileMatrixSet,
      matrix: fiche.service.matrix,
    },
    matrix: fiche.service.matrix,
    minLevel: fiche.service.minLevel,
    maxLevel: fiche.service.maxLevel,
    publishedPixelsPerDegree: fiche.publishedPixelsPerDegree,
    // Une fin `null` est « en cours » au sens STAC (seule une couche datée le peut).
    acquired: {
      from: Date.parse(from!),
      to: to === null ? Number.POSITIVE_INFINITY : Date.parse(to!),
    },
    credit: fiche.providers.map((provider) => provider.name).join(' · '),
    ...(fiche.edition !== undefined ? { edition: fiche.edition } : {}),
    ...(time
      ? {
          domainsUrl: time.domains
            .split('{TileMatrixSet}')
            .join(fiche.service.tileMatrixSet),
        }
      : {}),
  };
}

/** Les MOSAÏQUES déclarées, indexées par nom de corps du catalogue : la surface par défaut. */
export const SURFACE_TILESETS: ReadonlyMap<string, SurfaceTileset> = new Map(
  FICHES.filter((fiche) => !fiche.service.time && !fiche.variant).map(
    (fiche) => [fiche.body, toTileset(fiche)]
  )
);

/**
 * Les couches DATÉES (lot 48), indexées par corps : l'imagerie du jour de la scène, qu'un
 * réglage active et qui retombe sur la mosaïque de {@link SURFACE_TILESETS} pour tout jour que
 * la couche ne publie pas.
 */
export const DATED_SURFACE_TILESETS: ReadonlyMap<string, SurfaceTileset> =
  new Map(
    FICHES.filter((fiche) => fiche.service.time).map((fiche) => [
      fiche.body,
      toTileset(fiche),
    ])
  );

/** Fond de rechange d'un corps (lot 48), au vocabulaire fermé du schéma. */
export type SurfaceVariant = NonNullable<ImageryTilesetProduct['variant']>;

/**
 * Ce que le visiteur choisit pour le sol d'un corps : la mosaïque par défaut, la couche du jour
 * de la scène, ou un fond de rechange. Un choix que le corps ne propose pas retombe sur la
 * mosaïque : la Lune n'a pas de « lumières nocturnes », et le réglage vaut pour la Terre.
 */
export type SurfaceChoice = 'mosaic' | 'daily' | SurfaceVariant;

/**
 * Les fonds de rechange, par corps puis par variante : ses ÉDITIONS, dans l'ordre des années
 * (lot 50), ou une seule fiche pour un fond qui n'en a pas.
 */
export const SURFACE_VARIANTS: ReadonlyMap<
  string,
  ReadonlyMap<SurfaceVariant, readonly SurfaceTileset[]>
> = (() => {
  const byBody = new Map<string, Map<SurfaceVariant, SurfaceTileset[]>>();
  for (const fiche of FICHES) {
    if (!fiche.variant) continue;
    const variants = byBody.get(fiche.body) ?? new Map();
    variants.set(fiche.variant, [
      ...(variants.get(fiche.variant) ?? []),
      toTileset(fiche),
    ]);
    byBody.set(fiche.body, variants);
  }
  for (const variants of byBody.values())
    for (const editions of variants.values())
      editions.sort((a, b) => (a.edition ?? 0) - (b.edition ?? 0));
  return byBody;
})();

/**
 * L'ÉDITION À MONTRER à une date (lot 50) : la dernière dont l'année est au plus celle de la
 * scène, sinon la première. Une édition porte le nom de l'année de sa mosaïque, et ses données
 * peuvent déborder sur l'année d'avant (« data 2017 & 2018 » pour 2018) : c'est son NOM qui
 * décide, et le bandeau publie l'intervalle de ses données.
 *
 * Avant la première édition, la première, et après la dernière, la dernière : le bandeau dit
 * alors l'écart entre la scène et les images, comme pour toute mosaïque.
 */
export function editionFor(
  editions: readonly SurfaceTileset[],
  date: Date
): SurfaceTileset | undefined {
  const year = date.getUTCFullYear();
  let found = editions[0];
  for (const edition of editions)
    if ((edition.edition ?? Number.NEGATIVE_INFINITY) <= year) found = edition;
  return found;
}

/**
 * La couche datée FIGÉE sur un jour publié : `{Time}` résolu dans le gabarit, et l'intervalle
 * décrit ramené à ce seul jour, puisque c'est ce que l'image montre.
 *
 * Le jour doit venir de `core/timeDomain.ts::publishedDay`, jamais de la date de la scène
 * directement : un jour dans un trou rend 404 sans CORS. Un gabarit laissé avec `{Time}` est
 * refusé par `core/tileUrl.ts`, donc oublier cette étape échoue au lieu d'émettre.
 */
export function tilesetForDay(
  dated: SurfaceTileset,
  day: string
): SurfaceTileset {
  const from = Date.parse(`${day}T00:00:00Z`);
  return {
    ...dated,
    id: `${dated.id}@${day}`,
    service: {
      ...dated.service,
      template: dated.service.template.split('{Time}').join(day),
    },
    acquired: { from, to: from + 86_400_000 - 1000 },
    day,
  };
}

/**
 * L'ÉDITION COMPARÉE du rideau avant/après (lot 50, pas 2) : celle de l'année demandée, quand le
 * fond choisi est une série d'éditions qui la publie, et qu'elle n'est pas déjà celle qu'on
 * montre. Sinon `null` : pas de rideau, plutôt qu'un rideau entre deux images identiques.
 */
export function compareEdition(
  body: string,
  choice: SurfaceChoice,
  year: number | null,
  shown: SurfaceTileset | undefined,
  variants: ReadonlyMap<
    string,
    ReadonlyMap<SurfaceVariant, readonly SurfaceTileset[]>
  > = SURFACE_VARIANTS
): SurfaceTileset | null {
  if (year === null || choice === 'mosaic' || choice === 'daily') return null;
  const found = variants
    .get(body)
    ?.get(choice)
    ?.find((edition) => edition.edition === year);
  return found && found !== shown ? found : null;
}

/**
 * Produit daté d'une mosaïque, pour `classifyTemporal`.
 *
 * `kind: 'measurement'` : une mosaïque est un assemblage d'images prises par un capteur, sur
 * l'intervalle de sa campagne. Aucune tolérance d'écart n'est déclarée et aucune fenêtre
 * `measured` : la mosaïque est servie TELLE QUELLE quelle que soit la date de la scène, parce
 * qu'elle ne décrit pas cette date mais la surface. La catégorie rendue est donc `observed`, ce
 * qui est exactement ce que le bandeau doit dire.
 */
export function tilesetProduct(tileset: SurfaceTileset): DatedProduct {
  return { kind: 'measurement', validTime: tileset.acquired };
}

/**
 * Couche DATÉE (lot 48) : la date de la scène est relue à cette cadence, celle des couches
 * météo datées (`ui/datedTextureLayer.ts`, 500 ms). Relue à chaque image, une horloge rapide
 * changerait de jour soixante fois par seconde et ne laisserait aucune tuile arriver.
 */
export const DATED_RECHECK_MS = 500;

/**
 * Les jours publiés d'une couche datée en gagnent un chaque jour : la réponse DescribeDomains
 * est relue au plus une fois par heure, et un échec est retenté au même rythme.
 */
export const DOMAIN_MAX_AGE_MS = 3_600_000;

/**
 * LE JEU À ATTACHER, image après image : la MOSAÏQUE du corps, ou, couche datée demandée, cette
 * couche figée sur le jour de la scène quand ce jour est publié.
 *
 * Tout autre cas retombe sur la mosaïque, y compris tant que les jours publiés ne sont pas
 * lus : on ne demande jamais un jour qu'on n'a pas vu dans la réponse (404 sans CORS sinon).
 * Le même objet est rendu tant que le jour ne change pas, parce que le moteur compare les jeux
 * par IDENTITÉ : un objet neuf à chaque image le ferait changer de génération à chaque image.
 *
 * Vit ici et non dans `ui/surfacePanel.ts`, qui est du démarrage : ce choix ne sert qu'à
 * l'approche, et il pesait près de deux kilo-octets dans un budget qui en gardait 2,5.
 */
export function createDatedChooser(options: {
  date: () => Date;
  now?: () => number;
  fetchText?: (url: string) => Promise<string>;
  warn?: (message: string) => void;
  mosaics?: ReadonlyMap<string, SurfaceTileset>;
  dated?: ReadonlyMap<string, SurfaceTileset>;
  variants?: ReadonlyMap<
    string,
    ReadonlyMap<SurfaceVariant, readonly SurfaceTileset[]>
  >;
}): (body: string, choice: SurfaceChoice) => SurfaceTileset | undefined {
  const now = options.now ?? (() => performance.now());
  const fetchText =
    options.fetchText ??
    (async (url: string) => {
      const response = await fetch(url, { credentials: 'omit' });
      if (!response.ok) throw new Error(`jours publiés ${response.status}`);
      return response.text();
    });
  const warn = options.warn ?? ((message: string) => Logger.warn(message));
  const mosaics = options.mosaics ?? SURFACE_TILESETS;
  const datedSets = options.dated ?? DATED_SURFACE_TILESETS;
  const variantSets = options.variants ?? SURFACE_VARIANTS;

  const domains = new Map<
    string,
    { ranges: DayRange[] | null; at: number; loading: boolean }
  >();
  let chosen: {
    body: string;
    day: string | null;
    at: number;
    tileset: SurfaceTileset | undefined;
  } | null = null;

  return (body, choice) => {
    const base = mosaics.get(body);
    if (choice !== 'mosaic' && choice !== 'daily') {
      const editions = variantSets.get(body)?.get(choice);
      return (editions && editionFor(editions, options.date())) ?? base;
    }
    const dated = datedSets.get(body);
    if (choice !== 'daily' || !base || !dated?.domainsUrl) return base;
    const t = now();
    const known = domains.get(body);
    if (!known?.loading && (!known || t - known.at > DOMAIN_MAX_AGE_MS)) {
      const entry = { ranges: known?.ranges ?? null, at: t, loading: true };
      domains.set(body, entry);
      void fetchText(dated.domainsUrl)
        .then((xml) => {
          entry.ranges = parseDayDomain(xml);
        })
        .catch((error: unknown) =>
          warn(`[Surface] jours publiés illisibles : ${String(error)}`)
        )
        .finally(() => {
          entry.loading = false;
          entry.at = now();
        });
    }
    const ranges = domains.get(body)?.ranges;
    if (!ranges) return base;
    if (chosen?.body === body && t - chosen.at < DATED_RECHECK_MS)
      return chosen.tileset;
    const day = publishedDay(ranges, options.date());
    const tileset =
      chosen?.body === body && chosen.day === day
        ? chosen.tileset
        : day
          ? tilesetForDay(dated, day)
          : base;
    chosen = { body, day, at: t, tileset };
    return tileset;
  };
}
