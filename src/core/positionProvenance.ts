/**
 * PROVENANCE TEMPORELLE D'UNE POSITION : quelle source a placé ce corps à cette date, ce que
 * cela veut dire dans le modèle temporel (`core/temporal.ts`), et quel écart à JPL Horizons a
 * été MESURÉ autour de cette date. Module PUR : lignes de validation en entrée, rien lu ici.
 *
 * La même position peut changer de nature avec la date, sans que rien ne se voie à l'écran :
 * Encelade vient d'un binaire Horizons sur sa couverture, puis de ses éléments képlériens de
 * repli au-delà. `BodyPositionResolver.resolveSource` dit laquelle a répondu ; ce module en
 * tire la catégorie et l'écart mesuré.
 *
 * Deux sources ne peuvent pas « extrapoler » :
 *   - un binaire Horizons ou un noyau SPK EST la référence échantillonnée : hors de sa
 *     couverture il ne répond pas, et c'est une autre source qui prend le relais ;
 * Deux autres calculent à n'importe quelle date, et c'est là que l'étiquette compte :
 *   - astronomy-engine et les éléments képlériens : hors de toute fenêtre où leur écart à
 *     Horizons a été mesuré (`pnpm ephemeris:validate`), la position est `extrapolated`.
 *     Aucune ligne mesurée : extrapolée partout, car rien n'établit son exactitude.
 *
 * « Mesuré » ne veut pas dire « exact » : les éléments képlériens d'Hygie sur 1900-2100 sont
 * mesurés, à des dizaines de millions de km (ils ne servent plus qu'en repli depuis le lot 11). C'est pourquoi l'écart est affiché à côté de la catégorie, jamais caché dedans.
 */
import { DAY_MS, type DatedProduct, type OpenInterval } from './temporal';
import { POSITION_PROVIDERS, answersAnyDate } from '@/registry/providers';

/** Source qui a effectivement produit une position (règle de `BodyPositionResolver`). */
export type PositionSource = 'horizons' | 'spk' | 'astronomy-engine' | 'kepler';

/**
 * Tolérance de « en direct » : la scène à ±5 min du présent. Même seuil que la pastille du
 * panneau temps (`ui/timePanel.ts`), qui l'importe d'ici.
 */
export const LIVE_TOLERANCE_MS = 5 * 60_000;

/** Ligne du résumé de validation, réduite à ce que ce module lit. */
export interface AccuracyRow {
  body: string;
  provider: string;
  windowFrom: string;
  windowTo: string;
  relative: boolean;
  n: number;
  km: { mean: number | null } | null;
}

/**
 * Nom de chaque source dans le résumé écrit par `scripts/validate-against-horizons.mjs`, LU
 * dans le registre des fournisseurs (`src/registry/providers/*.json`, champ
 * `validationProviderId`) : une seule table, deux lecteurs. Le type impose les quatre clés, donc
 * une source de position sans fiche ne compile pas.
 */
export const SUMMARY_PROVIDER: Record<PositionSource, string> = {
  horizons: POSITION_PROVIDERS.horizons.validationProviderId,
  spk: POSITION_PROVIDERS.spk.validationProviderId,
  'astronomy-engine':
    POSITION_PROVIDERS['astronomy-engine'].validationProviderId,
  kepler: POSITION_PROVIDERS.kepler.validationProviderId,
};

/** Fenêtre où l'écart d'une source à Horizons a été mesuré, et son écart moyen. */
export interface MeasuredWindow {
  from: number;
  /** Fin incluse : le jour `windowTo` entier. */
  to: number;
  meanKm: number;
}

/**
 * Fenêtres mesurées d'une source pour un corps. `relative` : un satellite est jugé sur sa
 * position autour de son parent, pas sur une position héliocentrique dominée par l'erreur du
 * parent (la Lune : 11 km relatifs, 900 km héliocentriques). On ne mélange jamais les deux.
 */
export function measuredWindows(
  rows: readonly AccuracyRow[],
  body: string,
  source: PositionSource,
  relative: boolean
): MeasuredWindow[] {
  const provider = SUMMARY_PROVIDER[source];
  return rows
    .filter(
      (r) =>
        r.body === body &&
        r.provider === provider &&
        r.relative === relative &&
        r.n > 0 &&
        r.km?.mean != null
    )
    .map((r) => ({
      from: Date.parse(`${r.windowFrom}T00:00:00Z`),
      to: Date.parse(`${r.windowTo}T00:00:00Z`) + DAY_MS,
      meanKm: r.km!.mean!,
    }));
}

/** Aucune fenêtre mesurée : tout instant est hors de la fenêtre. */
const NEVER_MEASURED: OpenInterval = {
  from: Number.POSITIVE_INFINITY,
  to: Number.NEGATIVE_INFINITY,
};

/**
 * Sources qui répondent à toute date, donc qui peuvent sortir de leur fenêtre mesurée. Lu dans la
 * couverture déclarée par la fiche du fournisseur : au sens STAC, des bornes nulles des deux côtés
 * veulent dire « pas de borne ». Une fiche sans couverture déclarée (le noyau SPK, dont chaque
 * segment porte la sienne) n'est pas illimitée pour autant.
 */
function computesAnyDate(source: PositionSource): boolean {
  return answersAnyDate(POSITION_PROVIDERS[source]);
}

/** La donnée « position de ce corps à cette date », pour `classifyTemporal`. */
export function positionProduct(
  source: PositionSource,
  date: Date,
  windows: readonly MeasuredWindow[]
): DatedProduct {
  const instant = date.getTime();
  const product: DatedProduct = {
    kind: 'ephemeris',
    validTime: { from: instant, to: instant },
    liveToleranceMs: LIVE_TOLERANCE_MS,
  };
  if (computesAnyDate(source)) {
    product.measured =
      windows.length === 0
        ? NEVER_MEASURED
        : {
            from: Math.min(...windows.map((w) => w.from)),
            to: Math.max(...windows.map((w) => w.to)),
          };
  }
  return product;
}

/**
 * L'écart mesuré qui décrit le mieux cette date : la fenêtre la plus ÉTROITE qui la contient
 * (une fenêtre de ±10 ans autour de l'époque des éléments dit mieux 2026 que la moyenne sur
 * deux siècles). `null` hors de toute fenêtre.
 */
export function measuredErrorAt(
  windows: readonly MeasuredWindow[],
  date: Date
): MeasuredWindow | null {
  const t = date.getTime();
  let best: MeasuredWindow | null = null;
  for (const w of windows) {
    if (t < w.from || t > w.to) continue;
    if (!best || w.to - w.from < best.to - best.from) best = w;
  }
  return best;
}
