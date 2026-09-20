/**
 * SCHÉMA D'UNE FICHE D'ENTITÉ (`src/registry/entities/*.json`). Même contrat que `provider.ts` et
 * `product.ts` : seule déclaration, JSON Schema commité généré par `pnpm schema:generate` et
 * comparé par un test, Zod en `devDependency` jamais livré (`bundleIsolation.test.ts`).
 *
 * Ce que le schéma valide : la FORME. Les clés permises (une faute de frappe est refusée), les
 * vocabulaires fermés (classe de cible EPNCore, `kind`, corps astronomy-engine), la forme d'un
 * fait, et les FORMES DÉCLARÉES de calcul, dont la liste est lue dans le chargeur
 * (`EXPRESSION_FORMS`) plutôt que recopiée.
 *
 * Ce qu'il ne valide PAS, et ne doit surtout pas avoir l'air de valider (piège 4 du plan) : la
 * JUSTESSE. Un `maDeg` faux à l'époque déclarée déplace un corps à toutes les dates sans la
 * moindre erreur. Les gardes du fond restent `smallBodies.test.ts` (contre un vecteur Horizons),
 * `ephemerisPlausibility.test.ts` et `factProvenance.test.ts` (contre les sources relevées).
 */
import { z } from 'zod';
import { Body } from 'astronomy-engine';
import { decode, EXPRESSION_FORMS } from '../load';

const kebabId = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

/** Valeur encodée : JSON ordinaire, où un objet aux clés toutes en `$` est une forme déclarée. */
type EncodedInput =
  | null
  | boolean
  | number
  | string
  | EncodedInput[]
  | { [key: string]: EncodedInput };

const isoInstant = z.string().regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);

const expression = z.lazy(() =>
  z.union(
    EXPRESSION_FORMS.map((keys) =>
      z
        .object(
          Object.fromEntries(
            keys.map((k) => [
              k,
              k === '$date'
                ? isoInstant
                : k === '$retrograde'
                  ? z.literal(true)
                  : encoded,
            ])
          )
        )
        .strict()
    ) as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]
  )
) as unknown as z.ZodType<EncodedInput>;

/** Un objet de données : aucune clé ne commence par `$`, sinon c'est une forme (ci-dessus). */
const plainObject: z.ZodType<{ [key: string]: EncodedInput }> = z.lazy(() =>
  z.record(
    z
      .string()
      .regex(/^[^$]/, 'une clé en « $ » est réservée aux formes déclarées'),
    encoded
  )
);

const encoded: z.ZodType<EncodedInput> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(encoded),
    expression,
    plainObject,
  ])
);

const localized = z
  .object({ en: z.string().min(1), fr: z.string().min(1) })
  .strict();
const displayName = z
  .object({ en: z.string(), fr: z.string() })
  .partial()
  .strict();
const astroBody = z.enum(Object.values(Body) as [string, ...string[]]);
const color = z.string().regex(/^0x[0-9a-f]{6}$/);

/**
 * Un fait : sa valeur, sa provenance, ou la raison de ne pas le publier.
 *
 * Exporté parce que les fiches de sondes et d'objets interstellaires portent EXACTEMENT la
 * même forme de fait (`schema/spacecraft.ts`, `schema/interstellar.ts`) : ce qui diffère entre
 * les trois familles, c'est la LISTE des champs, pas ce qu'est un fait. Le dupliquer aurait
 * laissé deux définitions dériver, et c'est précisément ce que le lot 7 a supprimé ailleurs.
 */
export const fact = z
  .object({
    value: encoded.optional(),
    source: kebabId.optional(),
    method: z.enum(['measured', 'derived', 'illustrative']).optional(),
    asOf: z
      .string()
      .regex(/^\d{4}-\d{2}(-\d{2})?$/)
      .optional(),
    uncertainty: encoded.optional(),
    /** Clé de `DETAIL` (`config/factSources.ts`) ou texte propre. */
    detail: z.union([z.string().regex(/^[a-zA-Z0-9]+$/), localized]).optional(),
    citation: z.string().min(1).optional(),
    published: z.literal(false).optional(),
    reason: z
      .union([
        z.literal('not-yet-sourced'),
        localized.extend({ unsourced: z.boolean().optional() }).strict(),
      ])
      .optional(),
  })
  .strict()
  .superRefine((f, ctx) => {
    if (f.source !== undefined && f.method === undefined)
      ctx.addIssue({ code: 'custom', message: 'une source sans méthode' });
    if (f.method !== undefined && f.source === undefined)
      ctx.addIssue({ code: 'custom', message: 'une méthode sans source' });
    if (
      f.source === undefined &&
      (f.asOf !== undefined ||
        f.uncertainty !== undefined ||
        f.detail !== undefined ||
        f.citation !== undefined)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'les métadonnées de provenance exigent une source',
      });
    if (f.asOf !== undefined) {
      const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(f.asOf);
      const year = Number(match?.[1]);
      const month = Number(match?.[2]);
      const day = match?.[3] === undefined ? undefined : Number(match[3]);
      const validMonth = month >= 1 && month <= 12;
      const lastDay =
        day === undefined || !validMonth
          ? 31
          : new Date(Date.UTC(year, month, 0)).getUTCDate();
      if (!validMonth || (day !== undefined && (day < 1 || day > lastDay)))
        ctx.addIssue({ code: 'custom', message: 'date asOf impossible' });
    }
    if (f.uncertainty !== undefined) {
      try {
        const uncertainty = decode(f.uncertainty, 'facts.uncertainty');
        if (
          typeof uncertainty !== 'number' ||
          !Number.isFinite(uncertainty) ||
          uncertainty < 0
        )
          throw new Error('invalid');
      } catch {
        ctx.addIssue({
          code: 'custom',
          message: 'uncertainty doit être un nombre fini positif ou nul',
        });
      }
    }
    if (f.published === false && f.reason === undefined)
      ctx.addIssue({ code: 'custom', message: 'non publié sans raison' });
    if (f.reason !== undefined && f.published !== false)
      ctx.addIssue({
        code: 'custom',
        message: 'une raison sans « published: false »',
      });
    if (f.published === false && f.source !== undefined)
      ctx.addIssue({
        code: 'custom',
        message: 'un fait non publié ne cite pas de source',
      });
    if (
      f.value === undefined &&
      f.source === undefined &&
      f.published === undefined
    )
      ctx.addIssue({ code: 'custom', message: 'un fait vide' });
  });

const facts = z
  .object({
    radiusKm: fact,
    massKg: fact,
    gravity: fact,
    meanTempC: fact,
    moonCount: fact,
    axialTilt: fact,
    distanceAU: fact,
    orbitPeriodDays: fact,
    rotationPeriod: fact,
  })
  .partial()
  .strict();

const satellites = z.array(kebabId).min(1);

/** Clés d'un corps du catalogue (`CelestialBodyConfig`), hors faits. */
const catalogueConfig = z
  .object({
    kind: z.enum([
      'star',
      'planet',
      'moon',
      'skybox',
      'asteroid',
      'comet',
      'dwarf',
    ]),
    displayName: displayName.optional(),
    radius: encoded,
    rotationSpeed: encoded,
    orbitalColor: color,
    textureResolutions: plainObject,
    fallbackColor: color.optional(),
    model: plainObject.optional(),
    atmosphereColor: color.optional(),
    ring: plainObject.optional(),
    satellites: satellites.optional(),
    realData: z
      .object({
        orbitalInclination: encoded.optional(),
        ascendingNode: encoded.optional(),
        description: localized.optional(),
        wiki: localized.optional(),
      })
      .strict()
      .optional(),
    astroBody: astroBody.optional(),
    rotationBody: astroBody.optional(),
    positionBody: astroBody.optional(),
    relativeEphemeris: plainObject.optional(),
    relativeOrbitalElements: plainObject.optional(),
    orbitalElements: plainObject.optional(),
    frame: z.enum(['heliocentric', 'parentRelative']).optional(),
    cameraDistance: plainObject.optional(),
    loadPriority: z.number().int().nonnegative().optional(),
  })
  .strict();

/** Éléments publiés d'un petit corps (`SmallBodyElements`), hors faits. */
const smallBodyElements = z
  .object({
    displayName: displayName.optional(),
    a: z.number().positive(),
    e: z.number().nonnegative(),
    iDeg: z.number(),
    omDeg: z.number(),
    wDeg: z.number(),
    maDeg: z.number(),
    epoch: isoInstant,
    barycentric: z.literal(true).optional(),
    kind: z.enum(['asteroid', 'comet', 'dwarf']).optional(),
    color: color.optional(),
    surfaceResolutions: z.array(z.enum(['1k', '2k', '4k', '8k'])).optional(),
    fallbackColor: color.optional(),
    model: plainObject.optional(),
    visualRadius: z.number().positive().optional(),
    rotationBody: astroBody.optional(),
    description: localized.optional(),
    wiki: localized.optional(),
    satellites: satellites.optional(),
  })
  .strict();

/** Classes de cible, vocabulaire EPNCore `target_class` (EPN-TAP 2.0), lu à la source. */
const targetClass = z.enum([
  'asteroid',
  'dwarf_planet',
  'planet',
  'satellite',
  'comet',
  'exoplanet',
  'interplanetary_medium',
  'sample',
  'sky',
  'spacecraft',
  'spacejunk',
  'star',
  'calibration',
]);

const base = {
  $schema: z.string().optional(),
  id: kebabId,
  targetClass,
  facts: facts.optional(),
  /** Commentaires du dépôt : jamais chargés, retirés du bundle client à l'import. */
  notes: z.record(z.string(), z.string()).optional(),
};

export const entitySchema = z.discriminatedUnion('source', [
  z
    .object({
      ...base,
      source: z.literal('catalogue'),
      config: catalogueConfig,
    })
    .strict(),
  z
    .object({
      ...base,
      source: z.literal('small-body'),
      elements: smallBodyElements,
    })
    .strict(),
]);

/** `order.json` : l'ordre de premier niveau du catalogue. */
export const entityOrderSchema = z
  .object({
    $schema: z.string().optional(),
    $comment: z.string().optional(),
    order: z.array(kebabId).min(1),
  })
  .strict();

export function entityJsonSchemaText(): string {
  return `${JSON.stringify(
    z.toJSONSchema(entitySchema, { io: 'input', unrepresentable: 'any' }),
    null,
    2
  )}\n`;
}
