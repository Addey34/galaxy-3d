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

export interface CalmFrame {
  ms: number;
  textures: number;
  tiles: number;
  moving: boolean;
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
}

const FRAME = /^(\d+)(?:\+(\d+)tex)?(?:\+(\d+)tile)?(~)?$/;

/** Relit une image notée par l'attente du calme ; `null` si le format est inconnu. */
export function parseCalmFrame(text: string): CalmFrame | null {
  const m = FRAME.exec(text);
  if (!m) return null;
  return {
    ms: Number(m[1]),
    textures: m[2] === undefined ? 0 : Number(m[2]),
    tiles: m[3] === undefined ? 0 : Number(m[3]),
    moving: m[4] === '~',
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
    `meilleure-série=${s.bestStreak}/${wanted} échantillon=[${sample}]`
  );
}
