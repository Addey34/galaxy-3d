import { describe, expect, it } from 'vitest';
import {
  MISSION_STANDINGS,
  missionStanding,
  missionsAtDate,
  sortMissions,
  type MissionRecord,
} from './missions';

const mission = (
  name: string,
  start: string | null,
  end: string | null
): MissionRecord => ({ name, lid: `urn:test:${name}`, start, end });

/** Cassini, telle que le registre du PDS la déclare (mesuré le 2026-09-30). */
const CASSINI = mission('Cassini-Huygens', '1997-10-15', '2017-09-15');
/** Voyager : début de PROJET en 1972, et aucune fin déclarée. Les deux pièges en un seul cas. */
const VOYAGER = mission('Voyager', '1972-07-01', null);
/**
 * DART : l'archive écrit sa sentinelle de début `1000-01-01`, réécrite `null`, et ne déclare pas de
 * fin. Devenu visible le 2026-10-04, quand Didymos est entré au catalogue.
 */
const DART = mission('Double Asteroid Redirection Test', null, null);

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe('missionStanding', () => {
  it('rend les cinq états, et rien d’autre', () => {
    expect(MISSION_STANDINGS).toHaveLength(5);
    for (const date of ['1960-01-01', '2000-01-01', '2020-01-01'])
      for (const record of [CASSINI, VOYAGER, DART])
        expect(MISSION_STANDINGS).toContain(missionStanding(record, at(date)));
  });

  it('classe une mission aux deux bornes déclarées', () => {
    expect(missionStanding(CASSINI, at('1997-10-14'))).toBe('notYetStarted');
    expect(missionStanding(CASSINI, at('2005-01-01'))).toBe('underway');
    expect(missionStanding(CASSINI, at('2017-09-16'))).toBe('ended');
  });

  /**
   * LES BORNES SONT INCLUSES, et ce n'est pas un détail de goût : la fin déclarée de Cassini est
   * le jour de sa plongée dans Saturne, et dire « terminée » ce jour-là serait faux.
   */
  it('inclut les deux bornes', () => {
    expect(missionStanding(CASSINI, at('1997-10-15'))).toBe('underway');
    expect(missionStanding(CASSINI, at('2017-09-15'))).toBe('underway');
  });

  /**
   * LE QUATRIÈME ÉTAT EST LE SEUL QUI COMPTE VRAIMENT. Une mission sans fin déclarée n'est PAS
   * « en cours » : 31 des 113 missions du registre rendent `null`, dont Venera 4, qui s'est tue
   * en 1967. Répondre `underway` pour une scène en 2026 publierait une sonde soviétique encore
   * active. Le test le prouve en prenant une date largement postérieure à la mission réelle.
   */
  it('ne dit jamais « en cours » quand l’archive ne déclare pas de fin', () => {
    expect(missionStanding(VOYAGER, at('1972-07-01'))).toBe(
      'startedEndUndeclared'
    );
    expect(missionStanding(VOYAGER, at('2500-01-01'))).toBe(
      'startedEndUndeclared'
    );
    expect(missionStanding(VOYAGER, at('1972-06-30'))).toBe('notYetStarted');
  });

  /** Le jour est comparé en UTC : le résultat ne doit pas dépendre du fuseau de la personne. */
  it('ne devine rien quand l’archive ne déclare pas de début', () => {
    // Ni « pas encore commencée » ni « en cours » : on ne sait pas, à aucune date.
    for (const date of ['1000-01-02', '2022-09-26', '2099-01-01'])
      expect(missionStanding(DART, at(date))).toBe('startUndeclared');
    // Une fin déclarée et dépassée, elle, reste une certitude.
    const endOnly = mission('Fin seule', null, '2000-01-01');
    expect(missionStanding(endOnly, at('2001-01-01'))).toBe('ended');
    expect(missionStanding(endOnly, at('1999-01-01'))).toBe('startUndeclared');
    // Et une telle mission n'est jamais comptée parmi celles qui avaient commencé.
    expect(missionsAtDate([DART], at('2023-01-01'))).toEqual([]);
  });

  it('compare en UTC et non en heure locale', () => {
    const eve = new Date('1997-10-14T23:30:00Z');
    const dawn = new Date('1997-10-15T00:30:00Z');
    expect(missionStanding(CASSINI, eve)).toBe('notYetStarted');
    expect(missionStanding(CASSINI, dawn)).toBe('underway');
  });
});

describe('missionsAtDate', () => {
  it('garde celles qui avaient commencé, quel que soit l’état de leur fin', () => {
    const list = [CASSINI, VOYAGER];
    expect(
      missionsAtDate(list, at('2005-01-01')).map((r) => r.mission.name)
    ).toEqual(['Cassini-Huygens', 'Voyager']);
    expect(
      missionsAtDate(list, at('2020-01-01')).map((r) => r.mission.name)
    ).toEqual(['Voyager']);
    expect(missionsAtDate(list, at('1900-01-01'))).toHaveLength(0);
  });
});

describe('sortMissions', () => {
  it('range un début non déclaré en dernier, jamais en tête', () => {
    expect(sortMissions([DART, VOYAGER, CASSINI]).map((m) => m.name)).toEqual([
      'Voyager',
      'Cassini-Huygens',
      'Double Asteroid Redirection Test',
    ]);
  });

  /**
   * TRI SUR DES CHAÎNES, jamais sur des objets : le lot 39 a livré un `[...rows].sort()` qui
   * comparait des « [object Object] » et dont l'ordre n'était juste que par accident.
   */
  it('trie par début puis par nom, sans muter l’entrée', () => {
    const input = [
      mission('Zêta', '2000-01-01', null),
      mission('Alpha', '2000-01-01', null),
      mission('Vieille', '1965-03-04', '1965-03-05'),
    ];
    const copy = [...input];
    expect(sortMissions(input).map((m) => m.name)).toEqual([
      'Vieille',
      'Alpha',
      'Zêta',
    ]);
    expect(input).toEqual(copy);
  });
});
