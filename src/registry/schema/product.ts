/**
 * SCHÉMA D'UN PRODUIT LIVRÉ (`src/registry/products/**.json`) : une couche de texture d'un corps,
 * ou la collection des binaires d'éphémérides. Même contrat que `provider.ts` : ce schéma Zod est
 * la seule déclaration, le type en sort par `z.infer`, le JSON Schema commité
 * (`product.schema.json`) en est généré par `pnpm schema:generate` et comparé par un test. Zod
 * reste en `devDependency` : rien ici n'atteint le bundle client (`bundleIsolation.test.ts`).
 *
 * Emprunts, lus à la source le 2026-09-18 (`docs/private/REGISTRES_LOT7.md` § 10) :
 *   - STAC Collection 1.1.0 pour `license` : identifiant SPDX, expression SPDX, ou la chaîne
 *     `other`. Et, mot pour mot : « If no link to a license is included and the `license` field is
 *     set to `other` [...] the Collection is private, and consumers have not been granted any
 *     explicit right to use the data. » D'où la règle tenue ici : `other` EXIGE un lien
 *     `rel: "license"`. Écrire `other` seul affirmerait le contraire du domaine public ;
 *   - STAC `providers[]` : `name` et `roles` parmi `licensor`, `producer`, `processor`, `host` ;
 *   - STAC `links[]` : `rel` et `href`.
 *
 * `rights` est NOTRE champ, pas celui de STAC : SPDX n'a aucun identifiant générique de domaine
 * public (seulement des dédicaces comme `CC0-1.0`, que personne n'a appliquées à ces images, et des
 * notices d'agences précises comme `NIST-PD`). Il dit POURQUOI la licence est `other`.
 *
 * `lineage` et `review` recopient tels quels les blocs historiques de l'ancien
 * `scripts/texture-sources.json` (`sources` et `reviews`) : c'est le journal de la recherche des
 * sources, avec son propre vocabulaire (`unconfirmed`, `public-domain-if-usgs`…). Il n'est pas
 * publié et n'est pas normalisé en SPDX : seule la licence du PRODUIT l'est.
 */
import { z } from 'zod';

const kebabId = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'identifiant en kebab-case');

const httpsUrl = z.string().regex(/^https:\/\/[^\s"']+$/, 'URL https absolue');

/** Licence au sens STAC : SPDX, ou `other` (qui exige alors un lien de licence). */
const spdxOrOther = z
  .string()
  .regex(
    /^(other|[A-Za-z0-9.+-]+(\s+(AND|OR|WITH)\s+[A-Za-z0-9.+-]+)*)$/,
    'identifiant ou expression SPDX, ou « other »'
  )
  .refine(
    (value) => !['various', 'proprietary'].includes(value),
    'valeur dépréciée par STAC 1.1.0'
  );

const link = z.object({
  rel: z.enum(['license', 'via', 'describedby']),
  href: httpsUrl,
});

const provider = z.object({
  name: z.string().min(1),
  roles: z.array(z.enum(['licensor', 'producer', 'processor', 'host'])).min(1),
  url: httpsUrl.optional(),
});

/** Journal de recherche d'une source candidate (ancien bloc `sources`), recopié tel quel. */
const lineage = z
  .object({
    status: z.string(),
    downloadUrl: httpsUrl,
    sourcePage: httpsUrl,
    projection: z.string(),
    sourceResolution: z.string(),
    maxQuality: z.string(),
    outputBase: z.string(),
    license: z.string(),
    credit: z.string(),
    tier: z.string().optional(),
    importNote: z.string().optional(),
  })
  .strict();

/** Audit de qualité d'une couche (ancien bloc `reviews`), recopié tel quel. */
const review = z
  .object({
    status: z.string(),
    /**
     * URL de la page source, OU chemin du script qui a produit la couche : les 20 textures
     * procédurales du dépôt citent `scripts/generate-procedural-textures.mjs` comme source.
     */
    sourcePage: z
      .string()
      .regex(/^(https:\/\/[^\s"']+|scripts\/[a-z0-9-]+\.mjs)$/)
      .optional(),
    sourceResolution: z.string().optional(),
    projection: z.string().optional(),
    qualityClass: z.string().optional(),
    note: z.string().optional(),
    processing: z.string().optional(),
    downloadUrl: httpsUrl.optional(),
    license: z.string().optional(),
    credit: z.string().optional(),
    attributionNeeded: z.boolean().optional(),
    provenanceNote: z.string().optional(),
  })
  .strict();

const textureIdentity = {
  $schema: z.string().optional(),
  id: kebabId,
  type: z.literal('texture'),
  body: z.string().regex(/^[a-z0-9]+$/),
  /** Clé de couche telle que le catalogue la nomme (`surface`, `normalMap`…). */
  layer: z.string().regex(/^[a-z][A-Za-z0-9]*$/),
};

/** Une couche LIVRÉE : elle a une licence, des fournisseurs et un crédit affichés. */
const shippedTexture = z
  .object({
    ...textureIdentity,
    shipped: z.literal(true),
    license: spdxOrOther,
    /** Pourquoi `other` : domaine public, ou produit par ce dépôt. Absent pour un SPDX. */
    rights: z.enum(['public-domain', 'generated']).optional(),
    links: z.array(link).optional(),
    /** Le premier fournisseur est celui que `/sources` crédite. */
    providers: z.array(provider).min(1),
    tier: z.literal('free'),
    illustrative: z.boolean().optional(),
    /** Lacunes de la carte d'origine comblées. */
    filled: z.boolean().optional(),
    /** Page de la source affichée en lien du crédit. */
    sourceUrl: httpsUrl.optional(),
    /** Traitement appliqué après import, pour le dépôt. */
    postProcess: z.string().optional(),
    lineage: lineage.optional(),
    review: review,
  })
  .strict()
  .superRefine((product, ctx) => {
    if (product.license === 'other') {
      if (!product.rights)
        ctx.addIssue({
          code: 'custom',
          message: '« other » doit dire pourquoi (`rights`)',
        });
      if (!product.links?.some((l) => l.rel === 'license'))
        ctx.addIssue({
          code: 'custom',
          message:
            '« other » sans lien de licence vaut « données privées » en STAC : lien rel=license obligatoire',
        });
    } else if (product.rights) {
      ctx.addIssue({
        code: 'custom',
        message: '`rights` ne sert qu’à expliquer « other »',
      });
    }
  });

/** Une couche RELUE mais pas livrée : rien n'est publié à son sujet. */
const reviewedOnlyTexture = z
  .object({
    ...textureIdentity,
    shipped: z.literal(false),
    review: review,
  })
  .strict();

/**
 * La collection des binaires d'éphémérides. Le détail fichier par fichier reste dans
 * `public/assets/ephemerides/manifest.json`, écrit par `pnpm ephemeris:generate` : le recopier
 * ici ferait deux sources d'une même chose. Ce produit déclare la collection et pointe le
 * manifeste ; un test vérifie que les deux concordent.
 */
const ephemerisCollection = z
  .object({
    $schema: z.string().optional(),
    id: kebabId,
    type: z.literal('ephemeris-collection'),
    /** Chemin publié du manifeste, relatif à la racine du site. */
    manifest: z.string().regex(/^assets\/[a-z0-9/._-]+\.json$/),
    /** Fiche du registre `providers/` qui place les corps avec ces fichiers. */
    providerId: kebabId,
    license: spdxOrOther,
    rights: z.enum(['public-domain', 'generated', 'unreviewed']),
    links: z.array(link).min(1),
    providers: z.array(provider).min(1),
    /** Script qui produit la collection (lignée, au sens de `processing:lineage`). */
    generatedBy: z.string().regex(/^scripts\/[a-z0-9-]+\.mjs$/),
  })
  .strict()
  .superRefine((product, ctx) => {
    // `unreviewed` : aucune licence n'a encore été lue pour cette collection. Sans lien de
    // licence, STAC la lit comme « aucun droit accordé », ce qui est exactement vrai : Galaxy
    // n'en déclare aucun tant que les termes n'ont pas été lus à la source.
    if (
      product.license === 'other' &&
      product.rights !== 'unreviewed' &&
      !product.links.some((l) => l.rel === 'license')
    )
      ctx.addIssue({
        code: 'custom',
        message: '« other » exige un lien rel=license',
      });
    if (
      product.rights === 'unreviewed' &&
      product.links.some((l) => l.rel === 'license')
    )
      ctx.addIssue({
        code: 'custom',
        message: 'une licence non lue ne peut pas pointer un lien de licence',
      });
  });

/**
 * Un JEU DE TUILES d'imagerie planétaire, streamé à l'approche d'une surface (lot 9, phase 9C).
 *
 * C'est la fiche qui doit suffire à ajouter un corps : le moteur ne connaît aucun nom de corps,
 * aucun gabarit et aucun niveau. `service.template` est RECOPIÉ des capacités WMTS pointées par
 * le lien `describedby` — celui de Trek contient un double `/` après `1.0.0` et l'ordre
 * `{TileMatrix}/{TileRow}/{TileCol}`, que réécrire de mémoire donnerait des adresses valides
 * montrant un autre endroit du corps.
 *
 * `publishedPixelsPerDegree` est la finesse de la MOSAÏQUE, pas celle de la pyramide : Trek sert
 * la WAC jusqu'à 364 pixels par degré alors qu'elle est publiée à 303, et l'application doit le
 * dire plutôt qu'afficher une finesse que la source n'a pas (`tilePyramid.oversamplingFactor`).
 *
 * `acquired` est l'intervalle que la mosaïque DÉCRIT, au format STAC, et c'est lui que
 * `core/temporal.ts` classe : une mosaïque est une mesure sur la campagne qui l'a produite, pas
 * une image sans date.
 */
const imageryTileset = z
  .object({
    $schema: z.string().optional(),
    id: kebabId,
    type: z.literal('tileset'),
    /** Corps du catalogue que ce jeu recouvre. */
    body: z.string().regex(/^[a-z0-9]+$/),
    /** Titre publié par la source, affiché dans le bandeau de provenance. */
    title: z.string().min(1),
    /** Fiche `providers/` du service contacté (rôle `tile-source`). */
    providerId: kebabId,
    mission: z.string().min(1),
    instrument: z.string().min(1),
    service: z
      .object({
        template: httpsUrl,
        style: z.string().min(1),
        tileMatrixSet: z.string().min(1),
        format: z.enum(['image/jpeg', 'image/png']),
        matrix: z
          .object({
            columnsAtLevelZero: z.number().int().positive(),
            rowsAtLevelZero: z.number().int().positive(),
            tileSizePx: z.number().int().positive(),
          })
          .strict(),
        minLevel: z.number().int().min(0),
        maxLevel: z.number().int().min(0),
      })
      .strict()
      .refine((s) => s.maxLevel >= s.minLevel, 'maxLevel < minLevel'),
    /** Finesse de la mosaïque publiée, en pixels par degré. */
    publishedPixelsPerDegree: z.number().positive(),
    /** Intervalle décrit par la mosaïque (STAC ; bornes `null` interdites ici : une campagne finie). */
    acquired: z
      .object({
        interval: z
          .array(
            z
              .array(
                z
                  .string()
                  .regex(
                    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
                    'instant ISO UTC'
                  )
              )
              .length(2)
          )
          .min(1),
      })
      .strict(),
    license: spdxOrOther,
    rights: z.enum(['public-domain']).optional(),
    links: z.array(link).min(1),
    providers: z.array(provider).min(1),
    /** Date à laquelle la fiche a été confrontée au service (gabarit, niveaux, CORS). */
    verified: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date ISO AAAA-MM-JJ'),
  })
  .strict()
  .superRefine((product, ctx) => {
    if (product.license === 'other') {
      if (!product.rights)
        ctx.addIssue({
          code: 'custom',
          message: '« other » doit dire pourquoi (`rights`)',
        });
      if (!product.links.some((l) => l.rel === 'license'))
        ctx.addIssue({
          code: 'custom',
          message: '« other » exige un lien rel=license',
        });
    }
    // Le gabarit est recopié d'un document de capacités : il doit être cité.
    if (!product.links.some((l) => l.rel === 'describedby'))
      ctx.addIssue({
        code: 'custom',
        message:
          'un jeu de tuiles cite les capacités WMTS dont son gabarit est recopié (rel=describedby)',
      });
  });

/**
 * UN JEU DE TUILES DE HAUTEURS, cuit hors ligne depuis un modèle d'élévation publié (lot 9,
 * phase 9D).
 *
 * Il diffère d'un jeu d'imagerie sur un point qui décide de tout le reste : **il n'est servi par
 * personne**. Aucune source de hauteurs tuilée n'est publiée en CORS (la seule couche « DEM » de
 * Trek est une image 8 bits), donc `pnpm surface:tiles` lit un DEM PDS3 et écrit nos propres
 * tuiles, qui sont livrées avec le site.
 *
 * Le détail — quantum, offset, rayon de référence, couverture, altitudes extrêmes, répertoire
 * haché — vit dans le MANIFESTE écrit par ce script, jamais recopié ici : deux déclarations
 * d'une même mesure finissent par diverger, et c'est la règle déjà appliquée à la collection
 * d'éphémérides. Un test confronte cette fiche au manifeste.
 */
const heightfieldSet = z
  .object({
    $schema: z.string().optional(),
    id: kebabId,
    type: z.literal('heightfield'),
    body: z.string().regex(/^[a-z0-9]+$/),
    title: z.string().min(1),
    mission: z.string().min(1),
    instrument: z.string().min(1),
    /** Chemin publié du manifeste, relatif à la racine du site. */
    manifest: z.string().regex(/^assets\/[a-z0-9/._-]+\.json$/),
    /** Script qui cuit les tuiles (lignée, au sens de `processing:lineage`). */
    generatedBy: z.string().regex(/^scripts\/[a-z0-9-]+\.mjs$/),
    /** Intervalle d'acquisition déclaré par l'étiquette de la source. */
    acquired: z
      .object({
        interval: z
          .array(
            z
              .array(
                z
                  .string()
                  .regex(
                    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
                    'instant ISO UTC'
                  )
              )
              .length(2)
          )
          .min(1),
      })
      .strict(),
    license: spdxOrOther,
    rights: z.enum(['public-domain']).optional(),
    links: z.array(link).min(1),
    providers: z.array(provider).min(1),
    /** Date à laquelle la fiche a été confrontée à la source (étiquette, emprise, quantum). */
    verified: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date ISO AAAA-MM-JJ'),
  })
  .strict()
  .superRefine((product, ctx) => {
    if (product.license === 'other') {
      if (!product.rights)
        ctx.addIssue({
          code: 'custom',
          message: '« other » doit dire pourquoi (`rights`)',
        });
      if (!product.links.some((l) => l.rel === 'license'))
        ctx.addIssue({
          code: 'custom',
          message: '« other » exige un lien rel=license',
        });
    }
    // L'étiquette PDS lue par le cuiseur est le document qui porte le quantum et l'emprise :
    // elle doit être citée, comme les capacités WMTS le sont pour une imagerie.
    if (!product.links.some((l) => l.rel === 'describedby'))
      ctx.addIssue({
        code: 'custom',
        message:
          'un jeu de hauteurs cite l’étiquette du modèle d’élévation dont il est cuit (rel=describedby)',
      });
  });

export const productSchema = z.union([
  shippedTexture,
  reviewedOnlyTexture,
  ephemerisCollection,
  imageryTileset,
  heightfieldSet,
]);

export type ProductRecord = z.infer<typeof productSchema>;
export type ShippedTextureProduct = z.infer<typeof shippedTexture>;
export type ReviewedOnlyTextureProduct = z.infer<typeof reviewedOnlyTexture>;
export type EphemerisCollectionProduct = z.infer<typeof ephemerisCollection>;
export type ImageryTilesetProduct = z.infer<typeof imageryTileset>;
export type HeightfieldSetProduct = z.infer<typeof heightfieldSet>;

/** Le JSON Schema COMMITÉ, généré depuis le schéma Zod ci-dessus. */
export function productJsonSchema(): unknown {
  return z.toJSONSchema(productSchema, { io: 'input', unrepresentable: 'any' });
}

export function productJsonSchemaText(): string {
  return `${JSON.stringify(productJsonSchema(), null, 2)}\n`;
}
