import { describe, expect, it } from 'vitest';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { allBodies } from '@/config/catalog';
import { NAVIGABLE_TARGETS } from '@/config/navigable';
import { paletteBodyNames } from './bodyPalette';

/**
 * CE QUI SE CHERCHE DOIT ÊTRE TOUT CE QUI SE RÈGLE.
 *
 * Défaut livré : la palette de recherche excluait « les petits corps sans texture de surface »,
 * au motif qu'ils seraient naviguables par leurs seuls labels Explo. Mesuré dans l'application
 * construite : 51 entrées de palette pour 56 lignes dans le tableau Réglages. Les six absents
 * — Psyché, Bennu, Éros, Itokawa, Ryugu, Ida — avaient pourtant une ligne d'orbite, une ligne
 * de réglages, une fiche d'info, une page d'atterrissage, et pour cinq d'entre eux un modèle
 * de forme 3D. Ils étaient donc cliquables en 3D et réglables, mais introuvables.
 *
 * La règle tenue ici est celle-là, pas une liste : aucun corps du catalogue ne peut être
 * réglable sans être cherchable. Ajouter demain un corps sans texture le ferait apparaître
 * dans les deux surfaces, ou ferait échouer ce test.
 */
describe('palette de recherche', () => {
  const searchable = new Set(paletteBodyNames(CELESTIAL_CONFIG));

  it('ne laisse dehors que le fond étoilé', () => {
    const excluded = allBodies(CELESTIAL_CONFIG)
      .filter(({ name }) => !searchable.has(name))
      .map(({ name }) => name);
    expect(excluded).toEqual(['stars']);
  });

  it('rend cherchable tout corps que le tableau Réglages peut régler', () => {
    // Même filtre que `ui/orbitOptions` : tout ce qui porte une ligne d'orbite, hors étoile
    // et fond étoilé. Le Soleil n'a pas de ligne de réglages mais reste cherchable.
    const configurable = allBodies(CELESTIAL_CONFIG)
      .filter(
        ({ config }) => config.kind !== 'skybox' && config.kind !== 'star'
      )
      .map(({ name }) => name);
    expect(configurable.filter((name) => !searchable.has(name))).toEqual([]);
  });

  it('liste aussi les sondes et les objets interstellaires', () => {
    // Ils sont nommés à l'écran par la couche instrument depuis toujours ; ils n'étaient
    // cherchables nulle part. Ce qui porte un nom à l'écran se cherche.
    for (const name of NAVIGABLE_TARGETS.keys())
      expect(searchable.has(name), name).toBe(true);
    expect(NAVIGABLE_TARGETS.size).toBeGreaterThan(0);
  });

  it('nomme les six corps que l’exclusion cachait', () => {
    // Le cas précis qui a été livré faux, gardé nommément : ce sont aussi les corps portant
    // les modèles de forme réels, donc les plus coûteux à ne pas pouvoir atteindre.
    for (const name of ['psyche', 'bennu', 'eros', 'itokawa', 'ryugu', 'ida'])
      expect(searchable.has(name), name).toBe(true);
  });
});
