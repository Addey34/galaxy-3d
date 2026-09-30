/**
 * LE BLOC « INSTRUMENTS » DE LA FICHE D'UNE SONDE : ce que le registre de contexte du PDS déclare
 * qu'elle embarque, et les investigations où elle figure, avec leur état à la date de la scène.
 *
 * C'EST LE TROU QUE LE LOT 40 A LAISSÉ, et il est écrit noir sur blanc dans `config/missions.ts` :
 * « une mission n'est pas la cible d'une archive, elle en est l'auteur », donc le bloc « Missions »
 * reste masqué sur la fiche d'une sonde. Celle-ci n'avait donc que son nom, sa description et ses
 * quatre faits de lancement, alors que le même registre déclare ses instruments.
 *
 * RIEN N'EST DEMANDÉ AU DÉMARRAGE : l'index et la liste d'une sonde sont chargés par
 * `config/instruments.ts` à l'ouverture d'une fiche, comme les missions et le résumé de validation.
 *
 * LA DATE DE LA SCÈNE FAIT PARTIE DE LA RÉPONSE pour les investigations, et le calcul n'est PAS
 * redéfini ici : une investigation a la forme d'un `MissionRecord`, et `missionStanding` de
 * `core/missions.ts` répond déjà, avec son quatrième état pour celles qui ne déclarent pas de fin.
 *
 * UNE SONDE QUE L'ARCHIVE NE CONNAÎT PAS LE DIT, elle ne masque pas son bloc. Parker Solar Probe et
 * le JWST sont dans ce cas, mesuré avec témoin : le bloc affiche alors la raison, parce qu'un
 * visiteur qui passe de Cassini à Parker verrait sinon un bloc disparaître sans savoir pourquoi.
 */
import {
  instrumentProvenance,
  loadInstrumentIndex,
  loadSpacecraftArchive,
} from '@/config/instruments';
import {
  groupByHost,
  type HostGroup,
  type SpacecraftArchive,
} from '@/core/instruments';
import { missionStanding, type MissionStanding } from '@/core/missions';
import { formatIsoDay } from '@/core/dateText';
import { getLocale, intlLocale, onLocaleChange, t } from '@/i18n';
import type { PublicAPI } from '@/SolarSystemApp';
import type { BodyInfoPanel } from './bodyInfo';

/** Le jour d'une borne, dans la langue courante. `core/dateText.ts` porte la règle de l'ordinal. */
const formatDay = (iso: string): string =>
  formatIsoDay(iso, getLocale(), intlLocale());

const HAS_BEGUN: readonly MissionStanding[] = [
  'underway',
  'startedEndUndeclared',
];

/** Ce que l'archive a répondu pour la sonde rendue. */
type State = SpacecraftArchive | 'absent' | null;

export function setupInstrumentsBlock(
  api: PublicAPI,
  bodyInfo: BodyInfoPanel
): void {
  const panel = document.getElementById('body-info');
  const block = panel?.querySelector<HTMLDetailsElement>('.bi-instruments');
  const countEl = block?.querySelector<HTMLElement>('.bi-instruments-count');
  const body = block?.querySelector<HTMLElement>('.bi-instruments-body');
  const note = block?.querySelector<HTMLElement>('.bi-instruments-note');
  if (!block || !countEl || !body || !note) return;

  let rendered: string | null = null;
  let renderedDay = '';
  let state: State = null;
  /**
   * LA FICHE DONT ON SAIT DÉJÀ QU'ELLE N'A RIEN À MONTRER. Sans elle, `sync` redemande l'archive
   * TOUTES LES 500 ms, indéfiniment, dès qu'une fiche n'en a pas — c'est-à-dire sur les 58 corps du
   * catalogue, donc le cas le plus commun. La même correction est portée à `missionsBlock`, où la
   * boucle existe depuis le lot 40.
   *
   * Elle ne retient QUE le cas vide, et c'est délibéré : une variable « la réponse est arrivée »
   * confrontée à `!state` introduirait un défaut, parce que fermer la fiche remet `state` à `null`
   * sans rien dire de l'archive — une sonde qui EN A une reverrait alors son bloc masqué en
   * rouvrant. Trouvé en traçant la correction avant de l'appliquer.
   */
  let nothingToShow: string | null = null;

  /** Une liste d'instruments, éventuellement précédée du nom de son porteur. */
  const appendInstruments = (
    into: HTMLElement,
    group: HostGroup | null,
    instruments: SpacecraftArchive['instruments'],
    withHost: boolean
  ): void => {
    if (withHost && group) {
      const caption = document.createElement('p');
      caption.className = 'bi-instruments-host';
      caption.textContent = group.host.name;
      // UN PORTEUR SANS AUCUN INSTRUMENT GARDE SA PLACE : c'est le cas de l'orbiteur
      // magnétosphérique de BepiColombo, et le masquer ferait disparaître un tiers de la sonde.
      if (instruments.length === 0) {
        const empty = document.createElement('span');
        empty.className = 'bi-instruments-empty';
        empty.textContent = ` ${t('bi.instruments.hostEmpty')}`;
        caption.append(empty);
      }
      into.append(caption);
    }
    if (instruments.length === 0) return;
    const list = document.createElement('ul');
    for (const instrument of instruments) {
      const li = document.createElement('li');
      // Le nom est celui que l'archive PUBLIE, jamais réécrit : le corriger serait inventer une
      // valeur qu'aucune garde de provenance ne pourrait plus confronter.
      li.append(document.createTextNode(instrument.name));
      const lid = document.createElement('span');
      lid.className = 'bi-instruments-lid';
      // L'IDENTIFIANT LOGIQUE **EST** LA CITATION, et il est publié comme tel : le PDS s'en sert
      // pour citer un produit. Il n'est pas un lien, parce qu'aucune page humaine stable n'a été
      // VÉRIFIÉE derrière lui, et un lien mort serait pire qu'un texte exact.
      lid.textContent = instrument.lid;
      li.append(lid);
      list.append(li);
    }
    into.append(list);
  };

  const render = (spacecraft: string, sceneDate: Date): void => {
    const provenance = instrumentProvenance();
    if (!state || !provenance) {
      block.hidden = true;
      return;
    }
    body.replaceChildren();

    if (state === 'absent') {
      countEl.textContent = '';
      const p = document.createElement('p');
      p.textContent = t('bi.instruments.absent');
      body.append(p);
      /**
       * UNE NOTE DIFFÉRENTE, ET C'EST LA RELECTURE DU RENDU QUI L'A EXIGÉE. La note ordinaire
       * annonce « ce que cette archive déclare que cette sonde embarque » et « l'identifiant sous
       * chaque nom en est la citation » : sous un bloc qui vient de dire que l'archive ne déclare
       * RIEN, elle promettait une liste inexistante et des identifiants que rien ne rendait. Ici
       * il n'y a qu'une chose vraie à dire, la date de lecture.
       */
      note.textContent = t('bi.instruments.absentNote', {
        date: formatDay(provenance.retrieved),
      });
      block.hidden = false;
      rendered = spacecraft;
      renderedDay = sceneDate.toISOString().slice(0, 10);
      return;
    }

    const { groups, orphans } = groupByHost(state);
    countEl.textContent = String(state.instruments.length);

    // Le nom du porteur n'est montré que quand il APPORTE quelque chose : une sonde sur neuf est
    // plusieurs engins (BepiColombo), et répéter « Cassini Orbiter » au-dessus de ses dix-huit
    // instruments serait du bruit.
    const withHost = groups.length > 1;
    for (const group of groups)
      appendInstruments(body, group, group.instruments, withHost);
    if (orphans.length > 0) appendInstruments(body, null, orphans, false);

    if (state.investigations.length > 0) {
      const caption = document.createElement('p');
      caption.className = 'bi-instruments-caption';
      caption.textContent = t('bi.instruments.investigations');
      body.append(caption);
      const list = document.createElement('ul');
      for (const investigation of state.investigations) {
        const standing = missionStanding(investigation, sceneDate);
        const atDate = HAS_BEGUN.includes(standing);
        const li = document.createElement('li');
        li.classList.toggle('is-at-date', atDate);
        li.append(document.createTextNode(investigation.name));
        // La puce colorée le dit à l'œil ; ce texte le dit au lecteur d'écran, qui ne voit ni la
        // classe ni le `::before`. Sans lui l'information serait purement visuelle.
        if (atDate) {
          const sr = document.createElement('span');
          sr.className = 'sr-only';
          sr.textContent = ` (${t('bi.missions.atDate')})`;
          li.append(sr);
        }
        const span = document.createElement('span');
        span.className = 'bi-missions-span';
        span.textContent =
          investigation.end === null
            ? t('bi.missions.spanOpen', {
                from: formatDay(investigation.start),
              })
            : t('bi.missions.span', {
                from: formatDay(investigation.start),
                to: formatDay(investigation.end),
              });
        li.append(span);
        list.append(li);
      }
      body.append(list);
    }

    note.textContent = t('bi.instruments.note', {
      date: formatDay(provenance.retrieved),
    });
    block.hidden = false;
    rendered = spacecraft;
    renderedDay = sceneDate.toISOString().slice(0, 10);
  };

  /** La sonde dont l'archive est en vol, pour ne pas en demander deux fois la même. */
  let pending: string | null = null;

  const sync = (): void => {
    const current = bodyInfo.currentBody();
    if (!current) {
      block.hidden = true;
      rendered = null;
      state = null;
      return;
    }
    if (nothingToShow === current) {
      block.hidden = true;
      return;
    }
    const sceneDay = api.orbitalMechanics.simulationDate
      .toISOString()
      .slice(0, 10);
    if (rendered === current && renderedDay === sceneDay) return;
    if (rendered !== current) {
      rendered = null;
      state = null;
      block.hidden = true;
    }
    if (state) {
      render(current, api.orbitalMechanics.simulationDate);
      return;
    }
    if (pending === current) return;
    pending = current;
    void Promise.all([loadInstrumentIndex(), loadSpacecraftArchive(current)])
      .then(([, archive]) => {
        // La fiche a pu changer pendant le vol : on ne rend que ce qui est demandé.
        if (bodyInfo.currentBody() !== current) return;
        if (!archive) {
          // Ce n'est pas une sonde : la réponse est définitive, on ne la redemandera pas.
          nothingToShow = current;
          block.hidden = true;
          return;
        }
        state = archive;
        render(current, api.orbitalMechanics.simulationDate);
      })
      .finally(() => {
        // Seulement si c'est TOUJOURS notre chargement : un `pending = null` inconditionnel
        // effacerait la marque d'un chargement plus récent et en lancerait un troisième.
        if (pending === current) pending = null;
      });
  };

  // La cadence de l'interface suffit : le bloc ne change qu'au changement de corps ou de JOUR de
  // la scène, et `sync` sort immédiatement quand ni l'un ni l'autre n'a bougé.
  let lastCheck = 0;
  api.animationSystem.onFrame(() => {
    const at = performance.now();
    if (at - lastCheck < 500) return;
    lastCheck = at;
    sync();
  });

  onLocaleChange(() => {
    if (rendered) render(rendered, api.orbitalMechanics.simulationDate);
  });
}
