import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TEXT_ROOTS } from './catalogueText';
import { FACT_SOURCE_PROVIDERS } from '@/registry/providers';
import {
  DERIVED_TEXT_LOCALES,
  englishStrings,
  textKey,
} from '@/core/registryText';

/**
 * LA CARTE LIVRÉE ET LES RACINES DE TEXTE DÉCRIVENT-ELLES LA MÊME CHOSE ? (lot 21)
 *
 * CE TEST EST NEUF, ET IL COMBLE UNE PHRASE FAUSSE : le commentaire de `catalogueText.ts`
 * l'annonçait depuis le lot 20 (« `src/config/catalogueText.test.ts` vérifie que chaque racine est
 * bien couverte par la carte livrée ») alors que le fichier n'existait pas. Constaté le 2026-09-28
 * en ouvrant le lot 21, et corrigé en écrivant la garde plutôt qu'en effaçant la phrase.
 *
 * CE QU'IL EXISTE POUR ATTRAPER, et ce n'est pas théorique. Le texte du registre passe par QUATRE
 * listes de dossiers tenues à la main — le greffon `deriveRegistryText` de `vite.config.ts`,
 * `TEXT_ROOTS` ici, `scripts/localized-fields.mjs` et `src/registry/registryText.test.ts` — et
 * **aucune n'échoue bruyamment si on l'oublie** : le résultat serait de l'anglais dans une
 * interface espagnole, sans erreur et sans test rouge. Le lot 21 ajoute un cinquième dossier
 * (`tours`), donc quatre occasions de se tromper.
 *
 * DEUX SENS, parce qu'un seul laisserait passer la moitié des pannes :
 *
 *   A. tout texte localisé PRÉSENT SUR LE DISQUE sous `src/registry/` a sa traduction dans la carte
 *      livrée. Les fiches sont DÉCOUVERTES ici (tout sous-dossier sauf `schema/`), jamais listées :
 *      une liste recopiée aurait exactement le trou qu'on cherche. Un dossier oublié par le greffon
 *      rougit donc ici ;
 *   B. le texte de chaque dossier du registre est bien RÉCLAMÉ par une racine d'exécution. Un objet
 *      oublié dans `TEXT_ROOTS` laisserait son dossier à zéro : son texte serait dérivé, livré, et
 *      jamais reposé.
 *
 * La carte est chargée par le VRAI module virtuel, celui que le greffon produit : c'est la seule
 * façon de tester la liste de dossiers du greffon plutôt qu'une deuxième copie de cette liste.
 */

const MAPS = {
  fr: () => import('virtual:registry-text/catalogue-fr'),
  es: () => import('virtual:registry-text/catalogue-es'),
  'pt-BR': () => import('virtual:registry-text/catalogue-pt-BR'),
} as const;

const REGISTRY = resolve(import.meta.dirname, '../registry');

/** Les dossiers de fiches, découverts et non listés : `schema/` porte du code, pas des fiches. */
function registryDirs(): string[] {
  return readdirSync(REGISTRY).filter(
    (name) => name !== 'schema' && statSync(join(REGISTRY, name)).isDirectory()
  );
}

/** Les textes anglais localisés d'un dossier de fiches, lus sur le DISQUE. */
function englishOf(dir: string): Set<string> {
  const found = new Set<string>();
  for (const name of readdirSync(join(REGISTRY, dir)))
    if (name.endsWith('.json') && name !== 'order.json')
      englishStrings(
        JSON.parse(readFileSync(join(REGISTRY, dir, name), 'utf-8')),
        found
      );
  return found;
}

describe('le texte du registre livré', () => {
  const dirs = registryDirs();

  it('découvre bien les dossiers de fiches', () => {
    // Borne : une découverte vide rendrait tout le reste vert sans rien prouver.
    expect(dirs).toContain('entities');
    expect(dirs).toContain('tours');
    expect(dirs.length).toBeGreaterThanOrEqual(5);
  });

  it('déclare une carte par langue dérivée', () => {
    expect(Object.keys(MAPS).sort()).toEqual([...DERIVED_TEXT_LOCALES].sort());
  });

  for (const locale of DERIVED_TEXT_LOCALES) {
    it(`A. traduit en ${locale} chaque texte des fiches du disque`, async () => {
      const map = (await MAPS[locale]()).default;
      const missing: string[] = [];
      for (const dir of dirs)
        for (const english of englishOf(dir))
          if (map[textKey(english)] === undefined)
            missing.push(`${dir} : ${english}`);
      expect(
        missing.slice(0, 5),
        `${missing.length} texte(s) de fiche sans traduction ${locale} : le greffon ` +
          `deriveRegistryText a-t-il lu tous les dossiers du registre ?`
      ).toEqual([]);
    });
  }

  /**
   * Les dossiers dont le texte localisé est lu UNIQUEMENT au build, avec la raison MESURÉE. Une
   * exception déclarée, pas un silence : le jour où l'application affiche ce texte, il faudra
   * retirer la ligne, et la garde le dira.
   */
  const BUILD_ONLY: Record<string, string> = {
    // Trois fiches sur vingt-six portent `use` et `terms` (nasa-eonet, nasa-trek,
    // usgs-earthquake-catalog) : cette prose n'est lue que par `/sources`, généré au build, où les
    // fiches ne sont pas allégées. La façade d'exécution `FACT_SOURCE_PROVIDERS` n'expose, elle,
    // aucun bloc localisé — vérifié ci-dessous, pour que « build seulement » reste vrai.
    providers: 'la prose `use`/`terms` n’est lue que par /sources, au build',
  };

  it('B. chaque dossier de fiches est réclamé par une racine d’exécution', () => {
    const claimed = englishStrings(TEXT_ROOTS);
    // Borne : un ensemble vide de racines rendrait le contrôle ci-dessous vide de sens.
    expect(claimed.size).toBeGreaterThan(100);
    const orphans = dirs.filter((dir) => {
      if (BUILD_ONLY[dir] !== undefined) return false;
      const english = englishOf(dir);
      return english.size > 0 && ![...english].some((s) => claimed.has(s));
    });
    expect(
      orphans,
      `ces dossiers portent du texte traduit que rien ne repose à l’exécution : ` +
        `les ajouter à TEXT_ROOTS (${orphans.join(', ')})`
    ).toEqual([]);
  });

  it('B. et l’exception « build seulement » est vraie, pas commode', () => {
    // Si la façade des fournisseurs exposait un bloc localisé, l'exception ci-dessus cacherait un
    // vrai texte non traduit. Le contrôle est donc sur la façade, pas sur les fiches.
    expect(englishStrings(FACT_SOURCE_PROVIDERS).size).toBe(0);
    expect(Object.keys(BUILD_ONLY)).toEqual(['providers']);
  });
});
