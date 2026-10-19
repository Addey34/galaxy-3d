/**
 * SCHÉMA D'UN PRÉRÉGLAGE D'AFFICHAGE (`src/registry/presets/*.json`) — lot 59.
 *
 * Même contrat que les registres de visites et d'activités : ce schéma Zod est la SEULE
 * déclaration, le JSON Schema commité (`preset.schema.json`) en est généré par
 * `pnpm schema:generate --only preset` et comparé octet pour octet par un test. Zod reste en
 * `devDependency` : rien ici n'atteint le bundle client (`bundleIsolation.test.ts`).
 *
 * UN PRÉRÉGLAGE NE DÉCRIT QUE CE QUI DIFFÈRE DE LA RÈGLE. Le tableau « Dans la scène » a une règle
 * de départ unique (`ui/defaultDisplay.ts`) ; une fiche en écrit des ÉCARTS, par catégorie
 * (`kinds`) puis par objet (`bodies`, qui l'emporte). Une case non nommée garde la règle : un
 * corps ajouté demain au catalogue reçoit donc le comportement du préréglage sans que personne ne
 * retouche une fiche, ce qu'une liste exhaustive de noms ne ferait pas.
 */
import { z } from 'zod';

const localized = z
  .object({
    en: z.string().min(1),
    fr: z.string().min(1),
    es: z.string().min(1),
    'pt-BR': z.string().min(1),
  })
  .strict();

/** Les trois cases d'une ligne du tableau, toutes facultatives : seules les cases nommées changent. */
const columns = z
  .object({
    label: z.boolean().optional(),
    object: z.boolean().optional(),
    orbit: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'un écart vide ne change rien : le retirer',
  });

/**
 * Les catégories du tableau. Recopiées de `BodyKind` (hors `skybox`, qui n'a pas de ligne) parce
 * qu'un schéma de registre n'importe pas un module d'interface ; `preset.schema.test.ts` les
 * confronte à `BodyKind`, pour qu'une catégorie ajoutée ne reste pas sans préréglage possible.
 */
export const PRESET_KINDS = [
  'planet',
  'moon',
  'dwarf',
  'asteroid',
  'comet',
  'spacecraft',
  'interstellar',
] as const;

const kindsShape = Object.fromEntries(
  PRESET_KINDS.map((kind) => [kind, columns.optional()])
) as Record<(typeof PRESET_KINDS)[number], z.ZodOptional<typeof columns>>;

export const presetSchema = z
  .object({
    $schema: z.literal('../schema/preset.schema.json'),
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    title: localized,
    /** Une phrase : ce que le préréglage montre, et pour qui. Affichée sous le sélecteur. */
    description: localized,
    kinds: z.object(kindsShape).strict().optional(),
    /** Écarts par objet, sous le nom exact du catalogue (« Io », « Voyager 1 »). */
    bodies: z.record(z.string().min(1), columns).optional(),
  })
  .strict()
  .superRefine((record, ctx) => {
    if (
      Object.keys(record.kinds ?? {}).length === 0 &&
      Object.keys(record.bodies ?? {}).length === 0
    )
      ctx.addIssue({
        code: 'custom',
        path: ['kinds'],
        message:
          'un préréglage sans aucun écart est la règle par défaut, qui n’a pas de fiche',
      });
  });

export type PresetRecord = z.infer<typeof presetSchema>;
export type PresetColumns = z.infer<typeof columns>;

export function presetJsonSchemaText(): string {
  return `${JSON.stringify(z.toJSONSchema(presetSchema, { io: 'input' }), null, 2)}\n`;
}
