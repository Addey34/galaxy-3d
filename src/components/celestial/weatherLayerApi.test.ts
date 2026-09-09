import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import CelestialObject from './CelestialObject';
import type { AnimationSystem } from '@/components/systems/AnimationSystem';
import type { TextureSystem } from '@/components/systems/TextureSystem';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { getOverlaySunUniform } from '@/config/layerConfig';

/**
 * CONTRAT DES COUCHES DE DONNÉES DE `CelestialObject`, vu par `src/ui/*Layer.ts`.
 *
 * Cinq modules d'interface pilotent ces méthodes (`realtimeClouds`, `precipLayer`,
 * `thermalLayer`, `datedTextureLayer`, `meteoModelLayer`) et aucun test unitaire ne les
 * couvrait : seuls des scénarios e2e les traversaient, à travers toute l'application. Une
 * régression sur cette frontière ne se voyait donc qu'en ouvrant l'app, sur la bonne planète,
 * avec la bonne couche active.
 *
 * Deux propriétés méritent d'être verrouillées plus que les autres, parce qu'elles ont déjà
 * produit des défauts livrés :
 *
 *   1. **La couche thermique ne devient visible qu'AVEC une carte.** Son matériau naît à
 *      `opacity 0` : sans map il rendrait un voile BLANC opaque sur toute la planète, et
 *      l'interface affiche le mesh dès le clic, avant la fin du téléchargement (cf. aa83d9d).
 *   2. **Le fondu de la pluie est une machine à états.** Poser une texture pendant qu'un
 *      fondu court doit finaliser le précédent, sinon la carte reste figée quand les frames
 *      arrivent plus vite que le fondu.
 *
 * Et une propriété de sûreté qui vaut pour les 52 corps : ces méthodes sont appelées sur le
 * corps que l'interface croit être la Terre. Sur un corps sans la couche visée, elles doivent
 * être des NO-OP silencieuses, jamais une exception — Mars n'a qu'une couche `surface`.
 */

const textureSystem = {
  getLODTexture: () => new Promise<never>(() => {}),
} as unknown as TextureSystem;
const animationSystem = {
  addUpdatable: () => {},
} as unknown as AnimationSystem;

function makeBody(name: 'earth' | 'mars'): CelestialObject {
  return new CelestialObject(
    textureSystem,
    CELESTIAL_CONFIG.bodies[name],
    name,
    animationSystem
  );
}

/** Accès aux matériaux/uniformes internes — c'est l'état observable de ces méthodes. */
function internals(body: CelestialObject) {
  return body as unknown as {
    _precipMat?: THREE.MeshBasicMaterial;
    _precip?: {
      opacity: { value: number };
      enabled: { value: number };
      mix: { value: number };
      mapB: { value: THREE.Texture | null };
    };
    _thermalMat?: THREE.MeshBasicMaterial;
    _thermal?: { opacity: { value: number }; enabled: { value: number } };
    _precipFadeElapsed: number;
    layers: Map<string, THREE.Mesh>;
  };
}

const tex = (): THREE.Texture => new THREE.Texture();

describe('couches de données — contrat vu par src/ui', () => {
  let earth: CelestialObject;

  beforeEach(() => {
    earth = makeBody('earth');
  });

  describe('pluie : machine à états du fondu', () => {
    it('pose la première carte directement, sans fondu', () => {
      const first = tex();
      earth.setPrecipTexture(first);

      const { _precipMat, _precip } = internals(earth);
      expect(_precipMat!.map).toBe(first);
      // `mix = 0` et pas de cible : rien à fondre, il n'y avait rien avant.
      expect(_precip!.mix.value).toBe(0);
      expect(_precip!.mapB.value).toBeNull();
      expect(_precip!.enabled.value).toBe(1);
    });

    it('démarre un fondu vers la carte suivante sans lâcher la précédente', () => {
      const first = tex();
      const second = tex();
      earth.setPrecipTexture(first);
      earth.setPrecipTexture(second);

      const { _precipMat, _precip } = internals(earth);
      // La carte AFFICHÉE reste la première : c'est ce qui rend le fondu progressif.
      expect(_precipMat!.map).toBe(first);
      expect(_precip!.mapB.value).toBe(second);
      expect(_precip!.mix.value).toBe(0);
    });

    it('ignore une carte déjà affichée', () => {
      const only = tex();
      earth.setPrecipTexture(only);
      earth.setPrecipTexture(only);

      // Aucun fondu ne doit s'armer sur soi-même : sinon la couche clignote à chaque
      // rafraîchissement qui renvoie la même image.
      expect(internals(earth)._precip!.mapB.value).toBeNull();
    });

    it('finalise le fondu en cours avant d’en démarrer un nouveau', () => {
      const a = tex();
      const b = tex();
      const c = tex();
      earth.setPrecipTexture(a);
      earth.setPrecipTexture(b); // fondu a -> b armé
      earth.setPrecipTexture(c); // arrive avant la fin

      const { _precipMat, _precip } = internals(earth);
      // b devient la carte courante, c la nouvelle cible. Sans cette reprise, la carte
      // affichée resterait a — figée — tant que les frames arrivent plus vite que le fondu.
      expect(_precipMat!.map).toBe(b);
      expect(_precip!.mapB.value).toBe(c);
    });

    it('avance le fondu dans les deux sens du temps', () => {
      earth.setPrecipTexture(tex());
      earth.setPrecipTexture(tex());
      const before = internals(earth)._precipFadeElapsed;

      // Un fondu est une DURÉE, pas un déplacement : la timebar en marche arrière ne doit
      // pas le figer (défaut corrigé en 6db7ecb).
      //
      // `visible = true` est nécessaire, et la nuance vaut d'être notee : contrairement à la
      // rotation propre — délibérément placée AVANT le test de visibilité parce qu'elle est
      // une intégrale que sauter décale définitivement — le fondu, lui, est derrière. Un
      // corps hors champ ne fond pas : rien ne se perd, il n'y a personne pour le voir.
      earth.update(-0.05, new THREE.Vector3(0, 0, 0), true);
      expect(internals(earth)._precipFadeElapsed).toBeGreaterThan(before);
    });
  });

  describe('thermique : ne devient visible qu’avec une carte', () => {
    it('naît invisible', () => {
      const { _thermalMat } = internals(earth);
      // Sans map, ce matériau rendrait un voile blanc opaque sur toute la planète.
      expect(_thermalMat!.opacity).toBe(0);
    });

    it('devient visible en même temps que sa carte, jamais avant', () => {
      const map = tex();
      earth.setThermalTexture(map, { opacity: 0.8 });

      const { _thermalMat, _thermal } = internals(earth);
      expect(_thermalMat!.map).toBe(map);
      expect(_thermal!.enabled.value).toBe(1);
      expect(_thermalMat!.opacity).toBeGreaterThan(0);
    });
  });

  describe('overlay de donnée modèle : le terminateur vient de la COUCHE', () => {
    it('éteint la nuit un overlay posé sur une couche d’apparence physique', () => {
      // Défaut réellement livré : `setDataOverlay` remplaçait le matériau de la couche par un
      // MeshBasicMaterial nu. Les nuages satellite s'éteignaient au terminateur et les nuages
      // MODÈLE — la même chose physique, sur le même mesh — brillaient à plein régime sur la
      // face nuit. Basculer d'une source à l'autre ne doit rien changer à la nuit.
      earth.setDataOverlay('clouds', tex());
      const clouds = internals(earth).layers.get('clouds')!
        .material as THREE.Material;
      expect(getOverlaySunUniform(clouds)).toBeDefined();

      // Et la position du Soleil lui parvient bien chaque frame, sinon le masque resterait
      // figé sur sa valeur par défaut.
      const sun = new THREE.Vector3(7, 0, 0);
      earth.update(0.016, sun, true);
      expect(getOverlaySunUniform(clouds)!.value.x).toBe(7);
    });

    it('laisse une couche d’instrument telle quelle', () => {
      // La température n'est l'apparence de rien : l'assombrir la nuit rendrait illisible une
      // information, pas le rendu plus réaliste.
      earth.setDataOverlay('thermal', tex());
      const thermal = internals(earth).layers.get('thermal')!
        .material as THREE.Material;
      expect(getOverlaySunUniform(thermal)).toBeUndefined();
    });
  });

  /**
   * Ces méthodes sont appelées sur le corps que l'interface croit être la Terre. Sur un corps
   * qui n'a pas la couche visée, elles doivent se taire — pas lever.
   */
  describe('corps sans la couche visée', () => {
    it('ignore silencieusement les couches de données', () => {
      const mars = makeBody('mars');
      expect(() => mars.setPrecipTexture(tex())).not.toThrow();
      expect(() => mars.setThermalTexture(tex())).not.toThrow();
      expect(internals(mars)._precipMat).toBeUndefined();
    });
  });
});
