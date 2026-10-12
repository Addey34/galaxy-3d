/**
 * LES JOURS QU'UNE COUCHE DATÉE PUBLIE VRAIMENT — module pur, testé, aucun réseau (lot 48).
 *
 * Une couche quotidienne de NASA GIBS déclare sa dimension temporelle comme une liste
 * d'intervalles ISO 8601 (`2015-11-24/2022-07-27/P1D,2022-08-10/2024-05-31/P1D,…`) : les TROUS
 * sont les jours qu'aucun intervalle ne couvre. Ils ne sont pas théoriques, sept étaient
 * déclarés pour VIIRS le 2026-10-12, et une tuile demandée dans un trou rend **404 sans en-tête
 * CORS** (mesuré sur 2022-08-01) : dans un navigateur, c'est indiscernable d'un refus CORS, le
 * piège déjà payé avec Trek. Le client ne demande donc JAMAIS un jour que ce module n'a pas
 * trouvé dans la réponse.
 *
 * La liste ne se recopie pas dans une fiche : elle gagne un jour chaque jour et ses trous
 * changent. Elle se lit à l'exécution dans la réponse DescribeDomains de la couche (488 octets,
 * `Access-Control-Allow-Origin: *`, mesurés le 2026-10-12).
 */

/** Un intervalle de jours publiés, bornes incluses, en millisecondes UTC à minuit. */
export interface DayRange {
  from: number;
  to: number;
}

const DAY_MS = 86_400_000;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDay(text: string): number | null {
  const match = ISO_DAY.exec(text.trim());
  if (!match) return null;
  const ms = Date.UTC(+match[1]!, +match[2]! - 1, +match[3]!);
  // `Date.UTC` reporte un 2026-02-31 au 3 mars sans rien dire : on refuse ce qui ne revient pas.
  return new Date(ms).toISOString().slice(0, 10) === text.trim() ? ms : null;
}

/**
 * Lit le `<Domain>` d'une réponse DescribeDomains.
 *
 * Échoue plutôt que de rendre une liste vide sur une réponse qu'il ne comprend pas : une liste
 * vide voudrait dire « aucun jour publié », donc une couche silencieusement éteinte, alors que
 * le défaut serait de notre côté. Seule la période `P1D` est acceptée, parce que c'est la seule
 * que ce module sait énumérer ; une autre période est une couche qu'il ne faut pas brancher
 * sans le savoir.
 */
export function parseDayDomain(xml: string): DayRange[] {
  const body = /<Domain>([^<]*)<\/Domain>/.exec(xml)?.[1];
  if (body === undefined)
    throw new Error('réponse DescribeDomains sans élément <Domain>');
  const ranges: DayRange[] = [];
  for (const part of body.split(',')) {
    const text = part.trim();
    if (!text) continue;
    const fields = text.split('/');
    if (fields.length === 1) {
      const day = parseDay(fields[0]!);
      if (day === null) throw new Error(`jour illisible : « ${text} »`);
      ranges.push({ from: day, to: day });
      continue;
    }
    if (fields.length !== 3 || fields[2] !== 'P1D')
      throw new Error(`intervalle non quotidien : « ${text} »`);
    const from = parseDay(fields[0]!);
    const to = parseDay(fields[1]!);
    if (from === null || to === null || to < from)
      throw new Error(`intervalle illisible : « ${text} »`);
    ranges.push({ from, to });
  }
  if (ranges.length === 0)
    throw new Error('réponse DescribeDomains sans aucun intervalle');
  return ranges.sort((a, b) => a.from - b.from);
}

/**
 * Le jour UTC de `date`, au format de la dimension (`AAAA-MM-JJ`), s'il est publié ; sinon
 * `null`. Un jour HORS des intervalles n'est jamais arrondi au plus proche : montrer le sol
 * d'un autre jour sous la date d'aujourd'hui serait exactement le mensonge que la catégorie
 * temporelle existe pour empêcher. C'est l'appelant qui retombe alors sur la mosaïque.
 */
export function publishedDay(
  ranges: readonly DayRange[],
  date: Date
): string | null {
  const ms = date.getTime();
  if (!Number.isFinite(ms)) return null;
  const day = Math.floor(ms / DAY_MS) * DAY_MS;
  for (const range of ranges)
    if (day >= range.from && day <= range.to)
      return new Date(day).toISOString().slice(0, 10);
  return null;
}
