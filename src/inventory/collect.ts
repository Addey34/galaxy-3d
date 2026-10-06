/**
 * L'INVENTAIRE DÉRIVÉ — ce que chaque corps a, et ce qu'il n'a pas, LU dans le dépôt.
 *
 * Ce module existe à cause d'une panne connue : `docs/private/ROADMAP.md` a menti une journée
 * entière parce qu'il RECOPIAIT un état. Un nombre recopié pourrit ; un nombre lu ne peut pas.
 * Tout ce qui sort d'ici vient donc d'une seule lecture : le catalogue reconstruit depuis les
 * fiches, le manifeste des éphémérides, le relevé des paliers de texture, les fiches de
 * produits, le résumé de validation, l'empreinte des documents générés, et les fichiers
 * présents sur le disque.
 *
 * **Il ne DÉCIDE rien, il décrit.** Aucun seuil, aucune priorité, aucun verdict de complétude :
 * la règle des paliers de texture vit dans `@/core/textureLadder`, celle des faits applicables
 * dans `@/core/bodyFacts`, et la file de travail vit dans `docs/private/VISION.md`
 * § « La file de travail », son seul propriétaire. Ce module les INTERROGE.
 *
 * Node seulement, comme `src/seo/` : jamais importé par l'application. Ses lecteurs sont
 * `scripts/inventory-gaps.mjs` (`pnpm inventory:gaps`) et `src/config/inventoryGaps.test.ts`.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import {
  flattenBodies,
  hasIllustrativeSurface,
  modelPath,
} from '@/config/catalog';
import { bodyDynamics } from '@/config/gravity';
import { NAVIGABLE_TARGETS } from '@/config/navigable';
import { SURFACE_TILESETS } from '@/config/surfaceTilesets';
import { SURFACE_HEIGHT_SETS } from '@/config/surfaceHeights';
import discoveryIndex from '@/config/discoveryIndex.json';
import missionIndex from '@/config/missionIndex.json';
import gazetteerIndex from '@/config/gazetteerIndex.json';
import placeObservationIndex from '@/config/placeObservationIndex.json';
import instrumentIndex from '@/config/instrumentIndex.json';
import { textureReviews } from '@/registry/products';
import {
  ALL_FACT_FIELDS,
  bodyFact,
  notApplicableFacts,
} from '@/core/bodyFacts';
import { resolveLadder, TIERS, type TierRefusal } from '@/core/textureLadder';
import { bodyPagePath } from '@/seo/bodyLandingPage';
import { LOCALES, type Locale } from '@/i18n/locales';
import type { CelestialBodyConfig, FactField, TextureQuality } from '@/types';

/** Ce qu'une famille de lignes peut porter. Une absence n'est un manque que si c'est applicable. */
export type Capability =
  | 'position'
  | 'texture'
  | 'shape'
  | 'tileset'
  | 'heightfield'
  | 'discovery'
  | 'moons'
  | 'missions'
  | 'instruments'
  | 'places'
  | 'facts'
  | 'page'
  | 'card';

export interface PositionState {
  /** Binaire Horizons livré, tel que le manifeste le déclare, ou `null`. */
  readonly binary: {
    readonly file: string;
    readonly center: string;
    readonly stepDays: number;
    readonly sampleCount: number;
    readonly meanMotionScale: number | null;
    readonly bytes: number | null;
    /**
     * Échantillons par révolution au pas livré, `periodDays / stepDays`. En dessous de 1 un
     * intervalle du fichier enjambe plusieurs tours, ce qui est exactement la condition qui rend
     * l'interpolation CONDITIONNELLE (`docs/ARCHITECTURE.md` § « Position d'un corps ») : la
     * propagation à deux corps prend alors la main. `null` quand le corps ne publie pas de
     * période orbitale.
     */
    readonly samplesPerRevolution: number | null;
    /**
     * Les SEGMENTS de ce corps (`segmentOf` au manifeste) : un fichier relatif à un autre corps,
     * au pas fin, qui prend la main sur sa couverture (BepiColombo autour de Mercure).
     */
    readonly segments: readonly {
      readonly id: string;
      readonly file: string;
      readonly center: string;
      readonly stepDays: number;
      readonly bytes: number | null;
    }[];
  } | null;
  /**
   * Les champs de position que porte la fiche, par leur NOM DE CHAMP et non par le nom d'une
   * source : `astroBody`, `relativeEphemeris`, `orbitalElements`,
   * `relativeOrbitalElements`. La règle qui choisit entre eux vit dans
   * `@/core/BodyPositionResolver` et ne se recopie pas ici.
   */
  readonly declares: readonly string[];
  /**
   * Écart médian et maximal à Horizons, en km, de la ligne `production` du résumé de
   * validation — c'est-à-dire de ce que l'application sert vraiment. À défaut de ligne
   * `production` (les objets d'instrument n'en ont pas : une seule source les mesure), l'écart
   * de cette source unique. `null` quand ce corps n'est pas une cible de validation
   * (`scripts/validation-targets.json`).
   */
  readonly medianKm: number | null;
  readonly maxKm: number | null;
  /**
   * L'écart de chaque source MESURÉE pour ce corps, du meilleur au pire, tel que le résumé
   * l'écrit. C'est la « raison mesurée » d'un corps sans binaire : elle se lit, elle ne
   * s'affirme pas.
   */
  readonly measured: readonly {
    readonly provider: string;
    readonly medianKm: number;
  }[];
}

export interface TextureLayerState {
  readonly layer: string;
  readonly shipped: readonly TextureQuality[];
  /**
   * Largeur de la source publiée, lue à son étiquette, ou `null` quand la fiche du produit n'en
   * déclare aucune. `null` ne veut PAS dire « illustrative » : la moitié des fiches ne déclare
   * pas cette largeur, et l'appartenance à `ILLUSTRATIVE_SURFACES` est le seul propriétaire de
   * cette question (voir `illustrativeSurface` sur la ligne).
   */
  readonly sourcePixelWidth: number | null;
  /** Pourquoi l'échelle s'arrête là : refus du palier juste au-dessus du plus haut livré. */
  readonly refusedAbove: TierRefusal | null;
}

export interface FactsState {
  readonly applicable: number;
  readonly sourced: number;
  /** Faits volontairement non publiés, avec une raison RÉDIGÉE dans la fiche. */
  readonly reasoned: number;
  /** Faits que la simulation porte mais qu'aucune source primaire ne rattache encore. */
  readonly unsourced: readonly FactField[];
  /** Faits applicables dont la fiche ne porte ni valeur ni raison. */
  readonly missing: readonly FactField[];
}

export interface InventoryRow {
  readonly id: string;
  readonly family: 'body' | 'spacecraft' | 'interstellar';
  readonly kind: string;
  readonly parent: string | null;
  /** Rayon publié, en km, LU par `bodyFact` ; `null` quand la fiche n'en publie pas. */
  readonly radiusKm: number | null;
  /** Les capacités qui s'appliquent à cette ligne — une absence hors de là n'est pas un manque. */
  readonly applicable: readonly Capability[];
  readonly position: PositionState;
  readonly textures: readonly TextureLayerState[];
  /** Surface illustrative, d'après `ILLUSTRATIVE_SURFACES` de `@/config/catalog`. */
  readonly illustrativeSurface: boolean;
  /**
   * La DATE à laquelle l'absence de mosaïque a été revérifiée, LUE dans la raison écrite de la
   * fiche de surface. Une absence de source n'est pas éternelle : une mission passe, une mosaïque
   * est publiée, et la raison d'hier devient le mensonge d'aujourd'hui. `null` quand la fiche
   * n'en porte pas — ce que `src/config/illustrativeSurfaces.test.ts` interdit.
   */
  readonly illustrativeVerified: string | null;
  readonly shape: {
    readonly resolutions: readonly string[];
    readonly missingFiles: readonly string[];
  } | null;
  readonly tileset: {
    readonly id: string;
    readonly maxLevel: number;
    readonly publishedPixelsPerDegree: number;
  } | null;
  readonly heightfield: { readonly id: string } | null;
  /**
   * Combien de missions le registre de contexte du PDS déclare sur ce corps (lot 40), ou `null`
   * quand l'index n'a pas d'entrée pour lui. `0` est une réponse, pas une absence.
   */
  readonly missions: number | null;
  /**
   * Combien d'affirmations de découverte les sources primaires déclarent sur ce corps (lot 44).
   * Trois valeurs, et la troisième seule est un manque : un nombre ; `'sans-objet'` quand la
   * question n'a pas de sens et que la raison est écrite dans `scripts/discovery-targets.json`
   * (le Soleil, la Terre) ; `null` quand le corps n'est pas dans l'index, signe que
   * `pnpm discovery:generate` n'a pas été relancé.
   */
  readonly discovery: number | 'sans-objet' | null;
  /**
   * La liste des satellites d'un corps dont la fiche affiche au moins une lune (ligne 22.10,
   * pas 2), d'où vient le compte des lunes déjà vues à une date. Trois valeurs : la liste et sa
   * source (la table du JPL, ou SBDB pour un petit corps) ; `'sans-objet'` quand une raison est
   * écrite dans `satellitesNotCovered` de `scripts/discovery-targets.json` (la Terre) ; `null`,
   * le seul manque, quand ni l'une ni l'autre n'existe.
   */
  readonly moons:
    { readonly total: number; readonly source: string } | 'sans-objet' | null;
  /**
   * Les formations nommées que l'Orbital Data Explorer déclare observées (ligne 40.3). Trois
   * valeurs : un couple quand le corps est couvert et tiré en entier ; `'non-couvert'` quand
   * l'ODE ne couvre pas ce corps, ce qui est une MESURE écrite dans `docs/ARCHITECTURE.md` et
   * non un trou ; `null` quand le corps est couvert mais que son tirage est incomplet.
   */
  readonly places:
    { observed: number; formations: number } | 'non-couvert' | null;
  /**
   * Combien d'INSTRUMENTS le registre de contexte du PDS déclare sur cette sonde (lot 42).
   *
   * Trois valeurs, et la troisième seule est un manque : un nombre quand la sonde est jointe à
   * l'archive ; `'absent-de-l-archive'` quand le registre n'en déclare RIEN et que la raison est
   * écrite dans `scripts/pds-archive-targets.json` (Parker Solar Probe, JWST), ce qui est une
   * mesure et non un trou ; `null` quand la sonde n'est NI l'un NI l'autre, signe que
   * `pnpm instruments:generate` n'a pas été relancé.
   */
  readonly instruments: number | 'absent-de-l-archive' | null;
  readonly facts: FactsState;
  readonly page: { readonly locales: readonly Locale[] };
  readonly card: boolean;
  /** Capacités applicables dont aucun artefact n'existe. Une description, pas un verdict. */
  readonly absent: readonly Capability[];
}

export interface Inventory {
  /** D'où viennent ces nombres, pour qu'une sortie citée quelque part reste retrouvable. */
  readonly sources: {
    readonly ephemerisManifest: string;
    readonly textureLadderMeasuredAt: string;
    readonly validationGeneratedAt: string;
    readonly fingerprintDocuments: number;
  };
  readonly rows: readonly InventoryRow[];
}

interface ManifestEntry {
  file: string;
  center: string;
  stepDays: number;
  sampleCount: number;
  meanMotionScale?: number;
  segmentOf?: string;
}

interface LadderRow {
  body: string;
  layer: string;
  shipped: TextureQuality[];
  detail: Partial<Record<TextureQuality, number>>;
}

interface ValidationRow {
  body: string;
  provider: string;
  /** `null` quand la fenêtre n'a produit aucun échantillon (source hors de sa couverture). */
  km: { median: number; max: number } | null;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** `normal_map` côté fichier devient `normalMap` côté catalogue (même règle que le relevé). */
function camel(layer: string): string {
  return layer.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Les champs de position que la fiche DÉCLARE, nommés comme les champs du catalogue.
 *
 * Volontairement pas « la source qui place ce corps » : cette règle vit une seule fois, dans
 * `@/core/BodyPositionResolver`, et la rejouer ici demanderait d'instancier les services (donc
 * le réseau). Ce que ce module peut dire sans rien décider, c'est ce que le dépôt CONTIENT ; ce
 * que l'application en fait est mesuré par la ligne `production` du résumé de validation.
 */
function declaresOf(cfg: CelestialBodyConfig): string[] {
  const out: string[] = [];
  if (cfg.astroBody !== undefined) out.push('astroBody');
  if (cfg.relativeEphemeris)
    out.push(`relativeEphemeris:${cfg.relativeEphemeris.kind}`);
  if (cfg.orbitalElements) out.push('orbitalElements');
  if (cfg.relativeOrbitalElements) out.push('relativeOrbitalElements');
  return out;
}

function positionOf(
  id: string,
  cfg: CelestialBodyConfig,
  manifest: Record<string, ManifestEntry>,
  validation: readonly ValidationRow[],
  ephemerisDir: string,
  periodDays: number | undefined
): PositionState {
  const entry = manifest[id];
  const own = validation.filter((row) => row.body === id);
  const production = own.filter(
    (row) => row.provider === 'production' && row.km !== null
  );
  const binaryPath = entry ? join(ephemerisDir, entry.file) : null;
  const best = new Map<string, number>();
  for (const row of own) {
    if (row.provider === 'production' || row.km === null) continue;
    const current = best.get(row.provider);
    if (current === undefined || row.km.median < current)
      best.set(row.provider, row.km.median);
  }
  // Un objet d'instrument n'a pas de ligne `production` : une seule source le mesure, et c'est
  // celle-là qui décrit ce que l'application sert.
  const servedRows =
    production.length > 0
      ? production
      : best.size === 1
        ? own.filter((row) => row.km !== null)
        : [];
  return {
    binary: entry
      ? {
          file: entry.file,
          center: entry.center,
          stepDays: entry.stepDays,
          sampleCount: entry.sampleCount,
          meanMotionScale: entry.meanMotionScale ?? null,
          bytes:
            binaryPath !== null && existsSync(binaryPath)
              ? statSync(binaryPath).size
              : null,
          samplesPerRevolution:
            periodDays === undefined ? null : periodDays / entry.stepDays,
          segments: Object.entries(manifest)
            .filter(([, other]) => other.segmentOf === id)
            .map(([segmentId, segment]) => {
              const path = join(ephemerisDir, segment.file);
              return {
                id: segmentId,
                file: segment.file,
                center: segment.center,
                stepDays: segment.stepDays,
                bytes: existsSync(path) ? statSync(path).size : null,
              };
            }),
        }
      : null,
    declares: declaresOf(cfg),
    medianKm: servedRows.length
      ? Math.max(...servedRows.map((row) => row.km!.median))
      : null,
    maxKm: servedRows.length
      ? Math.max(...servedRows.map((row) => row.km!.max))
      : null,
    measured: [...best]
      .map(([provider, medianKm]) => ({ provider, medianKm }))
      .sort((a, b) => a.medianKm - b.medianKm),
  };
}

/**
 * LA DERNIÈRE DATE citée par la raison écrite de la surface. La plus RÉCENTE, parce qu'une fiche
 * revérifiée garde sa vérification d'origine et ajoute la nouvelle : c'est la dernière qui dit
 * depuis quand l'absence est tenue pour vraie.
 */
function illustrativeVerifiedOn(id: string): string | null {
  const note =
    textureReviews().find(
      (review) => review.body === id && camel(review.layer) === 'surface'
    )?.note ?? '';
  const dates = note.match(/\b20\d\d-\d\d-\d\d\b/g);
  return dates ? dates.sort().at(-1)! : null;
}

function texturesOf(
  id: string,
  cfg: CelestialBodyConfig,
  ladder: readonly LadderRow[]
): TextureLayerState[] {
  const rows = ladder.filter((row) => row.body === id);
  const layers = new Set<string>([
    ...Object.keys(cfg.textureResolutions),
    ...rows.map((row) => camel(row.layer)),
  ]);
  const reviews = textureReviews();
  return [...layers].sort().map((layer) => {
    const row = rows.find((candidate) => camel(candidate.layer) === layer);
    const sourcePixelWidth =
      reviews.find(
        (review) => review.body === id && camel(review.layer) === layer
      )?.sourcePixelWidth ?? null;
    const shipped = row?.shipped ?? [];
    const verdict = resolveLadder({
      sourcePixelWidth,
      detailByTier: row?.detail ?? {},
    });
    const above = TIERS[shipped.length];
    return {
      layer,
      shipped,
      sourcePixelWidth,
      refusedAbove: above ? (verdict.refused[above] ?? null) : null,
    };
  });
}

/** Le rayon publié, s'il l'est : lu par `bodyFact`, jamais dans le champ brut. */
function radiusOf(cfg: CelestialBodyConfig): number | null {
  const entry = bodyFact(cfg, 'radiusKm');
  return entry.status === 'value' && entry.value.kind === 'number'
    ? entry.value.value
    : null;
}

function factsOf(cfg: CelestialBodyConfig): FactsState {
  const notApplicable = notApplicableFacts(cfg);
  const applicable = ALL_FACT_FIELDS.filter(
    (field) => !notApplicable.has(field)
  );
  let sourced = 0;
  let reasoned = 0;
  const unsourced: FactField[] = [];
  const missing: FactField[] = [];
  for (const field of applicable) {
    const entry = bodyFact(cfg, field);
    if (entry.status === 'value') sourced++;
    else if (entry.status === 'unknown') {
      if (entry.reason.unsourced === true) unsourced.push(field);
      else reasoned++;
    } else missing.push(field);
  }
  return {
    applicable: applicable.length,
    sourced,
    reasoned,
    unsourced,
    missing,
  };
}

function shapeOf(
  id: string,
  cfg: CelestialBodyConfig,
  root: string
): InventoryRow['shape'] {
  const resolutions = cfg.model?.resolutions;
  if (!resolutions) return null;
  return {
    resolutions,
    missingFiles: resolutions
      .map((quality) => modelPath(id, quality))
      .filter((path) => !existsSync(join(root, 'public', path))),
  };
}

/**
 * Les capacités applicables à une ligne, DÉCLARÉES par famille plutôt que déduites d'une
 * absence : sans cela, un corps sans modèle de forme et un corps qui n'en a pas besoin se
 * liraient pareil.
 *
 * - `shape` ne s'applique qu'à un corps qui DÉCLARE un modèle : une sphère est la bonne forme
 *   d'une planète, et exiger un maillage de Jupiter serait un faux manque. Les corps
 *   irréguliers qui n'en ont pas encore sont une ligne de la file, pas un champ d'ici.
 * - `tileset` et `heightfield` idem : ce module dit qui en a un, la file dit pour qui une
 *   source existe.
 * - un objet d'instrument (sonde, interstellaire) n'a ni surface ni forme : l'invariant Explo
 *   (`CLAUDE.md`), pas un manque. Il a en revanche sa PAGE et sa VIGNETTE depuis le 2026-10-03
 *   (`src/seo/instrumentLandingPage.ts`), donc elles lui sont applicables : leur absence serait
 *   désormais un vrai manque, et la règle de parité veut qu'il se voie ici.
 * - le fond d'étoiles n'est pas un corps : il n'a qu'une texture. Ni position (il ne bouge
 *   pas), ni faits, ni page, ni vignette.
 * - le Soleil et le fond d'étoiles ne sont pas des cibles de validation
 *   (`scripts/validation-targets.json`) : le Soleil est l'origine de la scène héliocentrique.
 */
function applicableOf(
  family: InventoryRow['family'],
  cfg: CelestialBodyConfig,
  id: string
): Capability[] {
  // `instruments` n'est applicable qu'à une SONDE : un corps n'embarque rien, et un objet
  // interstellaire pas davantage. Le rendre applicable partout ferait compter 58 manques qui
  // n'existent pas.
  if (family === 'spacecraft')
    return ['position', 'facts', 'instruments', 'page', 'card'];
  if (family !== 'body') return ['position', 'facts', 'page', 'card'];
  if (cfg.kind === 'skybox') return ['texture'];
  const out: Capability[] = ['facts', 'page', 'card'];
  if (cfg.kind !== 'star') out.push('position');
  if (Object.keys(cfg.textureResolutions).length > 0) out.push('texture');
  if (cfg.model) out.push('shape');
  if (SURFACE_TILESETS.has(id)) out.push('tileset');
  if (SURFACE_HEIGHT_SETS.has(id)) out.push('heightfield');
  // `missions` s'applique à TOUT corps, y compris ceux où rien n'est allé : zéro mission n'est
  // pas un manque, c'est une mesure (aucune archive ne déclare Éris parmi ses cibles), et la
  // fiche le DIT. Ce qui serait un manque, c'est l'absence d'ENTRÉE dans l'index, signe que
  // `pnpm missions:generate` n'a pas été relancé après l'ajout d'un corps.
  out.push('missions');
  // `discovery` aussi : un corps sans découverte datée doit le DIRE (le Soleil, la Terre), sinon
  // l'absence d'entrée serait indiscernable d'un générateur pas relancé.
  out.push('discovery');
  // `moons` s'applique à tout corps dont la fiche affiche au moins une lune : sans lune, il n'y a
  // rien à compter à une date.
  if ((cfg.realData?.moonCount ?? 0) > 0) out.push('moons');
  // `places` s'applique à tout corps qui porte des noms de l'UAI : sans nom, rien à observer.
  if (id in gazetteerIndex.bodies) out.push('places');
  return out;
}

export function collectInventory(root: string): Inventory {
  const ephemerisDir = join(root, 'public/assets/ephemerides');
  const manifest = readJson<{
    generatedAt: string;
    bodies: Record<string, ManifestEntry>;
  }>(join(ephemerisDir, 'manifest.json'));
  const ladder = readJson<{ measuredAt: string; rows: LadderRow[] }>(
    join(root, 'src/config/textureLadder.json')
  );
  const validation = readJson<{ generatedAt: string; rows: ValidationRow[] }>(
    join(root, 'src/config/horizons-validation-summary.json')
  );
  const fingerprint = readJson<{ documents: Record<string, string> }>(
    join(root, 'src/seo/generated-fingerprint.json')
  );
  const documents = new Set(Object.keys(fingerprint.documents));
  const discoveryTargets = readJson<{
    satellitesNotCovered?: Record<string, string>;
  }>(join(root, 'scripts/discovery-targets.json'));

  const flat = flattenBodies(CELESTIAL_CONFIG);
  const dynamics = bodyDynamics(CELESTIAL_CONFIG);
  const parentOf = new Map<string, string>();
  for (const [name, cfg] of Object.entries(CELESTIAL_CONFIG.bodies))
    for (const satellite of Object.keys(cfg.satellites ?? {}))
      parentOf.set(satellite, name);

  type Entry = [string, CelestialBodyConfig, InventoryRow['family']];
  const entries: Entry[] = [
    ...[...flat].map(([id, cfg]): Entry => [id, cfg, 'body']),
    ...[...NAVIGABLE_TARGETS].map(([id, cfg]): Entry => [
      id,
      cfg,
      cfg.kind === 'spacecraft' ? 'spacecraft' : 'interstellar',
    ]),
  ];

  const rows = entries.map(([id, cfg, family]): InventoryRow => {
    const applicable = applicableOf(family, cfg, id);
    const position = positionOf(
      id,
      cfg,
      manifest.bodies,
      validation.rows,
      ephemerisDir,
      dynamics[id]?.periodDays
    );
    const textures = applicable.includes('texture')
      ? texturesOf(id, cfg, ladder.rows)
      : [];
    const shape = shapeOf(id, cfg, root);
    const tileset = SURFACE_TILESETS.get(id);
    const heightfield = SURFACE_HEIGHT_SETS.get(id);
    const missions = applicable.includes('missions')
      ? ((missionIndex.bodies as Record<string, { count: number } | undefined>)[
          id
        ]?.count ?? null)
      : null;
    const discoveryEntry = (
      discoveryIndex.bodies as Record<
        string,
        { claims?: unknown[]; notApplicable?: boolean } | undefined
      >
    )[id];
    const discovery = !applicable.includes('discovery')
      ? null
      : discoveryEntry?.notApplicable
        ? ('sans-objet' as const)
        : (discoveryEntry?.claims?.length ?? null);
    const system = (
      discoveryIndex.systems as Record<
        string,
        { total: number; source: string } | undefined
      >
    )[id];
    const moons = !applicable.includes('moons')
      ? null
      : system
        ? { total: system.total, source: system.source }
        : discoveryTargets.satellitesNotCovered?.[id]
          ? ('sans-objet' as const)
          : null;
    const placeCover = (
      placeObservationIndex.bodies as Record<
        string,
        | { observed: number; formations: number; missingPages?: number }
        | undefined
      >
    )[id];
    const places = !applicable.includes('places')
      ? null
      : !placeCover
        ? ('non-couvert' as const)
        : placeCover.missingPages
          ? null
          : {
              observed: placeCover.observed,
              formations: placeCover.formations,
            };
    const instruments = applicable.includes('instruments')
      ? ((
          instrumentIndex.spacecraft as Record<
            string,
            { instruments: number } | undefined
          >
        )[id]?.instruments ??
        (id in instrumentIndex.absent ? 'absent-de-l-archive' : null))
      : null;
    const facts = factsOf(cfg);
    const locales = applicable.includes('page')
      ? LOCALES.filter((locale) =>
          documents.has(`${bodyPagePath(id, locale)}/index.html`)
        )
      : [];
    const card = documents.has(`social/${id}.jpg`);

    const absent: Capability[] = [];
    if (applicable.includes('position') && position.medianKm === null)
      absent.push('position');
    if (
      applicable.includes('texture') &&
      textures.every((layer) => layer.shipped.length === 0)
    )
      absent.push('texture');
    if (applicable.includes('shape') && shape === null) absent.push('shape');
    if (applicable.includes('tileset') && tileset === undefined)
      absent.push('tileset');
    if (applicable.includes('heightfield') && heightfield === undefined)
      absent.push('heightfield');
    if (applicable.includes('missions') && missions === null)
      absent.push('missions');
    if (applicable.includes('discovery') && discovery === null)
      absent.push('discovery');
    if (applicable.includes('moons') && moons === null) absent.push('moons');
    // Une sonde dont l'archive ne déclare rien n'est PAS un manque : la raison est écrite et
    // mesurée. Le manque, c'est de n'être ni jointe ni déclarée absente.
    if (applicable.includes('instruments') && instruments === null)
      absent.push('instruments');
    if (applicable.includes('places') && places === null) absent.push('places');
    if (
      applicable.includes('facts') &&
      (facts.unsourced.length > 0 || facts.missing.length > 0)
    )
      absent.push('facts');
    if (applicable.includes('page') && locales.length < LOCALES.length)
      absent.push('page');
    if (applicable.includes('card') && !card) absent.push('card');

    return {
      id,
      family,
      kind: cfg.kind,
      parent: parentOf.get(id) ?? null,
      radiusKm: radiusOf(cfg),
      applicable,
      position,
      textures,
      illustrativeSurface: hasIllustrativeSurface(id),
      illustrativeVerified: hasIllustrativeSurface(id)
        ? illustrativeVerifiedOn(id)
        : null,
      shape,
      tileset: tileset
        ? {
            id: tileset.id,
            maxLevel: tileset.maxLevel,
            publishedPixelsPerDegree: tileset.publishedPixelsPerDegree,
          }
        : null,
      heightfield: heightfield ? { id: heightfield.id } : null,
      missions,
      discovery,
      moons,
      places,
      instruments,
      facts,
      page: { locales },
      card,
      absent,
    };
  });

  return {
    sources: {
      ephemerisManifest: manifest.generatedAt,
      textureLadderMeasuredAt: ladder.measuredAt,
      validationGeneratedAt: validation.generatedAt,
      fingerprintDocuments: documents.size,
    },
    rows,
  };
}
