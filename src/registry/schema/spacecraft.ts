/** Schéma des sondes ; Zod sert aux tests et à la génération, jamais au bundle client. */
import { z } from 'zod';
import { fact } from './entity';

const instant = z.string().datetime({ offset: false }).regex(/Z$/);
const localized = z
  .object({ en: z.string().min(1), fr: z.string().min(1) })
  .strict();

function isCalendarDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

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
    /**
     * Faits affichés par la fiche. `launchDate` ne porte pas de valeur ici : elle vit déjà
     * au-dessus, seule sa PROVENANCE manquait, et un fait sans provenance ne s'affiche pas.
     * La liste est celle que `core/bodyFacts.INSTRUMENT_FACTS` déclare applicable à une sonde.
     */
    facts: z
      .object({
        launchDate: fact,
        launchVehicle: fact,
        launchSite: fact,
        massKg: fact,
      })
      .partial()
      .strict()
      .optional(),
    coverage: z
      .object({
        temporal: z
          .object({ interval: z.array(z.tuple([instant, instant])).length(1) })
          .strict(),
      })
      .strict(),
    notes: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .superRefine((record, ctx) => {
    if (!isCalendarDate(record.launchDate))
      ctx.addIssue({
        code: 'custom',
        path: ['launchDate'],
        message: 'date de lancement impossible',
      });
    const [from, to] = record.coverage.temporal.interval[0]!;
    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    if (!(fromMs < toMs))
      ctx.addIssue({
        code: 'custom',
        path: ['coverage', 'temporal', 'interval'],
        message: 'couverture temporelle inversée ou vide',
      });
    if (
      isCalendarDate(record.launchDate) &&
      fromMs < Date.parse(`${record.launchDate}T00:00:00Z`)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['coverage', 'temporal', 'interval'],
        message: 'la couverture ne peut pas précéder le lancement',
      });
  });

export type SpacecraftRecord = z.infer<typeof spacecraftSchema>;
export function spacecraftJsonSchemaText(): string {
  return `${JSON.stringify(z.toJSONSchema(spacecraftSchema, { io: 'input' }), null, 2)}\n`;
}
