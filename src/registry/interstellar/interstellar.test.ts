import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { INTERSTELLAR_OBJECTS } from '@/config/interstellar';
import { INTERSTELLAR_ORDER, INTERSTELLAR_RECORDS } from './index';

describe('interstellaires du registre', () => {
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
