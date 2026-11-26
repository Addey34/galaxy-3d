/**
 * LE BLOC « POURSUIVRE L'OBSERVATION » DE LA FICHE (GAL-OBSERVATION-001). Dans le morceau des blocs de fiche :
 * il n'agit pas avant qu'une fiche existe.
 *
 * Depuis le corps ou la sonde montrés, les expériences de Galaxy qui le concernent RÉELLEMENT : visites qui le
 * rejoignent, sondes qui l'ont survolé ou orbité (à la date mesurée), inspection 3D d'un engin, prochain
 * événement, satellites de la Terre, voisinage solaire depuis le Soleil. Les relations sont DÉRIVÉES
 * (`core/observationLinks`) ; chaque action passe par une commande qui existe déjà (sélection partagée, lecteur
 * de visites, inspection, couches), jamais par un chemin à elle.
 *
 * Le RETOUR : une action qui change la date ou le corps garde ce qu'on regardait (corps, date, mode) et propose
 * d'y revenir. Choisir un autre corps ajoute de plus une entrée d'historique (le permalien), donc le bouton
 * Retour du navigateur ramène aussi au corps d'avant.
 */
import './observationBlock.css';
import tourCatalogue from 'virtual:tour-catalogue';

import {
  eventFocusBody,
  findUpcomingAstronomicalEvents,
} from '@/core/astronomicalEvents';
import { formatIsoDay } from '@/core/dateText';
import {
  bodyLinks,
  probeLinks,
  type ObservationData,
  type ObservationLink,
} from '@/core/observationLinks';
import { craftModelById, CRAFT_MODELS } from '@/config/craftModels';
import { SPACECRAFT_MISSIONS } from '@/config/spacecraft';
import { getLocale, intlLocale, onLocaleChange, t } from '@/i18n';
import { bodyDisplayName } from '@/i18n/bodyText';
import type { PublicAPI } from '@/SolarSystemApp';
import type { BodyInfoPanel } from './bodyInfo';
import type { CraftOpener } from './craftAccess';
import { eventLabel } from './eventLabel';
import type { ObservationActions } from './observationAccess';
import { loadSearchIndex } from './searchIndexLoader';

const MS_PER_DAY = 86_400_000;
const PROBES: ReadonlySet<string> = new Set(
  SPACECRAFT_MISSIONS.map((m) => m.name)
);
const PHASES = Object.fromEntries(
  SPACECRAFT_MISSIONS.map((m) => [m.name, m.satelliteOf])
);
const CRAFT = CRAFT_MODELS.map((m) => ({ id: m.id, targets: m.targets }));

const day = (iso: string): string =>
  formatIsoDay(iso.slice(0, 10), getLocale(), intlLocale());

interface Snapshot {
  body: string;
  atMs: number;
  mode: 'educ' | 'explo';
}

export function setupObservationBlock(
  api: PublicAPI,
  bodyInfo: BodyInfoPanel,
  openCraft: CraftOpener,
  actions: ObservationActions
): void {
  const panel = document.getElementById('body-info');
  const anchor = panel?.querySelector('.bi-missions');
  if (!panel || !anchor) return;
  const om = api.orbitalMechanics;

  const box = document.createElement('details');
  box.className = 'bi-observe';
  box.open = true;
  box.hidden = true;
  const summary = document.createElement('summary');
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'bi-observe-back';
  back.id = 'observe-back';
  back.hidden = true;
  const list = document.createElement('ul');
  list.className = 'bi-observe-list';
  const note = document.createElement('p');
  note.className = 'bi-observe-note';
  box.append(summary, back, list, note);
  anchor.before(box);

  let index: Awaited<ReturnType<typeof loadSearchIndex>> = null;
  let shown: string | null = null;
  let snapshot: Snapshot | null = null;

  const data = (body: string): ObservationData => ({
    index,
    tours: tourCatalogue,
    craft: CRAFT,
    phases: PHASES,
    nextEvent: nextEventFor(body),
  });

  /** Le prochain événement recadré sur ce corps, dans la fenêtre que le panneau des événements calcule. */
  const nextEventFor = (body: string): { at: string; kind: string } | null => {
    if (PROBES.has(body)) return null;
    const event = findUpcomingAstronomicalEvents(om.simulationDate, {
      count: 40,
    }).find((e) => eventFocusBody(e) === body);
    if (!event) return null;
    lastEvent = event;
    return { at: event.date.toISOString(), kind: event.kind };
  };
  let lastEvent:
    ReturnType<typeof findUpcomingAstronomicalEvents>[number] | null = null;

  /** Garde ce qu'on regardait, puis amène la scène à `atIso` (s'il y en a un). */
  const leave = (atIso: string | null): void => {
    if (shown)
      snapshot = {
        body: shown,
        atMs: om.simulationDate.getTime(),
        mode: actions.getMode(),
      };
    if (atIso)
      om.addTimeOffset(
        (Date.parse(atIso) - om.simulationDate.getTime()) / MS_PER_DAY
      );
  };

  const button = (
    text: string,
    run: () => void,
    kind: string
  ): HTMLLIElement => {
    const item = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bi-observe-action';
    b.dataset['kind'] = kind;
    b.textContent = text;
    b.addEventListener('click', run);
    item.append(b);
    return item;
  };

  const relationText = (
    link: Extract<ObservationLink, { kind: 'probe' }>
  ): string => {
    const probe = bodyDisplayName(link.probe);
    if (link.relation === 'mission')
      return link.at
        ? t('obs.missionFrom', { probe, date: day(link.at) })
        : t('obs.mission', { probe });
    return t(`obs.${link.relation}`, { probe, date: day(link.at ?? '') });
  };

  const bodyText = (
    link: Extract<ObservationLink, { kind: 'body' }>
  ): string => {
    const body = bodyDisplayName(link.body);
    const key =
      link.relation === 'orbit'
        ? 'obs.bodyOrbit'
        : link.relation === 'contact'
          ? 'obs.bodyContact'
          : link.relation === 'flyby'
            ? 'obs.bodyFlyby'
            : link.at
              ? 'obs.bodyMissionFrom'
              : 'obs.bodyMission';
    return t(key, { body, date: link.at ? day(link.at) : '' });
  };

  const items = (current: string): HTMLLIElement[] => {
    const isProbe = PROBES.has(current);
    const links = isProbe
      ? probeLinks(current, data(current))
      : bodyLinks(current, data(current));
    const out: HTMLLIElement[] = [];
    for (const link of links) {
      switch (link.kind) {
        case 'tour': {
          const entry = tourCatalogue.find((e) => e.id === link.tour);
          if (!entry) break;
          const title = entry.title[getLocale()];
          const text = link.place
            ? t('obs.tourPlace', { title, place: link.place })
            : t('obs.tour', { title });
          out.push(
            button(
              text,
              () => {
                void actions.startTour(link.tour);
              },
              'tour'
            )
          );
          break;
        }
        case 'probe':
          // La sonde à la date de la preuve, en Explo, où elle est dessinée à sa vraie place.
          out.push(
            button(
              relationText(link),
              () => {
                leave(link.at);
                actions.setMode('explo');
                actions.selectBody(link.probe);
                actions.sync();
              },
              'probe'
            )
          );
          if (link.model && craftModelById(link.model))
            out.push(
              button(
                t('obs.inspect', { probe: bodyDisplayName(link.probe) }),
                () => openCraft(link.model!, list),
                'inspect'
              )
            );
          break;
        case 'body':
          // Depuis la sonde : la scène à la date de la rencontre, la sonde gardée (le corps est à côté).
          out.push(
            button(
              bodyText(link),
              () => {
                leave(link.at);
                if (link.at) actions.setMode('explo');
                else actions.selectBody(link.body);
                actions.sync();
              },
              'body'
            )
          );
          break;
        case 'events': {
          const event = lastEvent;
          if (!event) break;
          out.push(
            button(
              t('obs.event', {
                event: eventLabel(event),
                date: day(link.nextAt),
              }),
              () => {
                leave(link.nextAt);
                actions.selectBody(eventFocusBody(event));
                actions.sync();
              },
              'event'
            )
          );
          break;
        }
        case 'satellites':
          out.push(
            button(
              t('obs.satellites'),
              () => actions.showSatellites(),
              'satellites'
            )
          );
          break;
        case 'neighbourhood':
          out.push(
            button(
              t('obs.neighbourhood'),
              () => actions.openNeighbourhood(),
              'neighbourhood'
            )
          );
          break;
      }
    }
    return out;
  };

  const renderBack = (): void => {
    back.hidden = !snapshot;
    if (snapshot)
      back.textContent = t('obs.back', {
        body: bodyDisplayName(snapshot.body),
        date: day(new Date(snapshot.atMs).toISOString()),
      });
  };

  back.addEventListener('click', () => {
    const was = snapshot;
    if (!was) return;
    snapshot = null;
    om.addTimeOffset((was.atMs - om.simulationDate.getTime()) / MS_PER_DAY);
    actions.setMode(was.mode);
    actions.selectBody(was.body);
    actions.sync();
    renderBack();
  });

  const render = (current: string | null): void => {
    shown = current;
    if (!current) {
      box.hidden = true;
      return;
    }
    summary.textContent = t('obs.label');
    const rows = items(current);
    list.replaceChildren(...rows);
    note.textContent = t('obs.note');
    renderBack();
    box.hidden = rows.length === 0 && !snapshot;
  };

  // L'index (sondes ↔ corps) arrive à part ; le bloc se rend sans lui puis se complète.
  void loadSearchIndex().then((file) => {
    index = file;
    render(shown);
  });

  let last = 0;
  api.animationSystem.onFrame(() => {
    const at = performance.now();
    if (at - last < 500) return;
    last = at;
    const current = bodyInfo.currentBody();
    if (current !== shown) render(current);
  });
  onLocaleChange(() => render(shown));
}
