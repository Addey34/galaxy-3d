import { describe, expect, it } from 'vitest';
import {
  ALL_FACT_FIELDS,
  GAS_GIANT_ATMOSPHERE_FACTS,
  notApplicableFacts,
} from '@/core/bodyFacts';
import type { CelestialBodyConfig } from '@/types';
import { CELESTIAL_CONFIG } from './bodies';
import { forEachBody } from './catalog';

/**
 * LES SIX FAITS « À 1 BAR » SONT CEUX D'UNE GÉANTE, ET LA CLASSE EST DÉCLARÉE (2026-10-28).
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

describe('classe d’atmosphère des géantes', () => {
  it('déclare au moins les quatre géantes (sinon cette garde ne regarde rien)', () => {
    expect(giants.length).toBeGreaterThanOrEqual(4);
  });

  for (const { name, cfg } of bodies) {
    const declared = cfg.atmosphereClass === 'gas-giant';
    it(`${name} : ${declared ? 'géante déclarée, les six faits sont publiés' : 'les six faits sont hors sujet et non publiés'}`, () => {
      const skip = notApplicableFacts(cfg);
      for (const field of GAS_GIANT_ATMOSPHERE_FACTS) {
        if (declared) {
          expect(skip.has(field), `${name} / ${field} applicable`).toBe(false);
          expect(
            publishes(cfg, field),
            `${name} se déclare géante mais ne publie pas ${field} (ni valeur, ni raison)`
          ).toBe(true);
        } else {
          expect(skip.has(field), `${name} / ${field} hors sujet`).toBe(true);
          expect(
            publishes(cfg, field),
            `${name} publie ${field} sans se déclarer atmosphereClass: gas-giant dans sa fiche`
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
