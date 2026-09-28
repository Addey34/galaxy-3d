/**
 * Cœur de l'internationalisation — état de langue, chargement du dictionnaire, traduction.
 *
 * Détection au démarrage : préférence persistée (`localStorage`) sinon langues du navigateur,
 * repli anglais (`negotiateLocale`, pur et testé). `setLocale` charge la langue demandée, la
 * persiste, met à jour `<html lang>` et notifie les observateurs (chaque module UI se réabonne
 * pour se retraduire à chaud). Aucune dépendance externe.
 *
 * DEPUIS LE LOT 20, LE DICTIONNAIRE ACTIF ARRIVE PAR LE RÉSEAU (sauf l'anglais, cf. `./locales`),
 * ce qui rend `initLocale` et `setLocale` asynchrones. Deux conséquences à ne pas contourner :
 *
 *   - `MainSolarSystemApp` attend `initLocale()` AVANT toute autre instruction. Le premier texte
 *     que voit un visiteur est celui du chargeur : s'il s'affichait avant l'arrivée du
 *     dictionnaire, il serait anglais chez un hispanophone, et rien ne le dirait ensuite (le
 *     chargeur ne se retraduit pas, il disparaît). C'est ce que garde
 *     `e2e/i18n-locales.spec.ts`, en démarrant l'application avec `es` déjà persisté ;
 *   - si le dictionnaire N'ARRIVE PAS (réseau coupé au mauvais instant), la langue RETOMBE à
 *     l'anglais, `getLocale()` le dit et `<html lang>` le dit aussi. Afficher de l'anglais sous
 *     `lang="es"` serait une affirmation fausse sur le contenu de la page, y compris pour un
 *     lecteur d'écran, qui prononcerait de l'anglais avec une voix espagnole.
 */
import {
  en,
  isLocale,
  loadDictionary,
  negotiateLocale,
  HTML_LANG,
  INTL_LOCALE,
  type Dict,
  type Locale,
} from './locales';
import { STORAGE_KEYS } from '@/config/storageKeys';

export type { Locale } from './locales';
export {
  LOCALES,
  LOCALE_ENDONYM,
  LOCALE_SHORT,
  LOCALE_PATH,
  HTML_LANG,
  INTL_LOCALE,
  isLocale,
  negotiateLocale,
} from './locales';

const STORAGE_KEY = STORAGE_KEYS.locale;

function detect(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // localStorage indisponible (mode privé strict) — on retombe sur le navigateur.
  }
  // `languages` porte la liste ORDONNÉE des préférences ; `language` n'en porte qu'une.
  return negotiateLocale(navigator.languages ?? navigator.language);
}

/**
 * Ce qu'il faut charger EN MÊME TEMPS que le dictionnaire, sans que ce module sache quoi.
 *
 * Le texte du catalogue (descriptions, noms, crédits) est lui aussi chargé à la demande depuis le
 * lot 20, mais il appartient à `config/`, pas à `i18n/` : laisser ce module l'importer ferait
 * dépendre le cœur de l'internationalisation du registre entier. `MainSolarSystemApp` enregistre
 * donc la préparation, et elle est attendue avant que la langue soit APPLIQUÉE — sinon
 * l'interface se retraduirait avant son contenu, et on verrait une fiche espagnole avec une
 * description anglaise pendant un aller-retour réseau.
 */
type LocalePreparation = (locale: Locale) => Promise<void>;
const preparations = new Set<LocalePreparation>();

export function onLocaleLoading(prepare: LocalePreparation): () => void {
  preparations.add(prepare);
  return () => preparations.delete(prepare);
}

async function prepare(locale: Locale): Promise<void> {
  await Promise.all([...preparations].map((run) => run(locale)));
}

let current: Locale = detect();
/** Dictionnaire actif. L'anglais est déjà là ; une autre langue le remplace quand elle arrive. */
let active: Dict = en;
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return current;
}

/**
 * Charge le dictionnaire de la langue détectée. À appeler UNE fois, avant le premier rendu.
 *
 * Ne notifie personne : à cet instant aucun module n'est encore câblé, et une notification
 * ferait retraduire une interface qui n'existe pas.
 */
export async function initLocale(): Promise<void> {
  if (current === 'en') return;
  try {
    // Le dictionnaire ET le texte du catalogue, en parallèle : ils ne se dépendent pas, et les
    // enchaîner ajouterait un aller-retour réseau au démarrage de toute langue non anglaise.
    const [dict] = await Promise.all([
      loadDictionary(current),
      prepare(current),
    ]);
    active = dict;
  } catch {
    // Le dictionnaire n'est pas arrivé : on le DIT plutôt que d'afficher de l'anglais sous une
    // autre étiquette de langue.
    current = 'en';
    active = en;
  }
}

/** Change la langue : charge, persiste, met à jour `<html lang>` et notifie les observateurs. */
export async function setLocale(locale: Locale): Promise<void> {
  if (locale === current || !isLocale(locale)) return;
  let dict: Dict;
  try {
    const [loaded] = await Promise.all([
      loadDictionary(locale),
      prepare(locale),
    ]);
    dict = loaded;
  } catch {
    // Échec du chargement : on ne change RIEN. Basculer la langue en gardant les anciennes
    // chaînes donnerait une interface à moitié traduite sans que rien ne le dise.
    return;
  }
  current = locale;
  active = dict;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Persistance best-effort : la session reste correcte même sans stockage.
  }
  document.documentElement.lang = HTML_LANG[locale];
  listeners.forEach((cb) => cb());
}

/** S'abonne aux changements de langue. Renvoie une fonction de désabonnement. */
export function onLocaleChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Traduit une clé dans la langue courante. Repli : anglais, puis la clé brute.
 * `vars` interpole les gabarits `{nom}` (ex. `t('subtitle.planetOrdinal', { ordinal: '3ᵉ' })`).
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const dict = active as Record<string, string | undefined>;
  const fallback = en as Record<string, string | undefined>;
  let s = dict[key] ?? fallback[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(`{${k}}`, String(v));
    }
  }
  return s;
}

/** Locale BCP 47 pour `Number.toLocaleString` / `Intl` (fr-FR, en-US, es, pt-BR). */
export function intlLocale(): string {
  return INTL_LOCALE[current];
}
