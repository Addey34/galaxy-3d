/**
 * CE QU'UNE SONDE PORTE, ET DANS QUELLES INVESTIGATIONS ELLE A SERVI. Module PUR (données → ordre
 * et regroupement), sans DOM ni réseau.
 *
 * L'ÉTAT DANS LE TEMPS N'EST PAS REDÉFINI ICI : une investigation a exactement la forme d'un
 * `MissionRecord` de `core/missions.ts` (un nom, un identifiant logique, un début, une fin
 * éventuellement absente), et `missionStanding` répond déjà « où en est-elle à la date de la
 * scène », avec son quatrième état pour les 36 investigations qui ne déclarent aucune fin. Écrire
 * une seconde horloge ici aurait fait diverger deux réponses à la même question.
 *
 * « PHASE » EST LE MAUVAIS MOT, et c'est une mesure du 2026-09-30 qui l'a dit, pas une préférence
 * de style. Une sonde est citée par une à trois investigations : New Horizons en a bien trois (la
 * mission, puis KEM1 et KEM2, ses deux extensions Kuiper) et OSIRIS-REx deux (OSIRIS-REx puis
 * OSIRIS-APEX), mais la SECONDE de Voyager 2 est « Comet D/1993 F2 (Shoemaker-Levy 9) Collision
 * into Jupiter », une CAMPAGNE d'observation et non une phase de Voyager 2. Ce module ne parle donc
 * que d'investigations, le mot de la source.
 */
import type { MissionRecord } from './missions';

/** Un porteur d'instruments : un engin, qui n'est pas toujours la sonde entière. */
export interface InstrumentHost {
  /** L'identifiant logique PDS, qui est la citation de la source. */
  readonly lid: string;
  /** Le nom PUBLIÉ par l'archive, jamais réécrit. */
  readonly name: string;
}

/**
 * Un instrument tel que le registre de contexte le déclare.
 *
 * PAS DE TYPE, et ce n'est pas un oubli : mesuré sur cinq produits de trois agences, la classe
 * `pds:Instrument` ne publie que `name`, `description`, `naif_instrument_id` et `serial_number`.
 * Il n'y a donc rien à classer, et un type ne sera pas inventé.
 *
 * PAS DE DESCRIPTION NON PLUS : elle existe et elle est riche, mais elle n'existe qu'en ANGLAIS.
 * Un nom d'instrument est un nom propre, qu'on publie tel quel dans les quatre langues ; un
 * paragraphe de prose anglaise sous une interface portugaise serait une régression, et le traduire
 * serait inventer. Le `lid` cite la fiche du PDS, qui la porte.
 */
export interface InstrumentRecord {
  readonly lid: string;
  readonly name: string;
  /** Le porteur qui l'embarque, quand l'archive le déclare. */
  readonly host: string | null;
  /** L'identifiant NAIF, UNIQUEMENT quand la source en publie un numérique. */
  readonly naif?: number;
}

/** Ce que l'archive du PDS déclare d'une sonde. */
export interface SpacecraftArchive {
  readonly hosts: readonly InstrumentHost[];
  /** Les investigations où cette sonde figure, du plus ancien début au plus récent. */
  readonly investigations: readonly MissionRecord[];
  readonly instruments: readonly InstrumentRecord[];
}

/**
 * L'ordre d'affichage des instruments : par nom publié, en comparaison de CHAÎNES.
 *
 * L'ordre vient d'ici et non du fichier livré, pour la même raison que `sortMissions` : un ordre
 * qui dépend de l'ordre d'écriture d'un générateur n'est pas un contrat.
 */
export function sortInstruments(
  instruments: readonly InstrumentRecord[]
): readonly InstrumentRecord[] {
  return [...instruments].sort((a, b) => a.name.localeCompare(b.name));
}

/** Un porteur et ce qu'il embarque, dans l'ordre déclaré des porteurs. */
export interface HostGroup {
  readonly host: InstrumentHost;
  readonly instruments: readonly InstrumentRecord[];
}

/**
 * Les instruments regroupés par porteur.
 *
 * UTILE POUR UNE SEULE SONDE SUR NEUF, ET C'EST BEPICOLOMBO : elle est TROIS engins sous une seule
 * investigation — l'orbiteur planétaire (MPO), l'orbiteur magnétosphérique japonais (MMO) et le
 * module de transfert (MTM). Un porteur qui n'embarque AUCUN instrument garde sa place dans le
 * résultat : MMO est exactement ce cas, et le masquer ferait disparaître un tiers de la sonde.
 *
 * Un instrument dont l'archive ne déclare pas le porteur, ou qui en déclare un que la sonde ne
 * possède pas, est rendu à part par `orphans` : il n'est pas rattaché au hasard au premier porteur.
 */
export function groupByHost(archive: SpacecraftArchive): {
  readonly groups: readonly HostGroup[];
  readonly orphans: readonly InstrumentRecord[];
} {
  const known = new Set(archive.hosts.map((host) => host.lid));
  const groups = archive.hosts.map((host) => ({
    host,
    instruments: sortInstruments(
      archive.instruments.filter((instrument) => instrument.host === host.lid)
    ),
  }));
  const orphans = sortInstruments(
    archive.instruments.filter(
      (instrument) => instrument.host === null || !known.has(instrument.host)
    )
  );
  return { groups, orphans };
}
