/** Schéma des sondes ; Zod sert aux tests et à la génération, jamais au bundle client. */
import { z } from 'zod';

const instant = z.string().datetime({ offset: false }).regex(/Z$/);
const localized = z
  .object({ en: z.string().min(1), fr: z.string().min(1) })
  .strict();

export const spacecraftSchema = z
  .object({
    $schema: z.literal('../schema/spacecraft.schema.json'),
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    targetClass: z.literal('spacecraft'),
    displayName: localized,
    description: localized,
    launchDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    color: z.string().regex(/^0x[0-9a-fA-F]{6}$/),
    identifiers: z.object({ naif: z.number().int().negative() }).strict(),
    coverage: z
      .object({
        temporal: z
          .object({ interval: z.array(z.tuple([instant, instant])).length(1) })
          .strict(),
      })
      .strict(),
    notes: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export type SpacecraftRecord = z.infer<typeof spacecraftSchema>;
export function spacecraftJsonSchemaText(): string {
  return `${JSON.stringify(z.toJSONSchema(spacecraftSchema, { io: 'input' }), null, 2)}\n`;
}
