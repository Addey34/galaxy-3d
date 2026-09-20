/**
 * FOURNISSEURS D'ÉVÉNEMENTS TERRESTRES — fiches lues AU BUILD et par les tests, jamais par
 * l'application.
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
import type { EventSourceProvider } from '../schema/provider';

import usgsEarthquakeCatalog from './usgs-earthquake-catalog.json';
import nasaEonet from './nasa-eonet.json';

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
