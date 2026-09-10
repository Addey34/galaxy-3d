import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CELESTIAL_CONFIG } from './bodies';
import { flattenBodies } from './catalog';
import type { CelestialBodyConfig } from '@/types';

/**
 * MODÈLES DE FORME — ce que le contrat doit garantir.
 *
 * Une sphère ne dit rien de vrai d'un corps de quelques centaines de mètres : ce qui fait
 * reconnaître Bennu, c'est sa forme de toupie. Mais un maillage est un asset lourd, distant et
 * tiers — trois façons de disparaître. Les tests ci-dessous tiennent les deux propriétés qui
 * comptent : le corps reste affichable SANS son modèle, et aucun maillage n'entre dans le dépôt
 * sans provenance.
 */

const PROJECT_ROOT = resolve(__dirname, '../..');

const withModel = (): [string, CelestialBodyConfig][] =>
  [...flattenBodies(CELESTIAL_CONFIG).entries()].filter(
    ([, cfg]) => cfg.model !== undefined
  );

describe('modèles de forme 3D', () => {
  it('déclare au moins un corps modélisé', () => {
    // Sans cette borne, toutes les assertions ci-dessous passeraient sur un ensemble vide —
    // le mode d'échec classique d'une suite paramétrée par un filtre.
    expect(withModel().length).toBeGreaterThan(0);
  });

  it.each(withModel().map(([name]) => name))(
    '%s : le fichier déclaré existe vraiment',
    (name) => {
      const model = flattenBodies(CELESTIAL_CONFIG).get(name)?.model;
      expect(model).toBeDefined();
      // Chemin absolu depuis la racine du site : c'est ce que le navigateur demandera.
      expect(model!.url.startsWith('/assets/models/')).toBe(true);
      const onDisk = join(PROJECT_ROOT, 'public', model!.url);
      expect(existsSync(onDisk), `${name} : ${model!.url} introuvable`).toBe(
        true
      );
    }
  );

  it.each(withModel().map(([name]) => name))(
    '%s : le modèle est crédité',
    (name) => {
      // Un maillage tiers sans provenance ne doit pas entrer dans le dépôt — même règle que
      // pour les textures (`scripts/texture-sources.json`). Le champ est obligatoire dans le
      // type, ce test interdit en plus de le remplir avec du vide.
      const credit = flattenBodies(CELESTIAL_CONFIG).get(name)?.model?.credit;
      expect(credit?.trim().length ?? 0).toBeGreaterThan(20);
      expect(credit).toMatch(/NASA|ESA|JAXA|USGS|DLR/);
    }
  );

  it.each(withModel().map(([name]) => name))(
    '%s : reste affichable SANS son modèle',
    (name) => {
      // LA propriété. Le maillage est distant et peut manquer : 404, réseau coupé, glTF
      // illisible, appareil qui abandonne. `CelestialObject` garde donc toujours la sphère et
      // se contente de la masquer quand le modèle arrive. Encore faut-il que cette sphère ait
      // de quoi s'afficher — une texture ou une couleur déclarée. Sans ça, le repli est une
      // boule noire, c'est-à-dire une absence.
      const cfg = flattenBodies(CELESTIAL_CONFIG).get(name);
      const hasTexture = cfg?.textureResolutions?.surface !== undefined;
      const hasColour = cfg?.fallbackColor !== undefined;
      expect(
        hasTexture || hasColour,
        `${name} : ni texture de surface ni fallbackColor, le repli serait invisible`
      ).toBe(true);
      // Et un rayon non nul, sinon la mise à l'échelle du maillage diviserait par zéro.
      expect(cfg?.radius ?? 0).toBeGreaterThan(0);
    }
  );

  it('n’attribue un modèle qu’aux corps irréguliers', () => {
    // Une planète ou une lune sphérique n'a rien à gagner à un maillage : la sphère texturée
    // est plus fidèle ET moins chère. Le contrat existe pour les corps que la sphère trahit.
    for (const [name, cfg] of withModel())
      expect(
        ['asteroid', 'comet'],
        `${name} est de type ${cfg.kind}`
      ).toContain(cfg.kind);
  });
});
