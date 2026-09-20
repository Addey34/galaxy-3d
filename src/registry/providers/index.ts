/**
 * REGISTRE DES FOURNISSEURS : qui publie ce que Galaxy affiche, et qui place les corps.
 *
 * Une fiche par fournisseur, en JSON (`src/registry/providers/*.json`), validée par le schéma
 * Zod de `../schema/provider.ts` — en `devDependency`, jamais livrée : ce module n'en prend que
 * le TYPE, par `import type`, qui s'efface à la compilation.
 *
 * Ce module ABSORBE deux tables qui vivaient ailleurs, sans qu'aucun de leurs lecteurs change :
 *   - les 18 entrées de `config/factSources.ts`, qui continue d'exporter `FACT_SOURCES`,
 *     `FACT_SOURCE_HOSTS` et `factSource()` en les DÉRIVANT d'ici ;
 *   - `SUMMARY_PROVIDER` de `core/positionProvenance.ts`, devenue le champ
 *     `validationProviderId` de la fiche de chaque source de position.
 *
 * **L'ORDRE EST UNE DONNÉE.** `seo/sourcesPage.ts` parcourt `Object.entries(FACT_SOURCES)` pour
 * écrire le tableau des sources primaires de `/sources` : changer l'ordre ici change deux pages
 * publiées. Un fichier par fiche ne porte aucun ordre, il est donc déclaré explicitement dans le
 * littéral ci-dessous, et `providers.test.ts` vérifie qu'aucune fiche n'y manque.
 *
 * **Les fiches d'ÉVÉNEMENTS TERRESTRES vivent à part**, dans `./events.ts`, et ce module ne les
 * réexporte pas : l'application importe celui-ci, et tout ce qu'il importe part dans le bundle
 * de chaque visiteur. Rien à l'exécution ne lit ces deux fiches — une couche ne connaît que
 * l'identifiant de son fournisseur — et leur prose bilingue s'y retrouvait mot pour mot.
 *
 * **Pourquoi un littéral plutôt qu'une boucle sur un glob.** Chaque import JSON garde le type
 * exact de son contenu (`journal` est présent ou absent, jamais « optionnel »), celui-là même que
 * `seo/sourcesPage.ts` teste par `'journal' in source`. Une projection générique le remplacerait
 * par un type large, et la page changerait.
 */
import type {
  FactSourceProvider,
  PositionSourceProvider,
} from '../schema/provider';

import nssdcaFactSheets from './nssdca-fact-sheets.json';
import jplSsdSatellitePhysicalParameters from './jpl-ssd-satellite-physical-parameters.json';
import jplSsdSatelliteMeanElements from './jpl-ssd-satellite-mean-elements.json';
import jplSbdb from './jpl-sbdb.json';
import jplHorizons from './jpl-horizons.json';
import nasaScienceJupiterMoons from './nasa-science-jupiter-moons.json';
import nasaScienceSaturnMoons from './nasa-science-saturn-moons.json';
import nasaScienceUranusMoons from './nasa-science-uranus-moons.json';
import nasaScienceNeptuneMoons from './nasa-science-neptune-moons.json';
import nasaScienceMarsMoons from './nasa-science-mars-moons.json';
import sicardy2011Eris from './sicardy-2011-eris.json';
import szakats2023Eris from './szakats-2023-eris.json';
import ragozzineBrown2009Haumea from './ragozzine-brown-2009-haumea.json';
import brown2013Makemake from './brown-2013-makemake.json';
import kiss2019Gonggong from './kiss-2019-gonggong.json';
import margoti2026Quaoar from './margoti-2026-quaoar.json';
import pal2012Sedna from './pal-2012-sedna.json';
import kiss2016Nereid from './kiss-2016-nereid.json';

import horizonsBinary from './horizons-binary.json';
import spkKernel from './spk.json';
import astronomyEngine from './astronomy-engine.json';
import keplerElements from './kepler.json';

/**
 * TypeScript ÉLARGIT les chaînes d'un module JSON : `"role": "fact-source"` arrive typé `string`,
 * jamais `'fact-source'`. Ces deux fonctions rendent les littéraux attendus, et rien d'autre :
 * la contrainte générique vérifie à la compilation tout le reste de la forme, et ce que le
 * compilateur ne peut plus voir — que la chaîne est bien l'une des valeurs permises — est
 * vérifié à l'exécution, sur CHAQUE fichier, par le schéma Zod (`provider.schema.test.ts`).
 */
const asFactSource = <
  T extends Omit<FactSourceProvider, 'kind' | 'role'> & {
    kind: string;
    role: string;
  },
>(
  record: T
): T & Pick<FactSourceProvider, 'kind' | 'role'> =>
  record as T & Pick<FactSourceProvider, 'kind' | 'role'>;

const asPositionSource = <
  T extends Omit<PositionSourceProvider, 'kind' | 'role' | 'positionSource'> & {
    kind: string;
    role: string;
    positionSource: string;
  },
>(
  record: T
): T & Pick<PositionSourceProvider, 'kind' | 'role' | 'positionSource'> =>
  record as T &
    Pick<PositionSourceProvider, 'kind' | 'role' | 'positionSource'>;

/**
 * Sources primaires des FAITS affichés, dans l'ordre publié par `/sources`. La clé est
 * l'identifiant cité par le catalogue (`realData.sources[champ].source`).
 */
export const FACT_SOURCE_PROVIDERS = {
  'nssdca-fact-sheets': asFactSource(nssdcaFactSheets),
  'jpl-ssd-satellite-physical-parameters': asFactSource(
    jplSsdSatellitePhysicalParameters
  ),
  'jpl-ssd-satellite-mean-elements': asFactSource(jplSsdSatelliteMeanElements),
  'jpl-sbdb': asFactSource(jplSbdb),
  'jpl-horizons': asFactSource(jplHorizons),
  'nasa-science-jupiter-moons': asFactSource(nasaScienceJupiterMoons),
  'nasa-science-saturn-moons': asFactSource(nasaScienceSaturnMoons),
  'nasa-science-uranus-moons': asFactSource(nasaScienceUranusMoons),
  'nasa-science-neptune-moons': asFactSource(nasaScienceNeptuneMoons),
  'nasa-science-mars-moons': asFactSource(nasaScienceMarsMoons),
  'sicardy-2011-eris': asFactSource(sicardy2011Eris),
  'szakats-2023-eris': asFactSource(szakats2023Eris),
  'ragozzine-brown-2009-haumea': asFactSource(ragozzineBrown2009Haumea),
  'brown-2013-makemake': asFactSource(brown2013Makemake),
  'kiss-2019-gonggong': asFactSource(kiss2019Gonggong),
  'margoti-2026-quaoar': asFactSource(margoti2026Quaoar),
  'pal-2012-sedna': asFactSource(pal2012Sedna),
  'kiss-2016-nereid': asFactSource(kiss2016Nereid),
};

/**
 * Sources qui PLACENT un corps à une date, indexées par la clé que renvoie
 * `BodyPositionResolver.resolveSource` (`PositionSource`). `providers.test.ts` refuse une clé qui
 * ne serait pas le `positionSource` de la fiche.
 */
export const POSITION_PROVIDERS = {
  horizons: asPositionSource(horizonsBinary),
  spk: asPositionSource(spkKernel),
  'astronomy-engine': asPositionSource(astronomyEngine),
  kepler: asPositionSource(keplerElements),
};

/** Toutes les fiches, pour les tests et la validation de schéma. */
export const ALL_PROVIDERS: readonly (
  FactSourceProvider | PositionSourceProvider
)[] = [
  ...Object.values(FACT_SOURCE_PROVIDERS),
  ...Object.values(POSITION_PROVIDERS),
];

/**
 * « Cette source répond-elle à n'importe quelle date ? » lue dans la fiche plutôt qu'écrite en
 * dur : au sens STAC, des bornes nulles des deux côtés veulent dire « pas de borne », et c'est
 * exactement la propriété dont `core/positionProvenance.ts` a besoin pour décider qu'une position
 * hors fenêtre mesurée est extrapolée.
 *
 * Une fiche SANS `extent` n'est pas illimitée : elle ne déclare rien à ce niveau (un noyau SPK
 * porte la couverture de chaque segment dans ses propres données).
 */
export function answersAnyDate(provider: {
  // `id` n'est pas décoratif : sans une propriété requise, TypeScript traiterait le paramètre
  // comme un « type faible » et refuserait la fiche du SPK, qui ne porte justement pas d'extent.
  id: string;
  extent?: PositionSourceProvider['extent'];
}): boolean {
  const interval = provider.extent?.temporal.interval;
  if (!interval) return false;
  return interval.some(([from, to]) => from === null && to === null);
}
