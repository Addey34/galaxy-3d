/**
 * LES COMMENTAIRES GLSL NE VOYAGENT PAS (ligne 45.10, 2026-10-11).
 *
 * Les shaders vivent dans des gabarits JavaScript, et le minifieur ne touche JAMAIS au contenu
 * d'une chaîne : leurs commentaires, en français et souvent longs (ils portent la mesure qui a
 * décidé chaque ligne), partaient donc tels quels chez chaque visiteur. Mesuré sur le build du
 * 2026-10-11 : 13 832 octets de commentaires et 4 475 d'indentation dans le seul morceau
 * d'entrée, alors que la marge du budget JavaScript du démarrage était de 112 octets.
 *
 * Ce module les retire du SOURCE, avant la compilation, dans les gabarits qui contiennent du
 * GLSL et dans eux seuls. Trois règles le rendent sûr :
 *   - il ne touche qu'au texte littéral d'un gabarit, jamais à une expression `${…}` ;
 *   - un commentaire qui court jusqu'à une expression (pas de fin de ligne avant `${`) est
 *     LAISSÉ : le retirer collerait la valeur de l'expression au code GLSL ;
 *   - chaque fin de ligne est GARDÉE, donc les numéros de ligne du fichier ne bougent pas (les
 *     traces de pile du serveur de dev restent justes).
 *
 * Le greffon (`vite.config.ts`, `stripGlslComments`) l'applique AUSSI en dev, pour que la suite
 * e2e compile les shaders transformés : un défaut ici se verrait dans un vrai navigateur.
 */
import ts from 'typescript';

/** Ce qui fait d'un gabarit un shader : un mot que seul le GLSL emploie. */
const GLSL_MARKER =
  /\b(uniform|varying|gl_FragColor|gl_Position|precision\s+(high|medium|low)p|#include|#ifdef|#define|vec[234]\s*\()/;

/** Le texte brut d'une pièce de gabarit, et sa position dans le fichier. */
interface Piece {
  readonly start: number;
  readonly raw: string;
}

function piecesOf(node: ts.Node, sf: ts.SourceFile): Piece[] | null {
  const piece = (literal: ts.TemplateLiteralLikeNode): Piece => ({
    // Après le délimiteur ouvrant : « ` » pour une tête, « } » pour un milieu ou une queue.
    start: literal.getStart(sf) + 1,
    raw: literal.rawText ?? '',
  });
  if (ts.isNoSubstitutionTemplateLiteral(node)) return [piece(node)];
  if (ts.isTemplateExpression(node))
    return [
      piece(node.head),
      ...node.templateSpans.map((s) => piece(s.literal)),
    ];
  return null;
}

/** Le texte d'une pièce, commentaires et indentation retirés, fins de ligne gardées. */
export function stripPiece(raw: string): string {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    if (raw.startsWith('//', i)) {
      const end = raw.indexOf('\n', i);
      // Le commentaire court jusqu'à l'expression suivante : on le laisse entier.
      if (end === -1) {
        out += raw.slice(i);
        break;
      }
      i = end;
      continue;
    }
    if (raw.startsWith('/*', i)) {
      const end = raw.indexOf('*/', i + 2);
      if (end === -1) {
        out += raw.slice(i);
        break;
      }
      // Les fins de ligne du bloc restent, pour la même raison que plus haut.
      out += raw.slice(i, end + 2).replace(/[^\n]/g, '');
      i = end + 2;
      continue;
    }
    out += raw[i];
    i++;
  }
  // Indentation et blancs de fin de ligne : le GLSL n'en a que faire.
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n');
}

/** Le source, débarrassé des commentaires de ses gabarits GLSL ; `null` s'il n'y en a aucun. */
export function stripGlslComments(
  code: string,
  fileName = 'module.ts'
): string | null {
  if (!code.includes('`') || !GLSL_MARKER.test(code)) return null;
  const sf = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true);
  const edits: { start: number; end: number; text: string }[] = [];
  const visit = (node: ts.Node): void => {
    const pieces = piecesOf(node, sf);
    if (pieces && pieces.some((p) => GLSL_MARKER.test(p.raw))) {
      for (const p of pieces) {
        const text = stripPiece(p.raw);
        if (text !== p.raw)
          edits.push({ start: p.start, end: p.start + p.raw.length, text });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (edits.length === 0) return null;
  let out = code;
  for (const e of edits.sort((a, b) => b.start - a.start))
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}
