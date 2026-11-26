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
  EVENT_FOCUS_BODIES,
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
import { getAnnouncer } from './announcer';
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

  /**
   * Le prochain événement recadré sur ce corps, sur la fenêtre du panneau des événements (730 jours). Calculé
   * SEULEMENT pour un corps qu'un événement peut recadrer (`EVENT_FOCUS_BODIES`), et gardé tant qu'il reste
   * exact : si la date de la scène est dans [instant du calcul, date de l'événement[, aucun autre événement de
   * ce corps ne peut s'intercaler (il aurait été trouvé), donc la réponse ne change pas. Hors de cet intervalle
   * (date reculée, événement passé), on recalcule ; « aucun événement » se recalcule au-delà d'un jour d'écart.
   */
  const nextEventFor = (body: string): { at: string; kind: string } | null => {
    if (!EVENT_FOCUS_BODIES.has(body)) {
      eventCache = null;
      return null;
    }
    if (!eventValid(body)) {
      const fromMs = om.simulationDate.getTime();
      const started = performance.now();
      const event =
        findUpcomingAstronomicalEvents(new Date(fromMs), {
          count: Number.MAX_SAFE_INTEGER,
        }).find((e) => eventFocusBody(e) === body) ?? null;
      eventCostMs = performance.now() - started;
      eventCache = { body, fromMs, event };
    }
    const event = eventCache!.event;
    return event ? { at: event.date.toISOString(), kind: event.kind } : null;
  };
  let eventCache: {
    body: string;
    fromMs: number;
    event: ReturnType<typeof findUpcomingAstronomicalEvents>[number] | null;
  } | null = null;
  /** Durée du dernier calcul, publiée sur le bloc (`data-event-cost-ms`) pour la mesure. */
  let eventCostMs = 0;
  const eventValid = (body: string): boolean => {
    if (!eventCache || eventCache.body !== body) return false;
    const now = om.simulationDate.getTime();
    if (!eventCache.event)
      return Math.abs(now - eventCache.fromMs) < MS_PER_DAY;
    return now >= eventCache.fromMs && now < eventCache.event.date.getTime();
  };

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
    // Le retour s'offre TOUT DE SUITE, même quand seul le temps a changé (le corps, lui, n'a pas bougé et
    // ne redéclenche pas de rendu).
    renderBack();
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
          const event = eventCache?.event;
          if (!event) break;
          out.push(
            button(
              t('obs.event', {
                event: eventLabel(event),
                date: day(link.nextAt),
              }),
              () => {
                // Les garanties du panneau des événements : la lecture figée sur l'instant exact (sinon
                // l'horloge le dépasse aussitôt), la date annoncée, puis le corps observé.
                actions.pause();
                leave(event.date.toISOString());
                getAnnouncer().announce(
                  t('a11y.dateChanged', { date: day(link.nextAt) })
                );
                actions.selectBody(eventFocusBody(event));
                actions.sync();
              },
              'event'
            )
          );
          out[out.length - 1]!.querySelector('button')!.dataset['at'] =
            link.nextAt;
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

  function renderBack(): void {
    back.hidden = !snapshot;
    if (snapshot)
      back.textContent = t('obs.back', {
        body: bodyDisplayName(snapshot.body),
        date: day(new Date(snapshot.atMs).toISOString()),
      });
  }

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
    // Un nouveau rendu ne vole pas le focus : la même ligne le reprend si elle existe encore.
    const focused = [...list.querySelectorAll('button')].indexOf(
      document.activeElement as HTMLButtonElement
    );
    const rows = items(current);
    list.replaceChildren(...rows);
    const buttons = list.querySelectorAll('button');
    if (focused >= 0) buttons[Math.min(focused, buttons.length - 1)]?.focus();
    box.dataset['eventCostMs'] = String(Math.round(eventCostMs * 10) / 10);
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
    // Même corps mais date changée (curseur, horloge, saut) : seul l'événement peut devenir faux, et on ne
    // recalcule que lorsqu'il l'est (cadence de 500 ms, jamais à chaque image).
    if (
      current !== shown ||
      (current !== null && eventCache?.body === current && !eventValid(current))
    )
      render(current);
  });
  onLocaleChange(() => render(shown));
}
