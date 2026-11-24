/**
 * LE TEXTE DU CATALOGUE DANS LA LANGUE ACTIVE — chargé à la demande, posé en place.
 *
 * Le bundle ne porte que l'anglais des fiches (cf. `core/registryText.ts` et le greffon
 * `deriveRegistryText` de `vite.config.ts`). Ce module charge la carte de la langue demandée et la
 * repose sur les objets déjà construits, ce qui laisse TOUS les lecteurs inchangés : la fiche, les
 * étiquettes, les crédits et les pages lisent toujours `texte[langue] ?? texte.en`.
 *
 * Il vit dans `config/` et non dans `i18n/`, et c'est une question de couche : `i18n` ne doit rien
 * savoir du catalogue, sinon le cœur de l'internationalisation dépendrait du registre. C'est
 * `MainSolarSystemApp` qui les relie, au démarrage, par `onLocaleLoading`.
 */
import { CELESTIAL_CONFIG } from './bodies';
import { NAVIGABLE_BODIES, NAVIGABLE_TARGETS } from './navigable';
import { FACT_SOURCE_PROVIDERS } from '@/registry/providers';
import { SMALL_BODY_ELEMENTS } from './smallBodies';
import { PRESETS } from '@/registry/presets';
import {
  DERIVED_TEXT_LOCALES,
  hydrateLocalized,
  type DerivedTextLocale,
} from '@/core/registryText';
import type { Locale } from '@/i18n/locales';

/**
 * Tout ce qui porte du texte de registre à l'exécution.
 *
 * La liste est EXPLICITE plutôt que devinée : un objet oublié ici afficherait de l'anglais dans
 * une interface espagnole, sans erreur. `e2e/i18n-locales.spec.ts` vérifie le cas qui se voit le
 * plus (la description d'un corps dans sa fiche), et `src/config/catalogueText.test.ts` vérifie
 * que chaque racine est bien couverte par la carte livrée.
 */
export const TEXT_ROOTS: readonly unknown[] = [
  CELESTIAL_CONFIG,
  NAVIGABLE_BODIES,
  NAVIGABLE_TARGETS,
  FACT_SOURCE_PROVIDERS,
  SMALL_BODY_ELEMENTS,
  PRESETS,
];

/**
 * Les dossiers du registre dont le texte voyage AILLEURS que dans la carte du catalogue
 * (GAL-TOUR-SCALE-001). Une visite porte ses quatre langues dans sa propre fiche, téléchargée à
 * l'ouverture de cette visite seulement : la reposer depuis la carte du catalogue l'aurait fait
 * payer à tout visiteur de langue non anglaise, ouverte ou non. `catalogueText.test.ts` tient la
 * frontière dans les deux sens. Les modèles d'engins (`craft`, GAL-OBJECT-IMMERSION-001) suivent la
 * même règle : leurs noms et leurs pièces voyagent avec le morceau de l'inspection. Les visites du voisinage
 * solaire (`stellar-visits`, GAL-UNIVERSE-005) aussi : leurs textes voyagent avec le morceau de la visite.
 */
export const SELF_CONTAINED_REGISTRY_DIRS: readonly string[] = [
  'tours',
  'craft',
  'stellar-visits',
];

/**
 * Un `import()` littéral par langue : Vite n'analyse pas un spécificateur calculé, et
 * embarquerait alors les trois cartes dans le démarrage — exactement ce que ce module évite.
 */
const LOADERS: Record<
  DerivedTextLocale,
  () => Promise<{ default: Record<string, string> }>
> = {
  fr: () => import('virtual:registry-text/catalogue-fr'),
  es: () => import('virtual:registry-text/catalogue-es'),
  'pt-BR': () => import('virtual:registry-text/catalogue-pt-BR'),
};

/** Les langues déjà posées : reposer la même carte deux fois ne sert à rien. */
const applied = new Set<string>();

/**
 * Charge et pose le texte du catalogue pour cette langue. Rend le nombre de blocs complétés,
 * pour que la garde puisse dire « rien n'a été posé » au lieu de le supposer.
 */
export async function hydrateCatalogueText(locale: Locale): Promise<number> {
  if (locale === 'en' || applied.has(locale)) return 0;
  if (!(DERIVED_TEXT_LOCALES as readonly string[]).includes(locale)) return 0;
  const derived = locale as DerivedTextLocale;
  const module = await LOADERS[derived]();
  let count = 0;
  for (const root of TEXT_ROOTS)
    count += hydrateLocalized(root, module.default, derived);
  applied.add(locale);
  return count;
}
