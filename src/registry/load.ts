/**
 * CHARGEUR DU REGISTRE DES ENTITÉS : fiches JSON → `CelestialConfig` d'aujourd'hui. PUR : il
 * reçoit les fiches, il ne lit rien. `entities/index.ts` fait l'entrée/sortie.
 *
 * Contrat (`docs/private/REGISTRES_LOT7.md` § 5, D5) : il reproduit le catalogue À L'IDENTITÉ DE
 * BITS PRÈS. Aucun consommateur ne change : ni `OrbitalMechanics`, ni `CelestialObject`, ni
 * `src/seo`. `entities.test.ts` compare sa sortie au catalogue, `Object.is` sur chaque nombre et
 * ordre des clés compris (hors `realData`, où l'ordre n'est lu par personne).
 *
 * Ce qu'une fiche ne contient PAS : du code. Un calcul se DÉCLARE par une forme nommée, dont
 * l'ensemble est FERMÉ (`EXPRESSIONS` ci-dessous) : `{"$deg": 7.25}` au lieu de `7.25 * D2R`,
 * `{"$gm": 8978.14}` au lieu de `massFromGM(8978.14)`. Chaque forme exécute EXACTEMENT les
 * opérations, dans le même ordre, que le littéral TypeScript qu'elle remplace : c'est ce qui rend
 * l'égalité de bits possible. Une forme inconnue est une ERREUR, jamais un repli silencieux.
 * Ajouter une forme est un acte délibéré, qui passe par ce fichier et donc par une revue.
 *
 * Un FAIT est un seul objet (valeur, provenance, raison de non-publication), là où le catalogue
 * tenait trois tables parallèles (`realData.X`, `realData.sources.X`, `realData.unknown.X`) que
 * rien n'empêchait de diverger. Le chargeur les redéploie pour les consommateurs actuels.
 *
 * `notes` (commentaires du catalogue d'origine) est ignoré ici, et retiré du bundle client à
 * l'import par le plugin `stripRegistryNotes` de `vite.config.ts`.
 */
import type {
  CelestialBodyConfig,
  FactField,
  FactProvenance,
  LocalizedText,
  UnknownReason,
} from '@/types';
import { DEG_TO_RAD as D2R } from '@/core/MathConstants';
import { exploCameraDistance } from '@/core/ScaleService';
import {
  DETAIL,
  NOT_YET_SOURCED,
  gravityFromGM,
  gravityFromMass,
  kmToAu,
  massFromDensity,
  massFromGM,
} from '@/config/factSources';
import {
  smallBodyToConfig,
  type SmallBodyElements,
} from '@/config/smallBodyConfig';

// ── Fiches ────────────────────────────────────────────────────────────────────────────────────

/** Valeur encodée : du JSON, où un objet dont TOUTES les clés commencent par `$` est une forme. */
export type Encoded =
  null | boolean | number | string | Encoded[] | { [key: string]: Encoded };

/** Un fait : valeur (éventuellement dérivée), provenance, ou raison de ne pas le publier. */
export interface FactEntry {
  value?: Encoded;
  source?: string;
  method?: FactProvenance['method'];
  asOf?: string;
  uncertainty?: Encoded;
  /** Clé de `DETAIL` (`config/factSources.ts`), ou texte localisé propre à ce fait. */
  detail?: string | LocalizedText;
  citation?: string;
  /** `false` : la simulation peut porter une valeur, mais elle n'est pas publiée. */
  published?: false;
  /** Pourquoi elle ne l'est pas : `not-yet-sourced`, ou un texte localisé. */
  reason?: 'not-yet-sourced' | (LocalizedText & { unsourced?: boolean });
}

interface EntityBase {
  $schema?: string;
  id: string;
  /** Classe scientifique, vocabulaire EPNCore `target_class`. */
  targetClass: string;
  facts?: Partial<Record<FactField, FactEntry>>;
  /** Commentaires du dépôt, jamais chargés. */
  notes?: Record<string, string>;
}

/** Un corps décrit dans la forme du catalogue (`CelestialBodyConfig`). */
export interface CatalogueEntity extends EntityBase {
  source: 'catalogue';
  config: { [key: string]: Encoded };
}

/** Un petit corps décrit par ses éléments publiés, converti par `smallBodyToConfig`. */
export interface SmallBodyEntity extends EntityBase {
  source: 'small-body';
  elements: { [key: string]: Encoded };
}

export type EntityRecord = CatalogueEntity | SmallBodyEntity;

// ── Formes déclarées (ensemble fermé) ─────────────────────────────────────────────────────────

/** Vitesse de rotation axiale, rad / seconde de simulation : le `_R` de l'ancien `bodies.ts`. */
const rotationSpeed = (hours: number): number =>
  (Math.PI * 2) / (hours * 3_600);

/**
 * Les formes, chacune avec ses clés EXACTES et l'expression qu'elle remplace. Ordre des
 * opérations identique au littéral d'origine, sinon l'égalité de bits tombe.
 */
const EXPRESSIONS: Record<
  string,
  { keys: readonly string[]; evaluate: (a: Record<string, number>) => number }
> = {
  /** `x * D2R` */
  deg: { keys: ['$deg'], evaluate: (a) => a.$deg! * D2R },
  /** `_R(h)` */
  rotation: {
    keys: ['$rotationHours'],
    evaluate: (a) => rotationSpeed(a.$rotationHours!),
  },
  /** `-_R(h)` : rotation rétrograde. */
  retrograde: {
    keys: ['$rotationHours', '$retrograde'],
    evaluate: (a) => -rotationSpeed(a.$rotationHours!),
  },
  /** `(Math.PI * 2) / (x * 86_400)` : période en jours, écrite ainsi dans le catalogue. */
  spin: {
    keys: ['$spinPeriodDays'],
    evaluate: (a) => (Math.PI * 2) / (a.$spinPeriodDays! * 86_400),
  },
  /** `x * 24` : des jours en heures. */
  days: { keys: ['$days'], evaluate: (a) => a.$days! * 24 },
  /** `kmToAu(x)` */
  km: { keys: ['$km'], evaluate: (a) => kmToAu(a.$km!) },
  /** `massFromGM(x)` */
  gm: { keys: ['$gm'], evaluate: (a) => massFromGM(a.$gm!) },
  /** `gravityFromGM(gm, r)` */
  gravityGm: {
    keys: ['$gm', '$radiusKm'],
    evaluate: (a) => gravityFromGM(a.$gm!, a.$radiusKm!),
  },
  /** `massFromDensity(d, r)` */
  density: {
    keys: ['$density', '$radiusKm'],
    evaluate: (a) => massFromDensity(a.$density!, a.$radiusKm!),
  },
  /** `gravityFromMass(m, r)` */
  gravityMass: {
    keys: ['$massKg', '$radiusKm'],
    evaluate: (a) => gravityFromMass(a.$massKg!, a.$radiusKm!),
  },
  /** `d / 2` : un rayon depuis le diamètre publié. */
  diameter: { keys: ['$diameterKm'], evaluate: (a) => a.$diameterKm! / 2 },
  /** `k - 273.15` : des kelvins en degrés Celsius. */
  kelvin: { keys: ['$kelvin'], evaluate: (a) => a.$kelvin! - 273.15 },
  /** `f * x` : une incertitude publiée en fraction de la valeur (Itokawa : 3 % de sa masse). */
  fraction: {
    keys: ['$fraction', '$of'],
    evaluate: (a) => a.$fraction! * a.$of!,
  },
  /** `exploCameraDistance(r)` */
  camera: {
    keys: ['$cameraFromRadiusKm'],
    evaluate: (a) => exploCameraDistance(a.$cameraFromRadiusKm!),
  },
};

/**
 * Les clés de chaque forme, `$date` compris : ce que le schéma des fiches
 * (`schema/entity.ts`) décrit à l'éditeur. Lu ici, jamais recopié, pour que les deux ne puissent
 * pas diverger.
 */
export const EXPRESSION_FORMS: readonly (readonly string[])[] = [
  ...Object.values(EXPRESSIONS).map((f) => f.keys),
  ['$date'],
];

const isExpression = (v: { [key: string]: Encoded }): boolean => {
  const keys = Object.keys(v);
  return keys.length > 0 && keys.every((k) => k.startsWith('$'));
};

/** Champs dont la valeur est une couleur `0xRRGGBB`, écrite en chaîne pour rester lisible. */
const COLOR_KEYS = new Set([
  'orbitalColor',
  'fallbackColor',
  'atmosphereColor',
  'color',
]);

/** Évalue une forme déclarée ; `$date` (`new Date(iso)` à l'origine) est la seule non numérique. */
function evaluate(value: { [key: string]: Encoded }, where: string): unknown {
  const keys = Object.keys(value).sort();
  if (keys.length === 1 && keys[0] === '$date') {
    if (typeof value.$date !== 'string')
      throw new Error(`${where} : $date attend une chaîne ISO`);
    return new Date(value.$date);
  }
  for (const form of Object.values(EXPRESSIONS)) {
    if (form.keys.length !== keys.length) continue;
    if (![...form.keys].sort().every((k, i) => k === keys[i])) continue;
    const args: Record<string, number> = {};
    for (const k of form.keys) {
      if (k === '$retrograde') {
        if (value[k] !== true)
          throw new Error(`${where} : $retrograde vaut true ou est absent`);
        continue;
      }
      const decoded = decode(value[k]!, `${where}.${k}`, k);
      if (typeof decoded !== 'number' || Number.isNaN(decoded))
        throw new Error(`${where}.${k} : nombre attendu`);
      args[k] = decoded;
    }
    return form.evaluate(args);
  }
  throw new Error(
    `${where} : forme déclarée inconnue ${JSON.stringify(Object.keys(value))}. L'ensemble des formes est fermé (registry/load.ts).`
  );
}

/** Décode une valeur de fiche vers la valeur du catalogue. */
export function decode(value: Encoded, where: string, key = ''): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number')
    return value;
  if (typeof value === 'string') {
    if (COLOR_KEYS.has(key)) {
      if (!/^0x[0-9a-fA-F]{6}$/.test(value))
        throw new Error(`${where} : couleur 0xRRGGBB attendue, reçu ${value}`);
      return Number.parseInt(value.slice(2), 16);
    }
    return value;
  }
  if (Array.isArray(value))
    return value.map((v, i) => decode(v, `${where}[${i}]`));
  if (isExpression(value)) return evaluate(value, where);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value))
    out[k] = decode(v, `${where}.${k}`, k);
  return out;
}

// ── Faits ─────────────────────────────────────────────────────────────────────────────────────

function provenanceOf(entry: FactEntry, where: string): FactProvenance | null {
  if (entry.source === undefined) return null;
  if (!entry.method) throw new Error(`${where} : provenance sans méthode`);
  const provenance: FactProvenance = {
    source: entry.source,
    method: entry.method,
  };
  if (entry.detail !== undefined) {
    if (typeof entry.detail === 'string') {
      const detail = (DETAIL as Record<string, LocalizedText>)[entry.detail];
      if (!detail)
        throw new Error(`${where} : précision inconnue ${entry.detail}`);
      provenance.detail = detail;
    } else provenance.detail = entry.detail;
  }
  if (entry.citation !== undefined) provenance.citation = entry.citation;
  if (entry.asOf !== undefined) provenance.asOf = entry.asOf;
  if (entry.uncertainty !== undefined)
    provenance.uncertainty = decode(
      entry.uncertainty,
      `${where}.uncertainty`
    ) as number;
  return provenance;
}

function reasonOf(entry: FactEntry, where: string): UnknownReason | null {
  if (entry.published !== false) {
    if (entry.reason !== undefined)
      throw new Error(`${where} : une raison sans « published: false »`);
    return null;
  }
  if (entry.source !== undefined)
    throw new Error(`${where} : un fait non publié ne cite pas de source`);
  if (entry.reason === 'not-yet-sourced') return NOT_YET_SOURCED;
  if (!entry.reason) throw new Error(`${where} : non publié sans raison`);
  return entry.reason;
}

/**
 * Où se range la VALEUR d'un fait. Dans le catalogue, `realData` porte le champ du même nom ;
 * la rotation vit hors de `realData` (`rotationSpeed`), elle ne porte donc jamais de valeur ici.
 */
const CATALOGUE_VALUE_FIELD: Partial<Record<FactField, string>> = {
  radiusKm: 'radiusKm',
  massKg: 'massKg',
  gravity: 'gravity',
  meanTempC: 'meanTempC',
  moonCount: 'moonCount',
  axialTilt: 'axialTilt',
  distanceAU: 'distanceAU',
  orbitPeriodDays: 'orbitPeriodDays',
};

/**
 * Pour un petit corps, la valeur va dans ses ÉLÉMENTS, dans leurs unités publiées (obliquité en
 * degrés, rotation en heures). Distance et période en sont DÉRIVÉES par `smallBodyToConfig`.
 */
const SMALL_BODY_VALUE_FIELD: Partial<Record<FactField, string>> = {
  radiusKm: 'radiusKm',
  massKg: 'massKg',
  gravity: 'gravity',
  meanTempC: 'meanTempC',
  moonCount: 'moonCount',
  axialTilt: 'axialTiltDeg',
  rotationPeriod: 'rotationHours',
};

/** Redéploie les faits : valeurs dans `target`, provenances et raisons dans deux tables. */
function spreadFacts(
  facts: Partial<Record<FactField, FactEntry>>,
  target: Record<string, unknown>,
  valueField: Partial<Record<FactField, string>>,
  where: string
): {
  sources: Partial<Record<FactField, FactProvenance>>;
  unknown: Partial<Record<FactField, UnknownReason>>;
} {
  const sources: Partial<Record<FactField, FactProvenance>> = {};
  const unknown: Partial<Record<FactField, UnknownReason>> = {};
  for (const [field, entry] of Object.entries(facts) as [
    FactField,
    FactEntry,
  ][]) {
    const at = `${where}.facts.${field}`;
    if (entry.value !== undefined) {
      const key = valueField[field];
      if (!key) throw new Error(`${at} : ce fait ne porte pas de valeur ici`);
      target[key] = decode(entry.value, `${at}.value`);
    }
    const provenance = provenanceOf(entry, at);
    if (provenance) sources[field] = provenance;
    const reason = reasonOf(entry, at);
    if (reason) unknown[field] = reason;
  }
  return { sources, unknown };
}

// ── Assemblage ────────────────────────────────────────────────────────────────────────────────

/** Construit les corps d'un ensemble de fiches, en notant lesquelles ont été placées. */
function builder(records: readonly EntityRecord[]) {
  const byId = new Map<string, EntityRecord>();
  for (const record of records) {
    if (byId.has(record.id)) throw new Error(`entité en double : ${record.id}`);
    byId.set(record.id, record);
  }
  const used = new Set<string>();

  const children = (ids: Encoded | undefined, where: string) => {
    if (!Array.isArray(ids) || !ids.every((c) => typeof c === 'string'))
      throw new Error(`${where}.satellites : liste d'identifiants attendue`);
    return Object.fromEntries(ids.map((c) => [c, build(c as string)]));
  };

  /** Les éléments publiés d'un petit corps, faits redéployés, satellites construits. */
  function elementsOf(record: SmallBodyEntity): SmallBodyElements {
    const where = `entities/${record.id}`;
    const el: Record<string, unknown> = { name: record.id };
    for (const [key, value] of Object.entries(record.elements)) {
      el[key] =
        key === 'satellites'
          ? children(value, where)
          : decode(value, `${where}.elements.${key}`, key);
    }
    const { sources, unknown } = spreadFacts(
      record.facts ?? {},
      el,
      SMALL_BODY_VALUE_FIELD,
      where
    );
    if (Object.keys(sources).length > 0) el.sources = sources;
    if (Object.keys(unknown).length > 0) el.unknown = unknown;
    return el as unknown as SmallBodyElements;
  }

  function build(id: string): CelestialBodyConfig {
    const record = byId.get(id);
    if (!record) throw new Error(`entité inconnue : ${id}`);
    if (used.has(id)) throw new Error(`entité placée deux fois : ${id}`);
    used.add(id);
    if (record.source === 'small-body')
      return smallBodyToConfig(elementsOf(record));

    const where = `entities/${id}`;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record.config)) {
      out[key] =
        key === 'satellites'
          ? children(value, where)
          : decode(value, `${where}.config.${key}`, key);
    }
    const facts = record.facts ?? {};
    if (Object.keys(facts).length > 0) {
      const realData = out.realData as Record<string, unknown> | undefined;
      if (!realData)
        throw new Error(
          `${where} : des faits sans emplacement « realData » dans config`
        );
      const { sources, unknown } = spreadFacts(
        facts,
        realData,
        CATALOGUE_VALUE_FIELD,
        where
      );
      if (Object.keys(sources).length > 0) realData.sources = sources;
      if (Object.keys(unknown).length > 0) realData.unknown = unknown;
    }
    return out as unknown as CelestialBodyConfig;
  }

  return { byId, used, build, elementsOf };
}

/**
 * Le catalogue, dans l'ordre déclaré par `order` (premier niveau) et par la liste `satellites` de
 * chaque fiche. L'ordre est une DONNÉE : il pilote la navigation, le sitemap et les pages. Une
 * fiche que l'arbre n'atteint pas est une erreur, pas un corps silencieusement absent.
 */
export function loadCatalogue(
  records: readonly EntityRecord[],
  order: readonly string[]
): Record<string, CelestialBodyConfig> {
  const { byId, used, build } = builder(records);
  const bodies = Object.fromEntries(order.map((id) => [id, build(id)]));
  const orphans = [...byId.keys()].filter((id) => !used.has(id));
  if (orphans.length > 0)
    throw new Error(
      `entités jamais placées dans l'arbre : ${orphans.join(', ')}`
    );
  return bodies;
}

/**
 * Les éléments publiés des petits corps de premier niveau, dans l'ordre du catalogue : ce que
 * `smallBodies.test.ts` confronte à Horizons et ce que `/methodology` compte.
 */
export function smallBodyElements(
  records: readonly EntityRecord[],
  order: readonly string[]
): SmallBodyElements[] {
  const { byId, elementsOf } = builder(records);
  return order
    .map((id) => byId.get(id))
    .filter((r): r is SmallBodyEntity => r?.source === 'small-body')
    .map((r) => elementsOf(r));
}
