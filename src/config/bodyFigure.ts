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
 * qui se lit ici : le noyau n'en publie pas les rayons (les petites lunes de Pluton n'y en ont
 * pas) ; il les publie égaux (la Lune, Ganymède) ; ou le
 * corps n'a pas de rayon de rendu. Un corps à modèle de forme garde sa figure : seule sa sphère de
 * REPLI la prend, et elle n'est vue que si le maillage n'arrive pas.
 */

import snapshot from './factSources.snapshot.json';
import fitted from './fittedFigures.json';
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

const FITTED = fitted as unknown as Record<
  string,
  { radiiKm?: readonly number[] } | string
>;

/**
 * Les rayons de l'ellipsoïde AJUSTÉ au relief livré du corps (`fittedFigures.json`, écrit par le
 * cuiseur de hauteurs, ligne 45.3), ou `null`. Ne sert que quand le noyau ne publie pas de rayons
 * différents : Cérès, dont le noyau ne porte que les rayons d'avant Dawn.
 */
export function fittedRadiiKm(
  name: string
): readonly [number, number, number] | null {
  const entry = FITTED[name];
  const radii = typeof entry === 'object' ? entry.radiiKm : undefined;
  if (!radii || radii.length !== 3) return null;
  return [radii[0]!, radii[1]!, radii[2]!];
}

/** Les rayons qui dessinent le globe : publiés s'ils diffèrent, sinon ajustés, sinon `null`. */
export function figureRadiiKm(
  name: string
): readonly [number, number, number] | null {
  const published = publishedRadiiKm(name);
  if (published && !allEqual(published)) return published;
  return fittedRadiiKm(name) ?? published;
}

function allEqual(r: readonly [number, number, number]): boolean {
  return r[0] === r[1] && r[1] === r[2];
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
  const radii = figureRadiiKm(name);
  if (!radii || !(radiusKm !== undefined && radiusKm > 0)) return null;
  const [a, b, c] = radii;
  if (allEqual(radii)) return null;
  return { a: a / radiusKm, b: b / radiusKm, c: c / radiusKm };
}
