import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { INTERSTELLAR_ORDER, INTERSTELLAR_RECORDS, loadInterstellar } from './index';

describe('interstellaires du registre', () => {
  it('refuse un ordre qui duplique une clé et en oublie une autre', () => {
    const records = INTERSTELLAR_RECORDS;
    const order = [...INTERSTELLAR_ORDER];
    order[order.length - 1] = order[0]!;
    expect(() => loadInterstellar(records, order)).toThrow(
      'registre interstellaire'
    );
  });

  it('déclare exactement les fiches présentes', () => {
    const files = readdirSync(import.meta.dirname)
      .filter((name) => name.endsWith('.json') && name !== 'order.json')
      .map((name) => name.slice(0, -5))
      .sort();
    expect(files).toEqual([...INTERSTELLAR_ORDER].sort());
    expect(INTERSTELLAR_RECORDS.map((record) => record.id).sort()).toEqual(
      files
    );
  });
});
