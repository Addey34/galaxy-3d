/**
 * FOURNISSEURS DE SERVICES CONTACTÉS À L'EXÉCUTION — fiches lues AU BUILD et par les tests,
 * jamais par l'application. Deux familles à ce jour : les événements terrestres (lot 8) et les
 * tuiles d'imagerie de surface (lot 9). Le fichier s'appelait `events.ts` tant qu'il n'y avait
 * qu'une famille ; il a été renommé quand la seconde est arrivée, plutôt que d'y ranger un
 * fournisseur de tuiles sous un nom qui ment.
 *
 * Pourquoi ce module existe à part de `./index.ts`, et ce n'est pas une préférence de rangement.
 * L'application importe `index.ts` (par la façade `config/factSources.ts`), donc tout ce qu'il
 * importe part dans le bundle de chaque visiteur. Mesuré : avec ces deux fiches dans `index.ts`,
 * la prose bilingue de leurs conditions se retrouvait mot pour mot dans
 * `dist/assets/SolarSystemApp-*.js`, alors que RIEN à l'exécution ne les lit — la couche ne
 * connaît de son fournisseur que son identifiant (`EarthEventLayer.providerId`), et c'est
 * `seo/sourcesPage.ts`, au build, qui publie le reste.
 *
 * `providers.test.ts` refuse qu'un module de `src/` hors `seo/` importe ce fichier.
 */
import type {
  EventSourceProvider,
  TileSourceProvider,
} from '../schema/provider';

import usgsEarthquakeCatalog from './usgs-earthquake-catalog.json';
import nasaEonet from './nasa-eonet.json';
import nasaTrek from './nasa-trek.json';

/**
 * Même raison que les deux fonctions d'assertion d'`index.ts` : un import JSON élargit
 * `"role": "event-source"` en `string`. Ce que le compilateur ne voit plus est vérifié à
 * l'exécution, fichier par fichier, par le schéma Zod (`provider.schema.test.ts`).
 */
const asEventSource = <
  T extends Omit<EventSourceProvider, 'kind' | 'role' | 'rights'> & {
    kind: string;
    role: string;
    rights?: string;
  },
>(
  record: T
): T & Pick<EventSourceProvider, 'kind' | 'role' | 'rights'> =>
  record as T & Pick<EventSourceProvider, 'kind' | 'role' | 'rights'>;

/**
 * Services d'événements terrestres interrogés depuis le navigateur, dans l'ordre publié par
 * `/sources`. Chaque `host` doit figurer dans le `connect-src` de `firebase.json`, et
 * réciproquement : `docPages.test.ts` refuse l'un sans l'autre.
 */
export const EVENT_PROVIDERS = {
  'usgs-earthquake-catalog': asEventSource(usgsEarthquakeCatalog),
  'nasa-eonet': asEventSource(nasaEonet),
};

/** Même règle pour les services de TUILES. Leur hôte doit aussi figurer dans `img-src`. */
const asTileSource = <
  T extends Omit<TileSourceProvider, 'kind' | 'role' | 'rights'> & {
    kind: string;
    role: string;
    rights?: string;
  },
>(
  record: T
): T & Pick<TileSourceProvider, 'kind' | 'role' | 'rights'> =>
  record as T & Pick<TileSourceProvider, 'kind' | 'role' | 'rights'>;

export const TILE_PROVIDERS = {
  'nasa-trek': asTileSource(nasaTrek),
};
