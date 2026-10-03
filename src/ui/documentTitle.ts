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
import { getLocale, onLocaleChange, t } from '@/i18n';
import { bodyDisplayName } from '@/i18n/bodyText';
import { isNavigableTarget } from '@/config/navigable';
import {
  eclipseTitleKey,
  formatEclipseDate,
  type EclipseEvent,
} from '@/core/eclipsePages';

export interface DocumentTitle {
  /** `null` ou `'overview'` = vue d'ensemble. */
  setBody(name: string | null): void;
  /**
   * Éclipse que l'ADRESSE nomme encore (`/eclipse/2026-08-12/`), ou `null`. Tant qu'elle est
   * posée elle prime sur le corps : l'onglet doit dire la même chose que l'adresse, et sur une
   * page d'éclipse l'adresse parle de l'éclipse. Posée par `ui/permalink` après chaque écriture.
   */
  setEclipse(event: EclipseEvent | null): void;
}

export function setupDocumentTitle(): DocumentTitle {
  let current: string | null = null;
  let eclipse: EclipseEvent | null = null;

  const apply = (): void => {
    if (eclipse) {
      document.title = t(eclipseTitleKey(eclipse), {
        date: formatEclipseDate(eclipse.date, getLocale()),
      });
      return;
    }
    document.title =
      current === null || current === 'overview'
        ? t('title.overview')
        : // Une sonde ou un interstellaire a sa page depuis le 2026-10-03, dont le titre dit
          // « trajectoire » : l'onglet dit la même chose qu'elle.
          t(isNavigableTarget(current) ? 'title.instrument' : 'title.body', {
            name: bodyDisplayName(current),
          });
  };

  // Le titre doit suivre un changement de langue même sans nouvelle sélection.
  onLocaleChange(apply);

  /**
   * ET IL DOIT ÊTRE POSÉ TOUT DE SUITE. Sans cet appel, `apply` n'était déclenché que par
   * `setBody`, `setEclipse` ou un changement de langue : sur la vue d'ensemble, où aucun des
   * trois ne se produit, le titre ANGLAIS de la page statique restait en place pendant toute
   * la visite. La passe lecteur d'écran du lot 19 l'a entendu — c'est le PREMIER énoncé en
   * entrant dans le document, et une voix française y lisait une phrase anglaise (défaut D1 de
   * `docs/private/LECTEUR_ECRAN_LOT19.md`). Le défaut disparaissait dès qu'on choisissait un
   * corps, ce qui explique qu'il ait tenu si longtemps.
   */
  apply();

  return {
    setBody: (name) => {
      current = name;
      apply();
    },
    setEclipse: (event) => {
      eclipse = event;
      apply();
    },
  };
}
