/**
 * La FIGURE de chaque corps : l'ellipsoïde que publie le noyau PCK de NAIF (ligne 45.3, lot 1).
 *
 * Les trois rayons ne sont écrits nulle part à la main : le relevé des faits les lit dans le
 * noyau (`scripts/snapshot-fact-sources.mjs`, section `naifRotation`, champ `radiiKm`), et ce
 * module les rapporte au rayon de rendu du corps, celui de sa fiche. Le globe dessiné a donc
 * EXACTEMENT les demi-axes publiés, quel que soit le rayon que la fiche affiche (Saturne :
 * 60 268 km à l'équateur, 54 364 km au pôle).
 *
 * `null` veut dire « sphère », et c'est le cas de trois sortes de corps, chacun pour une raison
 * qui se lit ici : le noyau n'en publie pas les rayons (Cérès n'est pas dans la liste lue, les
 * petites lunes de Pluton n'y ont pas de rayons) ; il les publie égaux (la Lune, Ganymède) ; ou le
 * corps n'a pas de rayon de rendu. Un corps à modèle de forme garde sa figure : seule sa sphère de
 * REPLI la prend, et elle n'est vue que si le maillage n'arrive pas.
 */

import snapshot from './factSources.snapshot.json';
import type { Figure } from '@/core/ellipsoid';

type RadiiEntry = { readonly radiiKm?: readonly number[] | null };

const BODIES = (
  snapshot as unknown as {
    naifRotation: { bodies: Record<string, RadiiEntry> };
  }
).naifRotation.bodies;

/** Les trois rayons publiés (a, b, c), en km, ou `null` si le noyau n'en publie pas. */
export function publishedRadiiKm(
  name: string
): readonly [number, number, number] | null {
  const radii = BODIES[name]?.radiiKm;
  if (!radii || radii.length !== 3) return null;
  return [radii[0]!, radii[1]!, radii[2]!];
}

/**
 * La figure du corps rapportée à son rayon de rendu `radiusKm`, ou `null` pour une sphère (rayons
 * absents ou tous égaux). Des rayons égaux mais différents de `radiusKm` restent une sphère : on
 * ne change pas la TAILLE d'un corps rond parce que deux sources arrondissent différemment.
 */
export function bodyFigure(
  name: string,
  radiusKm: number | undefined
): Figure | null {
  const radii = publishedRadiiKm(name);
  if (!radii || !(radiusKm !== undefined && radiusKm > 0)) return null;
  const [a, b, c] = radii;
  if (a === b && b === c) return null;
  return { a: a / radiusKm, b: b / radiusKm, c: c / radiusKm };
}
