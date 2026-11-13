import { describe, expect, it } from 'vitest';
import { messages } from './allDictionaries';
import { LOCALES, type Locale } from './locales';

/**
 * L'ÉTAPE 5 DE LA VISITE DIT CE QUE LE BOUTON D'INFORMATION FAIT VRAIMENT.
 *
 * Comportement du produit (`ui/bodyInfo.ts`, mesuré sur la production, GAL-PRODUCT-011) : choisir
 * un corps OUVRE sa fiche tout seul, et le bouton d'information la MASQUE ou la ROUVRE. L'ancien
 * texte demandait de l'ouvrir « avec le bouton » après la sélection : un visiteur qui obéissait
 * la fermait. Ce test fige la phrase et refuse le retour à l'ordre d'ouvrir à la main.
 */

const KEY = 'tour.step.info.text';

const EXPECTED: Record<Locale, string> = {
  en: 'Selecting a body opens its information panel. Use the information button to hide or reopen it.',
  fr: 'La fiche s’ouvre quand vous choisissez un astre. Le bouton d’information permet de la masquer ou de la rouvrir.',
  es: 'Al seleccionar un astro, su ficha se abre automáticamente. Use el botón de información para ocultarla o volver a abrirla.',
  'pt-BR':
    'Ao selecionar um astro, a ficha se abre automaticamente. Use o botão de informações para ocultá-la ou reabri-la.',
};

/** L'ancien ordre d'ouvrir la fiche depuis le bouton, une formulation par langue. */
const OBSOLETE: Record<Locale, RegExp> = {
  en: /open its information panel from/i,
  fr: /ouvrez sa fiche avec/i,
  es: /abra su ficha con/i,
  'pt-BR': /abra a ficha dele/i,
};

describe("étape 5 de la visite : le rôle du bouton d'information", () => {
  it('couvre les quatre langues', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...LOCALES].sort());
  });

  it.each([...LOCALES])('%s : dit que la fiche s’ouvre seule', (locale) => {
    expect(messages[locale][KEY]).toBe(EXPECTED[locale]);
  });

  it.each([...LOCALES])(
    '%s : ne demande plus d’ouvrir la fiche à la main',
    (locale) => {
      expect(messages[locale][KEY]).not.toMatch(OBSOLETE[locale]);
    }
  );

  it('ne contient aucun tiret cadratin', () => {
    for (const locale of LOCALES) {
      expect(messages[locale][KEY], locale).not.toContain('—');
    }
  });
});
