import { describe, expect, it } from 'vitest';
import {
  nextAdoption,
  namesAdoptedAt,
  type BodyAdoptions,
} from './nameAdoption';

const at = (iso: string): Date => new Date(`${iso}T12:00:00Z`);

/** La forme de la Lune livrée, réduite : une année seule, puis un lot de lettrées. */
const moonLike: BodyAdoptions = {
  total: 700,
  lettered: 500,
  steps: [
    ['1935', 100, 0],
    ['2006', 510, 500],
    ['2010-03-12', 90, 0],
  ],
};

describe('noms adoptés par l’UAI à une date', () => {
  it('ne compte rien avant la première adoption', () => {
    const { named, lettered } = namesAdoptedAt(moonLike, at('1934-06-01'));
    expect(named).toEqual({ atLeast: 0, atMost: 0, total: 200 });
    expect(lettered).toEqual({ atLeast: 0, atMost: 0, total: 500 });
  });

  it('fait d’une année seule une BORNE quand la scène la traverse', () => {
    const { named } = namesAdoptedAt(moonLike, at('1935-06-01'));
    expect(named).toEqual({ atLeast: 0, atMost: 100, total: 200 });
  });

  it('compte l’année seule entière une fois l’année révolue', () => {
    const { named } = namesAdoptedAt(moonLike, at('1936-01-01'));
    expect(named).toEqual({ atLeast: 100, atMost: 100, total: 200 });
  });

  it('sépare les désignations lettrées des noms propres', () => {
    const { named, lettered } = namesAdoptedAt(moonLike, at('2007-01-01'));
    expect(named).toEqual({ atLeast: 110, atMost: 110, total: 200 });
    expect(lettered).toEqual({ atLeast: 500, atMost: 500, total: 500 });
  });

  it('date au JOUR une adoption publiée au jour', () => {
    expect(namesAdoptedAt(moonLike, at('2010-03-11')).named.atMost).toBe(110);
    expect(namesAdoptedAt(moonLike, at('2010-03-12')).named).toEqual({
      atLeast: 200,
      atMost: 200,
      total: 200,
    });
  });

  it('donne la prochaine adoption, et rien quand tout est adopté', () => {
    expect(nextAdoption(moonLike, at('1900-01-01'))?.[0]).toBe('1935');
    // Une année que la scène traverse n'est pas « prochaine » : elle est peut-être passée.
    expect(nextAdoption(moonLike, at('2006-06-01'))?.[0]).toBe('2010-03-12');
    expect(nextAdoption(moonLike, at('2020-01-01'))).toBeNull();
  });
});
