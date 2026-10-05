/**
 * LE FACTEUR DE BALLANT D'UN PRIMAIRE, DÉRIVÉ DE SES ÉCHANTILLONS (2026-10-05).
 *
 * Un primaire tourne autour du barycentre de son couple : P(t) = B(t) + f·C(t), où C est son
 * compagnon vu du primaire et B une courbe lisse. Pour Pluton, f se dérive des masses publiées
 * (`config/gravity.ts`). Pour Patrocle, aucune répartition de la masse du couple n'est publiée,
 * mais Horizons sert le primaire ET le compagnon : le facteur est celui qui rend B LISSE.
 *
 * « Lisse » se mesure par les différences d'ordre SIX, et non deux : sur un pas de 4 jours, la
 * courbure de l'orbite héliocentrique d'un Troyen fait ~26 000 km de différence seconde et noie
 * entièrement le ballant (essayé : f = −0,45, rugosité inchangée, un nombre faux d'apparence
 * plausible). L'ordre six annule une orbite lisse et laisse le ballant, que le pas replie
 * (4,28 jours de période pour 4 jours de pas). Moindres carrés à une inconnue : avec a = Δ⁶P et
 * b = Δ⁶C, f = (a·b) / (b·b).
 *
 * Témoin, mesuré d'abord contre Horizons indépendamment de ce calcul : sur trois décades, primaire
 * − solution au sol = −0,2202 × Menoetius + une constante lente (résidu sous 1,7 km). Les fichiers
 * livrés redonnent −0,22024.
 */

import { alignedOffset } from './ephemerisWindow';

const COMPONENTS = 6;
const SIXTH_DIFFERENCE = [1, -6, 15, -20, 15, -6, 1] as const;

export interface ReflexFit {
  /** Le facteur f tel que P − f·C soit le plus lisse. */
  readonly factor: number;
  /** Rugosité (moyenne quadratique de Δ⁶, en unités des échantillons) de P, puis de P − f·C. */
  readonly roughnessBefore: number;
  readonly roughnessAfter: number;
}

/**
 * `body` et `companion` : états [x, y, z, vx, vy, vz] sur la MÊME suite d'instants, de même
 * longueur. Seules les positions comptent. `null` si la série est trop courte pour une
 * différence d'ordre six, ou si le compagnon ne varie pas.
 */
export function fitReflexFactor(
  body: Float64Array,
  companion: Float64Array
): ReflexFit | null {
  if (body.length !== companion.length)
    throw new Error('fitReflexFactor : séries de longueurs différentes');
  const count = body.length / COMPONENTS;
  const terms = count - (SIXTH_DIFFERENCE.length - 1);
  if (terms < 1) return null;
  const difference = (series: Float64Array, i: number, k: number) =>
    SIXTH_DIFFERENCE.reduce(
      (sum, c, j) => sum + c * series[(i + j) * COMPONENTS + k]!,
      0
    );
  let ab = 0;
  let bb = 0;
  let aa = 0;
  for (let i = 0; i < terms; i++)
    for (let k = 0; k < 3; k++) {
      const a = difference(body, i, k);
      const b = difference(companion, i, k);
      ab += a * b;
      bb += b * b;
      aa += a * a;
    }
  if (!(bb > 0)) return null;
  const factor = ab / bb;
  // Résidu des moindres carrés : |a|² − (a·b)²/|b|².
  const residual = Math.max(0, aa - (ab * ab) / bb);
  const n = terms * 3;
  return {
    factor,
    roughnessBefore: Math.sqrt(aa / n),
    roughnessAfter: Math.sqrt(residual / n),
  };
}

/** Ce que la règle lit d'une entrée du manifeste. */
export interface ReflexManifestEntry {
  readonly center?: string;
  readonly startJdTdb: number;
  readonly stepDays: number;
  readonly sampleCount: number;
  readonly primary?: { readonly fromJdTdb: number; readonly toJdTdb: number };
}

export interface ReflexDecision {
  readonly companion: string;
  readonly fit: ReflexFit;
  /** Publié : le facteur dépasse le seuil des masses ET réduit de moitié au moins la rugosité. */
  readonly published: boolean;
}

/**
 * LA RÈGLE DE PUBLICATION, une seule fois pour le script et pour sa garde.
 *
 * Un corps est candidat quand son fichier porte un intervalle `primary` et qu'un satellite est
 * stocké relativement à lui sur une grille ALIGNÉE. Le facteur s'ajuste sur l'intersection de
 * cet intervalle et du fichier compagnon, jamais sur la solution au sol, qui ne balance pas. Il
 * n'est publié que s'il dépasse `minRatio` (la règle des masses de `config/gravity.ts`) et s'il
 * réduit de moitié au moins la rugosité : sur Didymos il rend −0,009 (Dimorphos pèse ~1 % du
 * couple) sans rien réduire.
 */
export function reflexDecisions(
  name: string,
  bodies: Readonly<Record<string, ReflexManifestEntry>>,
  samplesOf: (name: string) => Float64Array,
  minRatio: number
): ReflexDecision[] {
  const entry = bodies[name];
  if (!entry?.primary) return [];
  const decisions: ReflexDecision[] = [];
  const toIndex = (jd: number) =>
    Math.round((jd - entry.startJdTdb) / entry.stepDays);
  for (const [companion, other] of Object.entries(bodies)) {
    if (other.center !== name) continue;
    const offset = alignedOffset(entry, other);
    if (offset === null) continue;
    const first = Math.max(offset, toIndex(entry.primary.fromJdTdb));
    const last = Math.min(
      offset + other.sampleCount - 1,
      toIndex(entry.primary.toJdTdb)
    );
    if (last - first < SIXTH_DIFFERENCE.length - 1) continue;
    const fit = fitReflexFactor(
      samplesOf(name).slice(first * COMPONENTS, (last + 1) * COMPONENTS),
      samplesOf(companion).slice(
        (first - offset) * COMPONENTS,
        (last - offset + 1) * COMPONENTS
      )
    );
    if (!fit) continue;
    decisions.push({
      companion,
      fit,
      published:
        Math.abs(fit.factor) >= minRatio &&
        fit.roughnessAfter <= fit.roughnessBefore / 2,
    });
  }
  return decisions;
}

/** Le facteur tel qu'il s'écrit au manifeste : cinq décimales, comme publié. */
export const publishedFactor = (factor: number): number =>
  Number(factor.toFixed(5));
