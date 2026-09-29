/**
 * RÉSOUDRE UN TEXTE QUI EST SOIT LOCALISÉ SUR PLACE, SOIT UNE CLÉ DE DICTIONNAIRE.
 *
 * Deux formes, une raison chacune — le contrat vit sur `LocalizedOrKey` dans `@/types`. Ce
 * module est le SEUL endroit qui sache les distinguer, pour qu'aucun appelant ne réinvente le
 * test et n'en oublie une branche.
 */

import type { LocalizedOrKey, LocalizedText } from '@/types';
import { getLocale, t } from './index';

/** Le texte, dans la langue active. */
export function localizedOrKey(value: LocalizedOrKey): string {
  if ('message' in value) return t(value.message);
  return value[getLocale()] ?? value.en;
}

/**
 * Vrai quand le texte est écrit SUR PLACE dans les quatre langues, et non nommé par une clé.
 *
 * Exporté parce que plusieurs gardes lisent la version anglaise ou française d'une raison de
 * fiche pour vérifier qu'elle cite bien ce qu'elle prétend (une magnitude M1, une plage de
 * températures, le mot « chaotique »). Ces gardes ne perdent rien au lot 35 : elles AFFIRMENT
 * désormais, en plus, que ces raisons-là sont propres à leur fiche.
 */
export function isLocalizedText(value: LocalizedOrKey): value is LocalizedText {
  return !('message' in value);
}
