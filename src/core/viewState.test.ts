import { describe, expect, it } from 'vitest';
import {
  decodeFieldChanges,
  decodeLayerChanges,
  decodeSceneChanges,
  encodeFieldChanges,
  encodeLayerChanges,
  encodeSceneChanges,
} from './viewState';

describe('écarts du tableau de scène', () => {
  const changes = [
    { column: 'orbit', name: 'europa', on: true },
    { column: 'label', name: 'venus', on: false },
    { column: 'object', name: 'wild-2', on: false },
  ] as const;

  it('fait un aller-retour sans rien perdre', () => {
    const text = encodeSceneChanges(changes);
    expect(decodeSceneChanges(text)).toEqual(
      expect.arrayContaining([...changes])
    );
    expect(decodeSceneChanges(text)).toHaveLength(changes.length);
  });

  it('écrit le même lien quel que soit l’ordre des changements', () => {
    expect(encodeSceneChanges([...changes].reverse())).toBe(
      encodeSceneChanges(changes)
    );
  });

  it('écarte ce qui n’est pas un jeton valide, sans rien inventer', () => {
    expect(decodeSceneChanges('x+io,l*io,o+,o+<b>,o+Io,b-io')).toEqual([
      { column: 'object', name: 'io', on: false },
    ]);
  });

  it('ignore une valeur absente ou démesurée', () => {
    expect(decodeSceneChanges(null)).toEqual([]);
    expect(decodeSceneChanges('')).toEqual([]);
    expect(decodeSceneChanges('o+io,'.repeat(2000))).toEqual([]);
  });
});

describe('écarts des couches', () => {
  it('fait un aller-retour trié et sans doublon', () => {
    expect(
      encodeLayerChanges([
        { id: 'precip', on: true },
        { id: 'clouds', on: false },
      ])
    ).toBe('+precip,-clouds');
    expect(decodeLayerChanges('+precip,-clouds,+clouds')).toEqual([
      { id: 'precip', on: true },
      { id: 'clouds', on: false },
    ]);
  });

  it('écarte les identifiants mal formés', () => {
    expect(decodeLayerChanges('+clouds,+<x>,,*wind,+Wind')).toEqual([
      { id: 'clouds', on: true },
    ]);
    expect(decodeLayerChanges(null)).toEqual([]);
  });
});

describe('champ de petits corps (lot 61)', () => {
  it('écrit les catégories éteintes et les relit', () => {
    const off = [
      { id: 'neo', on: false },
      { id: 'comet', on: false },
    ];
    const text = encodeFieldChanges(off);
    expect(text).toBe('-comet,-neo');
    expect(decodeFieldChanges(text)).toEqual([
      { id: 'comet', on: false },
      { id: 'neo', on: false },
    ]);
  });

  it('écarte un jeton invalide sans rien inventer', () => {
    expect(decodeFieldChanges('-neo,neo2,*x,-')).toEqual([{ id: 'neo', on: false }]); // prettier-ignore
    expect(decodeFieldChanges(null)).toEqual([]);
  });
});
