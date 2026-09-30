/**
 * CE QU'UNE MISSION DIT DU TEMPS, et ce qu'elle ne dit pas. Module PUR (dates → état), sans DOM
 * ni réseau, comme `core/temporal.ts` dont il ne réutilise PAS le vocabulaire : celui-là classe un
 * produit de donnée AFFICHÉ (mesure, réanalyse, prévision), une mission est une entité qui a une
 * durée de vie. Fondre les deux reproduirait, à l'envers, la faute que `temporal.ts` a corrigée
 * en appelant « observé » une réanalyse.
 *
 * L'ÉTAT LE PLUS IMPORTANT EST LE QUATRIÈME, et il vient d'une mesure faite le 2026-09-30 sur le
 * registre de contexte du PDS : **36 des 112 investigations ne déclarent aucune fin**. Sur les 113
 * LIGNES servies, 31 rendent `null` et 6 rendent la sentinelle `3000-01-01` que le générateur
 * réécrit en « pas de fin » ; l'écart d'une unité est Venus Express, servie en deux lignes portant
 * chacune une des deux formes.
 * Aucune de ces deux formes ne veut dire « toujours en cours » : Venus Express porte la sentinelle
 * alors qu'elle s'est terminée en 2014, et Venera 4 rend `null` alors qu'elle s'est tue en 1967.
 * Une mission commencée dont l'archive ne déclare pas la fin est donc `startedEndUndeclared`, et
 * jamais `underway` : l'application ne sait pas, et c'est cela qu'elle dit.
 */

/** Une mission telle que le registre de contexte du PDS la déclare. */
export interface MissionRecord {
  /** Le nom PUBLIÉ par l'archive, jamais réécrit (« Lucy MIssion » y compris). */
  readonly name: string;
  /** L'identifiant logique PDS, qui est la citation de la source. */
  readonly lid: string;
  /**
   * Le début que l'archive déclare, en jour ISO. Ce N'EST PAS une date de lancement : le PDS
   * fait commencer « Voyager » le 1972-07-01, alors que Voyager 1 a décollé le 1977-09-05. C'est
   * le début du PROJET, et les deux ne se confondent pas.
   */
  readonly start: string;
  /** La fin déclarée, en jour ISO, ou `null` quand l'archive n'en déclare aucune. */
  readonly end: string | null;
}

/** Où en est une mission à la date de la scène. */
export type MissionStanding =
  /** La scène est avant le début déclaré. */
  | 'notYetStarted'
  /** La scène est dans l'intervalle déclaré, les deux bornes étant connues. */
  | 'underway'
  /** La scène est après la fin déclarée. */
  | 'ended'
  /** La mission a commencé et l'archive ne déclare PAS de fin : on ne sait pas, on le dit. */
  | 'startedEndUndeclared';

export const MISSION_STANDINGS: readonly MissionStanding[] = [
  'notYetStarted',
  'underway',
  'ended',
  'startedEndUndeclared',
];

/**
 * Le jour UTC d'un instant. Une borne de mission est un JOUR : le PDS ne publie pas mieux, et
 * comparer un jour à une heure ferait dépendre le résultat du fuseau de la personne.
 */
const utcDay = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * L'état d'une mission à la date de la scène.
 *
 * Les bornes sont INCLUSES : une mission dont l'archive déclare la fin le 2017-09-15 est encore
 * `underway` ce jour-là. Une borne illisible fait rendre `notYetStarted` plutôt que d'inventer :
 * mais le générateur refuse déjà d'écrire un enregistrement sans début, donc ce cas ne se produit
 * pas sur la donnée livrée, et le test le vérifie.
 */
export function missionStanding(
  mission: MissionRecord,
  sceneDate: Date
): MissionStanding {
  const at = utcDay(sceneDate);
  if (at < mission.start) return 'notYetStarted';
  if (mission.end === null) return 'startedEndUndeclared';
  return at <= mission.end ? 'underway' : 'ended';
}

/** Les missions dont on peut dire qu'elles avaient commencé à cette date, l'état avec elles. */
export function missionsAtDate(
  missions: readonly MissionRecord[],
  sceneDate: Date
): readonly { mission: MissionRecord; standing: MissionStanding }[] {
  return missions
    .map((mission) => ({
      mission,
      standing: missionStanding(mission, sceneDate),
    }))
    .filter(
      ({ standing }) =>
        standing === 'underway' || standing === 'startedEndUndeclared'
    );
}

/**
 * L'ordre d'affichage : par début, puis par nom. Comparaison de CHAÎNES de jours ISO, qui est
 * l'ordre chronologique par construction — et non un tri d'objets, dont le lot 39 a montré qu'il
 * compare des « [object Object] » et ne trie juste que par accident.
 */
export function sortMissions(
  missions: readonly MissionRecord[]
): readonly MissionRecord[] {
  return [...missions].sort(
    (a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name)
  );
}
