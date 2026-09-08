import { describe, expect, it } from 'vitest';
import { CELESTIAL_CONFIG } from './bodies';
import { forEachBody } from './catalog';

/**
 * COMPLÉTUDE DU CATALOGUE — chaque corps porte-t-il les données que l'application promet ?
 *
 * La fiche d'information (`ui/bodyInfo.ts`) affiche ces champs pour n'importe quel corps
 * sélectionnable. Un champ absent ne casse rien : la ligne disparaît, silencieusement. C'est
 * exactement le mode de défaut de ce projet — pas d'erreur, pas de log, juste une information
 * qui n'est plus là. Audit du 2026-09-08 : 45 corps sur 51 complets, et les 6 autres l'étaient
 * par oubli, pas par choix.
 *
 * Ce test rend le choix EXPLICITE. Un champ manquant est soit un oubli (le test échoue), soit
 * une exemption inscrite ci-dessous avec sa raison. Il n'y a pas de troisième cas.
 *
 * La règle qui gouverne les exemptions : on n'exempte que ce qui n'a **pas de valeur publiée
 * unique**, jamais ce qu'on n'a simplement pas pris le temps de chercher. Inventer une moyenne
 * pour combler une case serait pire que la case vide — l'utilisateur ne peut pas distinguer une
 * donnée mesurée d'une donnée inventée.
 */

/** Champs que la fiche d'information affiche, et que tout corps devrait donc porter. */
const DOCUMENTED_FIELDS = [
  'radiusKm',
  'massKg',
  'gravity',
  'meanTempC',
  'orbitPeriodDays',
  'distanceAU',
  'axialTilt',
  'moonCount',
  'description',
  'wiki',
] as const;

type Field = (typeof DOCUMENTED_FIELDS)[number];

/**
 * Exemptions, chacune avec la raison qui la justifie. Toute entrée ici est une affirmation
 * vérifiable : si la raison cesse d'être vraie, l'exemption doit sauter.
 */
const EXEMPT: Record<string, Partial<Record<Field, string>>> = {
  sun: {
    orbitPeriodDays:
      "il est l'origine du repère héliocentrique, il n'orbite rien",
    distanceAU: "idem — sa distance à lui-même n'a pas de sens",
  },
  // Les quatre galiléennes : masse et gravité sont désormais dérivées du GM publié par JPL
  // (cf. `bodies.ts`). La température, elle, n'a pas de valeur moyenne publiée.
  io: {
    meanTempC:
      'la NASA publie une plage, pas une moyenne : ~80-85 K la nuit, 420-620 K sur les zones volcaniques',
  },
  europa: {
    meanTempC:
      'plage publiée de ~50 K aux pôles à ~140 K à l’équateur (science.nasa.gov), aucune moyenne officielle',
  },
  ganymede: {
    meanTempC:
      'la fiche NASA donne « 90 to 160 Kelvin » en journée, sans moyenne',
  },
  callisto: {
    meanTempC:
      'même situation que ses voisines : plage publiée, pas de moyenne',
  },
  // Note : `halley.axialTilt` n'est PAS exempte ici parce que `smallBodyToConfig` le met a 0
  // par defaut, donc le champ existe toujours. C'est une limite differente, hors de portee de
  // ce test : une valeur presente mais defaultee, pas une valeur absente.
  halley: {
    massKg:
      'aucune mesure directe : la masse du noyau se déduit d’une densité elle-même mal contrainte (« pas plus du quart de celle de la glace »)',
    gravity:
      'noyau irrégulier de ~15 × 8 km — la gravité de surface varie d’un facteur plusieurs selon l’endroit, une valeur unique serait trompeuse',
    meanTempC:
      'la température parcourt ~340 K le long de l’orbite, d’au-delà de −250 °C à l’aphélie à plusieurs dizaines de °C au périhélie : une moyenne ne décrirait aucun instant réel',
  },
};

const bodies: { name: string; realData: Record<string, unknown> }[] = [];
forEachBody(CELESTIAL_CONFIG, ({ name, config }) => {
  if (config.kind === 'skybox') return;
  bodies.push({
    name,
    realData: (config.realData ?? {}) as Record<string, unknown>,
  });
});

describe('complétude documentaire du catalogue', () => {
  it('couvre bien tout le catalogue', () => {
    expect(bodies.length).toBeGreaterThanOrEqual(50);
  });

  for (const { name, realData } of bodies) {
    it(`${name} porte toutes ses données documentaires`, () => {
      const missing = DOCUMENTED_FIELDS.filter(
        (field) => realData[field] === undefined && !EXEMPT[name]?.[field]
      );
      expect(
        missing,
        `${name} : champ(s) absent(s) sans exemption justifiée — ` +
          `soit renseigner la valeur (sourcée), soit ajouter une exemption motivée dans EXEMPT`
      ).toEqual([]);
    });
  }

  /**
   * Une exemption qui ne correspond plus à rien est un mensonge qui dort : elle laisse croire
   * qu'une absence est réfléchie alors que la donnée est peut-être là depuis longtemps. Ce cas
   * garde la table honnête dans les deux sens.
   */
  it('ne garde aucune exemption devenue inutile', () => {
    const stale: string[] = [];
    for (const [name, fields] of Object.entries(EXEMPT)) {
      const body = bodies.find((b) => b.name === name);
      expect(
        body,
        `EXEMPT référence « ${name} », absent du catalogue`
      ).toBeDefined();
      for (const field of Object.keys(fields)) {
        if (body!.realData[field] !== undefined) {
          stale.push(`${name}.${field}`);
        }
      }
    }
    expect(
      stale,
      'ces champs sont renseignés : retirer leur exemption'
    ).toEqual([]);
  });

  /** Une exemption sans raison lisible n'en est pas une. */
  it('justifie chaque exemption', () => {
    for (const [name, fields] of Object.entries(EXEMPT)) {
      for (const [field, reason] of Object.entries(fields)) {
        expect(
          reason.length,
          `${name}.${field} : raison trop courte pour être une justification`
        ).toBeGreaterThan(25);
      }
    }
  });
});
