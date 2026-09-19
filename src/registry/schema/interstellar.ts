/** Schéma des objets interstellaires ; éléments déclarés, calculés par le chargeur pur. */
import { z } from 'zod';

const deg = z.object({ $deg: z.number() }).strict();
const date = z
  .object({ $date: z.string().datetime({ offset: false }).regex(/Z$/) })
  .strict();
const localized = z
  .object({ en: z.string().min(1), fr: z.string().min(1) })
  .strict();

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
  .strict();

export type InterstellarRecord = z.infer<typeof interstellarSchema>;
export function interstellarJsonSchemaText(): string {
  return `${JSON.stringify(z.toJSONSchema(interstellarSchema, { io: 'input' }), null, 2)}\n`;
}
