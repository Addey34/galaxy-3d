/**
 * LE TEXTE LOCALISÉ DU REGISTRE, SÉPARÉ DE SA STRUCTURE — pur, testé, sans E/S (lot 20, 20B).
 *
 * POURQUOI CE MODULE EXISTE, mesuré et non supposé. Les fiches du registre sont importées par
 * `import.meta.glob({ eager: true })`, donc leur contenu ENTIER part dans le bundle du
 * navigateur. Avec deux langues c'était déjà le cas ; avec quatre, les traductions espagnole et
 * portugaise ont ajouté **50 263 octets** payés par TOUS les visiteurs, y compris les
 * anglophones qui ne les liront jamais — la marge du budget JavaScript est tombée de 72 521 à
 * 22 258 octets. C'est exactement la pression que la garde de budget existe pour rendre visible,
 * et c'est aussi la contradiction du lot : son dictionnaire d'interface est paresseux, son
 * catalogue ne l'était pas.
 *
 * LA RÈGLE : le bundle ne reçoit que l'ANGLAIS, qui est le repli de tout l'affichage ; les trois
 * autres langues sont DÉRIVÉES des fiches au build, dans un module par langue, chargé avec le
 * dictionnaire de cette langue. Une cinquième langue ne coûtera donc rien au démarrage des
 * autres.
 *
 * LA CLÉ EST LA CHAÎNE ANGLAISE, et ce n'est pas un raccourci : elle évite de transporter un
 * chemin de fiche jusqu'au navigateur, elle survit à un déplacement de champ dans une fiche, et
 * deux champs qui portent le MÊME anglais (la raison de masse de Styx et de Cerbère, mot pour
 * mot) partagent alors la même traduction — ce qui est le comportement voulu, pas une collision.
 * Ce que cela interdit : deux traductions DIFFÉRENTES pour un même anglais. Aucune n'existe, et
 * `src/registry/registryText.test.ts` le vérifie sur les fiches livrées.
 *
 * UNE `Map` SE TRAVERSE, ET CE N'EST PAS UN RAFFINEMENT : `Object.values(new Map(...))` rend un
 * tableau VIDE, donc la première version de `hydrateLocalized` ne posait rien du tout dans un objet
 * rangé par clé. Mesuré le 2026-09-28, en ouvrant le lot 21 : `NAVIGABLE_TARGETS` et
 * `NAVIGABLE_BODIES` sont des `Map`, et les 14 objets d'instrument (11 sondes, 3 interstellaires)
 * lisaient donc l'ANGLAIS dans les trois autres langues, alors que leur traduction était bel et
 * bien téléchargée. 28 blocs reposés au lieu de 0. Le défaut ne pouvait se voir qu'à l'écran, dans
 * le navigateur : en test, les fiches ne sont pas allégées, donc leur français est encore là. C'est
 * `src/config/catalogueText.test.ts` qui l'a dénoncé — la garde que le lot 20 annonçait sans
 * l'écrire. `stripToEnglish` et `collectTranslations`, elles, ne voient QUE du JSON analysé : leur
 * ajouter une branche `Map` serait du code qu'aucun appel n'atteint.
 *
 * Les fiches restent le propriétaire unique du texte : rien n'est déplacé, rien n'est recopié.
 * `stripToEnglish` et `collectTranslations` sont deux lectures de la MÊME fiche, et
 * `hydrateLocalized` reconstruit exactement ce qu'elles ont séparé — propriété vérifiée par un
 * aller-retour dans le test.
 */

/**
 * LA CLÉ D'UNE TRADUCTION : une empreinte COURTE de la chaîne anglaise, pas la chaîne elle-même.
 *
 * Mesuré, et c'est la raison du changement : une carte indexée par la chaîne anglaise complète
 * pesait 41 342 octets par langue, dont environ 19 000 d'anglais RECOPIÉ — un texte que le bundle
 * porte déjà. L'empreinte ramène chaque clé à sept caractères, et la carte à environ 22 000
 * octets, sans rien perdre : le navigateur a l'anglais sous la main, il recalcule la clé.
 *
 * FNV-1a 32 bits, écrit ici plutôt qu'emprunté : il tient en cinq lignes, il est stable d'une
 * machine à l'autre et il n'a aucune dépendance. Ce n'est pas une empreinte cryptographique et
 * elle n'a pas à l'être ; ce qui compte est qu'une COLLISION soit refusée au build, ce que
 * `collectTranslations` fait en nommant les deux chaînes fautives.
 */
export function textKey(english: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < english.length; i += 1) {
    hash ^= english.charCodeAt(i);
    // Multiplication FNV en arithmétique 32 bits non signée.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** Les langues DÉRIVÉES : toutes sauf l'anglais, qui reste dans le bundle. */
export const DERIVED_TEXT_LOCALES = ['fr', 'es', 'pt-BR'] as const;
export type DerivedTextLocale = (typeof DERIVED_TEXT_LOCALES)[number];

/** Les clés qu'un bloc localisé peut porter en plus de ses langues. */
const FLAGS = ['unsourced'];
const LOCALE_KEYS = ['en', ...DERIVED_TEXT_LOCALES];

/**
 * Un bloc localisé : un objet dont toutes les clés sont des langues (ou `unsourced`), et qui
 * porte un anglais. La condition « rien d'autre que des langues » est ce qui empêche de prendre
 * pour un texte un objet de configuration qui aurait un champ `en`.
 */
function isLocalizedBlock(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false;
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length === 0) return false;
  if (!keys.every((key) => LOCALE_KEYS.includes(key) || FLAGS.includes(key)))
    return false;
  return typeof (value as Record<string, unknown>).en === 'string';
}

/**
 * Une copie de la donnée où chaque bloc localisé ne garde que l'anglais (et ses drapeaux).
 *
 * C'est ce que le navigateur reçoit. Le reste du JSON — nombres, identifiants, sources — est
 * copié tel quel : ce module ne décide rien d'autre que la langue.
 */
export function stripToEnglish<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripToEnglish) as unknown as T;
  if (isLocalizedBlock(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value))
      if (key === 'en' || FLAGS.includes(key)) out[key] = entry;
    return out as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>))
      out[key] = stripToEnglish(entry);
    return out as unknown as T;
  }
  return value;
}

/** Les traductions d'une langue, indexées par la chaîne anglaise. */
export function collectTranslations(
  value: unknown,
  locale: DerivedTextLocale,
  into: Record<string, string> = {}
): Record<string, string> {
  if (Array.isArray(value)) {
    for (const item of value) collectTranslations(item, locale, into);
    return into;
  }
  if (isLocalizedBlock(value)) {
    const english = value.en as string;
    const translation = value[locale];
    if (typeof translation === 'string') {
      const key = textKey(english);
      const existing = into[key];
      // Deux anglais différents sous la même empreinte, avec des traductions différentes :
      // impossible à trancher au runtime, donc refusé ici, en nommant les deux.
      if (existing !== undefined && existing !== translation)
        throw new Error(
          `collision d'empreinte de texte (${key}) : « ${existing} » et « ${translation} »`
        );
      into[key] = translation;
    }
    return into;
  }
  if (value !== null && typeof value === 'object')
    for (const entry of Object.values(value as Record<string, unknown>))
      collectTranslations(entry, locale, into);
  return into;
}

/**
 * Repose une langue sur une donnée allégée, EN PLACE, et rend le nombre de blocs complétés.
 *
 * En place, et non par copie : le catalogue est déjà construit et référencé par toute
 * l'application quand la langue arrive. Une copie obligerait chaque module à relire sa
 * référence, c'est-à-dire à changer partout pour un besoin qui n'appartient qu'ici.
 *
 * Un anglais absent de la carte laisse le bloc tel quel : l'affichage retombe alors sur
 * l'anglais, ce qui est visible, plutôt que sur une chaîne vide, qui ne le serait pas.
 */
export function hydrateLocalized(
  value: unknown,
  map: Readonly<Record<string, string>>,
  locale: DerivedTextLocale
): number {
  if (value instanceof Map) {
    let count = 0;
    for (const entry of value.values())
      count += hydrateLocalized(entry, map, locale);
    return count;
  }
  if (Array.isArray(value)) {
    let count = 0;
    for (const item of value) count += hydrateLocalized(item, map, locale);
    return count;
  }
  if (isLocalizedBlock(value)) {
    const translation = map[textKey(value.en as string)];
    if (typeof translation !== 'string') return 0;
    (value as Record<string, unknown>)[locale] = translation;
    return 1;
  }
  if (value !== null && typeof value === 'object') {
    let count = 0;
    for (const entry of Object.values(value as Record<string, unknown>))
      count += hydrateLocalized(entry, map, locale);
    return count;
  }
  return 0;
}

/** Toutes les chaînes anglaises localisées d'une donnée : ce qu'une carte doit couvrir. */
export function englishStrings(
  value: unknown,
  into: Set<string> = new Set()
): Set<string> {
  if (value instanceof Map) {
    for (const entry of value.values()) englishStrings(entry, into);
    return into;
  }
  if (Array.isArray(value)) {
    for (const item of value) englishStrings(item, into);
    return into;
  }
  if (isLocalizedBlock(value)) {
    into.add(value.en as string);
    return into;
  }
  if (value !== null && typeof value === 'object')
    for (const entry of Object.values(value as Record<string, unknown>))
      englishStrings(entry, into);
  return into;
}
