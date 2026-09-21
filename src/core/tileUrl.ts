/**
 * ADRESSE D'UNE TUILE — module pur, testé, aucun réseau (lot 9, phase 9C).
 *
 * Une seule responsabilité, et elle a une raison MESURÉE d'exister à part : une tuile hors
 * bornes fait répondre Trek 404 **sans en-tête `Access-Control-Allow-Origin`**. Le navigateur
 * rapporte alors un échec qui ressemble mot pour mot à un refus CORS, pour ce qui n'est qu'un
 * calcul de ligne faux. On refuse donc AVANT d'émettre, avec un message qui nomme la borne
 * franchie — c'est le piège 2 du plan du lot, et le test le falsifie.
 *
 * Le gabarit est RECOPIÉ des capacités WMTS de la couche, jamais réécrit : celui de Trek
 * contient un double `/` après `1.0.0`, et l'ordre est `{TileMatrix}/{TileRow}/{TileCol}`,
 * c'est-à-dire niveau, LIGNE, puis colonne. Inverser les deux derniers donne des adresses
 * valides qui montrent un autre endroit du corps, ce qu'aucune erreur ne signale.
 */

import {
  isWithinMatrix,
  tileMatrix,
  WMTS_EQUIRECTANGULAR_2x1,
  type TileIndex,
  type TileMatrixShape,
} from './tilePyramid';

/** Service de tuiles RESTful, tel qu'une fiche de jeu de tuiles le déclare. */
export interface TileService {
  /** Gabarit recopié des capacités, avec ses jetons entre accolades. */
  template: string;
  /** `{Style}` des capacités. */
  style: string;
  /** `{TileMatrixSet}` des capacités. */
  tileMatrixSet: string;
  /** Forme de la matrice ; par défaut celle que Trek publie. */
  matrix?: TileMatrixShape;
}

/** Les jetons que ce module sait remplacer. Tout autre jeton restant est une erreur. */
const TOKENS = ['Style', 'TileMatrixSet', 'TileMatrix', 'TileRow', 'TileCol'];

/**
 * Adresse d'une tuile, ou une exception si l'indice sort de la matrice de son niveau.
 *
 * Échouer plutôt que renvoyer `null` est délibéré : l'appelant qui ignorerait un `null` émettrait
 * une requête sur une adresse construite à côté, et c'est exactement le défaut que ce module
 * existe pour rendre impossible.
 */
export function tileUrl(service: TileService, index: TileIndex): string {
  const shape = service.matrix ?? WMTS_EQUIRECTANGULAR_2x1;
  if (!isWithinMatrix(index, shape)) {
    const matrix = tileMatrix(index.level, shape);
    throw new RangeError(
      `tuile hors matrice : niveau ${index.level}, ligne ${index.row}, colonne ${index.column} ` +
        `(la matrice de ce niveau a ${matrix.rows} lignes et ${matrix.columns} colonnes ; ` +
        `un 404 de Trek arrive sans en-tête CORS et ressemblerait à un refus CORS)`
    );
  }

  const values: Record<string, string> = {
    Style: service.style,
    TileMatrixSet: service.tileMatrixSet,
    TileMatrix: String(index.level),
    TileRow: String(index.row),
    TileCol: String(index.column),
  };

  let url = service.template;
  for (const token of TOKENS) {
    url = url.split(`{${token}}`).join(values[token]!);
  }

  const leftover = /\{([A-Za-z]+)\}/.exec(url);
  if (leftover) {
    throw new Error(
      `gabarit de tuile non résolu : jeton {${leftover[1]}} inconnu de tileUrl`
    );
  }
  if (!url.startsWith('https://')) {
    throw new Error('gabarit de tuile : une adresse https absolue est exigée');
  }
  return url;
}

/** Hôte d'un gabarit : ce qui doit figurer dans `img-src`/`connect-src` de la CSP. */
export function tileServiceHost(service: TileService): string {
  return new URL(service.template.replace(/\{[A-Za-z]+\}/g, 'x')).hostname;
}
