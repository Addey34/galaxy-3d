/**
 * LES QUATRE DICTIONNAIRES ENSEMBLE — pour le BUILD et les TESTS, jamais pour l'application.
 *
 * Ce module importe les quatre langues STATIQUEMENT. C'est exactement ce que le démarrage doit
 * éviter (cf. `./locales`), donc il ne doit être importé que par du code qui ne part pas chez le
 * visiteur : les générateurs de `src/seo/` et les tests. `src/i18n/allDictionaries.test.ts`
 * refuse tout autre importeur, de la même façon que `src/seo/buildOnly.test.ts` refuse qu'un
 * module de l'application importe `src/seo/`.
 *
 * Pourquoi il existe : les pages générées ont besoin des quatre langues EN MÊME TEMPS (un titre
 * d'éclipse en espagnol se lit dans le dictionnaire espagnol, pas dans un état global), et
 * plusieurs tests comparent les quatre. `messages[locale][clé]` est la forme qu'ils utilisaient
 * déjà avant le lot 20 ; elle est conservée telle quelle.
 */

import { en } from './dict-en';
import { fr } from './dict-fr';
import { es } from './dict-es';
import { ptBR } from './dict-pt-BR';
import { cardEn } from './dict-card-en';
import { cardFr } from './dict-card-fr';
import { cardEs } from './dict-card-es';
import { cardPtBR } from './dict-card-pt-BR';
import type { CardDict, Dict, Locale } from './locales';

// Les deux dictionnaires de chaque langue, réunis : les pages générées et les tests lisent
// toutes les clés, celles du démarrage comme celles des blocs hors démarrage (lot 52, piste C).
export const messages: Record<Locale, Dict & CardDict> = {
  en: { ...en, ...cardEn },
  fr: { ...fr, ...cardFr },
  es: { ...es, ...cardEs },
  'pt-BR': { ...ptBR, ...cardPtBR },
};

/**
 * Une clé CALCULÉE, dans une langue donnée — `undefined` si elle n'existe pas.
 *
 * `Dict` est un `Record<MessageKey, string>`, donc il ne s'indexe pas par une chaîne
 * quelconque, et c'est voulu : c'est ce qui rend une clé absente visible à la compilation. Cet
 * accesseur existe pour le seul cas honnête où la clé n'est PAS connue du compilateur : celle
 * qu'on vient de lire dans un attribut `data-i18n` d'`index.html`.
 */
export function message(locale: Locale, key: string): string | undefined {
  return (messages[locale] as Record<string, string | undefined>)[key];
}
