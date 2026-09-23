/**
 * L'échelle de résolutions d'une texture : jusqu'où on livre, et pourquoi (lot 16).
 *
 * Module PUR, sans état ni E/S. La règle vit ici, une seule fois ; le relevé mesuré vit
 * dans `src/config/textureLadder.json` (écrit par `pnpm textures:ladder`), la provenance
 * dans `src/registry/products/textures/*.json`, et `src/config/textureLadder.test.ts`
 * confronte les trois aux fichiers réellement livrés.
 *
 * « Échelle complète » ne veut PAS dire « agrandir jusqu'à 8k » : livrer des octets qui ne
 * montrent rien coûte au visiteur sans rien lui apprendre. Deux plafonds, mesurés tous les
 * deux, et c'est le PLUS BAS qui décide (voir `docs/ARCHITECTURE.md` § « L'échelle de
 * résolutions d'une texture »).
 */
import type { TextureQuality } from '@/types';

/** Largeur équirectangulaire d'un palier (hauteur = largeur / 2). */
export const TIER_WIDTH: Readonly<Record<TextureQuality, number>> = {
  '1k': 1024,
  '2k': 2048,
  '4k': 4096,
  '8k': 8192,
};

/** Du plus grossier au plus fin. Le palier 1k est le plancher : tout corps texturé l'a. */
export const TIERS: readonly TextureQuality[] = ['1k', '2k', '4k', '8k'];

/**
 * Plancher de detail d'un palier : part de la variance (ponderee par cos(latitude)) que le
 * palier doit porter EN PLUS de son propre aller-retour en demi-resolution.
 *
 * C'est une POLITIQUE, pas une grandeur physique, comme `SMALL_BODY_SNAPSHOT_MAX_AGE_DAYS`.
 * Elle est posee dans un ecart MESURE, puis REGARDE a l'ecran au rapport 1:1 (lot 16,
 * 2026-09-23) :
 *
 *   - Triton 8k (0,15 %), Saturne 2k (0,15 %) et Uranus 2k (0,04 %) sont indistinguables de
 *     leur palier du dessous agrandi : ces octets ne montrent rien.
 *   - Triton 4k (0,31 %) est deja franchement plus net, Triton 2k (0,44 %) nettement.
 *
 * Le plancher est donc pose a 0,25 %, dans le facteur deux qui separe les deux groupes.
 *
 * ATTENTION, erreur payee une fois : une premiere version le posait a 1,5 %, calibree sur une
 * AUTRE statistique (la variance au-dessus d'un palier, mesuree sur le fichier le plus fin, et
 * non ce que CE palier ajoute au sien). Elle aurait retire des paliers bien visibles : Io 4k,
 * Charon 4k, Triton 2k et 4k. Un seuil se calibre sur la statistique que la regle emploie
 * vraiment, et se verifie en regardant.
 */
export const DETAIL_FLOOR = 0.0025;

/**
 * Plafond d'une texture SANS source mesurée (surface illustrative, générée par
 * `scripts/generate-procedural-textures.mjs`). Ses pixels sont inventés : il n'y a rien à
 * résoudre, et le plancher de détail ne sait pas l'arbitrer puisqu'un bruit procédural est
 * haute fréquence par construction. On le déclare donc, au lieu de le mesurer.
 */
export const ILLUSTRATIVE_CEILING: TextureQuality = '2k';

/** Pourquoi un palier n'est pas livré. */
export type TierRefusal =
  | { readonly kind: 'above-source'; readonly sourcePixelWidth: number }
  | { readonly kind: 'no-source' }
  | { readonly kind: 'below-detail-floor'; readonly detail: number };

export interface LadderInput {
  /**
   * Largeur en pixels de la source RÉELLEMENT importée, lue à son étiquette (PDS3
   * `LINE_SAMPLES`, ou les dimensions du fichier publié). `null` quand aucune source ne
   * décrit ce corps : la texture est alors illustrative.
   */
  readonly sourcePixelWidth: number | null;
  /**
   * Part de variance qu'un palier porte en plus de son aller-retour en demi-résolution,
   * mesurée sur le fichier livré. Un palier absent du relevé n'est pas livré.
   */
  readonly detailByTier: Readonly<Partial<Record<TextureQuality, number>>>;
}

export interface LadderVerdict {
  readonly shipped: readonly TextureQuality[];
  readonly refused: Readonly<Partial<Record<TextureQuality, TierRefusal>>>;
}

/** Le plus haut palier dont la largeur tient dans `pixelWidth`, ou null si même 1k déborde. */
export function tierForSourceWidth(pixelWidth: number): TextureQuality | null {
  let best: TextureQuality | null = null;
  for (const tier of TIERS) if (TIER_WIDTH[tier] <= pixelWidth) best = tier;
  return best;
}

/**
 * Les paliers qu'un corps doit livrer, et la raison de chaque refus.
 *
 * Le palier 1k est toujours livré dès qu'une texture existe : c'est le niveau de démarrage,
 * et le refuser ferait disparaître le corps plutôt que l'alléger. Au-dessus, un palier est
 * livré s'il passe LES DEUX plafonds.
 */
export function resolveLadder(input: LadderInput): LadderVerdict {
  const { sourcePixelWidth, detailByTier } = input;
  const sourceTier =
    sourcePixelWidth === null
      ? ILLUSTRATIVE_CEILING
      : tierForSourceWidth(sourcePixelWidth);

  const refused: Partial<Record<TextureQuality, TierRefusal>> = {};

  // Chaque palier est jugé pour lui-même, pour que le refus porte sa vraie raison…
  for (const tier of TIERS) {
    if (tier === '1k') continue;
    if (sourceTier === null || TIER_WIDTH[tier] > TIER_WIDTH[sourceTier]) {
      refused[tier] =
        sourcePixelWidth === null
          ? { kind: 'no-source' }
          : { kind: 'above-source', sourcePixelWidth };
      continue;
    }
    const detail = detailByTier[tier];
    if (detail === undefined || detail < DETAIL_FLOOR) {
      refused[tier] = { kind: 'below-detail-floor', detail: detail ?? 0 };
    }
  }

  // …mais l'échelle livrée est CONTIGUË : le LOD descend de palier en palier, et un trou au
  // milieu ferait demander au moteur un fichier qui n'existe pas. On livre donc le plus long
  // préfixe accepté, en partant de 1k, qui est le plancher de démarrage de tout corps texturé.
  const shipped: TextureQuality[] = [];
  for (const tier of TIERS) {
    if (tier !== '1k' && refused[tier]) break;
    shipped.push(tier);
  }

  return { shipped, refused };
}
