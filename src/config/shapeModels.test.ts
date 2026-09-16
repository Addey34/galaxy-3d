import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CELESTIAL_CONFIG } from './bodies';
import { flattenBodies, modelPath } from './catalog';
import type { CelestialBodyConfig } from '@/types';
import {
  boundingRadius,
  maxInertiaAxis,
  meshVolume,
  volumeEquivalentRadius,
} from '@/core/modelFit';

/**
 * Écart toléré entre l'axe de plus grande inertie d'un modèle et Y. Mesuré sur les cinq
 * modèles livrés : 0,08° (Éros) à 0,97° (Itokawa). Le défaut qu'il attrape fait 90° — c'est ce
 * que valait le Bennu livré avant la correction.
 */
const MAX_POLE_OFFSET_DEG = 5;

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

/** Tous les niveaux livrés : [corps, niveau, chemin disque]. */
const levels = (): [string, string, string][] =>
  withModel().flatMap(([name, cfg]) =>
    cfg.model!.resolutions.map(
      (q) =>
        [name, q, join(PROJECT_ROOT, 'public', modelPath(name, q))] as [
          string,
          string,
          string,
        ]
    )
  );

/**
 * Budget de triangles par niveau (cf. `core/modelLod.ts`, produits par
 * `decimate-shape-model.mjs --target`), marge de 5 %. C'est ce qui rend le chargement FLUIDE :
 * le niveau léger qu'on charge d'abord pour chaque astéroïde ne peut pas grossir sans bruit.
 */
const TRIANGLE_BUDGET: Record<string, number> = {
  '1k': 4000,
  '2k': 15000,
  '4k': 60000,
};

describe('modèles de forme 3D', () => {
  it('déclare au moins un corps modélisé', () => {
    // Sans cette borne, toutes les assertions ci-dessous passeraient sur un ensemble vide —
    // le mode d'échec classique d'une suite paramétrée par un filtre.
    expect(withModel().length).toBeGreaterThan(0);
  });

  it.each(levels())(
    '%s %s : le niveau déclaré existe vraiment',
    (name, quality, onDisk) => {
      // Chemin DÉRIVÉ du nom (catalog.modelPath), comme les textures : jamais saisi.
      expect(modelPath(name, quality)).toBe(
        `/assets/models/${name}/${name}_shape_${quality}.glb`
      );
      expect(
        existsSync(onDisk),
        `${name} ${quality} : ${onDisk} introuvable`
      ).toBe(true);
    }
  );

  it.each(levels())(
    '%s %s : tient son budget de triangles',
    (name, quality, onDisk) => {
      const triangles = readGlbGeometry(onDisk).index.length / 3;
      expect(
        triangles,
        `${name} ${quality} : ${triangles} triangles`
      ).toBeLessThanOrEqual(TRIANGLE_BUDGET[quality]! * 1.05);
    }
  );

  it.each(withModel().map(([name]) => name))(
    '%s : chaque niveau est plus détaillé que le précédent',
    (name) => {
      const cfg = flattenBodies(CELESTIAL_CONFIG).get(name)!;
      const counts = ['1k', '2k', '4k']
        .filter((q) => cfg.model!.resolutions.includes(q as '1k'))
        .map(
          (q) =>
            readGlbGeometry(join(PROJECT_ROOT, 'public', modelPath(name, q)))
              .index.length / 3
        );
      expect(counts.length).toBeGreaterThan(0);
      for (let i = 1; i < counts.length; i++)
        expect(counts[i]!).toBeGreaterThan(counts[i - 1]!);
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

/**
 * Lecteur glTF binaire minimal : la géométrie du PREMIER maillage, telle que le navigateur la
 * recevra. Suffisant pour les fichiers que produit `scripts/decimate-shape-model.mjs`
 * (positions flottantes, indices 16 ou 32 bits), et il échoue bruyamment sur le reste.
 */
function readGlbGeometry(path: string): {
  positions: Float32Array;
  index: Uint16Array | Uint32Array;
} {
  const bytes = readFileSync(path);
  if (bytes.toString('ascii', 0, 4) !== 'glTF')
    throw new Error(`${path} : pas un glTF binaire`);
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const binStart = 20 + jsonLength + 8;
  const view = (accessorIndex: number) => {
    const accessor = gltf.accessors[accessorIndex];
    const bufferView = gltf.bufferViews[accessor.bufferView];
    const offset = binStart + (bufferView.byteOffset ?? 0);
    const slice = bytes.buffer.slice(
      bytes.byteOffset + offset,
      bytes.byteOffset + offset + bufferView.byteLength
    );
    return { accessor, slice };
  };
  const primitive = gltf.meshes[0].primitives[0];
  const position = view(primitive.attributes.POSITION);
  if (position.accessor.componentType !== 5126)
    throw new Error(`${path} : positions non flottantes`);
  const indices = view(primitive.indices);
  const index =
    indices.accessor.componentType === 5125
      ? new Uint32Array(indices.slice)
      : new Uint16Array(indices.slice);
  return { positions: new Float32Array(position.slice), index };
}

describe('orientation des modèles livrés', () => {
  /**
   * La scène fait tourner chaque corps autour de son Y LOCAL. Un petit corps tourne, lui,
   * autour de son axe de plus grande inertie. Les deux doivent coïncider, sinon le corps
   * roule sur lui-même autour d'un axe équatorial — sans erreur, sans avertissement. C'est ce
   * qui a été livré pour Bennu : son fichier portait le pôle sur Z, convention des produits
   * PDS, et personne ne l'a vu parce qu'une toupie qui roule ressemble encore à une toupie.
   */
  it.each(levels())(
    '%s %s : tourne autour de son axe de plus grande inertie (Y)',
    (name, _quality, onDisk) => {
      const { positions, index } = readGlbGeometry(onDisk);
      const axis = maxInertiaAxis(positions, index);
      const tiltDeg =
        (Math.acos(Math.min(1, Math.abs(axis[1]))) * 180) / Math.PI;
      expect(
        tiltDeg,
        `${name} : axe d'inertie maximale à ${tiltDeg.toFixed(1)}° de Y`
      ).toBeLessThan(MAX_POLE_OFFSET_DEG);
    }
  );

  /**
   * Le modèle est mis à l'échelle par son rayon ÉQUIVALENT-VOLUME (cf. `core/modelFit.ts`).
   * S'il est livré en km — c'est le cas de tous les produits scientifiques — ce rayon doit
   * retrouver le rayon moyen publié du catalogue : c'est la preuve que le fichier décrit le
   * bon corps, à la bonne taille, et que la décimation n'a pas mangé de volume.
   */
  it.each(levels())(
    '%s %s : son volume retrouve le rayon moyen du catalogue',
    (name, _quality, onDisk) => {
      const cfg = flattenBodies(CELESTIAL_CONFIG).get(name)!;
      const { positions, index } = readGlbGeometry(onDisk);
      const radius = volumeEquivalentRadius(
        meshVolume(positions, index).volume
      );
      const published = cfg.realData?.radiusKm;
      expect(published, `${name} : pas de rayon publié`).toBeGreaterThan(0);
      expect(
        Math.abs(radius / published! - 1),
        `${name} : rayon équivalent ${radius.toFixed(4)} km pour ${published} km publié`
      ).toBeLessThan(0.03);
    }
  );
});

/**
 * CE QUE LA CAMÉRA NE DOIT PAS TRAVERSER. Un corps irrégulier déborde largement de la sphère
 * de même volume : Éros et Ida atteignent le double de leur rayon moyen. La caméra s'arrête à
 * `rayon × extentRatio × 1,15` ; si la valeur déclarée est TROP PETITE, l'objectif entre dans
 * le maillage et l'écran devient noir, sans erreur — c'est ce qui est arrivé sur Bennu dès que
 * le plancher absolu de 85 km a été retiré.
 *
 * Le test compare donc la valeur déclarée au fichier lui-même, et refuse en particulier de la
 * sous-estimer. Une sur-estimation de quelques pour cent ne coûte qu'un peu de recul.
 */
describe('débordement des modèles (extentRatio)', () => {
  // Un seul `extentRatio` par corps pour TOUS ses niveaux : il doit couvrir le plus saillant.
  it.each(levels())('%s %s', (name, _quality, onDisk) => {
    const cfg = flattenBodies(CELESTIAL_CONFIG).get(name)!;
    const { positions, index } = readGlbGeometry(onDisk);
    const { volume, centroid } = meshVolume(positions, index);
    const measured =
      boundingRadius(positions, centroid) / volumeEquivalentRadius(volume);
    const declared = cfg.model!.extentRatio;
    expect(
      declared,
      `${name} : déclaré ${declared}, mesuré ${measured.toFixed(3)} — la caméra entrerait dans le maillage`
    ).toBeGreaterThanOrEqual(measured - 0.005);
    // Et pas n'importe quelle grande valeur : elle doit décrire ces fichiers.
    expect(declared).toBeLessThan(measured * 1.08);
  });
});
