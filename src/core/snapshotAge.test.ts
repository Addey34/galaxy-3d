import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  SMALL_BODY_SNAPSHOT_MAX_AGE_DAYS,
  isSnapshotStale,
  snapshotAgeDays,
  snapshotAgeMonths,
} from './snapshotAge';

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe('âge d’un instantané', () => {
  it('compte les jours révolus, le jour du relevé valant 0', () => {
    expect(snapshotAgeDays('2026-09-20', at('2026-09-20'))).toBe(0);
    expect(snapshotAgeDays('2026-09-20', at('2026-09-21'))).toBe(1);
    expect(snapshotAgeDays('2026-09-20', at('2027-09-20'))).toBe(365);
  });

  it('ne rend jamais un âge négatif pour une horloge en retard sur le relevé', () => {
    expect(snapshotAgeDays('2026-09-20', at('2026-01-01'))).toBe(0);
  });

  it('se déclare périmé au-delà de l’âge déclaré, pas avant', () => {
    expect(SMALL_BODY_SNAPSHOT_MAX_AGE_DAYS).toBe(180);
    // 2026-09-20 + 180 jours = 2027-03-19.
    expect(isSnapshotStale('2026-09-20', at('2027-03-19'))).toBe(false);
    expect(isSnapshotStale('2026-09-20', at('2027-03-20'))).toBe(true);
  });

  it('ne tient pas une date illisible pour fraîche', () => {
    expect(snapshotAgeDays('2026-02-30', at('2026-03-01'))).toBeNull();
    expect(isSnapshotStale('pas une date', at('2026-03-01'))).toBe(true);
  });

  it('compte les mois de calendrier révolus', () => {
    expect(snapshotAgeMonths('2026-09-20', at('2027-03-19'))).toBe(5);
    expect(snapshotAgeMonths('2026-09-20', at('2027-03-20'))).toBe(6);
    expect(snapshotAgeMonths('2026-09-20', at('2028-01-05'))).toBe(15);
  });
});

/**
 * Le contrôle daté ne vaut que s'il TOURNE sans qu'on y pense : le workflow doit être planifié,
 * et lancer la commande qui active ce fichier. Un workflow qui lancerait autre chose, ou qui
 * ne serait plus planifié, resterait vert pour toujours.
 */
describe('surveillance planifiée de l’instantané', () => {
  const workflow = readFileSync('.github/workflows/data-freshness.yml', 'utf8');
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
    scripts: Record<string, string>;
  };

  it('est planifiée, et lance la commande qui active le contrôle daté', () => {
    expect(workflow).toMatch(/^\s+schedule:\s*\n\s+- cron: '[^']+'/m);
    expect(workflow).toMatch(/^\s+- run: pnpm smallbodies:age\s*$/m);
    expect(pkg.scripts['smallbodies:age']).toBe(
      'node scripts/check-small-body-snapshot-age.mjs'
    );
    const script = readFileSync(
      'scripts/check-small-body-snapshot-age.mjs',
      'utf8'
    );
    expect(script).toContain("GALAXY_SNAPSHOT_AGE_CHECK: '1'");
    expect(script).toContain('src/core/snapshotAge.test.ts');
  });
});

/**
 * LE CONTRÔLE DATÉ, confronté à l'instantané COMMITÉ et à la date DU JOUR. Il ne tourne pas
 * dans `pnpm verify` : une porte qui rougit parce que le calendrier a tourné bloquerait un
 * déploiement sans rapport et rendrait la porte non reproductible. Il tourne quand on le
 * demande (`pnpm smallbodies:age`), et chaque semaine dans `.github/workflows/data-freshness.yml`,
 * dont l'échec prévient le propriétaire du dépôt sans que personne ait à y penser.
 */
describe.runIf(process.env.GALAXY_SNAPSHOT_AGE_CHECK === '1')(
  'instantané des petits corps livré',
  () => {
    it(`a moins de ${SMALL_BODY_SNAPSHOT_MAX_AGE_DAYS} jours`, () => {
      const file = JSON.parse(
        readFileSync('public/assets/small-bodies/dataset.json', 'utf8')
      ) as { retrieved: string };
      const now = new Date();
      const age = snapshotAgeDays(file.retrieved, now);
      expect(
        isSnapshotStale(file.retrieved, now),
        `relevé du ${file.retrieved}, vieux de ${age} jours : relancer « pnpm smallbodies:generate »`
      ).toBe(false);
    });
  }
);
