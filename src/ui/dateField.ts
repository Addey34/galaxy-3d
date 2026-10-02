/**
 * Les VALEURS des deux champs de la barre de temps (`ui/timePanel`), et rien d'autre : un
 * `<input type="date">` n'accepte que `yyyy-mm-dd`, avec au moins QUATRE chiffres d'année, et un
 * `<input type="time">` que `hh:mm:ss`. Une valeur qui ne respecte pas le format n'est pas
 * signalée : le navigateur la remplace par la chaîne vide.
 *
 * Le défaut que ce module ferme (lot 39) : la barre écrivait `${date.getUTCFullYear()}`, donc
 * « 500-05-14 » pour l'an 500. Le champ se VIDAIT, sans un mot, alors que la scène était bien à
 * cette date, et la molette ne pouvait plus rien décaler puisqu'il n'y avait plus de valeur.
 * Invisible tant que personne n'allait avant l'an 1000 ; la profondeur du temps mesurée par le
 * lot 39 rend ce voyage ordinaire.
 *
 * Ce que le format ne sait PAS écrire, et qui est une borne du navigateur et non un choix : une
 * année négative, ni une date julienne comme le 29 février 1500. Avant le 15 octobre 1582, la
 * barre de temps remplace donc ce champ par un groupe julien (`ui/timePanel.ts`,
 * `core/calendar.ts`, ligne 22.10).
 */

/** Première année qu'un `<input type="date">` sait porter. */
export const MIN_DATE_FIELD_YEAR = 1;

/** Valeur `yyyy-mm-dd` (UTC) du champ date. Année toujours sur quatre chiffres. */
export function dateFieldValue(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Valeur `hh:mm:ss` (UTC) du champ heure. */
export function timeFieldValue(date: Date): string {
  const h = String(date.getUTCHours()).padStart(2, '0');
  const m = String(date.getUTCMinutes()).padStart(2, '0');
  const s = String(date.getUTCSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/**
 * Date visée par une valeur `yyyy-mm-dd`, l'heure du jour étant conservée. `null` si la valeur
 * n'est pas une date au format du champ : quatre chiffres d'année au moins, comme à l'écriture.
 * Le champ garde alors la sienne plutôt que de sauter n'importe où.
 *
 * `setUTCFullYear` est indispensable ici : `new Date(500, 4, 14)` et `Date.UTC(500, 4, 14)`
 * placent les années 0 à 99 en 1900-1999, ce que cette méthode ne fait pas.
 */
export function dateFieldTarget(value: string, current: Date): Date | null {
  const match = /^(\d{4,6})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const target = new Date(current.getTime());
  target.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(target.getTime()) ? null : target;
}

/** Date visée par une valeur `hh:mm:ss`, le jour étant conservé. `null` si la valeur n'en est pas une. */
export function timeFieldTarget(value: string, current: Date): Date | null {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;
  const target = new Date(current.getTime());
  target.setUTCHours(Number(match[1]), Number(match[2]), Number(match[3] ?? 0), 0); // prettier-ignore
  return Number.isNaN(target.getTime()) ? null : target;
}
