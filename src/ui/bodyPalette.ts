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
import { forEachBody, flattenBodies } from '@/config/catalog';
import { SMALL_BODY_KINDS, type BodyKind } from '@/types';
import { bodyDisplayName } from '@/i18n/bodyText';
import { onLocaleChange, t } from '@/i18n';
import { bodyAccentColor, hexToRgbTriplet, onAccentChange } from './bodyAccent';
import type { OverlayCoordinator } from './overlayCoordinator';

const BODY_CONFIGS = flattenBodies(CELESTIAL_CONFIG);

interface PaletteEntry {
  name: string;
  label: string;
  kind: BodyKind;
  accent: string;
  button: HTMLButtonElement;
}

/** Ordre et libellé des groupes affichés dans la palette. */
const GROUPS: Array<{ key: string; kinds: ReadonlySet<BodyKind> }> = [
  { key: 'nav.group.star', kinds: new Set<BodyKind>(['star']) },
  { key: 'nav.group.planet', kinds: new Set<BodyKind>(['planet']) },
  { key: 'nav.group.moon', kinds: new Set<BodyKind>(['moon']) },
  { key: 'nav.group.dwarf', kinds: new Set<BodyKind>(['dwarf']) },
  {
    key: 'nav.group.other',
    kinds: new Set<BodyKind>(['asteroid', 'comet']),
  },
];

export interface BodyPalette {
  /** Reflète la sélection courante (état actif + libellé du déclencheur). */
  setActive(name: string | null): void;
  close(): void;
}

/** Corps éligibles à la palette : mêmes règles que l'ancienne barre. */
function collectEntries(): PaletteEntry[] {
  const entries: PaletteEntry[] = [];
  forEachBody(CELESTIAL_CONFIG, ({ name, config: cfg }) => {
    if (cfg.kind === 'skybox') return;
    // Petits corps sans texture surface : naviguables uniquement par leurs labels Explo.
    if (SMALL_BODY_KINDS.has(cfg.kind) && !cfg.textures?.surface) return;

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
  });
  return entries;
}

function kindTag(kind: BodyKind): string {
  if (kind === 'moon') return t('nav.kind.moon');
  if (kind === 'dwarf') return t('nav.kind.dwarf');
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
    return { setActive: () => {}, close: () => {} };
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
  results.append(emptyEl);

  let lastVisible: PaletteEntry[] = [];

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
    emptyEl.hidden = visible.length > 0;
    emptyEl.textContent = t('events.empty');

    highlighted = -1;
    lastVisible = visible;
    syncHighlight(visible);
  };

  const syncHighlight = (visible: PaletteEntry[]): void => {
    visible.forEach((entry, index) => {
      const isHighlighted = index === highlighted;
      entry.button.classList.toggle('is-highlighted', isHighlighted);
      entry.button.setAttribute('aria-selected', String(isHighlighted));
    });
    const active = highlighted >= 0 ? visible[highlighted] : undefined;
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
      requestAnimationFrame(() => input.focus());
    }
  };
  coordinator?.register('body-palette', () => setOpen(false));

  trigger.addEventListener('click', () => setOpen(!open));

  input.addEventListener('input', () => render(input.value));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const dir = event.key === 'ArrowDown' ? 1 : -1;
      highlighted =
        (highlighted + dir + lastVisible.length) %
        Math.max(1, lastVisible.length);
      syncHighlight(lastVisible);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const entry = lastVisible[highlighted] ?? lastVisible[0];
      if (entry) onSelect(entry.name);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      trigger.focus();
    }
  });

  // Clic sur une entrée : commande de navigation partagée.
  results.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      '.palette-item'
    );
    if (button) onSelect(button.id.replace('orbit-', ''));
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
    close: () => setOpen(false),
  };
}
