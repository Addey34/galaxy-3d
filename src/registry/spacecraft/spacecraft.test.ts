/** Témoin figé : legacyFixture.ts est la copie exacte du littéral avant le lot 7D. */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SPACECRAFT_MISSIONS } from '@/config/spacecraft';
import { SPACECRAFT_MISSIONS as LEGACY } from './legacyFixture';
import { compareStrict } from '../strictLegacy';
import { SPACECRAFT_ORDER, SPACECRAFT_RECORDS } from './index';

const manifest = JSON.parse(
  readFileSync(
    resolve(
      import.meta.dirname,
      '../../../public/assets/ephemerides/manifest.json'
    ),
    'utf8'
  )
) as {
  bodies: Record<
    string,
    {
      target: string;
      center: string;
      startJdTdb: number;
      stepDays: number;
      sampleCount: number;
    }
  >;
};

describe('sondes du registre', () => {
  it('reproduit le littéral exact, bits et ordre des clés compris', () => {
    compareStrict(SPACECRAFT_MISSIONS, LEGACY);
  });

  it('déclare exactement les fiches présentes', () => {
    const files = readdirSync(import.meta.dirname)
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -5))
      .sort();
    expect(files).toEqual([...SPACECRAFT_ORDER].sort());
    expect(SPACECRAFT_RECORDS.map((record) => record.id).sort()).toEqual(files);
  });

  it.each(SPACECRAFT_RECORDS)(
    '$id : identité NAIF et couverture réelle du manifeste',
    (record) => {
      const entry = manifest.bodies[record.id];
      expect(entry).toBeDefined();
      expect(entry.center).toBe('sun');
      expect(String(record.identifiers.naif)).toBe(entry.target);
      const instant = (jd: number) =>
        new Date((jd - 2440587.5) * 86400000)
          .toISOString()
          .replace('.000Z', 'Z');
      expect(record.coverage.temporal.interval).toEqual([
        [
          instant(entry.startJdTdb),
          instant(entry.startJdTdb + entry.stepDays * (entry.sampleCount - 1)),
        ],
      ]);
    }
  );
});
