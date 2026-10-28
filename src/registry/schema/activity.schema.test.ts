import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { activityJsonSchemaText, activitySchema } from './activity';

/**
 * LE SCHÉMA DES ACTIVITÉS FAIT FOI, LE JSON SCHEMA COMMITÉ EN EST UNE COPIE (lot 58), et il
 * refuse ce qui ferait publier un corrigé sans preuve.
 */
const ACTIVITIES = resolve(import.meta.dirname, '../activities');
const files = (): string[] =>
  readdirSync(ACTIVITIES)
    .filter((name) => name.endsWith('.json') && name !== 'order.json')
    .map((name) => join(ACTIVITIES, name));
const read = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;

describe('JSON Schema des activités généré depuis Zod', () => {
  it('est exactement le fichier commité', () => {
    const committed = readFileSync(resolve(import.meta.dirname, 'activity.schema.json'), 'utf-8'); // prettier-ignore
    expect(
      committed,
      'le schéma Zod a changé : relancer `pnpm schema:generate --only activity` et committer'
    ).toBe(activityJsonSchemaText());
  });
});

describe('fiches d’activité', () => {
  it.each(files())('%s passe le schéma', (file) => {
    const result = activitySchema.safeParse(read(file));
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  const valid = read(join(ACTIVITIES, 'seasons.json'));
  const galileans = read(join(ACTIVITIES, 'galileans.json'));
  type Part = {
    questions: { answer: Record<string, string>; evidence: string[] }[];
  };
  const withFirstQuestion = (
    edit: (q: Part['questions'][number]) => void
  ): Record<string, unknown> => {
    const copy = structuredClone(valid) as { parts: Part[] };
    edit(copy.parts[0]!.questions[0]!);
    return copy;
  };

  it.each([
    [
      'une réponse sans preuve',
      withFirstQuestion((q) => {
        q.evidence = [];
      }),
    ],
    [
      'une preuve non déclarée',
      withFirstQuestion((q) => {
        q.evidence = ['inventee'];
      }),
    ],
    [
      'un emplacement non déclaré',
      withFirstQuestion((q) => {
        q.answer.fr += ' {inventee}';
      }),
    ],
    [
      'une traduction qui tait un nombre',
      withFirstQuestion((q) => {
        q.answer.es = q.answer.es!.replace('{apsisGap}', 'unos tres');
      }),
    ],
    [
      'une valeur citée nulle part',
      {
        ...valid,
        values: {
          ...(valid['values'] as object),
          orpheline: { kind: 'apsisGapPercent', decimals: 1 },
        },
      },
    ],
    [
      'un accord avec une valeur absente',
      {
        ...valid,
        values: {
          ...(valid['values'] as object),
          sunJune: {
            kind: 'subsolarLatitude',
            event: 'june-solstice',
            decimals: 1,
            agrees: { value: 'absente', tolerance: 0.05 },
          },
        },
      },
    ],
    [
      'un rapport de périodes d’un corps avec lui-même',
      {
        ...galileans,
        values: {
          ...(galileans['values'] as object),
          ioEuropa: {
            kind: 'factRatio',
            fact: 'orbitPeriodDays',
            outer: 'io',
            inner: 'io',
            decimals: 1,
          },
        },
      },
    ],
  ] as const)('refuse %s', (_label, record) => {
    expect(activitySchema.safeParse(record).success).toBe(false);
  });
});
