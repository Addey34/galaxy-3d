import { describe, expect, it } from 'vitest';
import { MAJOR_BODIES } from './exploHud';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { flattenBodies } from '@/config/catalog';

/**
 * CE QUE MONTRE LA PREMIÈRE VUE, SANS QUE PERSONNE N'AIT RIEN RÉGLÉ.
 *
 * Défaut signalé : « je sais pas si par défaut […] afficher tout ou restreindre et laisser les
 * gens décider, pour moi surcharger ». Il avait raison, et c'était mesurable — vingt-quatre
 * étiquettes empilées sur la vue initiale, dont Phobos, Hygie, Orcus, Bennu et Pallas. Les
 * ORBITES appliquaient déjà une retenue (planètes seules) ; les LIBELLÉS, non. Deux défauts
 * par défaut incohérents entre eux, dans le même panneau, sur la même liste de corps.
 *
 * Ce fichier fixe la retenue de départ. Il ne teste pas le DOM : la règle est dans le contenu
 * de `MAJOR_BODIES`, et c'est elle qui se dégraderait sans bruit si quelqu'un ajoutait une
 * lune « juste pour voir ». Le panneau `#orbit-options` reste la porte de sortie — rien ici
 * n'empêche d'afficher les cinquante autres.
 */
describe('affichage par défaut', () => {
  const catalogue = flattenBodies(CELESTIAL_CONFIG);

  it('ne nomme d’emblée que ce qu’un visiteur reconnaît', () => {
    expect([...MAJOR_BODIES].sort()).toEqual([
      'earth',
      'jupiter',
      'mars',
      'mercury',
      'moon',
      'neptune',
      'saturn',
      'sun',
      'uranus',
      'venus',
    ]);
  });

  it('reste une petite minorité du catalogue', () => {
    // La borne qui porte l'intention : si un jour la moitié du catalogue est nommée d'emblée,
    // le défaut d'origine est revenu, quelle que soit la liste.
    const named = [...catalogue.keys()].filter((n) => MAJOR_BODIES.has(n));
    expect(named.length).toBe(MAJOR_BODIES.size);
    expect(catalogue.size).toBeGreaterThan(40);
    expect(named.length / catalogue.size).toBeLessThan(0.25);
  });

  it('ne nomme aucun petit corps ni aucune naine', () => {
    // Ce sont eux qui saturaient la vue : Bennu, Hygie, Pallas, Vesta, Orcus, Sedna, Halley…
    // Des noms qui n'aident pas à commencer, et qui masquent ceux qui aident.
    for (const name of [
      'bennu',
      'hygiea',
      'pallas',
      'vesta',
      'halley',
      'ceres',
    ])
      expect(MAJOR_BODIES.has(name)).toBe(false);
  });

  it('ne nomme qu’une seule lune, et c’est la nôtre', () => {
    // La Lune est la seule que tout le monde nomme sans hésiter, et elle est le compagnon du
    // corps d'où l'on regarde. Phobos, Io, Titan et les autres attendent qu'on aille les voir.
    const moons = [...MAJOR_BODIES].filter(
      (name) => catalogue.get(name)?.kind === 'moon'
    );
    expect(moons).toEqual(['moon']);
  });

  it('nomme le Soleil et les huit planètes, sans en oublier une', () => {
    // L'autre moitié du risque : une retenue si forte qu'elle retire ce qu'on vient chercher.
    const planets = [...catalogue.entries()]
      .filter(([, cfg]) => cfg.kind === 'planet')
      .map(([name]) => name);
    expect(planets.length).toBe(8);
    for (const name of planets) expect(MAJOR_BODIES.has(name)).toBe(true);
    expect(MAJOR_BODIES.has('sun')).toBe(true);
  });

  it('ne nomme que des corps qui existent vraiment au catalogue', () => {
    // Un nom mal orthographié ici ne casse rien et ne se voit pas : le corps reste
    // simplement anonyme pour toujours.
    for (const name of MAJOR_BODIES) expect(catalogue.has(name)).toBe(true);
  });
});
