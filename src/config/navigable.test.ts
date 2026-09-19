import { describe, expect, it } from 'vitest';
import { CELESTIAL_CONFIG } from './bodies';
import { flattenBodies } from './catalog';
import { SPACECRAFT_MISSIONS } from './spacecraft';
import { INTERSTELLAR_OBJECTS } from './interstellar';
import { NAVIGABLE_BODIES, NAVIGABLE_TARGETS } from './navigable';

/**
 * LES OBJETS D'INSTRUMENT SONT NAVIGABLES, ET ILS NE SONT PAS DES CORPS DE LA SCÈNE.
 *
 * Défaut livré : onze sondes et trois objets interstellaires étaient nommés à l'écran depuis
 * toujours et n'existaient nulle part ailleurs — ni dans la recherche, ni au clic, ni dans les
 * Réglages, ni dans la fiche. Ils viennent de leurs registres, donc ajouter une sonde reste
 * « ajouter une fiche JSON » : aucune liste n'est recopiée ici, et ce test le tient.
 *
 * L'autre moitié compte autant. Les faire entrer dans `CELESTIAL_CONFIG` aurait été le chemin
 * court, et il aurait fabriqué un mesh, une texture à précharger, une page d'atterrissage et
 * une vignette pour un objet de quelques mètres — l'inverse de l'invariant Explo. Le test
 * vérifie donc aussi qu'ils en restent DEHORS.
 */
describe('objets navigables', () => {
  it('dérive ses objets des registres, sans liste recopiée', () => {
    expect([...NAVIGABLE_TARGETS.keys()]).toEqual([
      ...SPACECRAFT_MISSIONS.map((m) => m.name),
      ...INTERSTELLAR_OBJECTS.map((o) => o.name),
    ]);
    expect(NAVIGABLE_TARGETS.size).toBe(
      SPACECRAFT_MISSIONS.length + INTERSTELLAR_OBJECTS.length
    );
  });

  it('n’entre dans aucun catalogue de la scène', () => {
    const scene = flattenBodies(CELESTIAL_CONFIG);
    for (const name of NAVIGABLE_TARGETS.keys())
      expect(scene.has(name), name).toBe(false);
  });

  it('ne porte rien qui fabriquerait un mesh', () => {
    // `celestialLayers.buildLayers` ne crée une surface que s'il trouve une texture ou une
    // couleur de repli. Aucune des deux ici : c'est ce qui garantit qu'aucune sphère
    // mandataire n'apparaît, même si un jour quelqu'un passait ces configs à la fabrique.
    for (const [name, cfg] of NAVIGABLE_TARGETS) {
      expect(cfg.textureResolutions, name).toEqual({});
      expect(cfg.textures?.surface, name).toBeUndefined();
      expect(cfg.fallbackColor, name).toBeUndefined();
      expect(cfg.model, name).toBeUndefined();
      expect(cfg.ring, name).toBeUndefined();
    }
  });

  it('publie un nom, une catégorie et une description, et aucun fait chiffré', () => {
    // Un fait sans provenance ne s'affiche pas (cf. `core/bodyFacts.ts`). Ces objets n'ont
    // aucun fait sourcé : leur fiche doit donc rester un nom, une catégorie et un texte.
    for (const [name, cfg] of NAVIGABLE_TARGETS) {
      expect(['spacecraft', 'interstellar'], name).toContain(cfg.kind);
      expect(cfg.displayName?.en, name).toBeTruthy();
      expect(cfg.displayName?.fr, name).toBeTruthy();
      expect(cfg.realData?.description?.en, name).toBeTruthy();
      expect(cfg.realData?.radiusKm, name).toBeUndefined();
      expect(cfg.realData?.massKg, name).toBeUndefined();
      expect(cfg.realData?.sources, name).toBeUndefined();
    }
  });

  it('complète le catalogue sans en écraser une seule entrée', () => {
    const scene = flattenBodies(CELESTIAL_CONFIG);
    expect(NAVIGABLE_BODIES.size).toBe(scene.size + NAVIGABLE_TARGETS.size);
    for (const [name, cfg] of scene)
      expect(NAVIGABLE_BODIES.get(name), name).toBe(cfg);
  });
});
