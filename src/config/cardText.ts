/**
 * LE TEXTE LONG DES FICHES, chargé à la PREMIÈRE ouverture d'une fiche (2026-10-04).
 *
 * Descriptions, raisons de non-publication, crédits des modèles et liens Wikipédia ne sont lus
 * que par la fiche (`ui/bodyInfo.ts`). Ils pesaient 23 896 octets d'anglais dans le bundle de
 * démarrage, plus leur traduction dans la carte de la langue active ; ils voyagent désormais dans
 * `virtual:registry-text/card-<langue>`, l'anglais compris, et ce module les repose EN PLACE sur
 * les objets du catalogue (cf. `core/registryText.ts::DEFERRED_TEXT_KEYS`).
 *
 * Les `import()` sont LITTÉRAUX, pour la même raison que `catalogueText.ts` : un spécificateur
 * calculé n'est pas analysable par Vite, qui embarquerait alors les quatre cartes.
 *
 * En test et dans les pages générées, les fiches ne sont pas allégées : l'hydratation y touche
 * zéro bloc, et `loadCardText` le dit par son retour.
 */
import { TEXT_ROOTS } from './catalogueText';
import { hydrateDeferred, type CardTextLocale } from '@/core/registryText';
import type { Locale } from '@/i18n/locales';

type CardMap = () => Promise<{ default: Record<string, string> }>;

const LOADERS: Record<CardTextLocale, CardMap> = {
  en: () => import('virtual:registry-text/card-en'),
  fr: () => import('virtual:registry-text/card-fr'),
  es: () => import('virtual:registry-text/card-es'),
  'pt-BR': () => import('virtual:registry-text/card-pt-BR'),
};

const pending = new Map<Locale, Promise<number>>();

/**
 * Repose le texte de fiche d'une langue (et l'anglais, qui reste le repli de chaque bloc).
 * Idempotent : une langue déjà demandée rend la même promesse. Un échec de réseau n'est PAS
 * retenu : la promesse est oubliée, pour que la prochaine ouverture de fiche réessaie, comme le
 * fait le morceau des blocs de fiche.
 */
export function loadCardText(locale: Locale): Promise<number> {
  const known = pending.get(locale);
  if (known) return known;
  const run = (async () => {
    const english = (await LOADERS.en()).default;
    const translation =
      locale === 'en' ? null : (await LOADERS[locale]()).default;
    let count = 0;
    for (const root of TEXT_ROOTS)
      count += hydrateDeferred(root, english, translation, locale);
    return count;
  })();
  pending.set(locale, run);
  run.catch(() => pending.delete(locale));
  return run;
}
