import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Body, RotationAxis } from 'astronomy-engine';
import CelestialObject from './CelestialObject';
import type { AnimationSystem } from '@/components/systems/AnimationSystem';
import type { TextureSystem } from '@/components/systems/TextureSystem';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { forEachBody } from '@/config/catalog';
import { EphemerisService } from '@/core/EphemerisService';
import { OrbitalMechanics } from '@/core/OrbitalMechanics';
import type { CelestialBodies } from '@/components/systems/SceneSystem';
import type { CelestialBodyConfig } from '@/types';

/**
 * SENS DE ROTATION PROPRE — sur tout le catalogue, et dans LES DEUX SENS DU TEMPS.
 *
 * La rotation propre est la seule grandeur de la scène qui soit une INTÉGRALE du pas de
 * simulation (`rotation.y += rotationSpeed * delta`) : elle est donc la seule à dépendre du
 * SIGNE de ce pas. La timebar étant bidirectionnelle, chaque corps doit tourner à l'envers
 * quand le temps recule — défaut réellement livré : le pas était publié en valeur absolue,
 * si bien que les 52 corps continuaient de tourner vers l'avant pendant que les orbites
 * reculaient. Seule la Terre y échappait, sa phase étant DÉRIVÉE de la date
 * (`syncEarthSurfaceRotation`) et non intégrée — ce qui rendait le défaut invisible sur le
 * corps que l'on regarde le plus.
 *
 * Aucun test unitaire existant ne couvrait ce contrat : il ne se lit ni dans le catalogue
 * (qui ne connaît que des vitesses) ni dans l'horloge (qui ne connaît que des dates), mais
 * seulement dans leur COMPOSITION — l'orientation monde du `_meshGroup` après un pas.
 *
 * Partage des rôles, à ne pas confondre : ce fichier garde le CONSOMMATEUR du pas (chaque
 * corps honore-t-il un delta négatif ?) en l'appelant directement. Le PRODUCTEUR —
 * `OrbitalMechanics.update` publie-t-il un pas signé, ou une magnitude ? — est gardé dans
 * `core/OrbitalMechanics.test.ts` : réintroduire là-bas la valeur absolue d'origine ne fait
 * PAS tomber ce fichier-ci, qui ne passe pas par l'horloge. Les deux ensemble couvrent la
 * chaîne, aucun des deux seul.
 *
 * Le fichier est en quatre couches, de la plus circulaire à la moins :
 *   1. symétrie temporelle (comportement pur, aucune vérité externe requise) ;
 *   2. rotation autour de l'axe DÉCLARÉ, main droite ;
 *   3. confrontation au modèle IAU/WGCCRE 2015 pour les 11 corps qu'il couvre : non circulaire
 *      sur la PÉRIODE (catalogue et WGCCRE sont deux sources indépendantes), circulaire en
 *      revanche sur le SENS et sur l'AXE depuis que le rendu les lit à cette même source
 *      (`getSpinAxisDirection`) — elle n'y vérifie donc que la plomberie ;
 *   3 bis. sens de rotation confronté à une table de faits PUBLIÉS, écrite à la main : la
 *      seule garde indépendante qui reste sur le sens, une fois le code alimenté par WGCCRE ;
 *   4. cohérence lune/planète-mère, qui encode elle aussi un fait astronomique publié.
 */

// Le constructeur ne fait qu'assembler des objets Three.js et lancer un chargement de
// textures : deux doublures suffisent. La promesse qui ne se résout jamais laisse
// `_loadAllTextures` en attente sans rejet non géré ni bruit de log.
const textureSystem = {
  getLODTexture: () => new Promise<never>(() => {}),
} as unknown as TextureSystem;
const animationSystem = {
  addUpdatable: () => {},
} as unknown as AnimationSystem;

const DATE = new Date('2026-03-15T00:00:00Z');
/** Pas de simulation du test, en secondes. Grand pour sortir du bruit numérique. */
const STEP_S = 1_000;

const catalogue = new Map<string, CelestialBodyConfig>();
const parentOf = new Map<string, string>();
forEachBody(CELESTIAL_CONFIG, ({ name, config, parentName }) => {
  catalogue.set(name, config);
  if (parentName !== null) parentOf.set(name, parentName);
});

/** Corps dotés d'une rotation propre — les seuls sur lesquels un sens ait un sens. */
const spinning = [...catalogue].filter(
  ([, cfg]) => (cfg.rotationSpeed ?? 0) !== 0
);

/**
 * Construit la scène des 52 corps et leur applique le VRAI pipeline d'axe
 * (`OrbitalMechanics.syncAxesFromEphemeris`) plutôt qu'une copie locale de sa règle : c'est
 * lui qui décide du retournement rétrograde, donc lui qu'il faut mettre à l'épreuve. Le
 * constructeur d'`OrbitalMechanics` tirant des services lourds, on n'instancie que l'état
 * que cette méthode lit.
 */
function buildScene(): CelestialBodies {
  const bodies: CelestialBodies = {};
  for (const [name, cfg] of catalogue) {
    bodies[name] = new CelestialObject(
      textureSystem,
      cfg,
      name,
      animationSystem
    );
  }

  const mechanics = Object.create(
    OrbitalMechanics.prototype
  ) as OrbitalMechanics;
  Object.defineProperty(mechanics, 'config', { value: CELESTIAL_CONFIG });
  Object.defineProperty(mechanics, 'bodies', { value: bodies });
  Object.defineProperty(mechanics, 'ephemeris', {
    value: new EphemerisService(),
  });
  mechanics.syncAxesFromEphemeris(DATE);

  return bodies;
}

/**
 * Vecteur rotation MONDE réellement APPLIQUÉ par un pas de `delta` secondes, ramené à la
 * seconde : direction = sens de rotation observé, norme = vitesse angulaire (rad/s).
 * Mesuré sur le quaternion monde du `_meshGroup` avant/après, donc sur le résultat rendu —
 * pas sur les entrées.
 *
 * On divise par |delta| et NON par delta : diviser par un delta signé rendrait la fonction
 * aveugle à ce qu'elle doit mesurer (elle renverrait la même vitesse angulaire « par
 * seconde de simulation » dans les deux sens du temps, y compris pour un corps qui ne
 * reculerait pas du tout).
 *
 * `visible = false` : `update()` n'exécute alors que `_advanceSpin`, exactement le chemin
 * testé ici (la rotation est délibérément placée avant le test de visibilité, cf. son
 * commentaire), sans rien demander aux couches ni aux shaders.
 */
function angularVelocity(
  body: CelestialObject,
  name: string,
  delta: number
): THREE.Vector3 {
  const mesh = body.group.getObjectByName(`${name}_mesh`)!;
  body.group.updateMatrixWorld(true);
  const before = mesh.getWorldQuaternion(new THREE.Quaternion());

  body.update(delta, null, false);

  body.group.updateMatrixWorld(true);
  const after = mesh.getWorldQuaternion(new THREE.Quaternion());

  // Rotation relative (monde) → axe + angle signé.
  const rel = after.multiply(before.invert()).normalize();
  // Le quaternion et son opposé décrivent la même rotation : on ramène w ≥ 0 pour que
  // l'angle reste dans [0, π] et que le signe vive dans l'axe, pas dans la représentation.
  if (rel.w < 0) {
    rel.set(-rel.x, -rel.y, -rel.z, -rel.w);
  }
  const sinHalf = Math.sqrt(Math.max(0, 1 - rel.w * rel.w));
  const angle = 2 * Math.atan2(sinHalf, rel.w);
  if (sinHalf < 1e-15) return new THREE.Vector3();
  return new THREE.Vector3(rel.x, rel.y, rel.z).multiplyScalar(
    angle / sinHalf / Math.abs(delta)
  );
}

describe('sens de rotation propre du catalogue', () => {
  it('couvre bien tout le catalogue (garde contre un filtre qui viderait la suite)', () => {
    expect(catalogue.size).toBeGreaterThanOrEqual(50);
    expect(spinning.length).toBeGreaterThanOrEqual(50);
  });

  /**
   * Couche 1 — SYMÉTRIE TEMPORELLE. Un pas en avant puis le pas opposé doivent ramener le
   * corps exactement à son orientation de départ. C'est la formulation la plus stricte du
   * défaut corrigé : avec un pas en valeur absolue, le second pas ajoute au lieu de retirer
   * et l'écart vaut 2 × l'angle, pour les 52 corps à la fois.
   */
  it('revient exactement à son orientation quand le temps repart en arrière', () => {
    const bodies = buildScene();
    for (const [name] of spinning) {
      const body = bodies[name];
      const mesh = body.group.getObjectByName(`${name}_mesh`)!;
      body.group.updateMatrixWorld(true);
      const start = mesh.getWorldQuaternion(new THREE.Quaternion());

      body.update(STEP_S, null, false);
      body.update(-STEP_S, null, false);

      body.group.updateMatrixWorld(true);
      const end = mesh.getWorldQuaternion(new THREE.Quaternion());
      // Comparaison sur le produit scalaire et non sur `angleTo` : près de l'identité,
      // `angleTo` passe par un acos dont la dérivée diverge, et un seul ulp sur le produit
      // scalaire y ressort déjà comme 4e-8 — un plancher numérique, pas un écart réel.
      expect(
        Math.abs(start.dot(end)),
        `${name} ne revient pas sur ses pas`
      ).toBeGreaterThan(1 - 1e-14);
    }
  });

  /**
   * Couche 1 bis — le pas arrière doit VRAIMENT tourner, et à l'exact opposé. La symétrie
   * seule serait satisfaite par un corps qui ne bouge dans aucun sens : cette assertion
   * ferme la porte à un `Math.max(delta, 0)` ou à toute autre remise à zéro du recul.
   */
  it('produit une vitesse angulaire exactement opposée en marche arrière', () => {
    const forward = buildScene();
    const backward = buildScene();
    for (const [name, cfg] of spinning) {
      const wPlus = angularVelocity(forward[name], name, STEP_S);
      const wMinus = angularVelocity(backward[name], name, -STEP_S);

      expect(
        wPlus.length(),
        `${name} ne tourne pas en marche avant`
      ).toBeGreaterThan(0);
      expect(
        wMinus.length(),
        `${name} ne tourne pas en marche arrière`
      ).toBeGreaterThan(0);
      // Opposés : même norme, directions antiparallèles.
      expect(wMinus.length()).toBeCloseTo(wPlus.length(), 12);
      expect(
        wPlus.clone().normalize().dot(wMinus.clone().normalize()),
        `${name} ne s'inverse pas`
      ).toBeCloseTo(-1, 9);
      // Et cette norme est bien la vitesse du catalogue (pas un pas d'animation déguisé).
      expect(wPlus.length()).toBeCloseTo(Math.abs(cfg.rotationSpeed ?? 0), 12);
    }
  });

  /**
   * Couche 2 — la rotation se fait autour de l'AXE DÉCLARÉ par le corps, en main droite.
   * Un repère miroité (déterminant −1, cf. le `-ey` d'`equatorialToScene`) ou un signe
   * inversé dans `setAxisDirection` ferait basculer ce produit scalaire à −1 sans changer
   * ni la norme ni la symétrie temporelle : les deux couches précédentes passeraient.
   */
  it('tourne autour de son axe déclaré, en main droite', () => {
    const bodies = buildScene();
    for (const [name, cfg] of spinning) {
      const axis = bodies[name].getAxisDirection();
      const w = angularVelocity(bodies[name], name, STEP_S);
      const expected = Math.sign(cfg.rotationSpeed ?? 0);
      expect(
        w.normalize().dot(axis),
        `${name} ne tourne pas autour de son axe`
      ).toBeCloseTo(expected, 9);
    }
  });
});

/**
 * Couche 3 — le modèle IAU/WGCCRE 2015 (`RotationAxis`), qui couvre le Soleil, la Lune, les
 * huit planètes et Pluton. Son angle de méridien W donne la période ET le sens de rotation.
 *
 * Portée exacte, à ne pas surestimer. La PÉRIODE reste une confrontation réelle : le
 * catalogue la tient de ses propres sources, WGCCRE de dW/dt, et rien ne les relie. Le SENS
 * et l'AXE, en revanche, ne le sont plus : `getSpinAxisDirection` lit désormais le sens à
 * cette même source, précisément pour ne plus le déduire d'une obliquité « > 90° » qui se
 * trompait sur les planètes naines. Ce qui est testé ici de ce côté est donc la PLOMBERIE —
 * le pôle arrive-t-il jusqu'à l'orientation monde du mesh, sans être perdu, miroité ou
 * remplacé par l'obliquité de secours du constructeur ? La garde indépendante sur le sens
 * est ailleurs : couche 3 bis (faits publiés) et couche 4 (Triton).
 */
const WGCCRE: Record<string, Body> = {
  sun: Body.Sun,
  mercury: Body.Mercury,
  venus: Body.Venus,
  earth: Body.Earth,
  moon: Body.Moon,
  mars: Body.Mars,
  jupiter: Body.Jupiter,
  saturn: Body.Saturn,
  uranus: Body.Uranus,
  neptune: Body.Neptune,
  pluto: Body.Pluto,
};

/**
 * dW/dt en rad/s, signé. Base de 100 s : assez courte pour qu'aucun corps ne fasse un tour
 * (Jupiter, le plus rapide, avance de 1,0°) donc pour lever l'ambiguïté modulo 360°, et
 * assez longue pour que l'écart domine largement le bruit de troncature sur W.
 */
function wgccreSpinRate(body: Body): number {
  const dtMs = 100_000;
  const w1 = RotationAxis(body, DATE).spin;
  const w2 = RotationAxis(body, new Date(DATE.getTime() + dtMs)).spin;
  const deltaDeg = ((((w2 - w1) % 360) + 540) % 360) - 180;
  return (deltaDeg * (Math.PI / 180)) / (dtMs / 1_000);
}

describe('rotation confrontée au modèle IAU/WGCCRE 2015', () => {
  const bodies = buildScene();
  const ephemeris = new EphemerisService();

  for (const [name, astroBody] of Object.entries(WGCCRE)) {
    const cfg = catalogue.get(name)!;
    // Le pôle n'est appliqué qu'aux corps que `syncAxesFromEphemeris` sait orienter ; les
    // autres gardent l'obliquité de secours du constructeur, qui n'en connaît pas l'azimut.
    const hasPoleSource =
      (cfg.rotationBody ?? cfg.astroBody) !== undefined &&
      cfg.kind !== 'star' &&
      cfg.kind !== 'skybox';

    it(`${name} : période et sens conformes à WGCCRE`, () => {
      const rate = wgccreSpinRate(astroBody);
      const north = ephemeris.getNorthPoleDirection(astroBody, DATE);
      const truth = north.multiplyScalar(rate);
      const rendered = angularVelocity(bodies[name], name, STEP_S);

      // Période : le catalogue et WGCCRE doivent décrire la même rotation à 1,5 % près
      // (l'écart réel le plus large est Neptune, 0,9 % — sa période est mal contrainte).
      expect(
        rendered.length() / Math.abs(rate),
        `${name} : période de rotation`
      ).toBeCloseTo(1, 1);

      const alignment = rendered.normalize().dot(truth.clone().normalize());
      if (hasPoleSource) {
        // Axe issu du pôle IAU : la direction doit coïncider, pas seulement le sens.
        expect(alignment, `${name} : axe et sens de rotation`).toBeCloseTo(
          1,
          3
        );
      } else {
        // Sans pôle, l'azimut est inconnu : seul le SENS est vérifiable — et c'est bien
        // lui qui est en cause ici (un contresens donnerait un produit scalaire négatif).
        expect(alignment, `${name} : sens de rotation`).toBeGreaterThan(0.5);
      }
    });
  }
});

/**
 * Couche 3 bis — SENS DE ROTATION, table de faits PUBLIÉS écrite à la main.
 *
 * Depuis que `getSpinAxisDirection` déduit le sens de dW/dt, plus aucune assertion tirée
 * d'astronomy-engine ne peut le contredire : le code et la « vérité » viendraient du même
 * calcul. Cette table est donc la dernière garde indépendante sur le sens — elle ne dépend
 * d'aucune ligne du projet et tomberait si une régression inversait un axe, y compris une
 * régression à l'intérieur d'astronomy-engine ou de `equatorialToScene`.
 *
 * Critère retenu : le signe de la composante Y du vecteur rotation, c'est-à-dire le sens vu
 * depuis le nord ÉCLIPTIQUE (l'axe +Y de la scène). C'est la formulation grand public de
 * « tourne à l'endroit / à l'envers », et celle que l'utilisateur voit à l'écran.
 *
 * Trois corps tournent à l'envers de l'écliptique : Vénus (obliquité 177,4°), Uranus (97,8°)
 * et Pluton (119,6°). Tous les autres tournent à l'endroit.
 */
describe('sens de rotation vu du nord écliptique (faits publiés)', () => {
  const bodies = buildScene();
  const RETROGRADE_VS_ECLIPTIC = new Set(['venus', 'uranus', 'pluto']);

  for (const name of Object.keys(WGCCRE)) {
    const retrograde = RETROGRADE_VS_ECLIPTIC.has(name);
    it(`${name} tourne ${retrograde ? 'à l’envers' : 'à l’endroit'} vu du nord écliptique`, () => {
      const spinY = angularVelocity(bodies[name], name, STEP_S).y;
      if (retrograde) expect(spinY).toBeLessThan(0);
      else expect(spinY).toBeGreaterThan(0);
    });
  }
});

/**
 * Couche 4 — COHÉRENCE LUNE / PLANÈTE-MÈRE. `RotationAxis` ne couvre aucun satellite : cette
 * couche est donc la seule garde possible sur les 24 lunes du catalogue, et elle confronte le
 * rendu à des faits publiés plutôt qu'à un modèle.
 *
 * Deux populations, deux forces d'assertion — la distinction n'est pas cosmétique :
 *
 *  - VERROUILLÉES par effet de marée : leur rotation propre épouse leur révolution, donc le
 *    spin de leur planète. C'est un fait astronomique, et Triton en est l'exception publiée :
 *    seul gros satellite rétrograde du Système solaire, il tourne à l'inverse de Neptune.
 *    C'est ici, et nulle part ailleurs, qu'un contresens d'axe sur une lune se voit.
 *
 *  - CHAOTIQUES ou non synchrones (Styx, Nix, Kerbéros, Hydre, Hypérion, Néréide) : le
 *    catalogue les documente lui-même comme dépourvues de période fixe réelle. Leur axe
 *    n'a pas de vérité à respecter ; leur imposer le sens de la planète serait présenter une
 *    convention de rendu comme un fait. On vérifie seulement qu'elles héritent bien de l'axe
 *    de leur planète — le défaut par défaut choisi par l'app — et qu'aucune ne part à la
 *    dérive sur un axe étranger au système.
 */
describe('sens de rotation des satellites vs leur planète', () => {
  const bodies = buildScene();
  /** Seul gros satellite rétrograde du Système solaire. */
  const RETROGRADE_MOONS = new Set(['triton']);
  /** Rotation sans période fixe réelle — cf. les commentaires du catalogue sur chacune. */
  const CHAOTIC_MOONS = new Set([
    'styx',
    'nix',
    'kerberos',
    'hydra',
    'hyperion',
    'nereid',
  ]);

  for (const [name, cfg] of spinning) {
    const parent = parentOf.get(name);
    if (parent === undefined) continue;
    const parentCfg = catalogue.get(parent)!;
    if ((parentCfg.rotationSpeed ?? 0) === 0) continue;

    // Une lune qui EMPRUNTE le pôle de sa planète (`rotationBody`) doit s'aligner dessus au
    // vecteur près. Une lune qui a son PROPRE pôle publié — la Lune est la seule du
    // catalogue — n'a aucune raison d'être colinéaire à sa planète : son axe fait 22° avec
    // celui de la Terre (obliquité terrestre 23,4°, obliquité lunaire sur l'écliptique
    // 1,5°), et c'est correct. Sur elle, seul le SENS est une assertion légitime.
    const borrowsParentPole = cfg.rotationBody !== undefined;

    const retrograde = RETROGRADE_MOONS.has(name);
    const chaotic = CHAOTIC_MOONS.has(name);
    const expectation = chaotic
      ? `partage l’axe de ${parent} (rotation chaotique : convention, pas un fait)`
      : !borrowsParentPole
        ? `tourne dans le sens de ${parent} (pôle publié propre)`
        : retrograde
          ? `tourne à l’inverse du spin de ${parent}`
          : `tourne dans le sens du spin de ${parent}`;

    it(`${name} ${expectation}`, () => {
      const moon = angularVelocity(bodies[name], name, STEP_S).normalize();
      const planet = angularVelocity(
        bodies[parent],
        parent,
        STEP_S
      ).normalize();
      const alignment = moon.dot(planet);

      if (retrograde) {
        expect(alignment, `${name} devrait être rétrograde`).toBeLessThan(0);
      } else if (borrowsParentPole) {
        // Colinéaires : l'axe est bien celui de la planète, pas un axe voisin.
        expect(alignment, `${name} devrait suivre ${parent}`).toBeCloseTo(1, 6);
      } else {
        expect(
          alignment,
          `${name} devrait tourner dans le sens de ${parent}`
        ).toBeGreaterThan(0);
      }
    });
  }
});
