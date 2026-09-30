import { describe, expect, it } from 'vitest';
import {
  groupByHost,
  sortInstruments,
  type InstrumentRecord,
  type SpacecraftArchive,
} from './instruments';
import { missionStanding } from './missions';

const instrument = (
  lid: string,
  name: string,
  host: string | null
): InstrumentRecord => ({ lid, name, host });

const archive = (
  hosts: readonly string[],
  instruments: readonly InstrumentRecord[]
): SpacecraftArchive => ({
  hosts: hosts.map((lid) => ({ lid, name: lid.split('.').pop()! })),
  investigations: [],
  instruments,
});

describe('instruments d’une sonde', () => {
  it('trie par nom publié, pas par identifiant', () => {
    const sorted = sortInstruments([
      instrument('urn:a:b:context:instrument:zz', 'Alpha', null),
      instrument('urn:a:b:context:instrument:aa', 'Omega', null),
    ]);
    expect(sorted.map((i) => i.name)).toEqual(['Alpha', 'Omega']);
  });

  it('ne modifie pas le tableau qu’on lui donne', () => {
    const input = [
      instrument('urn:a:b:context:instrument:zz', 'Omega', null),
      instrument('urn:a:b:context:instrument:aa', 'Alpha', null),
    ];
    sortInstruments(input);
    expect(input.map((i) => i.name)).toEqual(['Omega', 'Alpha']);
  });

  it('regroupe par porteur, dans l’ordre DÉCLARÉ des porteurs', () => {
    const { groups, orphans } = groupByHost(
      archive(
        [
          'urn:x:y:context:instrument_host:spacecraft.b',
          'urn:x:y:context:instrument_host:spacecraft.a',
        ],
        [
          instrument(
            'urn:x:y:context:instrument:one',
            'One',
            'urn:x:y:context:instrument_host:spacecraft.a'
          ),
          instrument(
            'urn:x:y:context:instrument:two',
            'Two',
            'urn:x:y:context:instrument_host:spacecraft.b'
          ),
        ]
      )
    );
    // L'ordre est celui de la déclaration, pas l'ordre alphabétique : c'est celui du constructeur
    // de la mission (MPO, MMO, MTM pour BepiColombo), et le réordonner perdrait cette information.
    expect(groups.map((g) => g.host.name)).toEqual(['b', 'a']);
    expect(groups[0]!.instruments.map((i) => i.name)).toEqual(['Two']);
    expect(orphans).toEqual([]);
  });

  it('GARDE un porteur qui ne déclare aucun instrument', () => {
    // C'est l'orbiteur magnétosphérique de BepiColombo. Le masquer ferait disparaître un tiers de
    // la sonde de sa fiche, sans que rien ne le dise.
    const { groups } = groupByHost(
      archive(['urn:x:y:context:instrument_host:spacecraft.vide'], [])
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.instruments).toEqual([]);
  });

  it('rend à part un instrument dont le porteur est inconnu, sans l’attribuer au hasard', () => {
    const { groups, orphans } = groupByHost(
      archive(
        ['urn:x:y:context:instrument_host:spacecraft.a'],
        [
          instrument('urn:x:y:context:instrument:sans', 'Sans porteur', null),
          instrument(
            'urn:x:y:context:instrument:ailleurs',
            'Ailleurs',
            'urn:x:y:context:instrument_host:spacecraft.z'
          ),
        ]
      )
    );
    expect(groups[0]!.instruments).toEqual([]);
    // Rattacher ces deux-là au premier porteur serait une affirmation que la source ne fait pas.
    expect(orphans.map((o) => o.name)).toEqual(['Ailleurs', 'Sans porteur']);
  });

  it('compte chaque instrument une fois et une seule', () => {
    const list = [
      instrument(
        'urn:x:y:context:instrument:1',
        'A',
        'urn:x:y:context:instrument_host:spacecraft.a'
      ),
      instrument('urn:x:y:context:instrument:2', 'B', null),
      instrument(
        'urn:x:y:context:instrument:3',
        'C',
        'urn:x:y:context:instrument_host:spacecraft.zz'
      ),
    ];
    const { groups, orphans } = groupByHost(
      archive(['urn:x:y:context:instrument_host:spacecraft.a'], list)
    );
    const total =
      groups.reduce((n, g) => n + g.instruments.length, 0) + orphans.length;
    expect(total).toBe(list.length);
  });

  it('LAISSE core/missions répondre pour l’état d’une investigation dans le temps', () => {
    // Une investigation a exactement la forme d'un `MissionRecord` : écrire une seconde horloge
    // ici aurait fait diverger deux réponses à la même question. Ce test est là pour que la
    // réutilisation soit un contrat et non un hasard.
    const investigation = {
      name: 'New Horizons Kuiper Belt Extended Mission 1',
      lid: 'urn:nasa:pds:context:investigation:mission.new_horizons_kem1',
      start: '2016-10-01',
      end: null,
    };
    expect(
      missionStanding(investigation, new Date('2015-01-01T00:00:00Z'))
    ).toBe('notYetStarted');
    expect(
      missionStanding(investigation, new Date('2019-01-01T00:00:00Z'))
    ).toBe('startedEndUndeclared');
  });
});
