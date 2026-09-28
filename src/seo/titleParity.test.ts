import { describe, expect, it } from 'vitest';
import { bodyLandingPages } from './bodyLandingPage';
import { eclipseLandingPages, eclipsePageTitle } from './eclipseLandingPage';
import { eclipsesInPageWindow, eclipseTitleKey } from '@/core/eclipsePages';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { messages } from '@/i18n/allDictionaries';
import { LOCALES } from '@/i18n/locales';

/**
 * LE TITRE DE L'ONGLET ET CELUI DE LA PAGE SERVIE DOIVENT ÊTRE LE MÊME TEXTE, DANS CHAQUE LANGUE.
 *
 * Deux endroits écrivent le titre d'un corps, et pour de bonnes raisons. `src/seo` le met dans
 * la page statique, lue par les robots. `ui/documentTitle` le remet à jour pendant la
 * navigation, parce que le chemin de l'URL change désormais sans rechargement et qu'un titre
 * figé ferait dire deux choses différentes à l'adresse et à l'onglet.
 *
 * Les deux doivent coïncider au caractère près : sinon recharger `/jupiter/` fait clignoter le
 * titre — la page statique s'affiche, puis l'application le remplace par une formulation
 * légèrement différente. Personne ne le signalerait, et personne ne le corrigerait.
 *
 * CETTE PARITÉ VAUT MAINTENANT DANS LES QUATRE LANGUES (lot 20, phase 20D). Elle ne valait qu'en
 * anglais avant, et ce fichier expliquait la divergence française par « la page statique est
 * anglaise par choix de référencement » : cette phrase est PÉRIMÉE, les pages existent
 * désormais dans les quatre langues, à leur propre adresse. C'est la même parité qui a fait
 * trouver, au lot 19, un titre d'onglet jamais traduit.
 */
describe('parité des titres', () => {
  it('trouve bien la page de référence', () => {
    // Borne : sans elle, un renommage de slug rendrait tout le reste vert sans rien comparer.
    const pages = bodyLandingPages(CELESTIAL_CONFIG, 'https://example.test');
    expect(pages.find((page) => page.slug === 'jupiter')).toBeDefined();
    expect(pages.length).toBeGreaterThan(20);
  });

  for (const locale of LOCALES) {
    it(`écrit le même titre qu'\`ui/documentTitle\` en ${locale}`, () => {
      const pattern = messages[locale]['title.body'];
      const pages = bodyLandingPages(
        CELESTIAL_CONFIG,
        'https://example.test',
        locale
      );
      expect(pages.length).toBeGreaterThan(20);
      for (const page of pages) {
        // Le nom vient du catalogue, le gabarit du dictionnaire : exactement les deux sources
        // que `ui/documentTitle` emploie à l'exécution.
        expect(page.title, `${page.slug} en ${locale}`).toBe(
          pattern.replace('{name}', page.displayName)
        );
        // Et le titre de niveau 1 de la page est le même texte : c'est le premier énoncé d'un
        // lecteur d'écran qui arrive sur l'adresse.
        expect(page.heading).toBe(page.title);
      }
    });

    it(`écrit le titre d'éclipse depuis le dictionnaire en ${locale}`, () => {
      const pages = eclipseLandingPages('https://example.test', locale);
      const events = eclipsesInPageWindow();
      expect(pages.length).toBe(events.length);
      for (const [index, page] of pages.entries()) {
        const event = events[index]!;
        expect(page.title).toBe(eclipsePageTitle(event, locale));
        // Le gabarit existe dans CETTE langue : une clé manquante rendrait la clé brute.
        expect(messages[locale][eclipseTitleKey(event)]).toBeTruthy();
      }
    });
  }

  it('ne laisse aucun titre en anglais dans une autre langue', () => {
    // La garde qui compte vraiment : un titre identique à l'anglais dans les trois autres
    // langues serait un dictionnaire non consulté. Jupiter s'appelle « Júpiter » en espagnol et
    // en portugais, « Jupiter » en français : on compare donc le GABARIT, pas le nom.
    const english = messages.en['title.body'];
    for (const locale of LOCALES) {
      if (locale === 'en') continue;
      expect(messages[locale]['title.body'], locale).not.toBe(english);
      const [page] = bodyLandingPages(
        CELESTIAL_CONFIG,
        'https://example.test',
        locale
      );
      expect(page!.title).not.toContain('in 3D: live position');
    }
  });
});
