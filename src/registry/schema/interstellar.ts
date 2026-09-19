/** Schéma des objets interstellaires ; éléments déclarés, calculés par le chargeur pur. */
import { z } from 'zod';

const deg = z.object({ $deg: z.number() }).strict();
const date = z
  .object({ $date: z.string().datetime({ offset: false }).regex(/Z$/) })
  .strict();
const localized = z
  .object({ en: z.string().min(1), fr: z.string().min(1) })
  .strict();

const MONTHS = new Map(
  [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ].map((month, index) => [month, index])
);
const UNIX_EPOCH_JD = 2_440_587.5;
const MS_PER_DAY = 86_400_000;

function isHorizonsSolutionDate(value: string): boolean {
  const match = /^(\d{4})-([A-Z][a-z]{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const month = MONTHS.get(match[2]!);
  if (month === undefined) return false;
  const year = Number(match[1]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month &&
    date.getUTCDate() === day
  );
}

export const interstellarSchema = z
  .object({
    $schema: z.literal('../schema/interstellar.schema.json'),
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    targetClass: z.enum(['asteroid', 'comet']),
    population: z.literal('interstellar'),
    displayName: localized,
    designation: z.string().min(1),
    solution: z
      .object({
        horizonsRec: z.number().int().positive(),
        solutionDate: z.string().min(1),
        epochJd: z.number().positive(),
      })
      .strict(),
    elements: z
      .object({
        semiMajorAxisAU: z.number().negative(),
        eccentricity: z.number().gt(1),
        inclinationRad: deg,
        ascendingNodeRad: deg,
        argPerihelionRad: deg,
        meanAnomalyAtEpochRad: deg,
        epoch: date,
      })
      .strict(),
    color: z.string().regex(/^0x[0-9a-fA-F]{6}$/),
    notes: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .superRefine((record, ctx) => {
    if (!isHorizonsSolutionDate(record.solution.solutionDate))
      ctx.addIssue({
        code: 'custom',
        path: ['solution', 'solutionDate'],
        message: 'date de solution Horizons impossible',
      });

    const epochMs = Date.parse(record.elements.epoch.$date);
    const epochJd = epochMs / MS_PER_DAY + UNIX_EPOCH_JD;
    if (Math.abs(epochJd - record.solution.epochJd) > 1e-9)
      ctx.addIssue({
        code: 'custom',
        path: ['solution', 'epochJd'],
        message: 'epochJd ne correspond pas à elements.epoch',
      });
  });

export type InterstellarRecord = z.infer<typeof interstellarSchema>;
export function interstellarJsonSchemaText(): string {
  return `${JSON.stringify(z.toJSONSchema(interstellarSchema, { io: 'input' }), null, 2)}\n`;
}
