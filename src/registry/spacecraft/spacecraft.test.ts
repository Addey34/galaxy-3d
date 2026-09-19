import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SPACECRAFT_ORDER, SPACECRAFT_RECORDS, loadSpacecraft } from './index';

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
  it('refuse un ordre qui duplique une clé et en oublie une autre', () => {
    const records = SPACECRAFT_RECORDS;
    const order = [...SPACECRAFT_ORDER];
    order[order.length - 1] = order[0]!;
    expect(() => loadSpacecraft(records, order)).toThrow('registre des sondes');
  });

  it('déclare exactement les fiches présentes', () => {
    const files = readdirSync(import.meta.dirname)
      .filter((name) => name.endsWith('.json') && name !== 'order.json')
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
