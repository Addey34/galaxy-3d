/**
 * LE BLOC « FORMATIONS OBSERVÉES » DE LA FICHE D'UN CORPS (ligne 40.3) : pour une formation nommée
 * par l'UAI, quels instruments en orbite l'ont observée, combien de fois, de quand à quand, et
 * l'étiquette PDS de la première observation, qui en est la source primaire.
 *
 * POURQUOI UN CHAMP DE RECHERCHE ET NON UN CLIC SUR LA CARTE : les noms du gazetteer (lot 37)
 * sont écrits sur un CANVAS, qu'aucun clavier ni lecteur d'écran n'atteint. Un `<input>` relié à
 * une `<datalist>` est natif, se lit au clavier, et ne demande aucun geste de pointage précis sur
 * une Lune qui tourne.
 *
 * RIEN N'EST DEMANDÉ AU DÉMARRAGE, ni même à l'ouverture de la fiche : les noms ne sont chargés
 * qu'à l'ouverture du BLOC, et le morceau d'une formation qu'à sa demande
 * (`config/placeObservations.ts`).
 *
 * UN CORPS QUE LE SERVICE NE COUVRE PAS LE DIT, il ne masque pas son bloc : trente-deux des
 * trente-six corps qui portent des noms sont dans ce cas, et c'est la règle de parité du lot 42.
 */
import gazetteerIndex from '@/config/gazetteerIndex.json';
import {
  loadFormations,
  loadPlaceIndex,
  loadPlaceObservations,
  placeCoverage,
  placeProvenance,
  type PlaceObservationResult,
} from '@/config/placeObservations';
import type { NamedFeature } from '@/core/gazetteer';
import { formatIsoDay } from '@/core/dateText';
import { fold } from '@/core/textFold';
import { getLocale, intlLocale, onLocaleChange, t } from '@/i18n';
import { bodyDisplayName } from '@/i18n/bodyText';
import type { PublicAPI } from '@/SolarSystemApp';
import type { BodyInfoPanel } from './bodyInfo';
import { getAnnouncer } from './announcer';

const formatDay = (iso: string): string =>
  formatIsoDay(iso, getLocale(), intlLocale());

const NAMED = new Set(Object.keys(gazetteerIndex.bodies));

/** La phrase d'un état qui n'est pas une liste d'observations. */
export function statusKey(
  answer: Exclude<PlaceObservationResult, { status: 'observed' }>
): 'bi.places.none' | 'bi.places.notEvaluated' | 'bi.places.unavailable' {
  if (answer.status === 'zero-proven') return 'bi.places.none';
  if (answer.status === 'not-evaluated') return 'bi.places.notEvaluated';
  return 'bi.places.unavailable';
}

/**
 * Une formation se retrouve par son nom SANS accent ni casse (« Na Hye-sŏk » comme « na hye-sok »),
 * comme la recherche universelle (`fold`), sans toucher à la donnée officielle. Une correspondance
 * exacte l'emporte ; une correspondance repliée doit être UNIQUE, sinon on ne devine pas.
 */
export function matchFormation(
  names: readonly NamedFeature[],
  typed: string
): NamedFeature | null {
  const lower = typed.trim().toLocaleLowerCase();
  const exact = names.find((f) => f.name.toLocaleLowerCase() === lower);
  if (exact) return exact;
  const folded = fold(typed);
  if (!folded) return null;
  const found = names.filter((f) => fold(f.name) === folded);
  return found.length === 1 ? found[0]! : null;
}

export function setupPlacesBlock(
  api: PublicAPI,
  bodyInfo: BodyInfoPanel
): void {
  const panel = document.getElementById('body-info');
  const block = panel?.querySelector<HTMLDetailsElement>('.bi-places');
  const countEl = block?.querySelector<HTMLElement>('.bi-places-count');
  const intro = block?.querySelector<HTMLElement>('.bi-places-intro');
  const form = block?.querySelector<HTMLFormElement>('.bi-places-form');
  const input = block?.querySelector<HTMLInputElement>('.bi-places-input');
  const list = block?.querySelector<HTMLDataListElement>('.bi-places-names');
  const result = block?.querySelector<HTMLElement>('.bi-places-result');
  const note = block?.querySelector<HTMLElement>('.bi-places-note');
  if (
    !block ||
    !countEl ||
    !intro ||
    !form ||
    !input ||
    !list ||
    !result ||
    !note
  )
    return;

  let rendered: string | null = null;
  /** Les corps que l'index déclare couverts, lus et non recopiés. */
  let covered: Record<string, unknown> = {};
  let names: NamedFeature[] | null = null;
  let namesFor: string | null = null;
  /** La dernière formation demandée, pour la re-rendre au changement de langue. */
  let shown: {
    body: string;
    feature: NamedFeature;
    result: PlaceObservationResult;
  } | null = null;
  /**
   * Le numéro de la DERNIÈRE question posée. Une réponse qui arrive après une question plus récente
   * (même corps, autre formation) ou après un changement de corps ne remplace rien.
   */
  let asked = 0;

  const renderFrame = (body: string): void => {
    const cover = placeCoverage(body);
    const provenance = placeProvenance();
    if (!cover || !provenance) {
      block.hidden = true;
      return;
    }
    if (cover === 'uncovered') {
      countEl.textContent = '';
      form.hidden = true;
      result.replaceChildren();
      // La liste des corps couverts se LIT dans l'index : la recopier dans une phrase la ferait
      // mentir le jour où l'ODE en ajoute un.
      // Après un deux-points, sans article : « la Lune » ne se fabrique pas d'un nom, et la liste
      // écrite sans deux-points lisait « que pour Vénus, Mercure, Mars et Lune ». Triée dans la
      // langue courante, et non dans l'ordre où l'index a été écrit.
      const coveredNames = Object.keys(covered)
        .map(bodyDisplayName)
        .sort((a, b) => a.localeCompare(b, intlLocale()));
      intro.textContent = t('bi.places.uncovered', {
        bodies: new Intl.ListFormat(intlLocale(), {
          type: 'conjunction',
        }).format(coveredNames),
      });
      note.textContent = '';
    } else {
      const n = new Intl.NumberFormat(intlLocale());
      // TROIS nombres, trois sens : ce que l'ODE a observé, ce qu'il a ÉVALUÉ (le jeu publié), ce
      // que l'UAI nomme. Une fraction « x sur y » ne disait pas lequel des deux y était.
      const named = (
        gazetteerIndex.bodies as Record<string, { count: number } | undefined>
      )[body]?.count;
      countEl.textContent = [
        t('bi.places.count', {
          observed: n.format(cover.observed),
          evaluated: n.format(cover.formations),
        }),
        named !== undefined && named !== cover.formations
          ? t('bi.places.countNamed', { named: n.format(named) })
          : '',
      ]
        .filter(Boolean)
        .join(' ');
      form.hidden = false;
      intro.textContent = t('bi.places.hint');
      note.textContent = t('bi.places.note', {
        date: formatDay(provenance.frozenAt),
      });
    }
    input.setAttribute('aria-label', t('bi.places.search'));
    block.hidden = false;
  };

  const renderResult = (): void => {
    result.replaceChildren();
    if (!shown) return;
    const { feature, result: answer } = shown;
    const title = document.createElement('p');
    title.className = 'bi-places-title';
    title.textContent = `${feature.name} · ${feature.type}`;
    result.append(title);
    if (answer.status !== 'observed') {
      const p = document.createElement('p');
      p.textContent = t(statusKey(answer));
      result.append(p);
      return;
    }
    const ul = document.createElement('ul');
    for (const o of answer.observations) {
      const li = document.createElement('li');
      // Les noms sont ceux que l'ODE PUBLIE, jamais traduits ni réécrits.
      li.append(
        document.createTextNode(
          `${o.instrument.mission} · ${o.instrument.instrument}`
        )
      );
      const span = document.createElement('span');
      span.className = 'bi-missions-span';
      span.textContent = !o.first
        ? t('bi.places.observationsUndated', {
            count: new Intl.NumberFormat(intlLocale()).format(o.count),
          })
        : t('bi.places.observations', {
            count: new Intl.NumberFormat(intlLocale()).format(o.count),
            span:
              o.first === o.last
                ? formatDay(o.first)
                : t('bi.missions.span', {
                    from: formatDay(o.first),
                    to: formatDay(o.last),
                  }),
          });
      li.append(span);
      if (/^https:\/\//.test(o.label)) {
        const a = document.createElement('a');
        a.className = 'bi-places-label';
        a.href = o.label;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = t('bi.places.firstLabel');
        li.append(a);
      }
      ul.append(li);
    }
    result.append(ul);
  };

  const ensureNames = (body: string): void => {
    if (namesFor === body) return;
    namesFor = body;
    names = null;
    list.replaceChildren();
    void loadFormations(body).then((loaded) => {
      if (namesFor !== body || !loaded) return;
      names = loaded;
      const frag = document.createDocumentFragment();
      for (const f of [...loaded].sort((a, b) =>
        a.name.localeCompare(b.name)
      )) {
        const option = document.createElement('option');
        option.value = f.name;
        frag.append(option);
      }
      list.append(frag);
    });
  };

  const ask = (): void => {
    const body = rendered;
    if (!body || !names) return;
    if (!input.value.trim()) return;
    const feature = matchFormation(names, input.value);
    const mine = ++asked;
    if (!feature) {
      shown = null;
      result.replaceChildren();
      const p = document.createElement('p');
      p.textContent = t('bi.places.unknown');
      result.append(p);
      getAnnouncer().announce(t('bi.places.unknown'), 'places');
      return;
    }
    void loadPlaceObservations(body, feature.iauId).then((answer) => {
      if (rendered !== body || mine !== asked) return;
      shown = { body, feature, result: answer };
      renderResult();
      getAnnouncer().announce(
        answer.status === 'observed'
          ? t('bi.places.announce', {
              name: feature.name,
              count: answer.observations.length,
            })
          : `${feature.name}. ${t(statusKey(answer))}`,
        'places'
      );
    });
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    ask();
  });
  // Choisir une proposition de la liste ne soumet pas le formulaire : `change` le fait.
  input.addEventListener('change', ask);
  block.addEventListener('toggle', () => {
    if (block.open && rendered && placeCoverage(rendered) !== 'uncovered')
      ensureNames(rendered);
  });

  let pending: string | null = null;
  const sync = (): void => {
    const current = bodyInfo.currentBody();
    if (!current || !NAMED.has(current)) {
      // `rendered` est oublié dans LES DEUX cas : passer par un corps sans nom puis revenir
      // laisserait sinon le bloc masqué, puisque `rendered === current` court-circuiterait tout.
      block.hidden = true;
      rendered = null;
      return;
    }
    if (rendered === current) return;
    if (pending === current) return;
    pending = current;
    block.hidden = true;
    void loadPlaceIndex()
      .then((loaded) => {
        if (!loaded || bodyInfo.currentBody() !== current) return;
        covered = loaded.bodies;
        rendered = current;
        asked++;
        shown = null;
        input.value = '';
        result.replaceChildren();
        block.open = false;
        renderFrame(current);
      })
      .finally(() => {
        if (pending === current) pending = null;
      });
  };

  let lastCheck = 0;
  api.animationSystem.onFrame(() => {
    const at = performance.now();
    if (at - lastCheck < 500) return;
    lastCheck = at;
    sync();
  });

  onLocaleChange(() => {
    if (!rendered) return;
    renderFrame(rendered);
    renderResult();
  });
}
