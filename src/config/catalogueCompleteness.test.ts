import { describe, expect, it } from 'vitest';
import { CELESTIAL_CONFIG } from './bodies';
import { forEachBody } from './catalog';
import type { CelestialBodyConfig, UnknownableField } from '@/types';

/**
 * COMPLÉTUDE DU CATALOGUE — chaque corps porte-t-il ce que l'application promet d'afficher ?
 *
 * La fiche d'information affiche ces champs pour n'importe quel corps sélectionnable. Un champ
 * simplement absent ne casse rien : la ligne disparaît, silencieusement. C'est le mode de
 * défaut habituel de ce projet — pas d'erreur, pas de log, juste une information qui n'est
 * plus là. Audit du 2026-09-08 : 45 corps sur 51 complets, les 6 autres par oubli.
 *
 * Trois états possibles pour un champ, et un seul est un défaut :
 *
 *   1. **renseigné** — la valeur est là, sourcée ;
 *   2. **déclaré inconnu** — `realData.unknown[champ]` porte la raison, et la fiche affiche
 *      un tiret cadratin avec cette raison en infobulle plutôt que de masquer la ligne ;
 *   3. **oublié** — rien de tout cela : c'est ce que ce test fait échouer.
 *
 * Le NON APPLICABLE est un quatrième cas, volontairement absent de la donnée : le Soleil n'a
 * pas de période orbitale parce qu'il est l'origine du repère, pas parce qu'on l'ignore. Cela
 * se déduit du `kind`, ça ne se déclare pas corps par corps — sinon on maintiendrait à la main
 * une évidence structurelle.
 *
 * La raison des inconnues vit dans le CATALOGUE, pas ici. C'est la règle du projet (« config
 * is the single source of truth ») et c'est surtout ce qui permet à la fiche d'information de
 * l'afficher à l'utilisateur : une raison enfermée dans un fichier de test ne sert personne.
 */

/** Champs que la fiche d'information affiche, et que tout corps devrait donc porter. */
const DOCUMENTED_FIELDS: UnknownableField[] = [
  'radiusKm',
  'massKg',
  'gravity',
  'meanTempC',
  'orbitPeriodDays',
  'distanceAU',
  'axialTilt',
  'moonCount',
];

/**
 * Champs qui n'ont structurellement pas de sens pour un `kind` donné. Une étoile centrale
 * n'orbite rien : lui réclamer une période ou une distance serait une erreur de modèle, pas
 * une donnée manquante.
 */
function notApplicable(cfg: CelestialBodyConfig): Set<UnknownableField> {
  return cfg.kind === 'star'
    ? new Set<UnknownableField>(['orbitPeriodDays', 'distanceAU'])
    : new Set<UnknownableField>();
}

const bodies: { name: string; cfg: CelestialBodyConfig }[] = [];
forEachBody(CELESTIAL_CONFIG, ({ name, config }) => {
  if (config.kind === 'skybox') return;
  bodies.push({ name, cfg: config });
});

describe('complétude documentaire du catalogue', () => {
  it('couvre bien tout le catalogue', () => {
    expect(bodies.length).toBeGreaterThanOrEqual(50);
  });

  for (const { name, cfg } of bodies) {
    it(`${name} : chaque champ est renseigné, déclaré inconnu, ou hors sujet`, () => {
      const realData = (cfg.realData ?? {}) as Record<string, unknown>;
      const skip = notApplicable(cfg);

      const forgotten = DOCUMENTED_FIELDS.filter(
        (field) =>
          !skip.has(field) &&
          realData[field] === undefined &&
          cfg.realData?.unknown?.[field] === undefined
      );

      expect(
        forgotten,
        `${name} : champ(s) ni renseigné(s) ni déclaré(s) inconnu(s). Soit fournir la ` +
          `valeur avec sa source, soit ajouter realData.unknown.<champ> avec la raison — ` +
          `la fiche d'information l'affichera à l'utilisateur.`
      ).toEqual([]);
    });
  }

  /**
   * Une déclaration d'inconnue qui ne correspond plus à rien est un mensonge qui dort : elle
   * ferait afficher « non publié » sur une donnée présente. Ce cas garde la table honnête
   * dans l'autre sens.
   */
  it('ne déclare inconnu aucun champ pourtant renseigné', () => {
    const contradictions: string[] = [];
    for (const { name, cfg } of bodies) {
      const realData = (cfg.realData ?? {}) as Record<string, unknown>;
      for (const field of Object.keys(cfg.realData?.unknown ?? {})) {
        if (realData[field] !== undefined)
          contradictions.push(`${name}.${field}`);
      }
    }
    expect(
      contradictions,
      'ces champs ont une valeur : retirer leur déclaration d’inconnue'
    ).toEqual([]);
  });

  /**
   * Une raison doit être lisible par un utilisateur, dans les deux langues — elle finit en
   * infobulle sur sa fiche, pas dans un log de développeur.
   */
  it('justifie chaque inconnue dans les deux langues', () => {
    for (const { name, cfg } of bodies) {
      for (const [field, reason] of Object.entries(
        cfg.realData?.unknown ?? {}
      )) {
        for (const locale of ['en', 'fr'] as const) {
          expect(
            reason[locale]?.length ?? 0,
            `${name}.${field} (${locale}) : raison absente ou trop courte pour expliquer ` +
              `une absence à un utilisateur`
          ).toBeGreaterThan(30);
        }
      }
    }
  });
});
