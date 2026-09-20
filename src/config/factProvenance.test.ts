import { describe, expect, it } from 'vitest';
import { CELESTIAL_CONFIG } from './bodies';
import { forEachBody } from './catalog';
import {
  FACT_SOURCES,
  G_SI,
  factSource,
  gravityFromGM,
  massFromDensity,
  massFromGM,
} from './factSources';
import snapshot from './factSources.snapshot.json';
import {
  ALL_FACT_FIELDS,
  DATE_FACTS,
  TIME_VARYING_FACTS,
  bodyFact,
  factValue,
} from '@/core/bodyFacts';
import { NAVIGABLE_TARGETS } from './navigable';
import { SPACECRAFT_MISSIONS } from './spacecraft';
import { KM_PER_AU } from '@/core/ScaleService';
import { PLANETS_TO_SUN_MASS_RATIO } from '@/core/kepler';
import { DEG_TO_RAD as D2R, RAD_TO_DEG } from '@/core/MathConstants';
import type { CelestialBodyConfig, FactField, FactProvenance } from '@/types';

/**
 * FAITS SOURCÉS — un chiffre affiché sur la fiche d'un corps ou sur sa page publique est une
 * affirmation scientifique. Ce fichier tient trois promesses :
 *
 *   1. aucun fait affiché sans provenance (source du registre, méthode, date s'il évolue) ;
 *   2. aucune source secondaire : pas de Wikipédia, que des agences, bases d'agences et articles ;
 *   3. chaque valeur citée est CONFRONTÉE à sa source, telle que `scripts/snapshot-fact-sources.mjs`
 *      l'a lue (`factSources.snapshot.json`). Une citation qu'aucun test ne vérifie ne vaut pas
 *      mieux que pas de citation : le catalogue citait des valeurs qu'aucune source ne portait
 *      (gravité de Jupiter 24,79 m/s², Titanie 788,4 km, masse de Kerberos dix fois trop faible).
 */

const FIELDS: FactField[] = [...ALL_FACT_FIELDS];

/**
 * Tout ce qui porte une fiche, catalogue ET couche instrument : les onze sondes et les trois
 * objets interstellaires affichent leurs faits par la même règle (`core/bodyFacts.ts`) et dans
 * la même fiche (`ui/bodyInfo.ts`). Les laisser hors de ce fichier, c'est exactement ce qui a
 * permis à leur date de lancement de vivre des mois sans source.
 */
const bodies: { name: string; cfg: CelestialBodyConfig }[] = [];
forEachBody(CELESTIAL_CONFIG, ({ name, config }) => {
  if (config.kind !== 'skybox') bodies.push({ name, cfg: config });
});
for (const [name, cfg] of NAVIGABLE_TARGETS) bodies.push({ name, cfg });

const relativeError = (actual: number, expected: number): number =>
  expected === 0
    ? Math.abs(actual)
    : Math.abs(actual - expected) / Math.abs(expected);

describe('faits affichés : provenance obligatoire', () => {
  it('couvre tout le catalogue', () => {
    expect(bodies.length).toBeGreaterThanOrEqual(50);
  });

  it('ne publie aucune valeur sans source', () => {
    // Le cœur du lot : une valeur présente dans le catalogue, affichable, et sans provenance.
    // `core/bodyFacts` la montrerait « pas encore sourcée » ; le catalogue doit le dire lui-même
    // (`unknown: NOT_YET_SOURCED`) ou citer sa source.
    const unsourced: string[] = [];
    for (const { name, cfg } of bodies)
      for (const field of FIELDS) {
        const entry = bodyFact(cfg, field);
        if (
          entry.status === 'unknown' &&
          entry.reason.unsourced &&
          !cfg.realData?.unknown?.[field]
        )
          unsourced.push(`${name}.${field}`);
      }
    expect(
      unsourced,
      'valeurs affichables sans provenance : citer la source (realData.sources) ou déclarer NOT_YET_SOURCED'
    ).toEqual([]);
  });

  it('ne cite qu’une source du registre, jamais Wikipédia', () => {
    for (const { name, cfg } of bodies)
      for (const [field, provenance] of Object.entries(
        cfg.realData?.sources ?? {}
      )) {
        const source = factSource(provenance.source);
        expect(
          source,
          `${name}.${field} : source inconnue ${provenance.source}`
        ).toBeDefined();
      }
    for (const [id, source] of Object.entries(FACT_SOURCES)) {
      const url = new URL(source.url);
      expect(url.protocol, id).toBe('https:');
      expect(url.hostname, id).not.toMatch(/wikipedia|wikimedia|wikidata/);
      expect(source.accessed, id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('n’a aucune source orpheline dans le registre', () => {
    const used = new Set<string>();
    for (const { cfg } of bodies)
      for (const provenance of Object.values(cfg.realData?.sources ?? {}))
        used.add(provenance.source);
    expect(Object.keys(FACT_SOURCES).filter((id) => !used.has(id))).toEqual([]);
  });

  it('date chaque fait qui évolue', () => {
    for (const { name, cfg } of bodies)
      for (const field of TIME_VARYING_FACTS) {
        const provenance = cfg.realData?.sources?.[field];
        if (!provenance) continue;
        expect(provenance.asOf, `${name}.${field}`).toMatch(
          /^\d{4}-\d{2}(-\d{2})?$/
        );
      }
  });

  it('ne déclare pas de provenance pour une valeur absente ou non affichée', () => {
    // Une provenance qui ne décrit rien d'affiché ment en silence : elle survivrait au retrait de
    // la valeur et ferait croire à une source vérifiée.
    const stray: string[] = [];
    for (const { name, cfg } of bodies)
      for (const field of Object.keys(
        cfg.realData?.sources ?? {}
      ) as FactField[])
        if (bodyFact(cfg, field).status !== 'value')
          stray.push(`${name}.${field}`);
    expect(stray).toEqual([]);
  });
});

// ── Confrontation aux sources ────────────────────────────────────────────────────────────────

/** `absolute` : tolérance dans l'unité du champ plutôt que relative (obliquité). */
type Expected = { values: number[]; tolerance: number; absolute?: boolean };

/** Tolérance relative : l'arrondi d'affichage le plus fin (4 chiffres significatifs). */
const MEASURED = 1e-3;

const nssdca = snapshot.nssdca.bodies as Record<
  string,
  Record<string, number | string>
>;
const nssdcaSat = snapshot.nssdcaSatellites as Record<
  string,
  {
    semiMajorAxisKm: number;
    siderealOrbitDays: number;
    rotation: string | null;
  }
>;
const phys = snapshot.jplSatellites.physicalParameters.bodies as Record<
  string,
  {
    gmKm3s2: number | null;
    gmSigma: number | null;
    meanRadiusKm: number;
    meanRadiusSigma: number;
  }
>;
const elem = snapshot.jplSatellites.meanElements.bodies as Record<
  string,
  { semiMajorAxisKm: number; periodDays: number }
>;
const nssdcaMaster = snapshot.nssdcaMasterCatalog as Record<
  string,
  {
    cosparId: string;
    name: string;
    launchDate: string;
    massKg: number;
    launchMassMentions: string[];
  }
>;
const sbdbInterstellar = snapshot.sbdbInterstellar as Record<
  string,
  {
    fullname: string;
    eccentricity: { value: number; sigma: number | null };
    perihelionAU: { value: number; sigma: number | null };
    firstObservation: string;
    observationsUsed: number;
    solutionDate: string;
  }
>;
const sbdb = snapshot.sbdb as Record<
  string,
  {
    // `sigma` peut être une chaîne : la SBDB publie des incertitudes asymétriques
    // (« -1/+4 » pour le diamètre de 16 Psyché), conservées telles quelles.
    diameterKm: {
      value: number;
      sigma: number | string | null;
      ref: string;
    } | null;
    gmKm3s2: {
      value: number;
      sigma: number | string | null;
      ref: string;
      notes: string | null;
    } | null;
    rotationHours: { value: number; ref: string; notes: string | null } | null;
    pole: { value: number[]; ref: string } | null;
    confirmedSatellites: number;
  }
>;

const num = (v: number | string | undefined): number => Number(v);

/**
 * Valeurs d'articles, transcrites depuis les citations que le script a retrouvées MOT POUR MOT
 * dans le texte publié (`snapshot.articles[id].verifiedQuotes`). La transcription reste humaine ;
 * le texte qu'elle transcrit, lui, est vérifié, et ce test exige que la citation y figure.
 */
const ARTICLE_VALUES: Record<
  string,
  Record<string, Partial<Record<FactField, { value: number; quote: string }>>>
> = {
  'sicardy-2011-eris': {
    eris: {
      radiusKm: { value: 1163, quote: 'radius 1,163 ± 6 kilometres' },
      massKg: {
        value: massFromDensity(2.52, 1163),
        quote: 'density 2.52 ± 0.05 grams per cm3',
      },
      gravity: {
        value: gravityFromGM((massFromDensity(2.52, 1163) * G_SI) / 1e9, 1163),
        quote: 'density 2.52 ± 0.05 grams per cm3',
      },
    },
  },
  'szakats-2023-eris': {
    eris: { rotationPeriod: { value: 15.8 * 24, quote: 'P = 15.8 d' } },
  },
  'ragozzine-brown-2009-haumea': {
    haumea: {
      massKg: { value: 4.006e21, quote: 'Haumea Mass 4.006 ± 0.040 1021 kg' },
    },
  },
  'brown-2013-makemake': {
    makemake: {
      radiusKm: {
        value: 1434 / 2,
        quote: 'measured equatorial diameter of 1434 +/- 14 km',
      },
    },
  },
  'kiss-2019-gonggong': {
    gonggong: {
      radiusKm: { value: 615, quote: 'a size of 1230$\\pm$50 km' },
      massKg: { value: 1.75e21, quote: 'system mass of 1.75x10$^{21}$ kg' },
      gravity: {
        value: gravityFromGM((1.75e21 * G_SI) / 1e9, 615),
        quote: 'system mass of 1.75x10$^{21}$ kg',
      },
    },
  },
  'margoti-2026-quaoar': {
    quaoar: {
      radiusKm: {
        value: 547.2,
        quote: 'equivalent volumetric diameter of 1094.4 +/- 4.6 km',
      },
      massKg: {
        value: massFromDensity(1.76, 547.2),
        quote: 'density of 1.760 +/- 0.109 g/cm3',
      },
      gravity: {
        value: gravityFromGM(
          (massFromDensity(1.76, 547.2) * G_SI) / 1e9,
          547.2
        ),
        quote: 'density of 1.760 +/- 0.109 g/cm3',
      },
      rotationPeriod: { value: 8.8394, quote: '8.8394 +/- 0.0002 hours' },
    },
  },
  'pal-2012-sedna': {
    sedna: { radiusKm: { value: 497.5, quote: '995 +/- 80 km' } },
  },
  'kiss-2016-nereid': {
    nereid: {
      rotationPeriod: {
        value: 11.594,
        quote: 'rotation period of P=11.594(+/-)0.017 h',
      },
    },
  },
};

/** Obliquité (degrés) entre un pôle RA/Dec J2000 et la normale d'une orbite écliptique (i, Ω). */
function obliquityFromPole(
  poleDeg: number[],
  cfg: CelestialBodyConfig
): number {
  const [ra, dec] = poleDeg.map((d) => d * D2R);
  const eps = (84381.448 / 3600) * D2R;
  const eq = [
    Math.cos(dec) * Math.cos(ra),
    Math.cos(dec) * Math.sin(ra),
    Math.sin(dec),
  ];
  const ecl = [
    eq[0],
    Math.cos(eps) * eq[1] + Math.sin(eps) * eq[2],
    -Math.sin(eps) * eq[1] + Math.cos(eps) * eq[2],
  ];
  const el = cfg.orbitalElements!;
  const normal = [
    Math.sin(el.inclinationRad) * Math.sin(el.ascendingNodeRad),
    -Math.sin(el.inclinationRad) * Math.cos(el.ascendingNodeRad),
    Math.cos(el.inclinationRad),
  ];
  const dot = ecl.reduce((sum, v, k) => sum + v * normal[k], 0);
  return Math.acos(Math.max(-1, Math.min(1, dot))) * RAD_TO_DEG;
}

/**
 * Ce que la source dit pour ce champ, dans l'unité du catalogue (heures pour la rotation, radians
 * pour l'obliquité). Plusieurs valeurs possibles quand une fiche publie plusieurs définitions
 * (rayon moyen ou équatorial) : la valeur du catalogue doit correspondre à l'une d'elles, et le
 * test suivant exige alors une précision (`detail`) quand ce n'est pas la définition par défaut.
 */
function expected(
  name: string,
  cfg: CelestialBodyConfig,
  field: FactField,
  p: FactProvenance
): Expected {
  const fail = (why: string): never => {
    throw new Error(`${name}.${field} (${p.source}) : ${why}`);
  };
  switch (p.source) {
    case 'nssdca-fact-sheets': {
      const sat = nssdcaSat[name];
      const sheet = nssdca[name];
      if (
        sat &&
        (field === 'distanceAU' ||
          field === 'orbitPeriodDays' ||
          field === 'rotationPeriod')
      ) {
        if (field === 'distanceAU')
          return {
            values: [sat.semiMajorAxisKm / KM_PER_AU],
            tolerance: MEASURED,
          };
        if (field === 'orbitPeriodDays')
          return { values: [sat.siderealOrbitDays], tolerance: MEASURED };
        if (sat.rotation !== 'S')
          fail('rotation non synchrone selon la source');
        return { values: [sat.siderealOrbitDays * 24], tolerance: MEASURED };
      }
      if (!sheet) fail('corps absent des fiches');
      switch (field) {
        case 'radiusKm':
          return {
            values: [sheet.volumetricMeanRadiusKm, sheet.equatorialRadiusKm]
              .filter((v) => v !== undefined)
              .map(num),
            tolerance: MEASURED,
          };
        case 'massKg':
          return {
            values: [
              sheet.mass1e24Kg !== undefined
                ? num(sheet.mass1e24Kg) * 1e24
                : num(sheet.mass1e21Kg) * 1e21,
            ],
            tolerance: MEASURED,
          };
        case 'gravity':
          return {
            values: [
              sheet.meanGravity,
              sheet.surfaceGravity,
              sheet.surfaceGravityEq,
            ]
              .filter((v) => v !== undefined)
              .map(num),
            tolerance: 0.006,
          };
        case 'meanTempC':
          if (sheet.effectiveTemperatureK !== undefined)
            return {
              values: [num(sheet.effectiveTemperatureK) - 273.15],
              tolerance: 1e-6,
            };
          return { values: [num(sheet.meanTemperatureC)], tolerance: 1e-6 };
        case 'distanceAU':
          return {
            values: [
              sheet.semiMajorAxisAU !== undefined
                ? num(sheet.semiMajorAxisAU)
                : (num(sheet.semiMajorAxis1e6Km) * 1e6) / KM_PER_AU,
            ],
            tolerance: MEASURED,
          };
        case 'orbitPeriodDays':
          return {
            values: [num(sheet.siderealOrbitDays)],
            tolerance: MEASURED,
          };
        case 'rotationPeriod':
          return {
            values: [
              sheet.siderealRotationHours !== undefined
                ? Math.abs(num(sheet.siderealRotationHours))
                : num(sheet.siderealRotationDays) * 24,
            ],
            tolerance: MEASURED,
          };
        case 'axialTilt':
          return { values: [num(sheet.obliquityDeg) * D2R], tolerance: 1e-6 };
        case 'moonCount':
          if (p.asOf !== sheet.updated)
            fail(`date ${p.asOf} ≠ mise à jour de la fiche ${sheet.updated}`);
          return { values: [num(sheet.moonCount)], tolerance: 0 };
      }
      break;
    }
    case 'jpl-ssd-satellite-physical-parameters': {
      const row = phys[name] ?? fail('satellite absent de la table');
      if (field === 'radiusKm') {
        if (p.uncertainty !== row.meanRadiusSigma) fail('incertitude ≠ table');
        return { values: [row.meanRadiusKm], tolerance: 1e-9 };
      }
      if (row.gmKm3s2 === null || row.gmKm3s2 === 0) fail('aucun GM publié');
      const gm = row.gmKm3s2!;
      if (field === 'massKg') {
        if (p.method !== 'derived') fail('la masse se DÉRIVE du GM');
        if (
          p.uncertainty !== undefined &&
          relativeError(p.uncertainty, massFromGM(row.gmSigma!)) > 1e-9
        )
          fail('incertitude ≠ table');
        return { values: [massFromGM(gm)], tolerance: 1e-9 };
      }
      if (field === 'gravity')
        return {
          values: [gravityFromGM(gm, row.meanRadiusKm)],
          tolerance: 1e-9,
        };
      break;
    }
    case 'jpl-ssd-satellite-mean-elements': {
      const row = elem[name] ?? fail('satellite absent de la table');
      if (field === 'distanceAU')
        return { values: [row.semiMajorAxisKm / KM_PER_AU], tolerance: 1e-9 };
      if (field === 'orbitPeriodDays')
        return { values: [row.periodDays], tolerance: MEASURED };
      break;
    }
    case 'nssdca-master-catalog': {
      const row = nssdcaMaster[name] ?? fail('sonde absente du relevé NSSDCA');
      if (p.citation !== `NSSDCA/COSPAR ${row.cosparId}`)
        fail(`citation « ${p.citation} » ≠ identifiant ${row.cosparId}`);
      if (field === 'massKg') {
        // Le champ « Mass » du catalogue n'a pas le même sens partout : quand la fiche elle-même
        // parle d'une masse au lancement, la valeur publiée doit le DIRE (`detail`).
        if (row.launchMassMentions.length > 0 && !p.detail)
          fail(
            'la page cite une masse au lancement différente : la fiche doit préciser ce qu’elle publie'
          );
        return { values: [row.massKg], tolerance: 0 };
      }
      break;
    }
    case 'jpl-sbdb': {
      // Un interstellaire n'est pas dans le relevé `sbdb` (diamètre, GM, rotation) : ses deux
      // faits sont traités d'abord, avant que l'absence de ligne ne fasse échouer.
      const row = sbdbInterstellar[name]
        ? ({} as (typeof sbdb)[string])
        : (sbdb[name] ?? fail('corps absent de la SBDB'));
      const cite = (ref: string | undefined): void => {
        if (p.citation !== ref)
          fail(`citation « ${p.citation} » ≠ référence SBDB « ${ref} »`);
      };
      switch (field) {
        case 'eccentricity':
        case 'perihelionAU': {
          const inter =
            sbdbInterstellar[name] ?? fail('objet absent du relevé SBDB');
          const reference = `orbit solution ${inter.solutionDate.slice(0, 10)}, ${inter.observationsUsed} observations`;
          if (p.citation !== reference)
            fail(`citation « ${p.citation} » ≠ solution « ${reference} »`);
          const published = inter[field];
          if (p.uncertainty !== (published.sigma ?? undefined))
            fail(
              `incertitude ${p.uncertainty} ≠ sigma publié ${published.sigma}`
            );
          return { values: [published.value], tolerance: 1e-12 };
        }
        case 'radiusKm':
          cite(row.diameterKm?.ref);
          return { values: [row.diameterKm!.value / 2], tolerance: 1e-9 };
        case 'massKg': {
          cite(row.gmKm3s2?.ref);
          const published = row.gmKm3s2?.notes?.match(
            /published mass of ([\d.e+]+) kg/
          )?.[1];
          return {
            values: [
              massFromGM(row.gmKm3s2!.value),
              ...(published ? [Number(published)] : []),
            ],
            tolerance: 1e-9,
          };
        }
        case 'gravity':
          cite(row.gmKm3s2?.ref);
          return {
            values: [
              gravityFromGM(row.gmKm3s2!.value, row.diameterKm!.value / 2),
            ],
            tolerance: 1e-9,
          };
        case 'rotationPeriod':
          cite(row.rotationHours?.ref);
          if (
            row.rotationHours?.notes?.includes('less than full coverage') &&
            !p.detail
          )
            fail(
              'la source signale une couverture incomplète : la fiche doit le dire (detail)'
            );
          return { values: [row.rotationHours!.value], tolerance: 1e-6 };
        case 'axialTilt':
          cite(row.pole?.ref);
          return {
            values: [obliquityFromPole(row.pole!.value, cfg) * D2R],
            tolerance: 0.06 * D2R,
            absolute: true,
          };
        case 'moonCount':
          if (p.asOf !== snapshot.retrieved)
            fail(`date ${p.asOf} ≠ relevé ${snapshot.retrieved}`);
          return { values: [row.confirmedSatellites], tolerance: 0 };
      }
      break;
    }
    case 'jpl-horizons': {
      const el = cfg.orbitalElements ?? fail('pas d’éléments orbitaux');
      if (field === 'distanceAU')
        return { values: [el.semiMajorAxisAU], tolerance: 1e-12 };
      if (field === 'orbitPeriodDays') {
        // Troisième loi de Kepler ; barycentrique : même μ que la propagation (planètes incluses).
        const days =
          (365.256 * Math.pow(el.semiMajorAxisAU, 1.5)) /
          (el.barycentric ? Math.sqrt(1 + PLANETS_TO_SUN_MASS_RATIO) : 1);
        return { values: [days], tolerance: 1e-9 };
      }
      break;
    }
    default: {
      if (p.source.startsWith('nasa-science-')) {
        const planet = p.source
          .replace('nasa-science-', '')
          .replace('-moons', '');
        const row = (
          snapshot.nasaMoonCounts as Record<
            string,
            { moonCount: number; asOf: string | null }
          >
        )[planet];
        if (planet !== name) fail('page d’une autre planète');
        const asOf = row.asOf ?? snapshot.retrieved;
        if (p.asOf !== asOf) fail(`date ${p.asOf} ≠ date de la source ${asOf}`);
        return { values: [row.moonCount], tolerance: 0 };
      }
      const article = ARTICLE_VALUES[p.source]?.[name]?.[field];
      if (article) {
        const verified = (
          snapshot.articles as Record<string, { verifiedQuotes: string[] }>
        )[p.source];
        if (!verified?.verifiedQuotes.includes(article.quote))
          fail(`citation non vérifiée dans la source : ${article.quote}`);
        return { values: [article.value], tolerance: 1e-9 };
      }
    }
  }
  return fail('aucune règle de confrontation pour ce champ');
}

describe('faits affichés : confrontés à leur source', () => {
  const cases: [
    string,
    string,
    CelestialBodyConfig,
    FactField,
    FactProvenance,
  ][] = [];
  for (const { name, cfg } of bodies)
    for (const [field, provenance] of Object.entries(
      cfg.realData?.sources ?? {}
    )) {
      // Les faits DATÉS ont leur propre confrontation, juste en dessous : une date ne se
      // compare pas à une tolérance relative.
      if (DATE_FACTS.has(field as FactField)) continue;
      cases.push([
        `${name}.${field}`,
        name,
        cfg,
        field as FactField,
        provenance,
      ]);
    }

  it('confronte un nombre substantiel de faits', () => {
    expect(cases.length).toBeGreaterThan(300);
  });

  it.each(cases)('%s', (_label, name, cfg, field, provenance) => {
    const factual = factValue(cfg, field)!;
    // Cette confrontation-ci est NUMÉRIQUE ; les faits datés ont la leur, plus bas.
    if (factual.kind !== 'number')
      throw new Error(
        `${name}.${field} : fait daté dans la confrontation numérique`
      );
    const value = factual.value;
    const { values, tolerance, absolute } = expected(
      name,
      cfg,
      field,
      provenance
    );
    const errors = values.map((v) =>
      absolute ? Math.abs(value - v) : relativeError(value, v)
    );
    const best = Math.min(...errors);
    expect(
      best,
      `${name}.${field} = ${value}, source ${provenance.source} : ${values.join(' ou ')}`
    ).toBeLessThanOrEqual(tolerance === 0 ? 0 : tolerance);
    // Une définition autre que la première (rayon équatorial plutôt que moyen) doit se dire.
    if (errors[0] > tolerance && !provenance.detail)
      throw new Error(
        `${name}.${field} : valeur conforme à une définition secondaire sans « detail »`
      );
  });
});

/**
 * FAITS DATÉS. Une date de lancement ou une première observation ne se compare pas avec une
 * tolérance : c'est la date de la source, ou ce n'en est pas une. Le relevé porte l'identifiant
 * COSPAR ou la solution d'orbite, et la fiche doit citer exactement celui-là : c'est ce qui
 * rend la valeur retrouvable par un lecteur, puisque le registre ne porte qu'une URL de base.
 */
describe('faits datés : confrontés à leur source', () => {
  const cases: [string, string, CelestialBodyConfig, FactField][] = [];
  for (const { name, cfg } of bodies)
    for (const field of DATE_FACTS)
      if (cfg.realData?.sources?.[field])
        cases.push([`${name}.${field}`, name, cfg, field]);

  it('couvre les onze sondes et les trois interstellaires', () => {
    expect(cases.length).toBe(14);
  });

  it.each(cases)('%s', (_label, name, cfg, field) => {
    const factual = factValue(cfg, field)!;
    expect(factual.kind, `${name}.${field}`).toBe('date');
    const iso = factual.kind === 'date' ? factual.iso : '';
    const provenance = cfg.realData!.sources![field]!;
    if (field === 'launchDate') {
      const row = nssdcaMaster[name];
      expect(row, `${name} absente du relevé NSSDCA`).toBeDefined();
      expect(provenance.source).toBe('nssdca-master-catalog');
      expect(provenance.citation).toBe(`NSSDCA/COSPAR ${row.cosparId}`);
      expect(iso, `${name}.launchDate`).toBe(row.launchDate);
      return;
    }
    const row = sbdbInterstellar[name];
    expect(row, `${name} absent du relevé SBDB`).toBeDefined();
    expect(provenance.source).toBe('jpl-sbdb');
    expect(iso, `${name}.firstObservation`).toBe(row.firstObservation);
  });

  it('cite la couverture Horizons qui commence après le lancement publié', () => {
    // Deux chemins indépendants pour la même date : le relevé NSSDCA d'un côté, la borne basse
    // du manifeste d'éphémérides de l'autre. Une erreur d'identifiant COSPAR ferait diverger
    // les deux, même si la page lue existait bel et bien.
    for (const mission of SPACECRAFT_MISSIONS) {
      const row = nssdcaMaster[mission.name];
      expect(row, mission.name).toBeDefined();
      expect(mission.launchDate, mission.name).toBe(row.launchDate);
    }
  });
});
