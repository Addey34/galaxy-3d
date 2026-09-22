/**
 * Âge d'un instantané livré : QUAND un relevé daté devient-il trop vieux pour être présenté
 * sans le dire ?
 *
 * Les petits corps viennent d'un instantané de la JPL Small-Body Database relevé au build
 * (`pnpm smallbodies:generate`), parce que l'API ne renvoie pas l'en-tête CORS qu'un navigateur
 * exige. Un instantané se périme EN SILENCE : les éléments orbitaux sont affinés à chaque nuit
 * d'observations, de nouveaux objets entrent dans les catégories, et rien dans l'application ne
 * change pour autant. Ce module rend ce vieillissement visible, de deux façons qui lisent la
 * même règle :
 *   - le panneau des petits corps le dit au visiteur, au-delà de l'âge déclaré ;
 *   - un workflow GitHub planifié (`.github/workflows/data-freshness.yml`) échoue au-delà du
 *     même âge, et GitHub en avertit le propriétaire du dépôt par courriel.
 *
 * Module PUR : ni DOM, ni i18n. `now` est toujours passé par l'appelant.
 */

/**
 * Âge au-delà duquel l'instantané est déclaré périmé. C'est une POLITIQUE, pas une grandeur
 * physique : aucune date de la source ne dit qu'un relevé cesse d'être juste, il devient
 * seulement de moins en moins complet et de moins en moins à jour. Six mois est la cadence à
 * laquelle on s'engage à le relever, écrite une fois, ici.
 */
export const SMALL_BODY_SNAPSHOT_MAX_AGE_DAYS = 180;

const DAY_MS = 86_400_000;

/** Date de calendrier `AAAA-MM-JJ` → instant UTC, ou `null` si la date n'existe pas. */
function calendarDay(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10) === iso ? ms : null;
}

/**
 * Âge du relevé en jours entiers révolus, le jour du relevé comptant pour 0. `null` pour une
 * date illisible, qui ne doit ni passer pour fraîche ni faire échouer le panneau.
 */
export function snapshotAgeDays(retrieved: string, now: Date): number | null {
  const at = calendarDay(retrieved);
  if (at === null) return null;
  return Math.max(0, Math.floor((now.getTime() - at) / DAY_MS));
}

/** Vrai quand le relevé a dépassé l'âge déclaré. Une date illisible n'est pas « fraîche ». */
export function isSnapshotStale(
  retrieved: string,
  now: Date,
  maxAgeDays = SMALL_BODY_SNAPSHOT_MAX_AGE_DAYS
): boolean {
  const age = snapshotAgeDays(retrieved, now);
  return age === null || age > maxAgeDays;
}

/**
 * Âge en mois de calendrier révolus (le 20 mars est à 6 mois du 20 septembre, le 19 mars à 5),
 * pour la phrase du panneau : un nombre de jours dit mal « vieux de sept mois ».
 */
export function snapshotAgeMonths(retrieved: string, now: Date): number | null {
  if (calendarDay(retrieved) === null) return null;
  const [y, m, d] = retrieved.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  let months = (now.getUTCFullYear() - y) * 12 + (now.getUTCMonth() + 1 - m);
  if (now.getUTCDate() < d) months--;
  return Math.max(0, months);
}
