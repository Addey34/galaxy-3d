import { describe, expect, it } from 'vitest';
import { messages } from './allDictionaries';
import { LOCALES, type Locale } from './locales';

/**
 * L'ÉTAPE 1 DE LA VISITE NE DÉSIGNE PLUS UNE BARRE QUI N'EXISTE PLUS.
 *
 * Défaut constaté sur la production (GAL-PRODUCT-009) : la cible de l'étape 1 est `.dock--top-left`,
 * qui ne contient plus que « Vue globale » et le bouton de recherche (la palette). Le texte, lui,
 * demandait encore de choisir une planète « dans la barre du haut », dans les quatre langues. Le
 * test de couverture de la visite (`ui/guidedTourCoverage.test.ts`) vérifie les CIBLES, pas ce
 * que la phrase affirme : ce test-ci fige la phrase et refuse le renvoi à l'ancienne barre.
 */

const KEY = 'tour.step.navigation.text';

const EXPECTED: Record<Locale, string> = {
  en: 'Use the search button to choose a body, or drag the scene.',
  fr: 'Utilisez le bouton de recherche pour choisir un astre, ou faites glisser la scène.',
  es: 'Use el botón de búsqueda para elegir un astro o arrastre la escena.',
  'pt-BR': 'Use o botão de busca para escolher um astro ou arraste a cena.',
};

/** Les formulations de l'ancienne barre de sélection des planètes, une par langue. */
const OBSOLETE: Record<Locale, RegExp> = {
  en: /top bar|toolbar|planet bar/i,
  fr: /barre du haut|barre supérieure|barre des planètes/i,
  es: /barra superior|barra de planetas/i,
  'pt-BR': /barra superior|barra de planetas/i,
};

describe("étape 1 de la visite : l'instruction de navigation", () => {
  it('couvre les quatre langues', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...LOCALES].sort());
  });

  it.each([...LOCALES])(
    '%s : dit de passer par le bouton de recherche',
    (locale) => {
      expect(messages[locale][KEY]).toBe(EXPECTED[locale]);
    }
  );

  it.each([...LOCALES])("%s : ne renvoie plus à l'ancienne barre", (locale) => {
    expect(messages[locale][KEY]).not.toMatch(OBSOLETE[locale]);
  });

  it("garde l'étape 1 et ses douze étapes", () => {
    for (const locale of LOCALES) {
      const steps = Object.keys(messages[locale]).filter((key) =>
        /^tour\.step\..+\.text$/.test(key)
      );
      expect(steps, locale).toHaveLength(12);
    }
  });
});
