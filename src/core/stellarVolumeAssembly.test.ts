import { describe, expect, it } from 'vitest';
import { assembleVolume } from './stellarVolumeAssembly';
import {
  assembleShippedVolume,
  rawVolumeFile,
  readVolumeIndex,
  shippedVolumeSources,
  volumeJson,
} from './stellarVolumeTestFixture';

/**
 * LA SÉPARATION DES DONNÉES (GAL-UNIVERSE-008, décision du CTO, option A) : un dossier par fournisseur,
 * chacun sous SA licence ; des tables de correspondance de Galaxy qui ne portent que des identifiants ;
 * un assemblage à l'exécution qui survit à un fournisseur désactivé ou remplacé.
 */
const index = readVolumeIndex();
const full = assembleShippedVolume();
const structure = volumeJson<{
  hiddenGcns: number[];
  hiddenMissing: number[];
}>(index.crossmatch.structure.file);

describe('chaque fichier ne porte qu’un fournisseur', () => {
  it('chaque dossier a sa notice, avec sa licence et son titulaire', () => {
    const expected: Array<[string, RegExp]> = [
      [
        'gcns/NOTICE.txt',
        /Richard Smart is licensed under CC BY-NC 4\.0[\s\S]*CC BY-NC 3\.0 IGO/,
      ],
      ['gcns-missing/NOTICE.txt', /CC BY-NC 4\.0[\s\S]*CDS\/SIMBAD/],
      ['hyg/NOTICE.txt', /Attribution-ShareAlike 4\.0[\s\S]*CC BY-SA 4\.0/],
      ['nasa/NOTICE.txt', /NASA Exoplanet Archive, which is operated/],
    ];
    for (const [file, pattern] of expected) {
      const text = rawVolumeFile(file).toString('utf8');
      expect(text, file).toMatch(pattern);
      // Le logiciel et les données ne sont pas sous la même licence, et chaque notice le dit.
      expect(text, file).toMatch(/NOT covered by it/);
    }
  });

  it('les fichiers de HYG, de la liste des absentes et de la NASA n’ont aucun champ d’un autre catalogue', () => {
    const fieldsOf = (file: string): string[] =>
      volumeJson<{ fields: string[] }>(file).fields;
    const P = index.providers;
    expect(fieldsOf(P.hyg.complement.file)).toEqual([
      'hygId',
      'name',
      'spectral',
      'raDeg',
      'decDeg',
      'distPc',
      'vmag',
      'bv',
      'pmRaMas',
      'pmDecMas',
      'rvKms',
    ]);
    expect(fieldsOf(P.hyg.names.file)).toEqual(['hygId', 'name']);
    expect(fieldsOf(P.gcnsMissing.file)).toEqual([
      'mainId',
      'raDeg',
      'decDeg',
      'parallaxMas',
    ]);
    expect(fieldsOf(P.nasa.file)).toEqual(['gaiaDr3Id', 'host', 'planets']);
  });

  it('les tables de correspondance ne portent que des entiers (rangs, identifiants) et des empreintes', () => {
    const cross = volumeJson<Record<string, unknown>>(
      index.crossmatch.structure.file
    );
    const names = volumeJson<Record<string, unknown>>(
      index.crossmatch.names.file
    );
    const integers = (v: unknown): boolean =>
      Array.isArray(v)
        ? v.every(integers)
        : typeof v === 'number' && Number.isInteger(v);
    for (const key of ['hiddenGcns', 'hiddenMissing', 'missingHyg', 'hostGcns'])
      expect(integers(cross[key]), key).toBe(true);
    expect(integers(names['pairs'])).toBe(true);
    expect(Object.keys(cross).sort()).toEqual(
      [
        'binds',
        'hiddenGcns',
        'hiddenMissing',
        'hostGcns',
        'missingHyg',
        'rights',
      ].sort()
    );
    expect(Object.keys(names).sort()).toEqual(['binds', 'pairs', 'rights']);
  });
});

describe('un fournisseur désactivé ou remplacé ne casse pas le moteur', () => {
  it('sans HYG : les absentes de Gaia gardent la position et la parallaxe de SIMBAD, la couverture reste', () => {
    const v = assembleVolume(shippedVolumeSources({ hygComplement: null }));
    expect(v.missingParts).toContain('hyg');
    expect(v.manifest.counts['hyg']).toBe(0);
    // Les étoiles d'Hipparcos redeviennent des lignes SIMBAD ; aucune étoile ne disparaît.
    expect(v.manifest.counts['simbad']).toBeGreaterThanOrEqual(
      index.expected.counts['hyg']! + index.expected.counts['simbad']!
    );
    expect(v.manifest.count).toBeGreaterThanOrEqual(index.expected.count);
    const { names, fromHyg } = v.withHygNames(null, null);
    expect(fromHyg.size).toBe(0);
    expect(Object.keys(names).length).toBeGreaterThan(1000);
  });

  it('sans le GCNS : les absentes seules, une coquille se construit sans fichier du GCNS', () => {
    const v = assembleVolume(shippedVolumeSources({ gcns: false }));
    expect(v.manifest.counts['gcns']).toBe(0);
    expect(v.gcnsShellFile(0)).toBeNull();
    const buffer = v.shellBuffer(0, null);
    expect(buffer.byteLength).toBe(v.manifest.shells[0]!.count * 16);
    expect(v.manifest.count).toBe(
      index.expected.counts['hyg']! + index.expected.counts['simbad']!
    );
  });

  it('sans la NASA : aucun hôte, le reste intact', () => {
    const v = assembleVolume(shippedVolumeSources({ nasa: null }));
    expect(v.manifest.counts['exoplanetHosts']).toBe(0);
    expect(v.manifest.count).toBe(index.expected.count);
  });

  it('un fournisseur remplacé sans refaire la table : la jointure est refusée, jamais appliquée à tort', () => {
    const sources = shippedVolumeSources();
    const v = assembleVolume({
      ...sources,
      index: {
        ...sources.index,
        providers: {
          ...sources.index.providers,
          hyg: { ...sources.index.providers.hyg, sha256: 'autre-version' },
        },
      },
    });
    expect(v.missingParts).toContain('crossmatch:gcnsMissing+hyg');
    expect(v.manifest.counts['hyg']).toBe(0);
    const names = v.withHygNames(
      volumeJson(index.providers.hyg.names.file),
      volumeJson(index.crossmatch.names.file)
    );
    expect(names.fromHyg.size).toBe(0);
  });

  it('un fournisseur désactivé dans l’index n’est pas utilisé même si ses données sont là', () => {
    const sources = shippedVolumeSources();
    const v = assembleVolume({
      ...sources,
      index: {
        ...sources.index,
        providers: {
          ...sources.index.providers,
          nasa: { ...sources.index.providers.nasa, enabled: false },
        },
      },
    });
    expect(v.missingParts).toContain('nasa');
    expect(v.manifest.counts['exoplanetHosts']).toBe(0);
  });
});

describe('les rapprochements', () => {
  it('aucune étoile ne reçoit deux noms de HYG, aucune ligne de HYG ne nomme deux étoiles', () => {
    const pairs = volumeJson<{ pairs: Array<[number, number]> }>(
      index.crossmatch.names.file
    ).pairs;
    expect(new Set(pairs.map((p) => p[0])).size).toBe(pairs.length);
    expect(new Set(pairs.map((p) => p[1])).size).toBe(pairs.length);
  });

  it('les doublons du voisinage sont cachés : Sirius, Proxima et α Cen A ne sont pas dans le volume', () => {
    const all = Object.values(full.names).map((e) => e[0]);
    for (const name of ['Sirius', 'Proxima Centauri', 'Rigil Kentaurus'])
      expect(all, name).not.toContain(name);
    expect(index.expected.counts['hiddenNeighbours']).toBe(
      structure.hiddenGcns.length + structure.hiddenMissing.length
    );
  });

  it('un nom de HYG posé sur une étoile du GCNS est marqué comme tel (la fiche cite sa licence)', () => {
    const indexOf = (name: string): number =>
      Number(Object.entries(full.names).find(([, e]) => e[0] === name)![0]);
    // Véga : ligne HYG complète (absente de Gaia) ; son origine le dit déjà, pas la marque des noms.
    expect(full.fromHyg.has(indexOf('Vega'))).toBe(false);
    for (const at of full.fromHyg)
      expect(full.assembly.gcnsIndexOf(at)).toBeGreaterThanOrEqual(0);
  });
});
