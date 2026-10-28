import { describe, expect, it } from 'vitest';
import {
  ALL_FACT_FIELDS,
  atmosphereFactsOf,
  GAS_GIANT_ATMOSPHERE_FACTS,
  notApplicableFacts,
  TERRESTRIAL_ATMOSPHERE_FACTS,
} from '@/core/bodyFacts';
import type { CelestialBodyConfig } from '@/types';
import { CELESTIAL_CONFIG } from './bodies';
import { forEachBody } from './catalog';

/**
 * LES SIX FAITS « À 1 BAR » SONT CEUX D'UNE GÉANTE, ET LA CLASSE EST DÉCLARÉE (2026-10-28).
 * Les quatre faits « au sol » de Vénus, la Terre et Mars suivent la même règle (`terrestrial`).
 *
 * `inventory:gaps` les comptait manquants sur 78 corps sur 102 : la règle d'applicabilité les
 * supposait valables pour tout le catalogue, alors que le NSSDCA ne les publie, « au niveau de 1
 * bar », que pour les géantes gazeuses. La règle est maintenant `atmosphereClass: 'gas-giant'`
 * dans la fiche. Ce fichier tient les deux bords : un corps qui publie une de ces valeurs doit se
 * déclarer géante (sinon la règle cacherait une valeur affichable), et une géante déclarée doit
 * les publier toutes (sinon la déclaration cacherait un manque réel).
 */
const bodies: { name: string; cfg: CelestialBodyConfig }[] = [];
forEachBody(CELESTIAL_CONFIG, ({ name, config }) => {
  if (config.kind === 'skybox') return;
  bodies.push({ name, cfg: config });
});

const publishes = (cfg: CelestialBodyConfig, field: string): boolean =>
  (cfg.realData as Record<string, unknown> | undefined)?.[field] !==
    undefined ||
  (cfg.realData?.unknown as Record<string, unknown> | undefined)?.[field] !==
    undefined;

const skyboxes: CelestialBodyConfig[] = [];
forEachBody(CELESTIAL_CONFIG, ({ config }) => {
  if (config.kind === 'skybox') skyboxes.push(config);
});

const giants = bodies.filter(({ cfg }) => cfg.atmosphereClass === 'gas-giant');
const rocky = bodies.filter(({ cfg }) => cfg.atmosphereClass === 'terrestrial');
const ATMOSPHERE_FIELDS = [
  ...new Set([...GAS_GIANT_ATMOSPHERE_FACTS, ...TERRESTRIAL_ATMOSPHERE_FACTS]),
];

describe('classe d’atmosphère déclarée', () => {
  it('déclare les quatre géantes et Vénus, la Terre, Mars (sinon cette garde ne regarde rien)', () => {
    expect(giants.length).toBeGreaterThanOrEqual(4);
    expect(rocky.map(({ name }) => name).sort()).toEqual(
      expect.arrayContaining(['earth', 'mars', 'venus'])
    );
  });

  it('ne partage que la hauteur d’échelle et la masse molaire entre les deux classes', () => {
    expect(
      GAS_GIANT_ATMOSPHERE_FACTS.filter((f) =>
        TERRESTRIAL_ATMOSPHERE_FACTS.includes(f)
      ).sort()
    ).toEqual(['meanMolecularWeight', 'scaleHeightKm']);
  });

  for (const { name, cfg } of bodies) {
    const own = atmosphereFactsOf(cfg.atmosphereClass);
    it(`${name} : ${cfg.atmosphereClass ?? 'sans classe'}, ses ${own.length} faits sont publiés et les autres hors sujet`, () => {
      const skip = notApplicableFacts(cfg);
      for (const field of ATMOSPHERE_FIELDS) {
        if (own.includes(field)) {
          expect(skip.has(field), `${name} / ${field} applicable`).toBe(false);
          expect(
            publishes(cfg, field),
            `${name} se déclare ${cfg.atmosphereClass} mais ne publie pas ${field} (ni valeur, ni raison)`
          ).toBe(true);
        } else {
          expect(skip.has(field), `${name} / ${field} hors sujet`).toBe(true);
          expect(
            publishes(cfg, field),
            `${name} publie ${field} sans déclarer la classe d’atmosphère qui l’ouvre dans sa fiche`
          ).toBe(false);
        }
      }
    });
  }
});

describe('fond d’étoiles', () => {
  it('n’a aucun fait applicable : ce n’est pas un corps', () => {
    expect(skyboxes.length).toBeGreaterThan(0);
    for (const cfg of skyboxes)
      expect(notApplicableFacts(cfg).size).toBe(ALL_FACT_FIELDS.length);
  });
});
