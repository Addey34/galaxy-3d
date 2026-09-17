import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MakeTime } from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import {
  etSecondsFromDate,
  galaxyDeltaT,
  jdTdbFromDate,
  ttDaysFromDate,
} from './timeScale';

const utDays = (iso: string): number =>
  (Date.parse(iso) - Date.UTC(2000, 0, 1, 12)) / 86_400_000;

describe('convention d’échelle de temps (Horizons, TIME_TYPE=UT)', () => {
  it('suit la table des secondes intercalaires depuis 1972, figée après 2017', () => {
    expect(galaxyDeltaT(utDays('1972-01-01T00:00:00Z'))).toBe(42.184);
    expect(galaxyDeltaT(utDays('2016-12-31T23:59:59Z'))).toBe(68.184);
    expect(galaxyDeltaT(utDays('2017-01-01T00:00:00Z'))).toBe(69.184);
    // Là où astronomy-engine extrapolait 383 s puis 1 056 s.
    expect(galaxyDeltaT(utDays('2175-01-01T00:00:00Z'))).toBe(69.184);
    expect(galaxyDeltaT(utDays('2400-01-01T00:00:00Z'))).toBe(69.184);
  });

  it('lit UT1 et le ΔT historique avant 1972', () => {
    // Espenak-Meeus : ~29 s en 1950, ~120 s en 1600 (valeurs publiées).
    expect(galaxyDeltaT(utDays('1950-01-01T00:00:00Z'))).toBeCloseTo(29.1, 0);
    expect(galaxyDeltaT(utDays('1600-01-01T00:00:00Z'))).toBeCloseTo(120, -1);
  });

  /**
   * Le point décisif : astronomy-engine UTILISE cette convention (planètes, Lune, éclipses),
   * sans quoi une même date désignerait deux instants — 314 s d'écart en 2175.
   */
  it('est installée dans astronomy-engine', () => {
    for (const iso of [
      '1800-06-01T00:00:00Z',
      '2026-01-01T00:00:00Z',
      '2175-01-01T00:00:00Z',
    ]) {
      const date = new Date(iso);
      expect(MakeTime(date).tt).toBeCloseTo(ttDaysFromDate(date), 9);
    }
  });

  it('donne le même instant aux binaires Horizons et au noyau SPK', () => {
    for (const iso of [
      '1850-03-01T06:00:00Z',
      '2026-09-17T00:00:00Z',
      '2175-01-01T00:00:00Z',
    ]) {
      const date = new Date(iso);
      const fromJd = (jdTdbFromDate(date) - 2_451_545) * 86_400;
      expect(Math.abs(fromJd - etSecondsFromDate(date))).toBeLessThan(1e-3);
    }
  });

  /**
   * `SetDeltaTFunction` est un état GLOBAL d'astronomy-engine, posé à l'import de
   * `timeScale.ts`. Un module qui passe une date à astronomy-engine sans l'importer
   * fonctionnerait en test (un autre l'a importé) et, selon l'ordre de chargement, avec le ΔT
   * extrapolé ailleurs. On exige donc l'import partout où une valeur d'astronomy-engine autre
   * que l'énumération `Body` est importée.
   */
  it('est importée par tout module qui passe une date à astronomy-engine', () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.ts$/.test(entry) && !/\.test\.ts$/.test(entry))
          files.push(path);
      }
    };
    walk('src');

    const offenders = files.filter((path) => {
      if (path.replace(/\\/g, '/').endsWith('core/timeScale.ts')) return false;
      const source = readFileSync(path, 'utf-8');
      const values = [
        ...source.matchAll(
          /import\s+(?!type\b)\{([^}]*)\}\s+from\s+'astronomy-engine'/g
        ),
      ]
        .flatMap((match) => match[1].split(','))
        .map((name) => name.trim())
        .filter((name) => name && !name.startsWith('type ') && name !== 'Body');
      if (values.length === 0) return false;
      return !/import\s+(?:[^;]*from\s+)?'(?:\.\/|@\/core\/)timeScale'/.test(
        source
      );
    });
    expect(offenders).toEqual([]);
  });
});
