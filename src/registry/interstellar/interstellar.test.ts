/** Témoin figé : legacyFixture.ts est la copie exacte du littéral avant le lot 7D. */
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { INTERSTELLAR_OBJECTS } from '@/config/interstellar';
import { INTERSTELLAR_OBJECTS as LEGACY } from './legacyFixture';
import { compareStrict } from '../strictLegacy';
import { INTERSTELLAR_ORDER, INTERSTELLAR_RECORDS } from './index';

describe('interstellaires du registre', () => {
  it('reproduit le littéral exact, bits et ordre des clés compris', () => {
    compareStrict(INTERSTELLAR_OBJECTS, LEGACY);
  });

  it('déclare exactement les fiches présentes', () => {
    const files = readdirSync(import.meta.dirname)
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -5))
      .sort();
    expect(files).toEqual([...INTERSTELLAR_ORDER].sort());
    expect(INTERSTELLAR_RECORDS.map((record) => record.id).sort()).toEqual(
      files
    );
  });
});
