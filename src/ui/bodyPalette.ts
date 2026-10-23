/**
 * Palette de corps (#body-palette) — recherche + liste groupée, ouverte depuis le dock.
 *
 * Remplace l'ancienne barre horizontale défilable. Chaque entrée EST le bouton
 * `#orbit-{name}` historique (mêmes id/classe/état `.is-active`), simplement rangé dans une
 * palette au lieu d'une barre : la commande de navigation partagée (`PlanetNavigation.selectBody`)
 * et le contrat des tests restent inchangés. Les entrées sont générées depuis le catalogue —
 * ajouter un corps n'exige aucune édition HTML.
 */
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { forEachBody } from '@/config/catalog';
import { NAVIGABLE_BODIES, NAVIGABLE_TARGETS } from '@/config/navigable';
import type { BodyKind, CelestialConfig } from '@/types';
import { bodyDisplayName } from '@/i18n/bodyText';
import { onLocaleChange, t } from '@/i18n';
import { loadDeferredMessages } from '@/i18n/deferredMessages';
import { bodyAccentColor, hexToRgbTriplet, onAccentChange } from './bodyAccent';
import type { OverlayCoordinator } from './overlayCoordinator';
import { BODY_GROUPS } from './bodyGroups';
import { getAnnouncer } from './announcer';
import type { SearchHit } from '@/core/search';
import type { SearchContext } from './paletteSearch';

const BODY_CONFIGS = NAVIGABLE_BODIES;

interface PaletteEntry {
  name: string;
  label: string;
  kind: BodyKind;
  accent: string;
  button: HTMLButtonElement;
}

/** Ordre et libellé des groupes : ceux du tableau des Réglages (cf. `bodyGroups.ts`). */
const GROUPS = BODY_GROUPS;

/** Au-delà, le compte affiché est annoncé sans attendre les résultats typés. */
const PROVISIONAL_COUNT_MS = 800;

export interface BodyPalette {
  /** Reflète la sélection courante (état actif + libellé du déclencheur). */
  setActive(name: string | null): void;
  /**
   * Entrées que l'on ne peut PAS cibler à la date courante : une sonde hors de la couverture
   * de son fichier Horizons (avant son lancement, au-delà de sa solution de trajectoire), un
   * objet interstellaire hors de sa fenêtre. Elles restent listées et cherchables — leur
   * absence est une information sur la DATE, pas sur l'objet — mais ne se sélectionnent pas :
   * il n'y a aucune position à aller voir, et suivre la dernière connue serait un mensonge.
   */
  setUnavailable(names: ReadonlySet<string>): void;
  /**
   * Les commandes dont la recherche typée a besoin pour AGIR (lot 47) : elles n'existent qu'après
   * la palette (mode, permalien), d'où ce branchement tardif. Sans lui, seuls les corps se
   * cherchent.
   */
  setSearchContext(context: SearchContext): void;
  close(): void;
}

/** Une ligne qu'on atteint aux flèches : un corps ou un résultat typé. */
interface NavItem {
  button: HTMLButtonElement;
  activate(): void;
}

/**
 * Noms des corps du catalogue qui méritent une entrée de palette : TOUS, sauf le fond étoilé
 * qui n'est pas un corps.
 *
 * Il y avait ici une seconde exclusion — les petits corps sans texture de surface — au motif
 * qu'ils seraient « naviguables uniquement par leurs labels Explo ». Elle était fausse sur les
 * deux plans. Ces six corps (Psyché, Bennu, Éros, Itokawa, Ryugu, Ida) ont un `CelestialObject`,
 * une ligne d'orbite, une ligne dans le tableau Réglages, une fiche d'info et une page
 * d'atterrissage ; cinq d'entre eux ont même un MODÈLE DE FORME 3D, pas une sphère de repli.
 * Ils étaient donc déjà cliquables en 3D et déjà réglables — mais introuvables à la recherche,
 * seule surface où le catalogue n'était pas la source unique. Un corps du catalogue se cherche.
 *
 * Exporté et pur pour que le test confronte la liste au catalogue plutôt qu'au DOM.
 */
export function paletteBodyNames(
  config: CelestialConfig = CELESTIAL_CONFIG
): string[] {
  const names: string[] = [];
  forEachBody(config, ({ name, config: cfg }) => {
    if (cfg.kind !== 'skybox') names.push(name);
  });
  // Sondes et objets interstellaires, dans l'ordre de leurs registres.
  names.push(...NAVIGABLE_TARGETS.keys());
  return names;
}

/** Corps éligibles à la palette, avec leur bouton `#orbit-{nom}`. */
function collectEntries(): PaletteEntry[] {
  const entries: PaletteEntry[] = [];
  for (const name of paletteBodyNames()) {
    const cfg = BODY_CONFIGS.get(name);
    if (!cfg) continue;

    const label = bodyDisplayName(name);
    const accent = hexToRgbTriplet(bodyAccentColor(cfg, name));

    const button = document.createElement('button');
    button.id = `orbit-${name}`;
    button.type = 'button';
    button.className = 'palette-item';
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', 'false');
    button.style.setProperty('--body-rgb', accent);
    entries.push({ name, label, kind: cfg.kind, accent, button });
  }
  return entries;
}

function kindTag(kind: BodyKind): string {
  if (kind === 'moon') return t('nav.kind.moon');
  if (kind === 'dwarf') return t('nav.kind.dwarf');
  if (kind === 'spacecraft') return t('nav.kind.spacecraft');
  if (kind === 'interstellar') return t('nav.kind.interstellar');
  return '';
}

/** Remplit le bouton (point coloré + nom + éventuel tag catégorie). */
function fillButton(entry: PaletteEntry): void {
  entry.button.replaceChildren();
  const dot = document.createElement('span');
  dot.className = 'palette-item-dot';
  dot.setAttribute('aria-hidden', 'true');
  const name = document.createElement('span');
  name.className = 'palette-item-name';
  name.textContent = entry.label;
  entry.button.append(dot, name);
  const tag = kindTag(entry.kind);
  if (tag) {
    const kindEl = document.createElement('span');
    kindEl.className = 'palette-item-kind';
    kindEl.textContent = tag;
    entry.button.append(kindEl);
  }
  entry.button.setAttribute('aria-label', entry.label);
}

export function setupBodyPalette(
  onSelect: (name: string) => void,
  coordinator?: OverlayCoordinator
): BodyPalette {
  const panel = document.getElementById('body-palette');
  const trigger = document.getElementById(
    'body-search-trigger'
  ) as HTMLButtonElement | null;
  const input = document.getElementById(
    'palette-input'
  ) as HTMLInputElement | null;
  const results = document.getElementById('palette-results');
  const overviewBtn = document.getElementById(
    'orbit-overview'
  ) as HTMLButtonElement | null;
  const currentLabel = trigger?.querySelector<HTMLElement>(
    '[data-body-current]'
  );

  if (!panel || !trigger || !input || !results) {
    return {
      setActive: () => {},
      setUnavailable: () => {},
      setSearchContext: () => {},
      close: () => {},
    };
  }

  const entries = collectEntries();
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  let open = false;
  let highlighted = -1;

  // Structure construite UNE fois : titres de groupe + tous les boutons `#orbit-{name}`
  // vivent en permanence dans le DOM (contrat des tests + état actif observable). Le filtre
  // de recherche ne fait que basculer leur visibilité — jamais recréer le DOM.
  const groupTitles: HTMLElement[] = [];
  const emptyEl = document.createElement('p');
  emptyEl.className = 'palette-empty';
  emptyEl.hidden = true;

  for (const group of GROUPS) {
    const groupEntries = entries.filter((entry) => group.kinds.has(entry.kind));
    if (groupEntries.length === 0) continue;
    const title = document.createElement('div');
    title.className = 'palette-group-title';
    title.dataset['group'] = group.key;
    title.textContent = t(group.key);
    results.append(title);
    groupTitles.push(title);
    for (const entry of groupEntries) {
      entry.button.dataset['group'] = group.key;
      fillButton(entry);
      results.append(entry.button);
    }
  }
  // Les résultats typés (lieux, missions, instruments, survols), sous les corps, reconstruits à
  // chaque requête : leur nombre et leur contenu changent, à la différence des corps.
  const typedEl = document.createElement('div');
  typedEl.className = 'palette-typed';
  results.append(typedEl, emptyEl);

  let lastVisible: PaletteEntry[] = [];
  let typedItems: NavItem[] = [];
  let searchContext: SearchContext | null = null;
  /** Numéro de la dernière requête : une réponse plus ancienne arrivée après est ignorée. */
  let typedSeq = 0;
  /**
   * LE COMPTE ANNONCÉ, BORNÉ DANS LE TEMPS. Les résultats typés attendent leur morceau et leur
   * index à la première frappe : attendre pour annoncer un compte exact a fait passer la garde
   * NVDA du lot 19 au réessai sur un coureur lent (CI du 2026-10-12), et un morceau qui ne se
   * charge pas (hors ligne) n'annonçait plus RIEN. Le compte part donc au plus tard après
   * `PROVISIONAL_COUNT_MS` ; s'ils arrivent après, un second compte ne suit que s'il diffère.
   */
  let countTimer: number | undefined;
  let announcedCount: number | null = null;
  let countDue = false;

  const bodyItems = (): NavItem[] =>
    lastVisible.map((entry) => ({
      button: entry.button,
      activate: () => {
        if (!unavailable.has(entry.name)) onSelect(entry.name);
      },
    }));
  const navItems = (): NavItem[] => [...bodyItems(), ...typedItems];

  const render = (query: string): void => {
    const q = query.trim().toLowerCase();
    const visible: PaletteEntry[] = [];

    for (const entry of entries) {
      const match = !q || entry.label.toLowerCase().includes(q);
      entry.button.hidden = !match;
      if (match) visible.push(entry);
    }
    // Un titre de groupe n'apparaît que si au moins une de ses entrées est visible.
    for (const title of groupTitles) {
      const key = title.dataset['group'];
      title.hidden = !visible.some(
        (entry) => entry.button.dataset['group'] === key
      );
    }
    emptyEl.textContent = t('events.empty');
    // Le vide se dit d'abord sur les corps ; `refreshTyped` le corrige quand les résultats
    // typés arrivent (« aucun corps » ne veut plus dire « aucun résultat »).
    emptyEl.hidden = visible.length > 0 || typedItems.length > 0;

    highlighted = -1;
    lastVisible = visible;
    syncHighlight();
    void refreshTyped(query);
  };

  /** Les résultats typés de la requête, chargés à la PREMIÈRE frappe utile avec leur morceau. */
  const refreshTyped = async (query: string): Promise<void> => {
    const seq = ++typedSeq;
    let hits: SearchHit[] = [];
    let search: typeof import('./paletteSearch') | null = null;
    if (searchContext && query.trim().length >= 2) {
      try {
        // Les intitulés des groupes arrivent avec le morceau (`i18n/deferredMessages`).
        [search] = await Promise.all([
          import('./paletteSearch'),
          loadDeferredMessages(),
        ]);
        hits = await search.searchTyped(query, searchContext);
      } catch {
        hits = [];
      }
    }
    if (seq !== typedSeq) return;
    const hadTyped = typedItems.length > 0;
    typedEl.replaceChildren();
    // Le rendu vit dans le morceau de la recherche : rien de ce code ne sert avant la
    // première frappe, et le budget du démarrage n'a pas à le payer.
    typedItems =
      search && searchContext
        ? search.renderHits(typedEl, hits, searchContext, unavailable)
        : [];
    emptyEl.hidden = lastVisible.length + typedItems.length > 0;
    syncHighlight();
    // Seule une FRAPPE annonce : un changement de langue ou de date redessine sans parler.
    if (countDue && (search || hadTyped || announcedCount === null)) {
      window.clearTimeout(countTimer);
      const total = lastVisible.length + typedItems.length;
      if (total !== announcedCount) announceResults(total);
      announcedCount = total;
      countDue = false;
    }
  };

  const syncHighlight = (): void => {
    const items = navItems();
    items.forEach((item, index) => {
      const isHighlighted = index === highlighted;
      item.button.classList.toggle('is-highlighted', isHighlighted);
      item.button.setAttribute('aria-selected', String(isHighlighted));
    });
    const active = highlighted >= 0 ? items[highlighted] : undefined;
    if (active) {
      active.button.scrollIntoView({ block: 'nearest' });
      input.setAttribute('aria-activedescendant', active.button.id);
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  };

  const setOpen = (next: boolean): void => {
    if (next === open) return;
    open = next;
    if (open) coordinator?.requestOpen('body-palette');
    panel.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    input.setAttribute('aria-expanded', String(open));
    if (open) {
      input.value = '';
      render('');
      // Focus après affichage (sinon le focus est ignoré sur un élément caché).
      // Au doigt, le clavier virtuel couvrirait la moitié de la liste dès l'ouverture, et le
      // visiteur voulait d'abord PARCOURIR (signalé le 2026-10-23). `inputmode="none"` garde le
      // focus, donc le lecteur d'écran reste dans le champ, sans clavier ; un toucher sur le champ
      // le rend (ci-dessous), parce que là le visiteur veut écrire.
      input.inputMode = matchMedia('(pointer: coarse)').matches
        ? 'none'
        : 'text';
      requestAnimationFrame(() => input.focus({ preventScroll: true }));
    }
  };
  coordinator?.register('body-palette', () => setOpen(false));

  trigger.addEventListener('click', () => setOpen(!open));
  input.addEventListener('pointerdown', () => {
    if (input.inputMode !== 'none') return;
    input.inputMode = 'text';
    // Le champ a déjà le focus : le relâcher et le reprendre fait apparaître le clavier.
    input.blur();
    requestAnimationFrame(() => input.focus({ preventScroll: true }));
  });

  /**
   * Dit COMBIEN de corps correspondent.
   *
   * Mesuré au lot 19 (défaut D8) : on tapait « m », « a », « r », et NVDA n'énonçait que les
   * lettres elles-mêmes. Rien ne disait si la recherche trouvait quelque chose ; la première
   * information arrivait à la flèche bas. La région est `polite` et se remplace elle-même,
   * donc une frappe rapide n'empile pas les annonces.
   */
  const announceResults = (count: number): void => {
    getAnnouncer().announce(
      count === 0
        ? t('a11y.searchResultsNone')
        : count === 1
          ? t('a11y.searchResultsOne')
          : t('a11y.searchResults', { count: String(count) }),
      // Canal « search » : taper vite ne doit pas empiler cinq comptes successifs, seul le
      // dernier a un sens.
      'search'
    );
  };

  input.addEventListener('input', () => {
    window.clearTimeout(countTimer);
    announcedCount = null;
    if (!searchContext || input.value.trim().length < 2) {
      countDue = false;
      render(input.value);
      announceResults(lastVisible.length);
      return;
    }
    // Avec la recherche typée, le compte EXACT vient avec ses résultats (`refreshTyped`) ;
    // s'ils tardent, celui qui est affiché part quand même, une fois.
    countDue = true;
    render(input.value);
    countTimer = window.setTimeout(() => {
      announcedCount = lastVisible.length + typedItems.length;
      announceResults(announcedCount);
    }, PROVISIONAL_COUNT_MS);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const dir = event.key === 'ArrowDown' ? 1 : -1;
      const count = navItems().length;
      highlighted = (highlighted + dir + count) % Math.max(1, count);
      syncHighlight();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const items = navItems();
      (items[highlighted] ?? items[0])?.activate();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      trigger.focus();
    }
  });

  let unavailable: ReadonlySet<string> = new Set();

  const setUnavailable = (names: ReadonlySet<string>): void => {
    unavailable = new Set(names);
    for (const entry of entries) {
      const off = unavailable.has(entry.name);
      entry.button.classList.toggle('is-unavailable', off);
      // `aria-disabled` plutôt que `disabled` : l'entrée reste atteignable au clavier et
      // annoncée, ce qui est le but — on apprend que l'objet n'existe pas à cette date.
      entry.button.setAttribute('aria-disabled', String(off));
      if (off) entry.button.title = t('nav.unavailable');
      else entry.button.removeAttribute('title');
    }
    // Un instrument dont la sonde n'existe pas à cette date se grise comme elle.
    if (typedItems.length) void refreshTyped(input.value);
  };

  // Clic sur une entrée : commande de navigation partagée.
  results.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      '.palette-item'
    );
    // Un résultat typé porte son propre geste (`renderTyped`).
    if (!button || button.classList.contains('palette-hit')) return;
    const name = button.id.replace('orbit-', '');
    if (unavailable.has(name)) return;
    onSelect(name);
  });

  overviewBtn?.addEventListener('click', () => onSelect('overview'));

  onLocaleChange(() => {
    for (const entry of entries) {
      entry.label = bodyDisplayName(entry.name);
      fillButton(entry);
    }
    for (const title of groupTitles) {
      const key = title.dataset['group'];
      if (key) title.textContent = t(key);
    }
    render(input.value);
    // Le libellé courant reflète la sélection dans la nouvelle langue.
    if (currentLabel && currentActive && currentActive !== 'overview') {
      const entry = byName.get(currentActive);
      if (entry) currentLabel.textContent = entry.label;
    }
  });

  // Mode daltonien basculé : recolore les pastilles déjà créées (couleur figée à la création).
  onAccentChange(() => {
    for (const entry of entries) {
      entry.accent = hexToRgbTriplet(
        bodyAccentColor(BODY_CONFIGS.get(entry.name), entry.name)
      );
      entry.button.style.setProperty('--body-rgb', entry.accent);
    }
  });

  let currentActive: string | null = 'overview';
  const setActive = (name: string | null): void => {
    currentActive = name;
    for (const entry of entries) {
      entry.button.classList.toggle('is-active', entry.name === name);
    }
    overviewBtn?.classList.toggle(
      'is-active',
      name === 'overview' || name === null
    );
    if (currentLabel) {
      const entry = name ? byName.get(name) : undefined;
      currentLabel.textContent = entry ? entry.label : t('nav.bodies');
    }
  };

  return {
    setActive,
    setUnavailable,
    setSearchContext: (context) => {
      searchContext = context;
    },
    close: () => setOpen(false),
  };
}
