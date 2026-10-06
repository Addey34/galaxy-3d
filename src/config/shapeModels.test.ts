import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CELESTIAL_CONFIG } from './bodies';
import { flattenBodies, modelPath } from './catalog';
import type { CelestialBodyConfig } from '@/types';
import {
  boundingRadius,
  principalInertia,
  meshVolume,
  volumeEquivalentRadius,
} from '@/core/modelFit';
import { ATLAS_CHART_TOP } from '@/core/modelUv';

/**
 * Écart toléré entre l'axe de plus grande inertie d'un modèle et Y. Mesuré sur les cinq
 * modèles livrés : 0,08° (Éros) à 0,97° (Itokawa). Le défaut qu'il attrape fait 90° — c'est ce
 * que valait le Bennu livré avant la correction.
 */
const MAX_POLE_OFFSET_DEG = 10;

const PROJECT_ROOT = resolve(__dirname, '../..');

/**
 * Rapport du plus grand moment d'inertie au moyen à partir duquel l'axe de plus grande inertie
 * est DÉFINI. En dessous (Protée 1,004, Halley 1,01), la mesure de son orientation est du bruit.
 *
 * Seuil porté de 5 à 10° au lot parité (2026-09-22) : les modèles des satellites viennent dans
 * le repère de leur pôle IAU MESURÉ, et un modèle en grille de 5° s'en écarte de 5,3° (Amalthée)
 * à 5,5° (Déimos) sans que ce soit une erreur d'axe. Le défaut visé fait 90°.
 */
const DEFINED_AXIS_RATIO = 1.03;

/**
 * Modèles livrés dans le repère de leur pôle MESURÉ alors que leur axe de plus grande inertie,
 * calculé à densité homogène, s'en écarte de plus de `MAX_POLE_OFFSET_DEG`. Chacun avec son écart
 * mesuré et sa raison ; la tolérance reste loin des 90° du défaut visé.
 *
 * Gaspra (11,0°, 2026-10-05) : le pôle du modèle de Thomas et al. (1994) est celui de la rotation
 * OBSERVÉE, et c'est dans ce repère que la photomosaïque de Stooke a été projetée. Le tourner dans
 * ses axes d'inertie (`--principal`, livré jusque-là) rendait le drapé impossible et faisait
 * tourner le corps autour d'un axe calculé plutôt que mesuré, la moitié du modèle n'ayant été vue
 * qu'en basse résolution.
 */
const MEASURED_POLE_FRAME: Readonly<Record<string, number>> = { gaspra: 12 };

/**
 * MODÈLES DE FORME — ce que le contrat doit garantir.
 *
 * Une sphère ne dit rien de vrai d'un corps de quelques centaines de mètres : ce qui fait
 * reconnaître Bennu, c'est sa forme de toupie. Mais un maillage est un asset lourd, distant et
 * tiers — trois façons de disparaître. Les tests ci-dessous tiennent les deux propriétés qui
 * comptent : le corps reste affichable SANS son modèle, et aucun maillage n'entre dans le dépôt
 * sans provenance.
 */

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
 * La recette des modèles livrés (`scripts/generate-shape-models.mjs`), seule propriétaire des
 * budgets de triangles et des options de chaque corps.
 */
const RECIPE = JSON.parse(
  readFileSync(join(PROJECT_ROOT, 'scripts/shape-model-targets.json'), 'utf8')
) as {
  budgets: Record<string, number>;
  bodies: Record<
    string,
    { cache: string; flags: string[]; placeholderRadiusKm?: number }
  >;
};

/**
 * Budget de triangles par niveau (cf. `core/modelLod.ts`), marge de 5 %. C'est ce qui rend le
 * chargement FLUIDE : le niveau léger qu'on charge d'abord pour chaque astéroïde ne peut pas
 * grossir sans bruit.
 */
const TRIANGLE_BUDGET = RECIPE.budgets;

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
      // pour les textures (`src/registry/products/textures/`). Le champ est obligatoire dans le
      // type, ce test interdit en plus de le remplir avec du vide.
      const credit = flattenBodies(CELESTIAL_CONFIG).get(name)?.model?.credit;
      // Dans les DEUX langues : la fiche l'affiche dans la langue de l'interface.
      for (const text of [credit?.en, credit?.fr]) {
        expect(text?.trim().length ?? 0).toBeGreaterThan(20);
        // ESO : les modèles de Pallas et Hygie viennent de l'imagerie VLT/SPHERE (lot parité).
        expect(text).toMatch(/NASA|ESA|ESO|JAXA|USGS|DLR|DAMIT/);
      }
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
    // Le critère est MESURÉ sur la forme, pas tiré du type : Phobos est une lune, et une patate
    // (lot parité, 2026-09-22). `extentRatio` est lui-même confronté au fichier plus bas.
    for (const [name, cfg] of withModel())
      expect(
        cfg.model!.extentRatio,
        `${name} : extentRatio ${cfg.model!.extentRatio}, une sphère ferait l'affaire`
      ).toBeGreaterThanOrEqual(1.05);
  });

  it.each(withModel().map(([name]) => name))(
    '%s : drapé de sa texture si et seulement s’il en a une',
    (name) => {
      // Un corps qui a une vraie texture la garde sur sa forme (`core/modelUv.ts`) : l'albédo
      // cuit n'a alors pas d'objet. Sans texture, la couleur cuite est la seule mesure de sa
      // surface, et elle doit être déclarée avec sa source.
      const cfg = flattenBodies(CELESTIAL_CONFIG).get(name)!;
      const draped = cfg.textures?.surface !== undefined;
      const model = cfg.model!;
      if (draped) {
        expect(
          model.albedo,
          `${name} : drapé, pas d'albédo cuit`
        ).toBeUndefined();
        expect(model.colourSource).toBeUndefined();
      } else {
        expect(
          model.albedo,
          `${name} : sans texture, l'albédo cuit est obligatoire`
        ).toBeGreaterThan(0);
        expect(model.albedoSource?.trim().length ?? 0).toBeGreaterThan(10);
        expect(model.colourSource).not.toBeUndefined();
      }
    }
  );
});

/**
 * Lecteur glTF binaire minimal : la géométrie du PREMIER maillage, telle que le navigateur la
 * recevra. Suffisant pour les fichiers que produit `scripts/decimate-shape-model.mjs`
 * (positions flottantes, indices 16 ou 32 bits), et il échoue bruyamment sur le reste.
 */
function readGlbGeometry(path: string): {
  positions: Float32Array;
  index: Uint16Array | Uint32Array;
  uv: Float32Array | null;
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
  const texcoord = primitive.attributes.TEXCOORD_0;
  return {
    positions: new Float32Array(position.slice),
    index,
    uv: texcoord === undefined ? null : new Float32Array(view(texcoord).slice),
  };
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
      const { moments, axes } = principalInertia(positions, index);
      const maxOffsetDeg = MEASURED_POLE_FRAME[name] ?? MAX_POLE_OFFSET_DEG;
      const angleToY = (axis: [number, number, number]) =>
        (Math.acos(Math.min(1, Math.abs(axis[1]))) * 180) / Math.PI;
      if (moments[2] / moments[1] >= DEFINED_AXIS_RATIO) {
        const tiltDeg = angleToY(axes[2]);
        expect(
          tiltDeg,
          `${name} : axe d'inertie maximale à ${tiltDeg.toFixed(1)}° de Y`
        ).toBeLessThan(maxOffsetDeg);
      } else {
        // Axe maximal indéfini (corps en cigare ou presque rond) : Y doit seulement être
        // PERPENDICULAIRE au grand axe, l'axe de plus petite inertie, autour duquel une
        // rotation serait instable. C'est l'erreur qu'avait Hypérion passé par `--z-up`.
        const alongLongAxis = angleToY(axes[0]);
        expect(
          alongLongAxis,
          `${name} : Y à ${alongLongAxis.toFixed(1)}° de l'axe de plus petite inertie`
        ).toBeGreaterThan(90 - MAX_POLE_OFFSET_DEG);
      }
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
      // 3 %, ou l'incertitude publiée si elle est plus large (Protée : 208 ± 8 km, modèle de
      // Stooke à 201). Un écart au-delà n'est admis que DÉCLARÉ avec sa raison, et borné.
      const uncertainty = cfg.realData?.sources?.radiusKm?.uncertainty ?? 0;
      const tolerance = Math.max(0.03, uncertainty / published!);
      const declared = cfg.model!.radiusMismatch;
      const gap = Math.abs(radius / published! - 1);
      const message = `${name} : rayon équivalent ${radius.toFixed(4)} km pour ${published} km publié`;
      if (declared) {
        expect(
          declared.trim().length,
          `${name} : raison trop courte`
        ).toBeGreaterThan(40);
        expect(gap, message).toBeLessThan(0.25);
        // Une déclaration inutile serait un faux signal : l'écart doit la justifier.
        expect(gap, `${name} : écart déclaré sans nécessité`).toBeGreaterThan(
          tolerance
        );
      } else expect(gap, message).toBeLessThan(tolerance);
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
/**
 * FACES VERS L'EXTÉRIEUR. Un maillage retourné s'éclaire à l'envers et laisse voir son intérieur
 * par transparence de la face arrière. Le risque est réel depuis que le décimateur relit des
 * grilles en longitudes Ouest (`--west`) : inverser les longitudes inverse le sens des faces si
 * l'ordre de la grille n'est pas imposé. Volume signé positif = normales sortantes.
 */
describe('sens des faces des modèles livrés', () => {
  it.each(levels())('%s %s', (_name, _quality, onDisk) => {
    const { positions, index } = readGlbGeometry(onDisk);
    let signed = 0;
    for (let t = 0; t < index.length; t += 3) {
      const [a, b, c] = [index[t]! * 3, index[t + 1]! * 3, index[t + 2]! * 3];
      signed +=
        (positions[a]! *
          (positions[b + 1]! * positions[c + 2]! -
            positions[b + 2]! * positions[c + 1]!) -
          positions[a + 1]! *
            (positions[b]! * positions[c + 2]! -
              positions[b + 2]! * positions[c]!) +
          positions[a + 2]! *
            (positions[b]! * positions[c + 1]! -
              positions[b + 1]! * positions[c]!)) /
        6;
    }
    expect(signed).toBeGreaterThan(0);
  });
});

/**
 * UNE SURFACE FERMÉE, ET RIEN D'AUTRE. Chaque arête bordée par exactement deux triangles, parcourue
 * dans deux sens opposés : sinon un trou, une arête non manifold ou une face retournée, que la
 * scène dessine en noir. Le regroupement de sommets qui produisait ces fichiers en laissait sur
 * 38 des 49 niveaux (Bennu 4k : 1 470 arêtes non manifold, 983 de bord), quand toutes les
 * sources mesurées en avaient zéro (2026-10-04). Les sommets sont soudés par POSITION : la
 * fermeture est une propriété de la surface, pas de la numérotation.
 */
describe('topologie des modèles livrés', () => {
  it.each(levels())('%s %s', (_name, _quality, onDisk) => {
    const { positions, index } = readGlbGeometry(onDisk);
    const weld = new Map<string, number>();
    const id = (v: number): number => {
      const key = `${positions[v * 3]},${positions[v * 3 + 1]},${positions[v * 3 + 2]}`;
      if (!weld.has(key)) weld.set(key, weld.size);
      return weld.get(key)!;
    };
    const edges = new Map<string, { n: number; forward: number }>();
    for (let t = 0; t < index.length; t += 3)
      for (let k = 0; k < 3; k++) {
        const a = id(index[t + k]!);
        const b = id(index[t + ((k + 1) % 3)]!);
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        const e = edges.get(key) ?? { n: 0, forward: 0 };
        e.n++;
        if (a < b) e.forward++;
        edges.set(key, e);
      }
    let boundary = 0;
    let nonManifold = 0;
    let flipped = 0;
    for (const e of edges.values()) {
      if (e.n === 1) boundary++;
      else if (e.n > 2) nonManifold++;
      else if (e.forward !== 1) flipped++;
    }
    expect({ boundary, nonManifold, flipped }).toEqual({
      boundary: 0,
      nonManifold: 0,
      flipped: 0,
    });
  });
});

/**
 * L'ATLAS D'UN MODÈLE (2026-10-06), pour un corps que la direction ne décrit pas (67P).
 *
 * `unwrap-shape-model.mjs` déplie le niveau le plus fin, puis simplifie les autres DEPUIS lui :
 * l'effondrement d'arêtes ne crée aucun sommet, il en garde. Chaque couple (position, coordonnée)
 * d'un niveau grossier existe donc dans le plus fin, et c'est la preuve que les trois niveaux
 * partagent UN atlas, ce qu'exige un matériau commun dont la texture change de niveau à part.
 */
describe('atlas des modèles de forme', () => {
  const atlased = withModel().filter(([, cfg]) => cfg.model!.atlas === true);

  it('la fiche et la recette le déclarent ensemble', () => {
    const recipe = Object.entries(RECIPE.bodies)
      .filter(([, entry]) => (entry as { atlas?: boolean }).atlas === true)
      .map(([name]) => name)
      .sort();
    expect(recipe).toEqual(atlased.map(([name]) => name).sort());
    expect(recipe.length).toBeGreaterThan(0);
  });

  it('le script et l’application bornent les îles au même endroit', () => {
    const script = readFileSync(
      join(PROJECT_ROOT, 'scripts/unwrap-shape-model.mjs'),
      'utf8'
    );
    expect(Number(/const CHART_TOP = ([\d.]+);/.exec(script)?.[1])).toBe(
      ATLAS_CHART_TOP
    );
  });

  it.each(levels())(
    '%s %s : coordonnées si et seulement si atlas',
    (name, _q, onDisk) => {
      const { uv } = readGlbGeometry(onDisk);
      const atlas =
        flattenBodies(CELESTIAL_CONFIG).get(name)!.model!.atlas === true;
      if (!atlas) {
        expect(uv).toBeNull();
        return;
      }
      expect(uv).not.toBeNull();
      let maxV = -Infinity;
      let minU = Infinity;
      let maxU = -Infinity;
      let minV = Infinity;
      for (let i = 0; i < uv!.length; i += 2) {
        minU = Math.min(minU, uv![i]!);
        maxU = Math.max(maxU, uv![i]!);
        minV = Math.min(minV, uv![i + 1]!);
        maxV = Math.max(maxV, uv![i + 1]!);
      }
      expect(minU).toBeGreaterThanOrEqual(0);
      expect(maxU).toBeLessThanOrEqual(1);
      expect(minV).toBeGreaterThanOrEqual(0);
      // La pastille au-dessus reste libre ; et l'atlas occupe bien sa hauteur (un atlas tassé dans
      // un coin, défaut payé le 2026-10-06, passerait sinon).
      expect(maxV).toBeLessThanOrEqual(ATLAS_CHART_TOP + 1e-6);
      expect(maxV).toBeGreaterThan(ATLAS_CHART_TOP * 0.9);
      expect(maxU).toBeGreaterThan(0.9);
    }
  );

  it.each(atlased.map(([name]) => name))(
    '%s : tous les niveaux partagent l’atlas du plus fin',
    (name) => {
      const qualities =
        flattenBodies(CELESTIAL_CONFIG).get(name)!.model!.resolutions;
      const read = (q: string) =>
        readGlbGeometry(join(PROJECT_ROOT, 'public', modelPath(name, q)));
      const key = (g: ReturnType<typeof read>, i: number) =>
        `${g.positions[i * 3]},${g.positions[i * 3 + 1]},${g.positions[i * 3 + 2]}|${g.uv![i * 2]},${g.uv![i * 2 + 1]}`;
      const finest = read(qualities[0]!);
      const known = new Set<string>();
      for (let i = 0; i < finest.positions.length / 3; i++)
        known.add(key(finest, i));
      for (const q of qualities.slice(1)) {
        const level = read(q);
        let missing = 0;
        for (let i = 0; i < level.positions.length / 3; i++)
          if (!known.has(key(level, i))) missing++;
        expect(missing, `${name} ${q}`).toBe(0);
      }
    }
  );
});

describe('recette des modèles de forme', () => {
  it('couvre exactement les corps modélisés', () => {
    // Un corps modélisé hors recette ne se régénère plus ; une entrée sans fiche est morte.
    expect(Object.keys(RECIPE.bodies).sort()).toEqual(
      withModel()
        .map(([name]) => name)
        .sort()
    );
  });

  it.each(levels())(
    '%s %s : embarque le crédit de sa fiche',
    (name, _q, onDisk) => {
      const bytes = readFileSync(onDisk);
      const gltf = JSON.parse(
        bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12))
      ) as { asset: { copyright?: string } };
      expect(gltf.asset.copyright).toBe(
        flattenBodies(CELESTIAL_CONFIG).get(name)!.model!.credit.en
      );
    }
  );
});

/**
 * UNE SPHÈRE DE REMPLISSAGE DÉCLARÉE EST DITE AU VISITEUR, DANS SES QUATRE LANGUES.
 *
 * La moitié de `253mathilde.tab` vaut exactement 26,5 km : une sphère, pas une forme mesurée, et
 * l'étiquette PDS ne le dit pas (mesuré le 2026-10-06). Le générateur la DÉTECTE et refuse de
 * produire le maillage tant que la recette ne la déclare pas ; ce test exige que le rayon déclaré
 * figure dans le crédit affiché (fiche et `/sources`), sans quoi le maillage montrerait une moitié
 * inventée sans que personne le sache.
 */
describe('sphère de remplissage déclarée', () => {
  const declared = Object.entries(RECIPE.bodies).filter(
    ([, e]) => e.placeholderRadiusKm !== undefined
  );
  it('au moins un corps la déclare (Mathilde)', () => {
    expect(declared.map(([b]) => b)).toContain('mathilde');
  });
  it.each(declared)(
    '%s : le crédit nomme le rayon dans chaque langue',
    (name, e) => {
      const credit = flattenBodies(CELESTIAL_CONFIG).get(name)!.model!.credit;
      const r = e.placeholderRadiusKm!;
      for (const [locale, text] of Object.entries(credit)) {
        const written =
          locale === 'en' ? String(r) : String(r).replace('.', ',');
        expect(text, `${name} ${locale}`).toContain(written);
      }
    }
  );
});

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

/**
 * LA COULEUR CUITE DANS CHAQUE NIVEAU EST CELLE QUE LE CATALOGUE DÉCLARE.
 *
 * `scripts/bake-shape-colour.mjs` ramène la luminance moyenne du modèle à l'albédo géométrique
 * PUBLIÉ, converti à la convention d'affichage mesurée sur la texture lunaire (0,312 pour un
 * albédo de 0,12). Si quelqu'un régénère un niveau sans repasser le script, il retombe au gris
 * uniforme du décimateur — et Bennu, l'un des objets les plus sombres du système solaire,
 * s'afficherait trois fois trop clair sans que rien ne casse. C'est ce que ce test empêche.
 */
const DISPLAY_PER_ALBEDO = 0.312 / 0.12;

/** Luminance linéaire moyenne d'un niveau : couleurs par sommet si présentes, sinon matériau. */
function meanLuminance(path: string): {
  luminance: number;
  perVertex: boolean;
} {
  const bytes = readFileSync(path);
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const primitive = gltf.meshes[0].primitives[0];
  const colour = primitive.attributes.COLOR_0;
  if (colour === undefined) {
    const [r, g, b] = gltf.materials[primitive.material].pbrMetallicRoughness
      .baseColorFactor as number[];
    return {
      luminance: 0.2126 * r! + 0.7152 * g! + 0.0722 * b!,
      perVertex: false,
    };
  }
  const accessor = gltf.accessors[colour];
  const view = gltf.bufferViews[accessor.bufferView];
  const start = bytes.byteOffset + 20 + jsonLength + 8 + (view.byteOffset ?? 0);
  const values = new Uint16Array(
    bytes.buffer.slice(start, start + accessor.count * 8)
  );
  let sum = 0;
  for (let i = 0; i < accessor.count; i++)
    sum +=
      (0.2126 * values[i * 4]! +
        0.7152 * values[i * 4 + 1]! +
        0.0722 * values[i * 4 + 2]!) /
      65535;
  return { luminance: sum / accessor.count, perVertex: true };
}

describe('couleur réelle des modèles de forme', () => {
  it('le script de cuisson utilise la même convention que ce test', () => {
    const script = readFileSync(
      join(PROJECT_ROOT, 'scripts/display-albedo.mjs'),
      'utf8'
    );
    expect(script).toContain('0.312 / 0.12');
  });

  // Les modèles DRAPÉS n'ont pas de couleur cuite : leur couleur est celle de la texture.
  const baked = levels().filter(
    ([name]) =>
      flattenBodies(CELESTIAL_CONFIG).get(name)!.textures?.surface === undefined
  );
  it('garde des modèles à couleur cuite à vérifier', () => {
    expect(baked.length).toBeGreaterThan(0);
  });

  it.each(baked)('%s %s', (name, _quality, onDisk) => {
    const model = flattenBodies(CELESTIAL_CONFIG).get(name)!.model!;
    expect(model.albedoSource!.trim().length).toBeGreaterThan(10);
    const { luminance, perVertex } = meanLuminance(onDisk);
    const expected = model.albedo! * DISPLAY_PER_ALBEDO;
    // 3 % : les composantes écrêtées sur les zones les plus claires d'Éros tirent la moyenne
    // un peu sous la cible ; un niveau jamais cuit s'en écarte de 60 % à 200 %.
    expect(
      Math.abs(luminance / expected - 1),
      `${name} : luminance ${luminance.toFixed(3)} pour ${expected.toFixed(3)} attendue`
    ).toBeLessThan(0.03);
    // Une carte de mission ⇔ des couleurs par sommet ; sans carte, une couleur uniforme.
    expect(perVertex, `${name} : couleurs par sommet`).toBe(
      model.colourSource !== null
    );
  });
});

/**
 * UN MODÈLE DRAPÉ DOIT ÊTRE DANS LE REPÈRE DE SA CARTE. La carte équirectangulaire est posée par
 * longitude et latitude (`core/modelUv.ts`) ; si le fichier était tourné, miroir, ou compté en
 * longitudes ouest, le relief et l'image se décaleraient sans aucune erreur. On vérifie donc
 * qu'un repère PUBLIÉ du corps tombe au bon endroit du maillage livré.
 *
 * Phobos : le cratère Stickney, 1,0° S et 49,7° O (Nomenclature planétaire de l'UAI), est le
 * creux local le plus profond du modèle de Gaskell. Mesuré sur la source (q = 512) au lot
 * parité : 50° O, 0°, 1,24 km sous son voisinage.
 */
describe('repère des modèles drapés', () => {
  it('phobos : Stickney est le creux le plus profond, à sa longitude publiée', () => {
    const { positions } = readGlbGeometry(
      join(PROJECT_ROOT, 'public', modelPath('phobos', '4k'))
    );
    // Repère de l'application : pôle sur +Y, longitude Est vers −Z (cf. `core/modelUv.ts`).
    const cells = new Map<string, { sum: number; n: number }>();
    for (let i = 0; i < positions.length; i += 3) {
      const [x, y, z] = [positions[i]!, positions[i + 1]!, positions[i + 2]!];
      const r = Math.hypot(x, y, z);
      const lon = (Math.atan2(-z, x) * 180) / Math.PI;
      const lat = (Math.asin(y / r) * 180) / Math.PI;
      const key = `${Math.floor((lat + 90) / 5)},${Math.floor((lon + 180) / 5)}`;
      const cell = cells.get(key) ?? { sum: 0, n: 0 };
      cell.sum += r;
      cell.n++;
      cells.set(key, cell);
    }
    const list = [...cells.entries()].map(([key, c]) => {
      const [i, j] = key.split(',').map(Number);
      return { lat: i! * 5 - 87.5, lon: j! * 5 - 177.5, r: c.sum / c.n };
    });
    const rad = Math.PI / 180;
    const angle = (
      p: { lat: number; lon: number },
      q: { lat: number; lon: number }
    ) =>
      Math.acos(
        Math.min(
          1,
          Math.sin(p.lat * rad) * Math.sin(q.lat * rad) +
            Math.cos(p.lat * rad) *
              Math.cos(q.lat * rad) *
              Math.cos((p.lon - q.lon) * rad)
        )
      ) / rad;
    const deepest = list
      .filter((p) => Math.abs(p.lat) < 60)
      .map((p) => {
        const ring = list.filter((q) => {
          const a = angle(p, q);
          return a > 12 && a < 25;
        });
        return {
          ...p,
          depth: p.r - ring.reduce((s, q) => s + q.r, 0) / ring.length,
        };
      })
      .sort((a, b) => a.depth - b.depth)[0]!;
    expect(
      angle(deepest, { lat: -1.0, lon: -49.7 }),
      `creux le plus profond à ${deepest.lon}°, ${deepest.lat}°`
    ).toBeLessThan(8);
  });
});

/**
 * Chaque modèle livré est déclaré dans `THIRD_PARTY_NOTICES.md`, avec sa source et son crédit :
 * c'est là que l'attribution exigée par une licence (DAMIT, CC BY 4.0) se lit en entier. Le lot
 * parité en a ajouté dix d'un coup ; un onzième ajouté sans notice doit échouer ici.
 */
describe('notices des modèles de forme', () => {
  const notices = readFileSync(
    join(PROJECT_ROOT, 'THIRD_PARTY_NOTICES.md'),
    'utf8'
  );
  it.each(withModel().map(([name]) => name))('%s', (name) => {
    expect(notices).toContain(`public/assets/models/${name}/${name}_shape_`);
  });
});
