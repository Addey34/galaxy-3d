import { describe, expect, it } from 'vitest';
import { bodyLandingPages } from './bodyLandingPage';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { messages } from '@/i18n/locales';

/**
 * LE TITRE DE L'ONGLET ET CELUI DE LA PAGE SERVIE DOIVENT ÊTRE LE MÊME TEXTE.
 *
 * Deux endroits écrivent le titre d'un corps, et pour de bonnes raisons. `src/seo` le met dans
 * la page statique, lue par les robots. `ui/documentTitle` le remet à jour pendant la
 * navigation, parce que le chemin de l'URL change désormais sans rechargement et qu'un titre
 * figé ferait dire deux choses différentes à l'adresse et à l'onglet.
 *
 * En ANGLAIS, les deux doivent coïncider au caractère près : sinon recharger `/jupiter/` fait
 * clignoter le titre — la page statique s'affiche, puis l'application le remplace par une
 * formulation légèrement différente. Personne ne le signalerait, et personne ne le corrigerait.
 *
 * En FRANÇAIS la divergence est assumée : la page statique est anglaise par choix de
 * référencement, et l'interface doit parler la langue du visiteur. On vérifie donc seulement
 * que la traduction existe et porte bien le nom du corps.
 */
describe('parité des titres', () => {
  const pages = bodyLandingPages(CELESTIAL_CONFIG, 'https://example.test');
  const jupiter = pages.find((page) => page.slug === 'jupiter');

  it('trouve bien la page de référence', () => {
    // Borne : sans elle, un renommage de slug rendrait tout le reste vert sans rien comparer.
    expect(jupiter).toBeDefined();
    expect(pages.length).toBeGreaterThan(20);
  });

  it('écrit le même titre anglais des deux côtés', () => {
    const fromI18n = messages.en['title.body']?.replace('{name}', 'Jupiter');
    expect(fromI18n).toBe(jupiter?.title);
  });

  it('couvre TOUS les corps, pas seulement celui qu’on a regardé', () => {
    // Le motif est partagé, donc s'il vaut pour un corps il vaut pour tous — mais c'est le
    // genre d'affirmation qu'on croit sans la vérifier. Ici elle est vérifiée.
    const pattern = messages.en['title.body'] ?? '';
    for (const page of pages) {
      const expected = pattern.replace(
        '{name}',
        page.title.replace(/ in 3D.*$/, '')
      );
      expect(page.title, `titre de ${page.slug}`).toBe(expected);
    }
  });

  it('fournit une traduction française qui nomme le corps', () => {
    const fr = messages.fr['title.body'];
    expect(fr, 'title.body manquante en français').toBeTruthy();
    expect(fr).toContain('{name}');
    expect(fr).not.toBe(messages.en['title.body']);
    // Et la vue d'ensemble aussi, sans quoi revenir au global laisserait le titre d'un corps.
    expect(messages.fr['title.overview']).toBeTruthy();
    expect(messages.en['title.overview']).toBeTruthy();
  });
});
