import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { messages } from '@/i18n/locales';

/**
 * LE TITRE DE NIVEAU 1 EST ÉCRIT À DEUX ENDROITS, ET LES DEUX DOIVENT DIRE LA MÊME CHOSE EN
 * ANGLAIS.
 *
 * `index.html` porte un `<h1 class="sr-only">` : c'est le seul titre de premier niveau de la
 * page, donc le repère principal de quelqu'un qui navigue par titres, et c'est aussi l'ANCRE
 * que `src/seo/bodyLandingPage.ts` remplace pour chaque page de corps. Il reste donc en
 * anglais dans le fichier statique, comme le `<title>`, et pour la même raison : le robot le
 * lit, le visiteur ne le lit jamais.
 *
 * La passe lecteur d'écran du lot 19 a mesuré ce que cela coûtait : avec `<html lang="fr">` et
 * une interface française, NVDA annonçait « titre · niveau 1 » suivi d'une phrase ANGLAISE, lue
 * par une voix française (défaut D2 de `docs/private/LECTEUR_ECRAN_LOT19.md`). L'application
 * remplace donc ce texte par sa version localisée au démarrage.
 *
 * En anglais, les deux doivent coïncider au caractère près, sinon le remplacement change
 * visiblement le repère sans raison. En français la divergence est voulue.
 */
describe('parité du titre de niveau 1', () => {
  const html = readFileSync(
    resolve(import.meta.dirname, '../../index.html'),
    'utf8'
  );

  /** Le texte du `<h1 class="sr-only">`, espaces d'indentation repliés comme le fait le DOM. */
  const staticHeading = (() => {
    const match = /<h1 class="sr-only">([\s\S]*?)<\/h1>/.exec(html);
    // Borne : sans elle, une refonte d'`index.html` rendrait ce fichier vert en ne comparant
    // plus rien — et casserait au passage le remplacement de `bodyLandingPage`.
    expect(
      match,
      'le <h1 class="sr-only"> a disparu d’index.html'
    ).not.toBeNull();
    return match![1].replace(/\s+/g, ' ').trim();
  })();

  it('écrit le même titre de niveau 1 anglais des deux côtés', () => {
    expect(messages.en['a11y.pageHeading']).toBe(staticHeading);
  });

  it('fournit une traduction française, différente et non vide', () => {
    const fr = messages.fr['a11y.pageHeading'];
    expect(fr, 'a11y.pageHeading manquante en français').toBeTruthy();
    expect(fr).not.toBe(messages.en['a11y.pageHeading']);
  });

  it('nomme le projet dans les deux langues', () => {
    // Le repère principal doit dire OÙ l'on est, dans les deux langues.
    expect(messages.en['a11y.pageHeading']).toContain('Galaxy');
    expect(messages.fr['a11y.pageHeading']).toContain('Galaxy');
  });
});
