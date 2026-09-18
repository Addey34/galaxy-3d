/**
 * SCHÉMA D'UN FOURNISSEUR (`src/registry/providers/*.json`). Source unique : le schéma Zod
 * ci-dessous, d'où sont tirés À LA FOIS le type TypeScript (`z.infer`) et le JSON Schema commité
 * (`provider.schema.json`, régénéré et comparé par `provider.schema.test.ts`). Deux déclarations
 * d'une même chose finissent par diverger : ce dépôt l'a payé plusieurs fois.
 *
 * ZOD N'EST PAS LIVRÉ. Il est en `devDependency` et n'est importé que par les tests et
 * `scripts/generate-provider-schema.mjs`. Le registre lui-même (`providers/index.ts`) n'en prend
 * que le TYPE, par `import type`, qui s'efface à la compilation :
 * `src/registry/schema/bundleIsolation.test.ts` refuse un import de valeur depuis `src/`, et
 * vérifie l'absence de zod dans `dist/assets/*.js` quand un build existe.
 *
 * Ce que le schéma emprunte, et à qui (lu à la source le 2026-09-18, cf.
 * `docs/private/REGISTRES_LOT7.md` § 3) :
 *   - STAC 1.1.0 pour `extent.temporal.interval` : un tableau de paires `[début, fin]` où `null`
 *     signifie « pas de borne de ce côté ». C'est exactement la distinction dont Galaxy a besoin :
 *     un binaire Horizons est borné des deux côtés, astronomy-engine ne l'est d'aucun ;
 *   - EPNCore / EPN-TAP 2.0 pour la cadence (`time_sampling_step_min/max`, en secondes) ;
 *   - `core/temporal.ts` pour `kind` d'un fournisseur de position : c'est le `ProductKind` de
 *     l'application, dont la logique ne change pas d'une ligne ici.
 *
 * `role` est NOTRE discriminant, pas celui de STAC. STAC nomme `providers[].roles`
 * (`licensor`, `producer`, `processor`, `host`) le rôle d'un organisme vis-à-vis d'un produit :
 * cette notion-là appartient aux `products/` (phase 2), pas à cette fiche.
 */
import { z } from 'zod';

/** Identifiant de fiche : minuscules, chiffres et tirets, jamais de tiret en bordure. */
const providerId = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'identifiant en kebab-case');

/** Une URL que la fiche d'un corps a le droit de proposer en lien (`utils/safeUrl.ts`). */
const httpsUrl = z
  .string()
  .regex(/^https:\/\/[^\s"']+$/, 'URL https absolue')
  .refine((value) => {
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'URL analysable');

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date ISO AAAA-MM-JJ');

/** Instant STAC : date-heure UTC, ou `null` pour une borne ouverte. */
const instant = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, 'instant ISO UTC')
  .nullable();

const identity = {
  /** Présent dans chaque fichier pour que l'éditeur valide pendant la saisie. */
  $schema: z.string().optional(),
  id: providerId,
  /** Qui publie : agence, base de données, ou auteurs d'un article. */
  publisher: z.string().min(1),
  /** Titre tel que publié par la source, ou ce que Galaxy en utilise. */
  title: z.string().min(1),
  url: httpsUrl,
};

/**
 * Source primaire d'un FAIT affiché (rayon, masse, gravité…). Ces fiches alimentent
 * `FACT_SOURCES` : leur forme est celle que `ui/bodyInfo.ts`, `seo/sourcesPage.ts` et
 * `config/factProvenance.test.ts` lisent déjà.
 */
const factSourceProvider = z.object({
  ...identity,
  role: z.literal('fact-source'),
  kind: z.enum(['agency', 'database', 'article', 'preprint']),
  /** Revue et pages pour un article. */
  journal: z.string().min(1).optional(),
  /** `AAAA` ou `AAAA-MM-JJ`, tel que publié. */
  published: z
    .string()
    .regex(/^\d{4}(-\d{2}-\d{2})?$/, 'AAAA ou AAAA-MM-JJ')
    .optional(),
  doi: z.string().min(1).optional(),
  /** Date à laquelle la source a été lue pour ce catalogue. */
  accessed: isoDay,
});

/**
 * Couverture temporelle au sens STAC : la première paire est la couverture d'ensemble.
 * Paire écrite comme un tableau de deux éléments plutôt qu'un tuple : c'est la forme que
 * TypeScript infère d'un import JSON, et le registre doit pouvoir s'y comparer sans conversion.
 */
const temporalExtent = z.object({
  interval: z.array(z.array(instant).length(2)).min(1),
});

/**
 * Source qui PLACE un corps à une date (`core/positionProvenance.ts`). `positionSource` est la
 * clé que `BodyPositionResolver` renvoie ; `validationProviderId` est le nom de la même source
 * dans `src/config/horizons-validation-summary.json`. Une seule table, deux lecteurs : c'est
 * l'ancienne `SUMMARY_PROVIDER`.
 */
const positionSourceProvider = z.object({
  ...identity,
  role: z.literal('position-source'),
  /** `ProductKind` de `core/temporal.ts`. Une position est toujours une éphéméride. */
  kind: z.literal('ephemeris'),
  positionSource: z.enum(['horizons', 'spk', 'astronomy-engine', 'kepler']),
  validationProviderId: z.string().min(1),
  /**
   * Absente quand la couverture n'est PAS une propriété du fournisseur : chaque produit déclare
   * alors la sienne (un noyau SPK porte l'intervalle de chaque segment dans ses propres données).
   * `null` des deux côtés veut dire « répond à n'importe quelle date », jamais « on ne sait pas ».
   */
  extent: z.object({ temporal: temporalExtent }).optional(),
  /** Cadence d'échantillonnage, en secondes (EPNCore `time_sampling_step_min/max`). */
  samplingStepSeconds: z
    .object({ min: z.number().positive(), max: z.number().positive() })
    .optional(),
  /** Note pour le dépôt, jamais affichée : pourquoi `extent` est absente, par exemple. */
  coverageNote: z.string().min(1).optional(),
});

export const providerSchema = z.discriminatedUnion('role', [
  factSourceProvider,
  positionSourceProvider,
]);

export type ProviderRecord = z.infer<typeof providerSchema>;
export type FactSourceProvider = z.infer<typeof factSourceProvider>;
export type PositionSourceProvider = z.infer<typeof positionSourceProvider>;

/**
 * Le JSON Schema COMMITÉ, généré depuis le schéma Zod ci-dessus. Une seule fonction, appelée par
 * `scripts/generate-provider-schema.mjs` (qui écrit) et par `provider.schema.test.ts` (qui
 * compare) : le fichier ne peut donc pas dériver du schéma qui fait foi.
 */
export function providerJsonSchema(): unknown {
  return z.toJSONSchema(providerSchema, { io: 'input' });
}

/** Sérialisation exacte du fichier commité (une seule écriture possible). */
export function providerJsonSchemaText(): string {
  return `${JSON.stringify(providerJsonSchema(), null, 2)}\n`;
}
