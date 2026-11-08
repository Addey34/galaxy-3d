/**
 * SYNTHÈSE D'UNE FENÊTRE D'ATTENTE DU CALME (diagnostic de `surfaceImageryEarth.spec.ts:641`).
 *
 * `waitForCalmMainThread` observe chaque image dans la page et la note en texte
 * (`1315+4tile~` : durée en ms, `+N tex` textures en vol, `+N tile` carreaux de surface occupés,
 * `~` scène en mouvement). Ce module relit ce texte et en tire UNE ligne par fenêtre, pour savoir
 * quelle condition empêche le calme. Fonctions pures, sans Playwright : testées dans
 * `src/config/calmDiagnostic.test.ts`.
 *
 * Les compteurs de blocage ne sont PAS exclusifs : une image peut être lente, occupée par des
 * carreaux et en mouvement à la fois.
 */

import {
  isBusyDetailConsistent,
  parseBusyDetail,
  type BusyDetail,
} from '../src/core/surfaceBusyDetail';

export interface CalmFrame {
  ms: number;
  textures: number;
  tiles: number;
  moving: boolean;
  /** Décomposition de `data-surface-busy` lue au même instant (`?debug-surface`), si publiée. */
  busy?: BusyDetail;
}

export interface CalmWindowSummary {
  frames: number;
  medianMs: number;
  p90Ms: number;
  maxMs: number;
  /** Images avec au moins une texture en vol. */
  withTextures: number;
  /** Images avec au moins un carreau de surface occupé. */
  withTiles: number;
  /** Images pendant un vol de caméra ou un glissement d'échelle. */
  withMotion: number;
  /** Images plus longues que le budget. */
  slow: number;
  /** Plus longue suite d'images calmes consécutives (même condition que l'attente). */
  bestStreak: number;
  /** Images portant la décomposition de `data-surface-busy`. */
  withDetail: number;
  /** Moyennes, sur ces images, de chaque part du total occupé. */
  mean: { pending: number; queued: number; held: number; fading: number };
  /** Âge maximal d'un carreau retenu vu dans la fenêtre, en secondes. */
  heldAgeMaxS: number;
  /**
   * Incohérence INTERNE de la décomposition : les parties ne retrouvent pas son propre total, ou
   * le fondu actif est négatif. Ne dépend pas du moment de la lecture.
   */
  internal: number;
  /**
   * Décalage TEMPOREL : le total de la décomposition (pris à la fin de `engine.update`) diffère de
   * `data-surface-busy` (écrit par le `tick` du panneau). Une image lue entre les deux le montre,
   * sans que les compteurs soient faux.
   */
  skew: number;
  /** Part dominante du total occupé : téléchargements, file, retenus ou fondu actif. */
  dominant: 'téléchargements' | 'file' | 'retenus' | 'fondu' | 'aucune';
}

const FRAME = /^(\d+)(?:\+(\d+)tex)?(?:\+(\d+)tile)?(?:\{([^}]*)\})?(~)?$/;

/** Relit une image notée par l'attente du calme ; `null` si le format est inconnu. */
export function parseCalmFrame(text: string): CalmFrame | null {
  const m = FRAME.exec(text);
  if (!m) return null;
  const busy = m[4] === undefined ? undefined : parseBusyDetail(m[4]);
  if (m[4] !== undefined && !busy) return null;
  return {
    ms: Number(m[1]),
    textures: m[2] === undefined ? 0 : Number(m[2]),
    tiles: m[3] === undefined ? 0 : Number(m[3]),
    moving: m[5] === '~',
    ...(busy ? { busy } : {}),
  };
}

const isCalm = (f: CalmFrame, budgetMs: number): boolean =>
  f.ms <= budgetMs && f.textures === 0 && f.tiles === 0 && !f.moving;

export function summarizeCalmWindow(
  series: readonly string[],
  budgetMs: number
): CalmWindowSummary {
  const frames = series
    .map(parseCalmFrame)
    .filter((f): f is CalmFrame => f !== null);
  const sorted = frames.map((f) => f.ms).sort((a, b) => a - b);
  const n = sorted.length;
  const median =
    n === 0
      ? 0
      : n % 2 === 1
        ? sorted[(n - 1) / 2]!
        : Math.round((sorted[n / 2 - 1]! + sorted[n / 2]!) / 2);
  let streak = 0;
  let best = 0;
  for (const f of frames) {
    streak = isCalm(f, budgetMs) ? streak + 1 : 0;
    best = Math.max(best, streak);
  }
  const detailed = frames.filter((f) => f.busy !== undefined);
  const mean = (pick: (b: BusyDetail) => number): number =>
    detailed.length === 0
      ? 0
      : Math.round(
          (detailed.reduce((sum, f) => sum + pick(f.busy!), 0) /
            detailed.length) *
            10
        ) / 10;
  const parts = {
    pending: mean((b) => b.pending),
    queued: mean((b) => b.queued),
    held: mean((b) => b.held),
    fading: mean((b) => Math.max(0, b.fading)),
  };
  const ranked: [CalmWindowSummary['dominant'], number][] = [
    ['téléchargements', parts.pending],
    ['file', parts.queued],
    ['retenus', parts.held],
    ['fondu', parts.fading],
  ];
  const top = ranked.reduce((a, b) => (b[1] > a[1] ? b : a));
  return {
    frames: n,
    medianMs: median,
    p90Ms: n === 0 ? 0 : sorted[Math.ceil(0.9 * n) - 1]!,
    maxMs: n === 0 ? 0 : sorted[n - 1]!,
    withTextures: frames.filter((f) => f.textures > 0).length,
    withTiles: frames.filter((f) => f.tiles > 0).length,
    withMotion: frames.filter((f) => f.moving).length,
    slow: frames.filter((f) => f.ms > budgetMs).length,
    bestStreak: best,
    withDetail: detailed.length,
    mean: parts,
    heldAgeMaxS: detailed.reduce((a, f) => Math.max(a, f.busy!.heldAgeS), 0),
    internal: detailed.filter((f) => !isBusyDetailConsistent(f.busy!)).length,
    skew: detailed.filter((f) => f.busy!.busy !== f.tiles).length,
    dominant: top[1] > 0 ? top[0] : 'aucune',
  };
}

/** Une ligne par fenêtre : temps écoulé, synthèse, quelques images brutes pour vérifier. */
export function formatCalmWindow(
  elapsedMs: number,
  series: readonly string[],
  budgetMs: number,
  wanted: number
): string {
  const s = summarizeCalmWindow(series, budgetMs);
  const sample =
    series.length <= 12
      ? series.join(' ')
      : `${series.slice(0, 6).join(' ')} … ${series.slice(-6).join(' ')}`;
  return (
    `[calm-diag] t=${(elapsedMs / 1000).toFixed(1)}s images=${s.frames} ` +
    `ms(médiane/p90/max)=${s.medianMs}/${s.p90Ms}/${s.maxMs} ` +
    `avec-textures=${s.withTextures} avec-carreaux=${s.withTiles} ` +
    `en-mouvement=${s.withMotion} lentes(>${budgetMs})=${s.slow} ` +
    `meilleure-série=${s.bestStreak}/${wanted}` +
    (s.withDetail === 0
      ? ''
      : ` carreaux[n=${s.withDetail}](moyenne) téléchargements=${s.mean.pending} ` +
        `file=${s.mean.queued} retenus=${s.mean.held} fondu=${s.mean.fading} ` +
        `dominant=${s.dominant} âge-retenus-max=${s.heldAgeMaxS}s ` +
        `incohérences-internes=${s.internal} ` +
        `décalage-avec-data-surface-busy=${s.skew}`) +
    ` échantillon=[${sample}]`
  );
}
