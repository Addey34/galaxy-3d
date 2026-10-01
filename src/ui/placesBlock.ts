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
  type PlaceObservation,
} from '@/config/placeObservations';
import type { NamedFeature } from '@/core/gazetteer';
import { formatIsoDay } from '@/core/dateText';
import { getLocale, intlLocale, onLocaleChange, t } from '@/i18n';
import { bodyDisplayName } from '@/i18n/bodyText';
import type { PublicAPI } from '@/SolarSystemApp';
import type { BodyInfoPanel } from './bodyInfo';
import { getAnnouncer } from './announcer';

const formatDay = (iso: string): string =>
  formatIsoDay(iso, getLocale(), intlLocale());

const NAMED = new Set(Object.keys(gazetteerIndex.bodies));

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
    obs: PlaceObservation[] | null;
  } | null = null;

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
      countEl.textContent = t('bi.places.count', {
        observed: n.format(cover.observed),
        total: n.format(cover.formations),
      });
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
    const { feature, obs } = shown;
    const title = document.createElement('p');
    title.className = 'bi-places-title';
    title.textContent = `${feature.name} · ${feature.type}`;
    result.append(title);
    if (obs === null) {
      const p = document.createElement('p');
      p.textContent = t('bi.places.unavailable');
      result.append(p);
      return;
    }
    if (obs.length === 0) {
      const p = document.createElement('p');
      p.textContent = t('bi.places.none');
      result.append(p);
      return;
    }
    const ul = document.createElement('ul');
    for (const o of obs) {
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
    const wanted = input.value.trim().toLocaleLowerCase();
    if (!wanted) return;
    const feature = names.find((f) => f.name.toLocaleLowerCase() === wanted);
    if (!feature) {
      shown = null;
      result.replaceChildren();
      const p = document.createElement('p');
      p.textContent = t('bi.places.unknown');
      result.append(p);
      getAnnouncer().announce(t('bi.places.unknown'), 'places');
      return;
    }
    void loadPlaceObservations(body, feature.iauId).then((obs) => {
      if (rendered !== body) return;
      shown = { body, feature, obs };
      renderResult();
      getAnnouncer().announce(
        obs && obs.length
          ? t('bi.places.announce', { name: feature.name, count: obs.length })
          : `${feature.name}. ${t(obs ? 'bi.places.none' : 'bi.places.unavailable')}`,
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
