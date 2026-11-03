/**
 * LES FIGURES DES CONSTELLATIONS : des listes d'ÉTOILES, pas des coordonnées.
 *
 * `public/assets/sky/constellations.json` (`scripts/generate-constellations.mjs`) donne, par
 * constellation, des lignes dont chaque sommet est l'INDICE d'une étoile de `stars.json`. Les
 * figures suivent donc les étoiles quand la date change : sur des millénaires, le Grand Chariot ou
 * Orion se déforment, ce qu'une figure à coordonnées fixes ne montrerait pas.
 *
 * Le tracé est celui de d3-celestial (issu de la page des constellations de l'UAI, avec des
 * modifications de son auteur) : un tracé usuel, pas une définition officielle. Pur, sans DOM.
 */

export interface ConstellationFile {
  source: {
    id: string;
    name: string;
    url: string;
    linesCommit: string;
    namesCommit: string;
    license: string;
    licenseUrl: string;
    retrieved: string;
    maxSeparationDeg: number;
  };
  stars: { file: string; sha256: string };
  count: number;
  constellations: { id: string; name: string; lines: number[][] }[];
}

/**
 * Paires d'indices d'étoiles (deux par segment) pour un tracé en `LineSegments`. Chaque ligne de
 * n sommets donne n − 1 segments. Un indice hors du catalogue lève : mieux vaut aucune figure
 * qu'une figure tracée vers une étoile qui n'existe pas (indices écrits pour un autre catalogue).
 */
export function segmentIndices(
  file: Pick<ConstellationFile, 'constellations'>,
  starCount: number
): Uint16Array {
  const pairs: number[] = [];
  for (const c of file.constellations)
    for (const line of c.lines)
      for (let i = 0; i + 1 < line.length; i++) {
        const a = line[i]!;
        const b = line[i + 1]!;
        if (
          !Number.isInteger(a) ||
          !Number.isInteger(b) ||
          a < 0 ||
          b < 0 ||
          a >= starCount ||
          b >= starCount
        )
          throw new RangeError(
            `constellation ${c.id} : indice d'étoile hors du catalogue (${a}, ${b}, ${starCount} étoiles)`
          );
        if (a !== b) pairs.push(a, b);
      }
  return Uint16Array.from(pairs);
}
