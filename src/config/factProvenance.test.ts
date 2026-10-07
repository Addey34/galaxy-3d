import { describe, expect, it } from 'vitest';
import { isLocalizedText } from '@/i18n/localizedOrKey';
import { CELESTIAL_CONFIG } from './bodies';
import { forEachBody } from './catalog';
import {
  FACT_SOURCES,
  G_SI,
  factSource,
  gravityFromGM,
  gravityFromMass,
  massFromDensity,
  massFromGM,
} from './factSources';
import snapshot from './factSources.snapshot.json';
import {
  ALL_FACT_FIELDS,
  DATE_FACTS,
  NAME_FACTS,
  TIME_VARYING_FACTS,
  bodyFact,
  factValue,
} from '@/core/bodyFacts';
import { NAVIGABLE_TARGETS } from './navigable';
import { SPACECRAFT_MISSIONS } from './spacecraft';
import { KM_PER_AU } from '@/core/ScaleService';
import { PLANETS_TO_SUN_MASS_RATIO } from '@/core/kepler';
import { DEG_TO_RAD as D2R, RAD_TO_DEG } from '@/core/MathConstants';
import {
  angleBetween,
  centuriesFromJ2000,
  equatorialToEcliptic,
  orbitNormalFromElements,
  orbitNormalFromPositions,
  spinAngularMomentum,
  type NutationAngles,
  type Vec3,
} from '@/core/iauPole';
import { JupiterMoons } from 'astronomy-engine';
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

// `surfacePressure` (objet, 2026-10-07) n'est pas un fait affiché : lu par
// `scripts/measure-display-albedo.mjs`, pas ici.
const nssdca = snapshot.nssdca.bodies as unknown as Record<
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
    launchVehicle: string | null;
    launchSite: string | null;
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
    absoluteMagnitude: { value: number; sigma: number | null } | null;
    cometTotalMagnitude: { value: number; sigma: number | null } | null;
    firstObservation: string;
    observationsUsed: number;
    solutionDate: string;
  }
>;
const nasaScience = snapshot.nasaScienceBodies as Record<
  string,
  { url: string; sentence: string; celsius: number[] }
>;
const sbdb = snapshot.sbdb as Record<
  string,
  {
    // `sigma` peut être une chaîne : la SBDB publie des incertitudes asymétriques
    // (« -1/+4 » pour le diamètre de 16 Psyché), conservées telles quelles.
    diameterKm: {
      value: number;
      sigma: number | string | null;
      // `null` : la SBDB ne cite aucune source (Gaspra, Mathilde).
      ref: string | null;
    } | null;
    gmKm3s2: {
      value: number;
      sigma: number | string | null;
      ref: string;
      notes: string | null;
    } | null;
    /** g/cm³, sauf quand la base change d'unité sans le dire (Dinkinesh : « 2400 »). */
    densityGcm3: {
      value: number;
      sigma: number | string | null;
      ref: string | null;
    } | null;
    rotationHours: { value: number; ref: string; notes: string | null } | null;
    pole: { value: number[]; ref: string } | null;
    confirmedSatellites: number;
    /** Le jour où CETTE réponse a été lue : la SBDB ne date pas son compte de satellites. */
    retrieved: string;
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
  'brown-2010-orcus': {
    orcus: {
      massKg: {
        value: 6.32e20,
        quote: 'system mass of 6.32+- 0.01 X 10^20 kg',
      },
    },
  },
  'nasa-didymos-dimorphos': {
    dimorphos: {
      radiusKm: {
        value: 0.16 / 2,
        quote:
          'The moonlet, Dimorphos (Didymos B), is about 525 feet (160 meters) in diameter.',
      },
      orbitPeriodDays: {
        value: (11 + 23 / 60) / 24,
        quote:
          'shortening the 11-hour and 55-minute orbit to 11 hours and 23 minutes',
      },
    },
  },
  'grundy-2018-patroclus': {
    menoetius: {
      distanceAU: {
        value: 688.5 / KM_PER_AU,
        quote: 'Semimajor axis (km) a 688.5 ± 4.7',
      },
      orbitPeriodDays: {
        value: 4.28268,
        quote: 'Period (days) P 4.282680 ± 0.000063',
      },
    },
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

const naif = snapshot.naifRotation as unknown as {
  kernel: string;
  systems: Record<string, NutationAngles>;
  bodies: Record<
    string,
    {
      naifId: number;
      system: number | null;
      rotation: {
        poleRaDeg: number[];
        poleDecDeg: number[];
        nutPrecRa: number[] | null;
        nutPrecDec: number[] | null;
        pmRateDegPerDay: number;
      } | null;
    }
  >;
};

/**
 * L'époque des éléments de repli des satellites : la MÊME pour tout le catalogue, et cette
 * unicité est vérifiée ici plutôt que recopiée. Elle sert aussi aux quatre lunes galiléennes,
 * qui n'ont pas d'éléments — astronomy-engine les place — pour que les vingt-trois obliquités
 * dérivées le soient toutes au même instant.
 */
const ORBIT_EPOCH = (() => {
  const epochs = new Set<number>();
  for (const { cfg } of bodies)
    if (cfg.relativeOrbitalElements)
      epochs.add(cfg.relativeOrbitalElements.epoch.getTime());
  if (epochs.size !== 1)
    throw new Error(
      `éléments de repli : ${epochs.size} époques différentes, la dérivation en suppose une`
    );
  return new Date([...epochs][0]);
})();

/**
 * Normale de l'orbite d'un corps, en écliptique, prise LÀ OÙ SON ORBITE EST DÉCRITE : les
 * éléments que sa fiche déclare, ou, quand elle n'en déclare pas parce qu'astronomy-engine
 * place le corps, astronomy-engine lui-même. C'est la seule entrée de la dérivation qui ne
 * vienne pas du noyau de NAIF.
 */
function orbitNormalOf(
  name: string,
  cfg: CelestialBodyConfig
): { normal: Vec3; epoch: Date } {
  const elements = cfg.relativeOrbitalElements ?? cfg.orbitalElements;
  if (elements)
    return {
      normal: orbitNormalFromElements(
        elements.inclinationRad,
        elements.ascendingNodeRad
      ),
      epoch: elements.epoch,
    };
  const moon = cfg.relativeEphemeris;
  if (moon?.kind !== 'jupiterMoon')
    throw new Error(`${name} : aucune orbite d'où tirer une normale`);
  const state = JupiterMoons(ORBIT_EPOCH)[moon.moon];
  return {
    normal: equatorialToEcliptic(
      orbitNormalFromPositions(
        [state.x, state.y, state.z],
        [state.x + state.vx, state.y + state.vy, state.z + state.vz]
      )
    ),
    epoch: ORBIT_EPOCH,
  };
}

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
/** La clé du message de précision d'une provenance (`detail.massFromDensity`), ou rien. */
const detailKey = (p: FactProvenance): string | undefined =>
  p.detail && 'message' in p.detail ? String(p.detail.message) : undefined;

/**
 * La densité SBDB d'un corps, en g/cm³, ou l'échec. La base change parfois d'unité sans le dire
 * (Dinkinesh : « 2400 », des kg/m³) : une densité hors de l'échelle d'un corps solide refuse.
 */
function sbdbDensity(
  row: (typeof sbdb)[string],
  fail: (why: string) => never
): { value: number; ref: string | null } {
  const density = row.densityGcm3 ?? fail('aucune densité publiée');
  if (!(density.value > 0.1 && density.value < 10))
    fail(`densité ${density.value} hors de l'échelle des g/cm³`);
  if (density.ref !== row.diameterKm?.ref)
    fail('densité et diamètre ne viennent pas de la même référence');
  return density;
}

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
      // Une référence VIDE à la source (la SBDB n'en cite aucune pour le diamètre de Gaspra ni
      // pour celui de Mathilde) veut dire : aucune citation dans la fiche. Le schéma refuse
      // une citation vide, et en écrire une inventée serait pire (2026-10-04).
      const cite = (ref: string | null | undefined): void => {
        const expected = ref ? ref : undefined;
        if (p.citation !== expected)
          fail(`citation « ${p.citation} » ≠ référence SBDB « ${ref} »`);
      };
      switch (field) {
        case 'eccentricity':
        case 'perihelionAU':
        case 'absoluteMagnitude': {
          const inter =
            sbdbInterstellar[name] ?? fail('objet absent du relevé SBDB');
          const reference = `orbit solution ${inter.solutionDate.slice(0, 10)}, ${inter.observationsUsed} observations`;
          if (p.citation !== reference)
            fail(`citation « ${p.citation} » ≠ solution « ${reference} »`);
          const published =
            inter[field] ??
            fail(`la SBDB ne publie pas ${field} pour cet objet`);
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
          if (detailKey(p) === 'detail.massFromDensity') {
            cite(sbdbDensity(row, fail).ref);
            return {
              values: [
                massFromDensity(
                  sbdbDensity(row, fail).value,
                  row.diameterKm!.value / 2
                ),
              ],
              tolerance: 1e-9,
            };
          }
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
          if (detailKey(p) === 'detail.gravityFromMass') {
            cite(sbdbDensity(row, fail).ref);
            const radius = row.diameterKm!.value / 2;
            return {
              values: [
                gravityFromMass(
                  massFromDensity(sbdbDensity(row, fail).value, radius),
                  radius
                ),
              ],
              tolerance: 1e-9,
            };
          }
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
          // La SBDB ne date pas son compte de satellites : la date affichée est alors celle de
          // LA RÉPONSE qui le porte, jamais celle du dernier relevé (ligne 23.1).
          if (p.asOf !== row.retrieved)
            fail(`date ${p.asOf} ≠ lecture de la source ${row.retrieved}`);
          return { values: [row.confirmedSatellites], tolerance: 0 };
      }
      break;
    }
    case 'naif-pck': {
      const entry = naif.bodies[name] ?? fail('corps absent du relevé NAIF');
      const reference = `${naif.kernel}, BODY${entry.naifId}`;
      if (p.citation !== reference)
        fail(`citation « ${p.citation} » ≠ « ${reference} »`);
      if (field !== 'axialTilt') break;
      if (p.method !== 'derived') fail('l’obliquité se DÉRIVE du pôle publié');
      const rotation =
        entry.rotation ?? fail('le noyau ne publie aucun pôle pour ce corps');
      const { normal, epoch } = orbitNormalOf(name, cfg);
      const spin = equatorialToEcliptic(
        spinAngularMomentum(
          {
            ...rotation,
            nutPrecRa: rotation.nutPrecRa ?? undefined,
            nutPrecDec: rotation.nutPrecDec ?? undefined,
          },
          naif.systems[String(entry.system)] ?? [],
          centuriesFromJ2000(epoch)
        )
      );
      // Tolérance ABSOLUE de 0,0051° : la fiche publie l'obliquité arrondie au centième de
      // degré, et un arrondi au centième s'écarte au plus de 0,005. Ce n'est pas la précision
      // de la MESURE (le rapport de l'UAI s'attribue 0,1°), c'est celle de la RECOPIE.
      return {
        values: [angleBetween(spin, normal)],
        tolerance: 0.0051 * D2R,
        absolute: true,
      };
    }
    case 'nasa-science-bodies': {
      const row =
        nasaScience[name] ?? fail('corps absent du relevé NASA Science');
      if (p.citation !== row.url)
        fail(`citation « ${p.citation} » ≠ page « ${row.url} »`);
      if (field !== 'meanTempC') break;
      // Plusieurs valeurs dans la phrase relevée veulent dire une PLAGE : la page ne publie
      // alors pas de moyenne, et la fiche n'a pas le droit d'en afficher une.
      if (row.celsius.length !== 1)
        fail('la page publie une plage, pas une moyenne');
      return { values: [row.celsius[0]], tolerance: 0 };
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
            { moonCount: number; asOf: string | null; retrieved: string }
          >
        )[planet];
        if (planet !== name) fail('page d’une autre planète');
        // La page dit « as of August 2026 », ou elle ne dit rien : dans ce second cas la date
        // affichée est celle où CETTE page a été lue. C'est arrivé à Jupiter le 2026-09-28,
        // dont la page a perdu sa mention.
        const asOf = row.asOf ?? row.retrieved;
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
      if (NAME_FACTS.has(field as FactField)) continue;
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

/**
 * FAITS NOMMÉS. Un lanceur ou un site de lancement est la chaîne que la source écrit, recopiée
 * à l'identique : c'est la seule raison pour laquelle `FactValue` admet un nom (voir
 * `core/bodyFacts.ts`). Aucune tolérance, aucune normalisation, pas même de la casse : une
 * chaîne réécrite par nous, traduite ou « corrigée », doit échouer ici.
 */
describe('faits nommés : recopiés de leur source', () => {
  const cases: [string, string, CelestialBodyConfig, FactField][] = [];
  for (const { name, cfg } of bodies)
    for (const field of NAME_FACTS)
      if (cfg.realData?.sources?.[field])
        cases.push([`${name}.${field}`, name, cfg, field]);

  it('couvre le lanceur et le site des onze sondes', () => {
    expect(cases.length).toBe(22);
  });

  it.each(cases)('%s', (_label, name, cfg, field) => {
    const factual = factValue(cfg, field)!;
    expect(factual.kind, `${name}.${field}`).toBe('name');
    const text = factual.kind === 'name' ? factual.text : '';
    const provenance = cfg.realData!.sources![field]!;
    const row = nssdcaMaster[name];
    expect(row, `${name} absente du relevé NSSDCA`).toBeDefined();
    expect(provenance.source).toBe('nssdca-master-catalog');
    expect(provenance.citation).toBe(`NSSDCA/COSPAR ${row.cosparId}`);
    expect(text, `${name}.${field}`).toBe(
      field === 'launchVehicle' ? row.launchVehicle : row.launchSite
    );
  });
});

/**
 * MAGNITUDE ABSOLUE. La raison affichée pour les deux comètes AFFIRME quelque chose de la
 * source : qu'elle ne publie pas H, et qu'elle publie M1 à la place. Les deux moitiés sont
 * confrontées au relevé, et dans l'autre sens aussi : un objet pour lequel la SBDB publie H
 * doit l'afficher, pas une raison.
 */
describe('magnitude absolue des interstellaires : H affichée, ou la raison vérifiée', () => {
  const interstellar = bodies.filter(({ cfg }) => cfg.kind === 'interstellar');

  it('couvre les trois interstellaires', () => {
    expect(interstellar.length).toBe(3);
  });

  it.each(interstellar.map(({ name, cfg }) => [name, cfg] as const))(
    '%s',
    (name, cfg) => {
      const row = sbdbInterstellar[name];
      expect(row, `${name} absent du relevé SBDB`).toBeDefined();
      const reason = cfg.realData?.unknown?.absoluteMagnitude;
      if (row.absoluteMagnitude) {
        expect(reason, `${name} : la SBDB publie H`).toBeUndefined();
        expect(cfg.realData?.sources?.absoluteMagnitude?.source).toBe(
          'jpl-sbdb'
        );
        return;
      }
      expect(reason, `${name} : ni H ni raison`).toBeDefined();
      expect(reason!.unsourced).toBeUndefined();
      expect(row.cometTotalMagnitude, `${name} : la raison cite M1`).not.toBe(
        null
      );
      expect(
        isLocalizedText(reason!),
        `${name} : raison propre à la fiche`
      ).toBe(true);
      if (!isLocalizedText(reason!))
        throw new Error(`${name} : raison par clé, pas un texte de fiche`);
      expect(reason.en).toMatch(/\bM1\b/);
      expect(reason.fr).toMatch(/\bM1\b/);
    }
  );
});

/**
 * RAISONS CONFRONTÉES À LEUR SOURCE. Une valeur citée sans source ne vaut rien, et le lot 4 l'a
 * réglé ; une RAISON qui parle d'une source et que personne ne vérifie est exactement le même
 * défaut, une phrase de plus. « La base des petits corps ne publie pas de température » est une
 * affirmation sur une source : elle se vérifie contre le relevé de cette source.
 *
 * Ces gardes tiennent les quatre-vingt-huit raisons rédigées du catalogue, dont les soixante-trois
 * du lot 23, dans les deux sens : un
 * corps dont la source publie la grandeur ne peut PAS écrire qu'elle ne la publie pas, et un
 * corps dont elle ne la publie pas doit l'écrire plutôt que de laisser un champ muet.
 */
describe('raisons rédigées : confrontées à leur source', () => {
  const reasonOf = (cfg: CelestialBodyConfig, field: FactField) =>
    cfg.realData?.unknown?.[field];
  const written = (field: FactField) =>
    bodies.filter(({ cfg }) => {
      const reason = reasonOf(cfg, field);
      return reason !== undefined && reason.unsourced !== true;
    });
  const sbdbPhysical = snapshot.sbdb as Record<
    string,
    { physicalParameterNames: string[] }
  >;
  const nasaBodies = snapshot.nasaScienceBodies as Record<
    string,
    { url: string; sentence: string; celsius: number[] }
  >;
  const jplColumns = snapshot.jplSatellites.physicalParameters
    .columns as string[];

  it('aucune température que nous tenons n’est passée sous silence', () => {
    // Le sens qui compte : une raison ne peut pas dire « personne ne publie » d'un chiffre qui
    // est dans un de nos relevés. La garde regarde les quatre relevés qui pourraient en porter.
    const held: string[] = [];
    for (const { name } of written('meanTempC')) {
      if (
        nssdcaSat[name] &&
        (nssdcaSat[name] as { publishesTemperature?: boolean })
          .publishesTemperature
      )
        held.push(`${name} : fiche NSSDCA des satellites`);
      if (nssdca[name]?.meanTemperatureC !== undefined)
        held.push(`${name} : fiche NSSDCA`);
      if (
        sbdbPhysical[name]?.physicalParameterNames.some((parameter) =>
          /temp/i.test(parameter)
        )
      )
        held.push(`${name} : paramètres physiques SBDB`);
      if (nasaBodies[name]?.celsius.length === 1)
        held.push(`${name} : page NASA Science`);
    }
    expect(held).toEqual([]);
  });

  it('une raison qui refuse une plage en cite les bornes', () => {
    // L'autre sens : quand la page de la NASA publie plusieurs températures, la fiche n'a pas le
    // droit de les taire. Elle dit que c'est une plage, et elle l'écrit avec ses nombres.
    for (const [name, row] of Object.entries(nasaBodies)) {
      if (row.celsius.length === 1) continue;
      const cfg = bodies.find((b) => b.name === name)?.cfg;
      const reason = reasonOf(cfg!, 'meanTempC');
      expect(reason, `${name} : plage publiée, aucune raison`).toBeDefined();
      if (!isLocalizedText(reason!))
        throw new Error(`${name} : raison par clé`);
      for (const value of row.celsius)
        for (const locale of ['en', 'fr', 'es', 'pt-BR'] as const)
          expect(
            reason[locale],
            `${name}.${locale} ne cite pas ${value}`
          ).toContain(String(value));
    }
  });

  it('l’obliquité manque exactement là où le noyau ne publie pas de pôle', () => {
    // La raison affirme que TOUTES les autres lunes affichées ici ont un axe publié. C'est une
    // affirmation sur le catalogue entier, donc elle se vérifie sur le catalogue entier.
    for (const [name, entry] of Object.entries(naif.bodies)) {
      const cfg = bodies.find((b) => b.name === name)?.cfg;
      if (!cfg) continue;
      const status = bodyFact(cfg, 'axialTilt').status;
      if (entry.rotation)
        expect(status, `${name} : pôle publié mais aucune obliquité`).toBe(
          'value'
        );
      else {
        expect(status, `${name} : aucun pôle, aucune raison`).toBe('unknown');
        expect(reasonOf(cfg, 'axialTilt')?.unsourced).toBeUndefined();
      }
    }
  });

  it('une obliquité refusée à un petit corps est une absence de pôle à la SBDB', () => {
    for (const { name } of written('axialTilt')) {
      if (naif.bodies[name]) continue;
      const row = sbdb[name];
      expect(row, `${name} : ni noyau NAIF ni relevé SBDB`).toBeDefined();
      expect(row.pole, `${name} : la SBDB publie un pôle`).toBeNull();
    }
  });

  it('une masse ou une gravité refusée est une absence de GM chez celui qui la publierait', () => {
    for (const field of ['massKg', 'gravity'] as const)
      for (const { name } of written(field)) {
        if (phys[name]) {
          expect(phys[name].gmKm3s2, `${name} : JPL publie un GM`).toBeFalsy();
          continue;
        }
        if (!sbdb[name]) continue;
        // Orcus publie sa masse (masse du système) et refuse sa gravité, faute de rayon : le
        // GM n'est pas le sujet de cette raison-là.
        if (
          bodyFact(bodies.find((b) => b.name === name)!.cfg, 'massKg')
            .status === 'value'
        )
          continue;
        expect(sbdb[name].gmKm3s2, `${name} : la SBDB publie un GM`).toBeNull();
        // Ni une densité qui, avec le diamètre de la même référence, DONNE la masse : la
        // fiche de Didymos la refusait « faute de GM » alors que la base publie les deux
        // (2026-10-04).
        const density = sbdb[name].densityGcm3;
        expect(
          density !== null &&
            density.value > 0.1 &&
            density.value < 10 &&
            density.ref === sbdb[name].diameterKm?.ref,
          `${name} : la SBDB publie densité et diamètre, la masse se dérive`
        ).toBe(false);
      }
  });

  it('une rotation refusée est une colonne vide chez celui qui la publierait', () => {
    for (const { name } of written('rotationPeriod')) {
      if (nssdcaSat[name]) {
        const reason = bodies.find((b) => b.name === name)!.cfg.realData!
          .unknown!.rotationPeriod!;
        // « S » = synchrone, donc une période publiée : la fiche ne pourrait pas la refuser.
        // « C » = chaotique, et une raison qui invoque le chaos doit le tenir de la fiche.
        expect(
          nssdcaSat[name].rotation,
          `${name} : la fiche NSSDCA publie une rotation`
        ).not.toBe('S');
        if (
          isLocalizedText(reason) &&
          /chaotic|chaotique|caótica|caotic/i.test(reason.en + reason.fr)
        )
          expect(nssdcaSat[name].rotation, `${name} : chaos non publié`).toBe(
            'C'
          );
        continue;
      }
      if (sbdb[name]) {
        expect(
          sbdb[name].rotationHours,
          `${name} : la SBDB publie une rotation`
        ).toBeNull();
        continue;
      }
      // Les quatre petites lunes de Pluton n'ont ni fiche NSSDCA ni entrée SBDB : leurs chiffres
      // viennent de la table de JPL, dont la raison dit qu'elle n'a pas de colonne de rotation.
      expect(
        jplColumns.some((column) => /rotation/i.test(column)),
        `${name} : la table JPL a une colonne de rotation`
      ).toBe(false);
    }
  });

  it('les colonnes de la table JPL ne portent aucune température', () => {
    expect(jplColumns.some((column) => /temp/i.test(column))).toBe(false);
    expect(jplColumns.length).toBeGreaterThan(4);
  });

  it('une raison qui cite un article en cite les nombres vérifiés', () => {
    // Haumea et Orcus refusent un rayon en DISANT ce que la mesure a donné. Ces nombres sont
    // ceux des citations que `facts:snapshot` a retrouvées mot pour mot dans l'article.
    const quoted = (id: string) =>
      (snapshot.articles as Record<string, { verifiedQuotes: string[] }>)[
        id
      ].verifiedQuotes.join(' ');
    const cases: [string, FactField, string, string[]][] = [
      ['haumea', 'radiusKm', 'ortiz-2017-haumea', ['1704', '1138', '2322']],
      ['haumea', 'gravity', 'ortiz-2017-haumea', ['1704', '1138', '2322']],
      [
        'orcus',
        'radiusKm',
        'brown-2010-orcus',
        ['940', '900', '280', '820', '640'],
      ],
    ];
    for (const [name, field, article, numbers] of cases) {
      const cfg = bodies.find((b) => b.name === name)!.cfg;
      const reason = reasonOf(cfg, field);
      expect(reason, `${name}.${field}`).toBeDefined();
      const source = quoted(article).replace(/[,\s]/g, '');
      if (!isLocalizedText(reason!))
        throw new Error(`${name} : raison par clé`);
      for (const value of numbers) {
        expect(source, `${article} ne porte pas ${value}`).toContain(value);
        for (const locale of ['en', 'fr', 'es', 'pt-BR'] as const)
          expect(
            reason[locale],
            `${name}.${field}.${locale} ne cite pas ${value}`
          ).toContain(value);
      }
    }
  });
});
