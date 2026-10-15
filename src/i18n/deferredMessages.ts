/**
 * LES PHRASES DES BLOCS HORS DÉMARRAGE, chargées avec eux (lot 52, piste C, 2026-10-15).
 *
 * Les blocs de fiche (`ui/cardBlocks`), la recherche typée (`ui/paletteSearch`) et le rideau
 * avant/après (`components/surface/compareCurtain`) sont des morceaux chargés à la demande ;
 * leurs phrases voyageaient pourtant dans le dictionnaire du démarrage, en anglais et dans la
 * langue active (6 712 et 6 991 octets en français, mesurés). Elles vivent dans
 * `./dict-card-<langue>.ts`, et chaque chargeur de ces morceaux attend `loadDeferredMessages()`
 * avant de rendre : sans quoi `t()` rendrait la clé brute.
 *
 * L'anglais arrive toujours, parce qu'il est le repli de chaque phrase. Au premier chargement, ce
 * module s'inscrit aussi à `onLocaleLoading` : un changement de langue ultérieur attend alors les
 * phrases de la nouvelle langue avant de s'appliquer, comme il attend son dictionnaire.
 *
 * Les `import()` sont LITTÉRAUX, pour que Vite produise un morceau par langue au lieu de les
 * embarquer toutes.
 */
import {
  getLocale,
  installDeferredMessages,
  onLocaleLoading,
  type Locale,
} from './index';

const LOADERS: Record<Locale, () => Promise<Readonly<Record<string, string>>>> =
  {
    en: () => import('./dict-card-en').then((m) => m.cardEn),
    fr: () => import('./dict-card-fr').then((m) => m.cardFr),
    es: () => import('./dict-card-es').then((m) => m.cardEs),
    'pt-BR': () => import('./dict-card-pt-BR').then((m) => m.cardPtBR),
  };

const pending = new Map<Locale, Promise<void>>();
let subscribed = false;

function loadOne(locale: Locale): Promise<void> {
  const known = pending.get(locale);
  if (known) return known;
  const run = LOADERS[locale]().then((dict) =>
    installDeferredMessages(locale, dict)
  );
  pending.set(locale, run);
  // Un échec de réseau n'est pas retenu : le prochain chargement réessaie.
  run.catch(() => pending.delete(locale));
  return run;
}

/** Pose les phrases de l'anglais et de la langue demandée. Idempotent. */
export function loadDeferredMessages(
  locale: Locale = getLocale()
): Promise<void> {
  if (!subscribed) {
    subscribed = true;
    onLocaleLoading((next) => loadDeferredMessages(next));
  }
  return Promise.all([
    loadOne('en'),
    locale === 'en' ? Promise.resolve() : loadOne(locale),
  ]).then(() => undefined);
}
