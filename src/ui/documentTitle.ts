/**
 * TITRE DE L'ONGLET — il doit dire la même chose que l'adresse.
 *
 * Chaque corps a sa page indexable, avec son propre `<title>` : `/jupiter/` sert « Jupiter in
 * 3D — live position and orbit ». Depuis que le chemin suit la sélection (`core/permalink`,
 * `pathnameForBody`), l'adresse change sans rechargement — mais le document, lui, garde le
 * titre de la page par laquelle on est entré. Arriver par `/` puis regarder Jupiter donnait
 * donc une URL `/jupiter/` sous un onglet qui annonçait encore l'accueil, et un signet
 * enregistré à cet instant portait le mauvais nom.
 *
 * Ce défaut est né AVEC l'écriture du chemin : avant, le chemin ne bougeait jamais, donc rien
 * ne divergeait. C'est la contrepartie qu'il fallait payer.
 *
 * Le titre est LOCALISÉ, alors que la page statique sert un titre anglais (choix de
 * référencement, assumé là-bas). Les deux ne peuvent pas coïncider pour un visiteur
 * francophone, et c'est l'interface qui doit gagner : le titre anglais reste servi au
 * robot, qui ne parcourt jamais l'application. Au rechargement, le titre statique s'affiche
 * une fraction de seconde puis cette fonction le remplace par sa version localisée — la
 * version anglaise reprend d'ailleurs mot pour mot celle du référencement.
 */
import { onLocaleChange, t } from '@/i18n';
import { bodyDisplayName } from '@/i18n/bodyText';

export interface DocumentTitle {
  /** `null` ou `'overview'` = vue d'ensemble. */
  setBody(name: string | null): void;
}

export function setupDocumentTitle(): DocumentTitle {
  let current: string | null = null;

  const apply = (): void => {
    document.title =
      current === null || current === 'overview'
        ? t('title.overview')
        : t('title.body', { name: bodyDisplayName(current) });
  };

  // Le titre doit suivre un changement de langue même sans nouvelle sélection.
  onLocaleChange(apply);

  return {
    setBody: (name) => {
      current = name;
      apply();
    },
  };
}
