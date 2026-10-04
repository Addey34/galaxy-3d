import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TEXT_ROOTS } from './catalogueText';
import { FACT_SOURCE_PROVIDERS } from '@/registry/providers';
import {
  CARD_TEXT_LOCALES,
  DEFERRED_KEY,
  DERIVED_TEXT_LOCALES,
  collectDeferredText,
  deferLongText,
  englishStrings,
  hydrateDeferred,
  stripToEnglish,
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

/**
 * Les cartes du texte LONG des fiches (2026-10-04), chargées à la première ouverture d'une fiche
 * (`config/cardText.ts`), l'anglais compris.
 */
const CARD_MAPS = {
  en: () => import('virtual:registry-text/card-en'),
  fr: () => import('virtual:registry-text/card-fr'),
  es: () => import('virtual:registry-text/card-es'),
  'pt-BR': () => import('virtual:registry-text/card-pt-BR'),
} as const;

/** Les dossiers dont le greffon diffère le texte long : ceux que lit la fiche. */
const DEFERRING_DIRS = ['entities', 'spacecraft', 'interstellar'];

const REGISTRY = resolve(import.meta.dirname, '../registry');

/** Les dossiers de fiches, découverts et non listés : `schema/` porte du code, pas des fiches. */
function registryDirs(): string[] {
  return readdirSync(REGISTRY).filter(
    (name) => name !== 'schema' && statSync(join(REGISTRY, name)).isDirectory()
  );
}

function fichesOf(dir: string): unknown[] {
  return readdirSync(join(REGISTRY, dir))
    .filter((name) => name.endsWith('.json') && name !== 'order.json')
    .map((name) =>
      JSON.parse(readFileSync(join(REGISTRY, dir, name), 'utf-8'))
    );
}

/**
 * Les textes anglais d'un dossier, séparés comme le greffon les sépare : DIFFÉRÉS (dans la carte
 * de fiche) ou de DÉMARRAGE (dans la carte de la langue). Un même anglais peut être les deux.
 */
function splitOf(dir: string): { deferred: Set<string>; boot: Set<string> } {
  const deferred = new Set<string>();
  const boot = new Set<string>();
  for (const fiche of fichesOf(dir)) {
    if (!DEFERRING_DIRS.includes(dir)) {
      englishStrings(fiche, boot);
      continue;
    }
    for (const text of Object.values(collectDeferredText(fiche, 'en')))
      deferred.add(text);
    englishStrings(deferLongText(stripToEnglish(fiche)), boot);
  }
  return { deferred, boot };
}

/** Ce que le navigateur garde d'une fiche : l'anglais et la seule langue active. */
function onlyLocale(value: unknown, locale: string): unknown {
  if (Array.isArray(value)) return value.map((v) => onlyLocale(v, locale));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value))
      if (
        !(DERIVED_TEXT_LOCALES as readonly string[]).includes(k) ||
        k === locale
      )
        out[k] = onlyLocale(v, locale);
    return out;
  }
  return value;
}

/** Retire les empreintes `deferredText` laissées sur les blocs différés, une fois reposés. */
function withoutKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value))
      if (k !== DEFERRED_KEY) out[k] = withoutKeys(v);
    return out;
  }
  return value;
}

/** Repose la carte de DÉMARRAGE d'une langue sur les blocs non différés, comme `hydrateLocalized`. */
function hydrateBoot(
  value: unknown,
  boot: Record<string, string>,
  locale: string
): void {
  if (Array.isArray(value)) {
    for (const v of value) hydrateBoot(v, boot, locale);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (typeof record.en === 'string' && !(DEFERRED_KEY in record)) {
    const text = boot[textKey(record.en)];
    if (typeof text === 'string' && record[locale] === undefined)
      record[locale] = text;
  }
  for (const v of Object.values(record)) hydrateBoot(v, boot, locale);
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
      const card = (await CARD_MAPS[locale]()).default;
      const missing: string[] = [];
      for (const dir of dirs) {
        const { deferred, boot } = splitOf(dir);
        for (const english of boot)
          if (map[textKey(english)] === undefined)
            missing.push(`${dir} (démarrage) : ${english}`);
        for (const english of deferred)
          // Un lien Wikipédia peut manquer en espagnol ou en portugais : il est DÉRIVÉ de
          // l'article anglais et omis où l'article n'existe pas (`localizedFidelity.test.ts`).
          if (
            card[textKey(english)] === undefined &&
            !english.startsWith('https://en.wikipedia.org/')
          )
            missing.push(`${dir} (fiche) : ${english}`);
      }
      expect(
        missing.slice(0, 5),
        `${missing.length} texte(s) de fiche sans traduction ${locale} : le greffon ` +
          `deriveRegistryText a-t-il lu tous les dossiers du registre ?`
      ).toEqual([]);
    });
  }

  /**
   * LA PROMESSE DU BUDGET : un texte seulement différé ne part PAS au démarrage. S'il restait dans
   * la carte de la langue, le texte long serait payé deux fois par un visiteur non anglophone, et
   * la séparation du 2026-10-04 n'aurait libéré que l'anglais.
   */
  for (const locale of DERIVED_TEXT_LOCALES)
    it(`A bis. la carte de démarrage ${locale} ne porte aucun texte seulement différé`, async () => {
      const map = (await MAPS[locale]()).default;
      const leaked: string[] = [];
      for (const dir of DEFERRING_DIRS) {
        const { deferred, boot } = splitOf(dir);
        for (const english of deferred)
          if (!boot.has(english) && map[textKey(english)] !== undefined)
            leaked.push(english);
      }
      expect(leaked.slice(0, 3)).toEqual([]);
    });

  it('A ter. la carte de fiche anglaise rend tout le texte différé, à l’octet près', async () => {
    const card = (await CARD_MAPS.en()).default;
    expect(Object.keys(CARD_MAPS).sort()).toEqual(
      [...CARD_TEXT_LOCALES].sort()
    );
    let total = 0;
    for (const dir of DEFERRING_DIRS)
      for (const english of splitOf(dir).deferred) {
        expect(card[textKey(english)]).toBe(english);
        total += 1;
      }
    // Borne : un ensemble vide rendrait la boucle verte sans rien vérifier.
    expect(total).toBeGreaterThan(150);
  });

  /**
   * L'ALLER-RETOUR qui prouve que différer ne perd rien : la fiche allégée telle que le navigateur
   * la reçoit, plus ses deux cartes, redonne exactement l'anglais et la langue de la fiche d'origine.
   */
  for (const locale of DERIVED_TEXT_LOCALES)
    it(`A quater. alléger puis reposer redonne la fiche en ${locale}`, async () => {
      const english = (await CARD_MAPS.en()).default;
      const translation = (await CARD_MAPS[locale]()).default;
      const boot = (await MAPS[locale]()).default;
      for (const dir of DEFERRING_DIRS)
        for (const fiche of fichesOf(dir)) {
          const served = deferLongText(stripToEnglish(fiche));
          hydrateDeferred(served, english, translation, locale);
          hydrateBoot(served, boot, locale);
          expect(withoutKeys(served)).toEqual(onlyLocale(fiche, locale));
        }
    });

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
