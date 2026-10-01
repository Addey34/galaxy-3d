/**
 * Les sources des blocs de fiche, telles que `/sources` les publie (ligne 44.1).
 *
 * Cinq blocs de la fiche d'un corps lisent chacun un index livré dans `src/config/` : les noms de
 * la surface (gazetteer de l'UAI, lot 37), les missions (registre de contexte du PDS, lot 40), les
 * instruments d'une sonde (le même registre, lot 42), les formations observées (Orbital Data
 * Explorer, lot 43) et la découverte (trois sources primaires et deux qui les requalifient,
 * lot 44). Chaque bloc cite sa source SUR la fiche ; la page publique des sources n'en disait rien.
 *
 * Rien n'est recopié : l'éditeur, le titre, l'adresse, la date et les comptes sont LUS dans
 * chaque index, qui porte déjà sa provenance, et le nom de chaque bloc est lu dans les
 * dictionnaires, c'est-à-dire tel que la fiche l'affiche. La table `CARD_BLOCK_INDEXES` est
 * indexée par NOM DE FICHIER : une garde (`cardBlockSources.test.ts`) exige qu'elle couvre
 * exactement les `*Index.json` livrés, donc un sixième index rougit tant qu'il n'est pas ici.
 *
 * Module PUR, réservé au build (`src/seo/`) : il importe les quatre dictionnaires ensemble.
 */
import gazetteerIndex from '@/config/gazetteerIndex.json';
import missionIndex from '@/config/missionIndex.json';
import instrumentIndex from '@/config/instrumentIndex.json';
import placeObservationIndex from '@/config/placeObservationIndex.json';
import discoveryIndex from '@/config/discoveryIndex.json';
import { messages } from '@/i18n/allDictionaries';
import type { MessageKey } from '@/i18n/locales';
import type { DocLocale } from './documentPage';

/** Une ligne du tableau : une source, ce qui la lit, ce qu'elle couvre, à quelle date. */
export interface CardBlockSourceRow {
  /** Fichier d'index d'où la ligne est lue. */
  index: string;
  publisher: string;
  title: string;
  url: string;
  /** Les libellés de l'application qui affichent ce qu'elle fournit. */
  usedBy: readonly MessageKey[];
  /** Ce qu'elle couvre, compté dans l'index, rédigé dans la langue de la page. */
  coverage: (locale: DocLocale) => string;
  /** Date (ou plage de dates) des données, lue dans l'index. */
  asOf: string;
  /** Licence, seulement quand l'index la DÉCLARE avec l'endroit où la source l'écrit. */
  rights?: { id: string; statedAt: string };
}

const count = (n: number, locale: DocLocale): string =>
  new Intl.NumberFormat(locale).format(n);

const sum = <T>(items: readonly T[], value: (item: T) => number): number =>
  items.reduce((total, item) => total + value(item), 0);

/** `min` seule si toutes les dates sont égales, sinon `min → max`. */
function dateSpan(dates: readonly string[]): string {
  if (dates.length === 0) throw new Error('aucune date de lecture');
  const sorted = [...dates].sort();
  const [first, last] = [sorted[0], sorted[sorted.length - 1]];
  return first === last ? first : `${first} → ${last}`;
}

function gazetteerRows(): CardBlockSourceRow[] {
  const { provider } = gazetteerIndex;
  const bodies = Object.values(gazetteerIndex.bodies);
  const names = sum(bodies, (b) => b.count);
  return [
    {
      index: 'gazetteerIndex.json',
      publisher: provider.publisher,
      title: provider.title,
      url: provider.url,
      usedBy: ['settings.gazetteer', 'bi.places.label'],
      coverage: (locale) =>
        ({
          en: `${count(names, locale)} names on ${count(bodies.length, locale)} bodies`,
          fr: `${count(names, locale)} noms sur ${count(bodies.length, locale)} corps`,
          es: `${count(names, locale)} nombres en ${count(bodies.length, locale)} cuerpos`,
          'pt-BR': `${count(names, locale)} nomes em ${count(bodies.length, locale)} corpos`,
        })[locale],
      asOf: provider.accessed,
      rights: { id: provider.rights, statedAt: provider.rightsStatedAt },
    },
  ];
}

function missionRows(): CardBlockSourceRow[] {
  const { provider } = missionIndex;
  const bodies = Object.values(missionIndex.bodies);
  const covered = bodies.filter((b) => b.count > 0).length;
  const missions = missionIndex.missions;
  return [
    {
      index: 'missionIndex.json',
      publisher: provider.publisher,
      title: provider.title,
      url: provider.url,
      usedBy: ['bi.missions.label'],
      coverage: (locale) =>
        ({
          en: `${count(missions, locale)} missions; at least one for ${count(covered, locale)} of ${count(bodies.length, locale)} bodies`,
          fr: `${count(missions, locale)} missions ; au moins une pour ${count(covered, locale)} corps sur ${count(bodies.length, locale)}`,
          es: `${count(missions, locale)} misiones; al menos una para ${count(covered, locale)} de ${count(bodies.length, locale)} cuerpos`,
          'pt-BR': `${count(missions, locale)} missões; ao menos uma para ${count(covered, locale)} de ${count(bodies.length, locale)} corpos`,
        })[locale],
      asOf: missionIndex.retrieved,
    },
  ];
}

function instrumentRows(): CardBlockSourceRow[] {
  const { provider } = instrumentIndex;
  const joined = Object.values(instrumentIndex.spacecraft);
  const absent = Object.keys(instrumentIndex.absent).length;
  const instruments = sum(joined, (s) => s.instruments);
  return [
    {
      index: 'instrumentIndex.json',
      publisher: provider.publisher,
      title: provider.title,
      url: provider.url,
      usedBy: ['bi.instruments.label'],
      coverage: (locale) =>
        ({
          en: `${count(instruments, locale)} instruments on ${count(joined.length, locale)} spacecraft; ${count(absent, locale)} spacecraft not in the registry, and their card says so`,
          fr: `${count(instruments, locale)} instruments sur ${count(joined.length, locale)} sondes ; ${count(absent, locale)} sondes absentes du registre, et leur fiche le dit`,
          es: `${count(instruments, locale)} instrumentos en ${count(joined.length, locale)} sondas; ${count(absent, locale)} sondas ausentes del registro, y su ficha lo dice`,
          'pt-BR': `${count(instruments, locale)} instrumentos em ${count(joined.length, locale)} sondas; ${count(absent, locale)} sondas ausentes do registro, e a ficha delas o diz`,
        })[locale],
      asOf: instrumentIndex.retrieved,
    },
  ];
}

function placeObservationRows(): CardBlockSourceRow[] {
  const { provider } = placeObservationIndex;
  if (!placeObservationIndex.complete)
    throw new Error(
      'placeObservationIndex.json : index partiel, non publiable'
    );
  const bodies = Object.values(placeObservationIndex.bodies);
  const formations = sum(bodies, (b) => b.observed);
  const footprints = sum(bodies, (b) => b.products);
  return [
    {
      index: 'placeObservationIndex.json',
      publisher: provider.publisher,
      title: provider.title,
      url: provider.url,
      usedBy: ['bi.places.label'],
      coverage: (locale) =>
        ({
          en: `${count(formations, locale)} named formations on ${count(bodies.length, locale)} bodies, crossed with ${count(footprints, locale)} instrument footprints`,
          fr: `${count(formations, locale)} formations nommées sur ${count(bodies.length, locale)} corps, croisées avec ${count(footprints, locale)} empreintes d’instruments`,
          es: `${count(formations, locale)} formaciones con nombre en ${count(bodies.length, locale)} cuerpos, cruzadas con ${count(footprints, locale)} huellas de instrumentos`,
          'pt-BR': `${count(formations, locale)} formações nomeadas em ${count(bodies.length, locale)} corpos, cruzadas com ${count(footprints, locale)} pegadas de instrumentos`,
        })[locale],
      // Un gel, pas une lecture : les produits créés jusqu'à la fin de ce jour.
      asOf: placeObservationIndex.frozenAt,
    },
  ];
}

type DiscoverySourceId = keyof typeof discoveryIndex.sources;

function discoveryRows(): CardBlockSourceRow[] {
  const bodiesBySource = new Map<string, Set<string>>();
  const datesBySource = new Map<string, string[]>();
  const note = (source: string, date: string, body?: string): void => {
    datesBySource.set(source, [...(datesBySource.get(source) ?? []), date]);
    if (body)
      bodiesBySource.set(
        source,
        (bodiesBySource.get(source) ?? new Set()).add(body)
      );
  };
  const nasaScience = discoveryIndex.sources['nasa-science'].url;
  for (const [body, entry] of Object.entries(discoveryIndex.bodies)) {
    if (!('claims' in entry)) continue;
    for (const claim of entry.claims) {
      note(claim.source, claim.retrieved, body);
      // Une source qui REQUALIFIE une affirmation (Halley) est lue elle aussi, à sa date.
      if (
        'roleUrl' in claim &&
        claim.roleUrl === nasaScience &&
        'roleRetrieved' in claim
      )
        note('nasa-science', claim.roleRetrieved as string, body);
    }
  }
  // Chaque liste de satellites DÉCLARE sa source (la table du JPL, ou SBDB pour un petit corps
  // qu'elle n'a pas en section, ligne 22.10 pas 2) : la ligne de cette source la compte.
  const systemsBySource = new Map<string, { total: number }[]>();
  for (const system of Object.values(discoveryIndex.systems)) {
    note(system.source, system.retrieved);
    systemsBySource.set(system.source, [
      ...(systemsBySource.get(system.source) ?? []),
      system,
    ]);
  }

  return (Object.keys(discoveryIndex.sources) as DiscoverySourceId[]).map(
    (id) => {
      const source = discoveryIndex.sources[id];
      const bodies = bodiesBySource.get(id)?.size ?? 0;
      if (bodies === 0)
        throw new Error(
          `discoveryIndex.json : la source « ${id} » n'est citée par aucun corps`
        );
      const cards = (locale: DocLocale): string =>
        ({
          en: `${count(bodies, locale)} ${bodies === 1 ? 'card' : 'cards'}`,
          fr: `${count(bodies, locale)} fiche${bodies === 1 ? '' : 's'}`,
          es: `${count(bodies, locale)} ficha${bodies === 1 ? '' : 's'}`,
          'pt-BR': `${count(bodies, locale)} ficha${bodies === 1 ? '' : 's'}`,
        })[locale];
      const systems = systemsBySource.get(id) ?? [];
      const satellites = sum(systems, (s) => s.total);
      return {
        index: 'discoveryIndex.json',
        publisher: source.publisher,
        title: source.title,
        url: source.url,
        usedBy: ['bi.discovery.label'],
        coverage:
          systems.length > 0
            ? (locale) =>
                ({
                  en: `${cards(locale)}, and ${count(satellites, locale)} satellites of ${count(systems.length, locale)} systems for the moons already seen at a date`,
                  fr: `${cards(locale)}, et ${count(satellites, locale)} satellites de ${count(systems.length, locale)} systèmes pour les lunes déjà vues à une date`,
                  es: `${cards(locale)}, y ${count(satellites, locale)} satélites de ${count(systems.length, locale)} sistemas para las lunas ya vistas en una fecha`,
                  'pt-BR': `${cards(locale)}, e ${count(satellites, locale)} satélites de ${count(systems.length, locale)} sistemas para as luas já vistas numa data`,
                })[locale]
            : cards,
        asOf: dateSpan(datesBySource.get(id) ?? []),
      };
    }
  );
}

/** Une entrée par index livré, par nom de fichier. */
export const CARD_BLOCK_INDEXES: Record<string, () => CardBlockSourceRow[]> = {
  'gazetteerIndex.json': gazetteerRows,
  'missionIndex.json': missionRows,
  'instrumentIndex.json': instrumentRows,
  'placeObservationIndex.json': placeObservationRows,
  'discoveryIndex.json': discoveryRows,
};

export function cardBlockSourceRows(): CardBlockSourceRow[] {
  return Object.values(CARD_BLOCK_INDEXES).flatMap((rows) => rows());
}

/** Le libellé d'un bloc, tel que la fiche l'affiche dans cette langue. */
export function blockLabel(key: MessageKey, locale: DocLocale): string {
  return messages[locale][key];
}
