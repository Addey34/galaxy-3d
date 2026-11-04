/**
 * COMPARER UN FICHIER LIVRÉ À SA RÉGÉNÉRATION, SANS LES DATES DE LECTURE.
 *
 * Les générateurs écrivent la date à laquelle LEUR source a répondu (`retrieved`, `accessed`...).
 * Un `--check` fait avec des lectures fraîches, un autre jour que la génération, change donc
 * cette date seule : comparer les octets déclarait « dérivé » un fichier au contenu identique
 * (constaté le 2026-11-03 : 9 jeux sur 10, le contenu n'avait bougé que pour un).
 *
 * Seule la VALEUR d'une clé de date de lecture connue est neutralisée. Une date qui fait partie
 * de la donnée (une date de survol, un périjove) n'est jamais touchée.
 */
export const READ_DATE_KEYS = [
  'retrieved',
  'roleRetrieved',
  'descriptionsRetrieved',
  'accessed',
  'methodSource',
];

const READ_DATE = new RegExp(
  String.raw`("(?:${READ_DATE_KEYS.join('|')})"\s*:\s*")\d{4}-\d{2}-\d{2}(")`,
  'g'
);

/** Le texte avec la valeur de chaque date de lecture remplacée par une valeur fixe. */
export function withoutReadDates(text) {
  return text.replace(READ_DATE, '$1<lecture>$2');
}

/** Vrai si les deux textes ne diffèrent que par des dates de lecture. */
export function sameIgnoringReadDates(shipped, fresh) {
  if (shipped === null || shipped === undefined) return false;
  return withoutReadDates(shipped) === withoutReadDates(fresh);
}
