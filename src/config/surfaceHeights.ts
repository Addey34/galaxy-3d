/**
 * FAÇADE D'EXÉCUTION des jeux de hauteurs (lot 9, phase 9D).
 *
 * Même rôle que `config/surfaceTilesets.ts` pour l'imagerie : le registre est de la DONNÉE
 * (`src/registry/products/heightfields/*.json`), ce module est ce que l'application en lit, et
 * il n'est chargé qu'à l'approche d'une surface.
 *
 * La fiche ne porte que l'identité et les droits. Tout ce qui se MESURE — quantum, offset,
 * rayon de référence du modèle, couverture, altitudes extrêmes, répertoire haché — vit dans le
 * manifeste écrit par `pnpm surface:tiles` et chargé ici, une fois, à l'approche. C'est la même
 * séparation que pour les éphémérides : la fiche déclare, le manifeste mesure.
 *
 * Le manifeste est VALIDÉ à la lecture, champ par champ. Ce n'est pas de la méfiance envers nos
 * propres octets : `firebase.json` réécrit toute adresse inconnue vers `/index.html`, donc un
 * fichier absent revient en HTTP 200 avec une page HTML, et un cache de service worker périmé
 * peut rendre une forme d'hier.
 */
import type { HeightfieldSetProduct } from '@/registry/schema/product';
import type { HeightCoverageEntry } from '@/core/heightPyramid';
import type { DatedProduct, TimeInterval } from '@/core/temporal';

const asHeightfield = (record: unknown): HeightfieldSetProduct =>
  record as HeightfieldSetProduct;

const FICHES = Object.values(
  import.meta.glob('../registry/products/heightfields/*.json', {
    eager: true,
    import: 'default',
  })
).map(asHeightfield);

/** Ce que le moteur et le bandeau lisent d'un jeu de hauteurs. */
export interface SurfaceHeightSet {
  id: string;
  body: string;
  title: string;
  mission: string;
  instrument: string;
  /** Chemin publié du manifeste, relatif à la racine du site. */
  manifestPath: string;
  /** Intervalle d'acquisition déclaré par l'étiquette de la source. */
  acquired: TimeInterval;
  /** Crédit à afficher, tiré des `providers[]` STAC de la fiche. */
  credit: string;
}

/** Le manifeste écrit par le cuiseur, tel que l'exécution l'emploie. */
export interface HeightManifest {
  /** Répertoire publié des tuiles, haché par le contenu. */
  directory: string;
  /** Échantillons par côté d'une tuile (registre grille). */
  samples: number;
  quantumMetres: number;
  offsetMetres: number;
  /** Rayon de la sphère de référence du modèle d'élévation, en kilomètres. */
  datumRadiusKm: number;
  coverage: HeightCoverageEntry[];
  /** Altitudes extrêmes MESURÉES sur les tuiles cuites, en mètres. */
  minElevationMetres: number;
  maxElevationMetres: number;
  /** Niveau du socle global. */
  baseLevel: number;
}

function toSet(fiche: HeightfieldSetProduct): SurfaceHeightSet {
  const [from, to] = fiche.acquired.interval[0]!;
  return {
    id: fiche.id,
    body: fiche.body,
    title: fiche.title,
    mission: fiche.mission,
    instrument: fiche.instrument,
    manifestPath: fiche.manifest,
    acquired: { from: Date.parse(from!), to: Date.parse(to!) },
    credit: fiche.providers.map((provider) => provider.name).join(' · '),
  };
}

/** Les jeux de hauteurs déclarés, indexés par nom de corps du catalogue. */
export const SURFACE_HEIGHT_SETS: ReadonlyMap<string, SurfaceHeightSet> =
  new Map(FICHES.map((fiche) => [fiche.body, toSet(fiche)]));

/**
 * Produit daté d'un jeu de hauteurs, pour `classifyTemporal`.
 *
 * Comme une mosaïque : une mesure sur l'intervalle de sa campagne d'acquisition. Le relief
 * d'un corps ne décrit pas la date de la scène, et la catégorie rendue est donc `observed`
 * quelle que soit cette date.
 */
export function heightSetProduct(set: SurfaceHeightSet): DatedProduct {
  return { kind: 'measurement', validTime: set.acquired };
}

/** Adresse publiée d'une tuile de hauteurs. */
export function heightTilePath(
  manifest: HeightManifest,
  index: { level: number; row: number; column: number }
): string {
  return `/${manifest.directory}/${index.level}/${index.row}/${index.column}.hgt`;
}

interface RawManifest {
  directory?: unknown;
  format?: { samples?: unknown };
  quantumMetres?: unknown;
  offsetMetres?: unknown;
  datumRadiusKm?: unknown;
  baseLevel?: unknown;
  coverage?: unknown;
  elevationMetres?: { minimum?: unknown; maximum?: unknown };
}

/**
 * Lit et vérifie un manifeste. Tout champ absent ou aberrant fait ÉCHOUER la lecture : sans
 * hauteurs l'application garde ses carreaux plats, ce qui est une dégradation honnête, alors
 * qu'un manifeste à moitié lu placerait du relief faux.
 */
export function parseHeightManifest(raw: unknown): HeightManifest {
  const data = (raw ?? {}) as RawManifest;
  const number = (value: unknown, name: string, minimum: number): number => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum)
      throw new Error(
        `manifeste de hauteurs : ${name} invalide (${String(value)})`
      );
    return value;
  };
  const directory = data.directory;
  if (typeof directory !== 'string' || !directory.startsWith('assets/'))
    throw new Error(
      `manifeste de hauteurs : répertoire invalide (${String(directory)})`
    );
  if (!Array.isArray(data.coverage) || data.coverage.length === 0)
    throw new Error('manifeste de hauteurs : couverture vide');

  const coverage: HeightCoverageEntry[] = data.coverage.map((entry, rank) => {
    const record = entry as {
      level?: unknown;
      levels?: unknown;
      global?: unknown;
      bounds?: unknown;
    };
    const levels = Array.isArray(record.levels)
      ? (record.levels as unknown[]).map((level) =>
          number(level, `couverture ${rank} : niveau`, 0)
        )
      : [number(record.level, `couverture ${rank} : niveau`, 0)];
    if (record.global === true) return { levels };
    const bounds = record.bounds as
      | { west?: unknown; east?: unknown; south?: unknown; north?: unknown }
      | undefined;
    if (!bounds)
      throw new Error(
        `manifeste de hauteurs : couverture ${rank} sans emprise et non globale`
      );
    const name = (entry as { area?: { name?: unknown } }).area?.name;
    return {
      levels,
      ...(typeof name === 'string' ? { areaName: name } : {}),
      bounds: {
        west: number(bounds.west, `couverture ${rank} : ouest`, -180),
        east: number(bounds.east, `couverture ${rank} : est`, -180),
        south: number(bounds.south, `couverture ${rank} : sud`, -90),
        north: number(bounds.north, `couverture ${rank} : nord`, -90),
      },
    };
  });

  const samples = number(data.format?.samples, 'échantillons', 2);
  const elevation = data.elevationMetres ?? {};
  return {
    directory,
    samples,
    quantumMetres: number(data.quantumMetres, 'quantum', Number.MIN_VALUE),
    offsetMetres:
      typeof data.offsetMetres === 'number' &&
      Number.isFinite(data.offsetMetres)
        ? data.offsetMetres
        : 0,
    datumRadiusKm: number(data.datumRadiusKm, 'rayon de référence', 1),
    coverage,
    minElevationMetres: number(elevation.minimum, 'altitude minimale', -1e6),
    maxElevationMetres: number(elevation.maximum, 'altitude maximale', -1e6),
    baseLevel: number(data.baseLevel, 'niveau du socle', 0),
  };
}
