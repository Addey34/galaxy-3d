/**
 * SCHÉMA D'UNE VISITE GUIDÉE (`src/registry/tours/*.json`) — lot 21.
 *
 * Même contrat que les quatre autres registres : ce schéma Zod est la SEULE déclaration, le type
 * en sort par `z.infer`, le JSON Schema commité (`tour.schema.json`) en est généré par
 * `pnpm schema:generate` et comparé octet pour octet par un test. Zod reste en `devDependency` :
 * rien ici n'atteint le bundle client (`bundleIsolation.test.ts`).
 *
 * CE QUE CE SCHÉMA EXISTE POUR PERMETTRE : qu'un enseignant décrive sa leçon sans que personne ne
 * touche à TypeScript. Le vocabulaire des étapes est donc FERMÉ et nommé, comme les formes
 * déclarées du registre d'entités (`{"$deg": …}`) : une fiche ne porte pas d'expression, elle
 * choisit parmi des formes que le moteur (`core/tourEngine.ts`) sait exécuter.
 */
import { z } from 'zod';
import { ASTRONOMICAL_EVENT_KINDS } from '@/core/astronomicalEvents';

/**
 * Un texte localisé : les QUATRE langues sont obligatoires, comme partout dans le registre depuis
 * le lot 20. Une visite « traduite » dont une légende sur deux parlerait anglais, sans que rien ne
 * le dise, est exactement ce que cette contrainte interdit.
 */
const localized = z
  .object({
    en: z.string().min(1),
    fr: z.string().min(1),
    es: z.string().min(1),
    'pt-BR': z.string().min(1),
  })
  .strict();

/** Nom de corps ou de cible navigable, tel que `PlanetNavigation.selectBody` l'attend. */
const targetName = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'nom de cible en kebab-case');

/**
 * Plafond de l'accélération du temps. Le propriétaire de cette valeur est
 * `MAX_SIMULATION_SCALE` dans `src/ui/speedSlider.ts` (un an simulé par seconde réelle) ; elle est
 * recopiée ici parce qu'un schéma de registre n'a pas à importer un module d'interface, et
 * `tour.schema.test.ts` confronte les deux. Sans plafond, une fiche pouvait demander une vitesse
 * que le curseur ne sait pas représenter.
 */
const MAX_TIME_SCALE = 31_557_600;

const timeScale = z
  .number()
  .refine(
    (value) => Math.abs(value) >= 1 && Math.abs(value) <= MAX_TIME_SCALE,
    `la magnitude doit tenir entre 1 et ${MAX_TIME_SCALE} : c'est ce que le curseur de vitesse sait représenter, et une vitesse nulle arrêterait le temps plutôt que la visite`
  );

/**
 * LES CINQ FORMES D'ÉTAPE, une par capacité du moteur.
 *
 * `jumpToEvent` est la seule qui n'existait pas avant le lot 21, et elle remplace l'exception qui
 * clochait sur un identifiant (`id === 'eclipse'` dans `ui/tourPlayer.ts`) : la date de l'éclipse
 * est DÉRIVÉE de `core/astronomicalEvents.ts` au moment où l'étape s'exécute. Une date écrite en
 * dur dans une fiche deviendrait fausse avec le temps ; celle-ci ne peut pas.
 */
const step = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('flyTo'), body: targetName }).strict(),
  z
    .object({
      kind: z.literal('jumpToDate'),
      date: z
        .object({ $date: z.string().datetime({ offset: false }).regex(/Z$/) })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('jumpToEvent'),
      event: z.enum(ASTRONOMICAL_EVENT_KINDS),
      /** Requis pour `opposition` et `conjunction`, interdit ailleurs (cf. `superRefine`). */
      body: targetName.optional(),
    })
    .strict(),
  z.object({ kind: z.literal('setTimeScale'), scale: timeScale }).strict(),
  z
    .object({
      kind: z.literal('caption'),
      text: localized,
      /** Absent : la légende attend un geste. Présent : elle s'efface d'elle-même. */
      durationMs: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({ kind: z.literal('wait'), ms: z.number().int().positive() })
    .strict(),
]);

/** Les deux formes d'événement qui dépendent d'un corps, cf. `AstronomicalEvent.body`. */
const EVENT_NEEDS_BODY = ['opposition', 'conjunction'] as const;

export const tourSchema = z
  .object({
    $schema: z.literal('../schema/tour.schema.json'),
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    title: localized,
    /**
     * Au moins une légende, et pas seulement au moins une étape : une visite qui ne dirait rien
     * déplacerait la caméra sans expliquer quoi que ce soit, ce qui n'est pas une leçon.
     */
    steps: z.array(step).min(1),
  })
  .strict()
  .superRefine((record, ctx) => {
    if (!record.steps.some((s) => s.kind === 'caption'))
      ctx.addIssue({
        code: 'custom',
        path: ['steps'],
        message: 'une visite sans aucune légende n’explique rien',
      });
    record.steps.forEach((s, index) => {
      if (s.kind !== 'jumpToEvent') return;
      const needsBody = (EVENT_NEEDS_BODY as readonly string[]).includes(
        s.event
      );
      if (needsBody && s.body === undefined)
        ctx.addIssue({
          code: 'custom',
          path: ['steps', index, 'body'],
          message: `« ${s.event} » dépend d’un corps : le nommer`,
        });
      if (!needsBody && s.body !== undefined)
        ctx.addIssue({
          code: 'custom',
          path: ['steps', index, 'body'],
          message: `« ${s.event} » ne dépend d’aucun corps : le nommer n’aurait aucun effet`,
        });
    });
  });

export type TourRecord = z.infer<typeof tourSchema>;
export type TourStepRecord = TourRecord['steps'][number];

export function tourJsonSchemaText(): string {
  return `${JSON.stringify(z.toJSONSchema(tourSchema, { io: 'input' }), null, 2)}\n`;
}

/** Ce que `tour.schema.test.ts` confronte à `MAX_SIMULATION_SCALE`. */
export const TOUR_MAX_TIME_SCALE = MAX_TIME_SCALE;
