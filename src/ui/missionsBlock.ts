/**
 * LE BLOC « MISSIONS » DE LA FICHE : ce que le registre de contexte du PDS déclare sur ce corps,
 * et où en était chaque mission à la date de la scène.
 *
 * C'est la question que l'application ne pouvait pas poser avant le lot 40. Elle savait OÙ est une
 * sonde à une date (trajectoires Horizons, lot 8), et depuis le lot 37 elle sait NOMMER une
 * formation ; elle ne savait pas dire ce qui est venu ici, ni quand.
 *
 * RIEN N'EST DEMANDÉ AU DÉMARRAGE. L'index et la liste d'un corps sont chargés par
 * `config/missions.ts` à l'ouverture d'une fiche, comme le résumé de validation que lit
 * `ui/positionProvenance.ts`. Tant que rien n'est arrivé, le bloc reste MASQUÉ plutôt que
 * d'annoncer « aucune mission », qui serait une affirmation fausse sur la donnée.
 *
 * LA DATE DE LA SCÈNE FAIT PARTIE DE LA RÉPONSE, et c'est ce qui distingue ce bloc d'une liste :
 * l'horloge de l'application décide quelles missions avaient commencé. Le calcul de l'état vit
 * dans `core/missions.ts` (pur, testé), avec son quatrième état — « commencée, fin non déclarée »
 * — qui existe parce que 36 des 112 investigations ne déclarent aucune fin, et qu'aucune des deux
 * formes que prend cette absence ne veut dire « toujours en cours ».
 */
import {
  loadMissionIndex,
  loadMissions,
  missionProvenance,
} from '@/config/missions';
import {
  missionStanding,
  type MissionRecord,
  type MissionStanding,
} from '@/core/missions';
import { formatIsoDay } from '@/core/dateText';
import { getLocale, intlLocale, onLocaleChange, t } from '@/i18n';
import type { PublicAPI } from '@/SolarSystemApp';
import type { BodyInfoPanel } from './bodyInfo';

/**
 * Le jour d'une borne, dans la langue courante. Les bornes du PDS sont des JOURS, jamais mieux.
 *
 * `core/dateText.ts` et non `toLocaleDateString` : une borne sur cinq tombe le 1er du mois (66 des
 * 337 livrées), et le français comme le portugais l'écrivent en ordinal.
 */
const formatDay = (iso: string): string =>
  formatIsoDay(iso, getLocale(), intlLocale());

/**
 * L'intervalle déclaré d'une mission, dans la langue courante : fin non déclarée, ou début non
 * déclaré (la sentinelle `1000-01-01` du PDS), dits comme tels. Partagé par le bloc « Missions »
 * d'un corps et le bloc « Instruments » d'une sonde, qui le recopiaient chacun.
 */
export function missionSpanText(
  mission: Pick<MissionRecord, 'start' | 'end'>,
  formatDay: (iso: string) => string
): string {
  if (mission.start === null)
    return mission.end === null
      ? t('bi.missions.spanUndeclared')
      : t('bi.missions.spanEndOnly', { to: formatDay(mission.end) });
  return mission.end === null
    ? t('bi.missions.spanOpen', { from: formatDay(mission.start) })
    : t('bi.missions.span', {
        from: formatDay(mission.start),
        to: formatDay(mission.end),
      });
}

/** L'intervalle déclaré, dans la langue courante. */
const formatSpan = (mission: MissionRecord): string =>
  missionSpanText(mission, formatDay);

const HAS_BEGUN: readonly MissionStanding[] = [
  'underway',
  'startedEndUndeclared',
];

export function setupMissionsBlock(
  api: PublicAPI,
  bodyInfo: BodyInfoPanel
): void {
  const panel = document.getElementById('body-info');
  const block = panel?.querySelector<HTMLDetailsElement>('.bi-missions');
  const countEl = block?.querySelector<HTMLElement>('.bi-missions-count');
  const list = block?.querySelector<HTMLUListElement>('ul');
  const note = block?.querySelector<HTMLElement>('.bi-missions-note');
  if (!block || !countEl || !list || !note) return;

  /** Le corps rendu, et la date pour laquelle il l'a été : on ne réécrit que ce qui change. */
  let rendered: string | null = null;
  let renderedDay = '';
  let missions: readonly MissionRecord[] | null = null;
  /**
   * LA FICHE DONT ON SAIT DÉJÀ QU'ELLE N'A RIEN À MONTRER. Ajoutée au lot 42, qui a mesuré la
   * boucle : sans elle, `sync` redemande la liste toutes les 500 ms, indéfiniment, sur la fiche
   * d'une SONDE ou d'un objet interstellaire, où ce bloc n'a rien à dire (`config/missions.ts`
   * rend `null` pour eux, délibérément). Cf. `ui/instrumentsBlock.ts` pour la raison de ne retenir
   * que le cas vide.
   */
  let nothingToShow: string | null = null;

  const render = (body: string, sceneDate: Date): void => {
    const provenance = missionProvenance();
    if (!missions || !provenance) {
      block.hidden = true;
      return;
    }
    const standings = missions.map((mission) => ({
      mission,
      standing: missionStanding(mission, sceneDate),
    }));
    const begun = standings.filter(({ standing }) =>
      HAS_BEGUN.includes(standing)
    ).length;

    // TROIS formulations, parce que deux nombres identiques côte à côte sont du bruit : « 3, dont
    // 3 à cette date » se lit mal, et c'est la relecture du rendu en quatre langues qui l'a montré.
    // Un compte NU quand rien n'avait commencé : `{count}` seul n'est pas une phrase, et une clé de
    // dictionnaire qui ne porterait qu'un substituant serait identique dans les quatre langues, ce
    // que la garde de fidélité refuse à juste titre.
    countEl.textContent =
      missions.length === 0
        ? ''
        : begun === 0
          ? String(missions.length)
          : begun === missions.length
            ? t('bi.missions.countAllAtDate', { count: missions.length })
            : t('bi.missions.countAtDate', {
                count: missions.length,
                active: begun,
              });

    list.replaceChildren();
    if (missions.length === 0) {
      const li = document.createElement('li');
      li.textContent = t('bi.missions.none');
      list.append(li);
    }
    for (const { mission, standing } of standings) {
      const li = document.createElement('li');
      const atDate = HAS_BEGUN.includes(standing);
      li.classList.toggle('is-at-date', atDate);
      // Le nom est celui que l'archive PUBLIE, jamais réécrit : « Lucy MIssion » y compris. Le
      // corriger serait inventer une valeur que la garde de provenance ne peut plus confronter.
      li.append(document.createTextNode(mission.name));
      // La puce colorée dit « avait commencé » à l'œil ; ce texte le dit au lecteur d'écran, qui
      // ne voit ni la classe ni le `::before`. Sans lui l'information serait purement visuelle.
      if (atDate) {
        const sr = document.createElement('span');
        sr.className = 'sr-only';
        sr.textContent = ` (${t('bi.missions.atDate')})`;
        li.append(sr);
      }
      const span = document.createElement('span');
      span.className = 'bi-missions-span';
      span.textContent = formatSpan(mission);
      li.append(span);
      list.append(li);
    }
    note.textContent = t('bi.missions.note', {
      date: formatDay(provenance.retrieved),
    });
    block.hidden = false;
    rendered = body;
    renderedDay = sceneDate.toISOString().slice(0, 10);
  };

  /** Le corps dont la liste est en vol, pour ne pas en demander deux fois la même. */
  let pending: string | null = null;

  const sync = (): void => {
    const body = bodyInfo.currentBody();
    if (!body) {
      block.hidden = true;
      rendered = null;
      missions = null;
      return;
    }
    if (nothingToShow === body) {
      block.hidden = true;
      return;
    }
    const sceneDay = api.orbitalMechanics.simulationDate
      .toISOString()
      .slice(0, 10);
    if (rendered === body && renderedDay === sceneDay) return;
    if (rendered !== body) {
      // `rendered` est remis à zéro en même temps que le bloc est masqué : sans cela, quitter A
      // pour B puis revenir sur A avant que B ait rendu laisserait `rendered` à « A » alors que le
      // bloc est masqué, la condition ci-dessus sortirait aussitôt, et la fiche de A resterait
      // muette. DÉFENSIF, et il faut le dire : j'ai essayé de le falsifier et je n'y suis pas
      // arrivé, parce que `bodyInfo.hide()` met déjà `currentBody()` à null dès qu'une autre
      // surface s'ouvre, ce que la branche `!body` ci-dessus traite. Aucun chemin de
      // l'application ne passe donc de A à B sans ce null. La ligne reste parce qu'elle est juste
      // et gratuite, pas parce qu'une garde la prouve.
      rendered = null;
      missions = null;
      block.hidden = true;
    }
    if (missions) {
      render(body, api.orbitalMechanics.simulationDate);
      return;
    }
    if (pending === body) return;
    pending = body;
    void Promise.all([loadMissionIndex(), loadMissions(body)])
      .then(([, list]) => {
        // La fiche a pu changer de corps pendant le vol : on ne rend que ce qui est demandé.
        if (bodyInfo.currentBody() !== body) return;
        if (!list) {
          // Ce n'est pas un corps du catalogue : la réponse est définitive.
          nothingToShow = body;
          block.hidden = true;
          return;
        }
        missions = list;
        render(body, api.orbitalMechanics.simulationDate);
      })
      .finally(() => {
        // Seulement si c'est TOUJOURS notre chargement : un `pending = null` inconditionnel
        // effacerait la marque d'un chargement plus récent et en lancerait un troisième.
        if (pending === body) pending = null;
      });
  };

  // La cadence de l'interface suffit : le bloc ne change qu'au changement de corps ou de JOUR
  // de la scène, et `sync` sort immédiatement quand ni l'un ni l'autre n'a bougé.
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
