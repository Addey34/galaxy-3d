import { describe, expect, it } from 'vitest';
import { CELESTIAL_CONFIG } from './bodies';
import { flattenBodies } from './catalog';
import { SPACECRAFT_MISSIONS } from './spacecraft';
import { INTERSTELLAR_OBJECTS } from './interstellar';
import { NAVIGABLE_BODIES, NAVIGABLE_TARGETS } from './navigable';
import { ALL_FACT_FIELDS, bodyFact } from '@/core/bodyFacts';

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

  it('publie un nom, une catégorie, une description et des faits sourcés', () => {
    // Jusqu'au lot 8b ces fiches n'affichaient AUCUN chiffre : leur date de lancement vivait
    // dans le registre sans champ `source`, et un fait sans provenance ne s'affiche pas
    // (`core/bodyFacts.ts`). Chacune en porte désormais au moins un, tiré d'une source
    // primaire ; `factProvenance.test.ts` confronte chaque valeur au relevé de cette source.
    for (const [name, cfg] of NAVIGABLE_TARGETS) {
      expect(['spacecraft', 'interstellar'], name).toContain(cfg.kind);
      expect(cfg.displayName?.en, name).toBeTruthy();
      expect(cfg.displayName?.fr, name).toBeTruthy();
      expect(cfg.realData?.description?.en, name).toBeTruthy();
      const shown = ALL_FACT_FIELDS.filter(
        (field) => bodyFact(cfg, field).status === 'value'
      );
      expect(shown.length, `${name} : aucun fait affiché`).toBeGreaterThan(0);
    }
  });

  it('n’affiche aucun chiffre sans source, et aucun rayon de cadrage', () => {
    // `MARKER_FRAMING_RADIUS` est une valeur de CAMÉRA, pas une mesure : elle ne doit jamais
    // atteindre `realData`, sans quoi la fiche annoncerait « Rayon : 0,5 km » pour une sonde.
    for (const [name, cfg] of NAVIGABLE_TARGETS) {
      expect(cfg.realData?.radiusKm, name).toBeUndefined();
      for (const field of ALL_FACT_FIELDS) {
        const entry = bodyFact(cfg, field);
        if (entry.status === 'unknown')
          expect(
            entry.reason.unsourced,
            `${name}.${field} : valeur affichable sans provenance`
          ).toBeFalsy();
      }
    }
  });

  it('déclare la masse de BepiColombo non publiable, avec sa raison', () => {
    // Le catalogue NSSDCA donne 365 kg, que sa propre page attribue au seul module de
    // propulsion. Une ligne « Masse : 365 kg » serait fausse pour le lecteur : la fiche dit
    // pourquoi elle ne montre rien, ce qui n'est pas la même chose qu'une ligne absente.
    const bepi = NAVIGABLE_TARGETS.get('bepicolombo');
    const entry = bodyFact(bepi!, 'massKg');
    expect(entry.status).toBe('unknown');
    if (entry.status !== 'unknown') return;
    expect(entry.reason.unsourced).toBeFalsy();
    expect(entry.reason.fr).toContain('365 kg');
    expect(entry.reason.en).toContain('365 kg');
  });

  it('complète le catalogue sans en écraser une seule entrée', () => {
    const scene = flattenBodies(CELESTIAL_CONFIG);
    expect(NAVIGABLE_BODIES.size).toBe(scene.size + NAVIGABLE_TARGETS.size);
    for (const [name, cfg] of scene)
      expect(NAVIGABLE_BODIES.get(name), name).toBe(cfg);
  });
});
