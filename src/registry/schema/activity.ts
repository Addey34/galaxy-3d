/**
 * SCHÉMA D'UNE ACTIVITÉ PÉDAGOGIQUE (`src/registry/activities/*.json`) — lot 58.
 *
 * Même contrat que les visites (`tour.ts`) : ce schéma Zod est la SEULE déclaration, le type en
 * sort par `z.infer`, le JSON Schema commité (`activity.schema.json`) en est généré par
 * `pnpm schema:generate` et comparé octet pour octet par un test. Zod reste en `devDependency`.
 *
 * LA FORME est celle des fiches « teach with space » de l'ESA, que le réseau ESERO relaie (lue à
 * la source le 2026-10-18, fiche PR45 « Une année sur la Terre », cf.
 * `docs/private/EDUCATION_LOT58.md`) : en bref (matières, âge, difficulté, durée, matériel),
 * objectifs, puis des parties qui portent chacune un déroulé pour l'enseignant, des consignes et
 * des questions pour l'élève, et le corrigé À CÔTÉ du déroulé, comme dans le guide de l'ESA.
 *
 * CE QUE CE SCHÉMA INTERDIT : une réponse tapée de mémoire. Un corrigé porte des emplacements
 * (`{inclinaison}`) que remplissent des VALEURS déclarées, chacune un fait sourcé d'une fiche de
 * corps ou une mesure de la scène (`core/activityMeasures.ts`), et chaque réponse nomme au moins
 * une valeur comme preuve. Le texte ne peut donc pas affirmer un nombre que rien ne calcule.
 */
import { z } from 'zod';
import { APSIS_EVENTS, SEASON_EVENTS } from '@/core/activityMeasures';

/** Les quatre langues, obligatoires, comme dans tout le registre depuis le lot 20. */
const localized = z
  .object({
    en: z.string().min(1),
    fr: z.string().min(1),
    es: z.string().min(1),
    'pt-BR': z.string().min(1),
  })
  .strict();

const kebab = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'kebab-case');
/** Le nom d'une valeur, tel qu'il s'écrit entre accolades dans un texte : `{periheliePlusTot}`. */
const slotName = z.string().regex(/^[a-z][a-zA-Z0-9]*$/, 'camelCase');

/** Nombre de décimales affichées : la précision que la phrase revendique, ni plus ni moins. */
const decimals = z.number().int().min(0).max(4);

/**
 * Une valeur que le corrigé cite : `fact`, ou l'une des mesures de la scène, nommée par la
 * fonction de `core/activityMeasures.ts` qui la calcule. `agrees` confronte une MESURE de la scène à une autre valeur
 * (le plus souvent le fait sourcé qu'elle illustre) : `src/config/activities.test.ts` l'exige, à
 * la tolérance déclarée, pour chaque année du domaine.
 */
const agrees = z
  .object({ value: slotName, tolerance: z.number().positive() })
  .strict();

const value = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('fact'),
      body: kebab,
      /**
       * Les seuls faits qu'une activité sait lire, en degrés. Fermé et minimal : un fait s'ajoute
       * avec l'activité qui le cite.
       */
      fact: z.enum(['axialTilt']),
      /** `complement90` : 90° moins le fait, la latitude du cercle polaire pour l'inclinaison. */
      form: z.enum(['value', 'complement90']).optional(),
      decimals,
    })
    .strict(),
  z
    .object({
      kind: z.enum(['subsolarLatitude', 'polarDayLatitude']),
      event: z.enum(SEASON_EVENTS),
      /** Affiche la valeur sans signe : l'hémisphère est dit par le texte (« 23,4° S »). */
      absolute: z.boolean().optional(),
      decimals,
      agrees: agrees.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('dayLength'),
      event: z.enum(SEASON_EVENTS),
      latitude: z.number().min(-66).max(66),
      longitude: z.number().min(-180).max(180),
    })
    .strict(),
  z
    .object({
      kind: z.literal('apsisDate'),
      event: z.enum(APSIS_EVENTS),
      /** Sur le domaine d'années de la fiche, la date la plus précoce ou la plus tardive. */
      bound: z.enum(['earliest', 'latest']),
    })
    .strict(),
  z
    .object({
      kind: z.enum(['apsisGapPercent', 'apsisFluxGainPercent']),
      decimals,
    })
    .strict(),
]);

const question = z
  .object({
    id: kebab,
    prompt: localized,
    /** Le corrigé, avec ses emplacements `{valeur}`. */
    answer: localized,
    /** Les valeurs qui PROUVENT la réponse ; au moins une, et toutes déclarées. */
    evidence: z.array(slotName).min(1),
    /**
     * Les NIVEAUX DE LECTURE (lot 58, pas 3), choisis par l'utilisateur le 2026-10-19 : un
     * prolongement gradué dans la même fiche, sur les mêmes valeurs, comme la fiche PR45 de l'ESA
     * (« Les élèves plus âgés peuvent également… »). Absent : la question du niveau de la fiche
     * (`ages`). Un niveau ne duplique aucun fait, il pose une autre question sur les mêmes.
     */
    level: z.enum(['high', 'advanced']).optional(),
  })
  .strict();

const part = z
  .object({
    title: localized,
    /** Le déroulé, côté enseignant (« Exercice » dans les fiches de l'ESA). */
    teacher: localized,
    /** Les consignes de la fiche élève, dans l'ordre. */
    steps: z.array(localized).min(1),
    questions: z.array(question).min(1),
  })
  .strict();

const SLOT = /\{([^{}]*)\}/g;

export const activitySchema = z
  .object({
    $schema: z.literal('../schema/activity.schema.json'),
    id: kebab,
    title: localized,
    summary: localized,
    /** La visite guidée que l'élève joue (`?tour=<id>`), qui doit exister au registre des visites. */
    tour: kebab,
    ages: z
      .object({
        from: z.number().int().min(5).max(18),
        to: z.number().int().min(5).max(18),
      })
      .strict(),
    durationMinutes: z.number().int().positive(),
    difficulty: z.enum(['easy', 'medium', 'hard']),
    subjects: z
      .array(z.enum(['physics', 'geography', 'earthScience', 'astronomy']))
      .min(1),
    objectives: z.array(localized).min(1),
    material: z.array(localized).min(1),
    /**
     * Les années sur lesquelles les mesures de la scène sont calculées, et que la fiche
     * imprimée annonce. Une activité ne dépend donc pas du jour où elle est construite.
     */
    years: z
      .object({
        from: z.number().int().min(1900),
        to: z.number().int().max(2100),
      })
      .strict(),
    values: z.record(slotName, value),
    parts: z.array(part).min(1),
  })
  .strict()
  .superRefine((record, ctx) => {
    if (record.ages.from > record.ages.to)
      ctx.addIssue({
        code: 'custom',
        path: ['ages'],
        message: 'âges inversés',
      });
    if (record.years.from > record.years.to)
      ctx.addIssue({
        code: 'custom',
        path: ['years'],
        message: 'années inversées',
      });
    const declared = new Set(Object.keys(record.values));
    const used = new Set<string>();
    for (const [name, v] of Object.entries(record.values)) {
      if ('agrees' in v && v.agrees !== undefined) {
        used.add(v.agrees.value);
        if (!declared.has(v.agrees.value) || v.agrees.value === name)
          ctx.addIssue({
            code: 'custom',
            path: ['values', name, 'agrees', 'value'],
            message: `« ${v.agrees.value} » n'est pas une autre valeur déclarée`,
          });
      }
    }
    record.parts.forEach((p, pi) =>
      p.questions.forEach((q, qi) => {
        const where = ['parts', pi, 'questions', qi];
        for (const name of q.evidence) {
          used.add(name);
          if (!declared.has(name))
            ctx.addIssue({
              code: 'custom',
              path: [...where, 'evidence'],
              message: `preuve « ${name} » non déclarée`,
            });
        }
        // Les emplacements : déclarés, et LES MÊMES dans les quatre langues, sans quoi une
        // traduction pourrait taire un nombre que les autres affirment.
        for (const field of ['prompt', 'answer'] as const) {
          const perLanguage = Object.entries(q[field]).map(
            ([lang, text]) =>
              [lang, [...text.matchAll(SLOT)].map((m) => m[1]!).sort()] as const
          );
          const reference = perLanguage[0]![1].join(',');
          for (const [lang, slots] of perLanguage) {
            if (slots.join(',') !== reference)
              ctx.addIssue({
                code: 'custom',
                path: [...where, field, lang],
                message: `emplacements différents de l'anglais : ${slots.join(', ')}`,
              });
            for (const name of slots) {
              used.add(name);
              if (!declared.has(name))
                ctx.addIssue({
                  code: 'custom',
                  path: [...where, field, lang],
                  message: `emplacement « {${name}} » non déclaré`,
                });
            }
          }
        }
      })
    );
    for (const name of declared)
      if (!used.has(name))
        ctx.addIssue({
          code: 'custom',
          path: ['values', name],
          message: `valeur « ${name} » déclarée mais citée nulle part`,
        });
  });

export type ActivityRecord = z.infer<typeof activitySchema>;
export type ActivityValue = ActivityRecord['values'][string];

export function activityJsonSchemaText(): string {
  return `${JSON.stringify(z.toJSONSchema(activitySchema, { io: 'input' }), null, 2)}\n`;
}
