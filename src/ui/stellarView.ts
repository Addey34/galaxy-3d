/**
 * LE VOISINAGE SOLAIRE EN 3D : l'interface de la vue stellaire. Chargée à la demande (un clic sur
 * « Voisinage solaire en 3D » ou sur le bouton d'une fiche d'étoile), jamais au démarrage.
 *
 * Une seule boucle, un seul renderer : la vue pose un rendu de remplacement dans `AnimationSystem`
 * (`setRenderOverride`), qui fige la simulation solaire (la date ne dérive pas, l'horloge se réancre
 * à la reprise) et dessine `NeighbourhoodScene` à la place. La vue possède sa scène, ses contrôles
 * et son DOM ; `close()` retire le rendu, libère les ressources GPU, rend la page à l'état exact où
 * elle l'avait trouvée (éléments rendus inertes puis rétablis, focus rendu au déclencheur).
 *
 * Les contrôles sont attachés à une SURFACE posée au-dessus du canevas : les écouteurs de la scène
 * solaire (sélecteur de corps, fiches du ciel, contrôles de caméra) sont sur le canevas et ne
 * reçoivent donc rien. Mouvement réduit : pas d'amortissement. Clavier complet : flèches, + et -,
 * Origine, Échap. Une liste des étoiles (boutons) donne le même accès que le clic, sans la souris.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { NeighbourhoodScene } from '@/components/stellar/NeighbourhoodScene';
import {
  distanceFacts,
  namesOf,
  systemName,
  systemPrimary,
  type NeighbourFile,
} from '@/core/neighbours';
import {
  distanceFromSunPc,
  motionWindow,
  parsecsToLightYears,
  scaleRingsPc,
  yearsFromJ2000,
} from '@/core/stellarSpace';
import { loadDeferredMessages } from '@/i18n/deferredMessages';
import { getLocale, onLocaleChange, t } from '@/i18n';
import { prefersReducedMotion } from '@/utils/reducedMotion';
import Logger from '@/utils/Logger';
import { getAnnouncer } from './announcer';
import type { OverlayCoordinator } from './overlayCoordinator';
import {
  maskElements,
  restoreElements,
  type MaskedElement,
} from './stellarMask';
import './stellarView.css';

export const NEIGHBOURS_URL = '/assets/sky/neighbours.json';
/** Rayon de capture d'un clic ou d'un tap, en pixels. */
const PICK_RADIUS_PX = 22;
const CLICK_MOVE_TOLERANCE = 5;
const KEY_ROTATE_RAD = (6 * Math.PI) / 180;
const KEY_ZOOM = 1.15;
const MIN_DISTANCE_PC = 0.25;
const TIME_STEP_YEARS = 100;

/** Ce que la vue demande à l'application : le renderer et la boucle (un seul de chaque). */
export interface StellarHost {
  animation: {
    setRenderOverride(render: ((delta: number) => void) | null): void;
  };
  renderer: THREE.WebGLRenderer;
  coordinator: OverlayCoordinator;
  /** Date de la scène solaire au moment de l'ouverture. */
  simulationDate: () => Date;
}

export interface StellarView {
  /** Ouvre la vue ; `focus` (un nom d'étoile) sélectionne le système qui le porte. */
  open(focus?: string): void;
  close(): void;
  readonly isOpen: boolean;
}

function number(value: number, digits: number): string {
  return new Intl.NumberFormat(getLocale(), {
    maximumSignificantDigits: digits,
  }).format(value);
}

function fixed(value: number, digits: number): string {
  return new Intl.NumberFormat(getLocale(), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  id?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (id) node.id = id;
  return node;
}

function fact(label: string, value: string): HTMLElement[] {
  const dt = el('dt');
  dt.textContent = label;
  const dd = el('dd');
  dd.textContent = value;
  return [dt, dd];
}

export async function setupStellarView(
  host: StellarHost,
  fetchImpl: typeof fetch = fetch
): Promise<StellarView | null> {
  let file: NeighbourFile;
  try {
    const res = await fetchImpl(NEIGHBOURS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    file = (await res.json()) as NeighbourFile;
    if (!Array.isArray(file.stars) || file.stars.length === 0)
      throw new Error('fichier vide');
  } catch (err) {
    Logger.warn('[stellarView] étoiles voisines illisibles', err);
    return null;
  }
  // Les phrases de la vue sont hors démarrage : `t()` rendrait les clés brutes sans elles.
  await loadDeferredMessages();

  let opened: Session | null = null;

  /** Tout ce que possède une ouverture : scène, contrôles, DOM, écouteurs, éléments rendus inertes. */
  interface Session {
    scene: NeighbourhoodScene;
    controls: OrbitControls;
    root: HTMLElement;
    cleanups: Array<() => void>;
    inert: MaskedElement[];
    opener: HTMLElement | null;
    close(): void;
  }

  function open(focus?: string): void {
    if (opened) return;
    // Pas en session VR : la scène solaire y est rendue par le casque, pas par la boucle bureau.
    if (host.renderer.xr.isPresenting) return;
    const gl = host.renderer.getContext();
    if (gl.isContextLost()) {
      getAnnouncer().announce(t('st.unavailable'));
      return;
    }
    // Le déclencheur se lit AVANT de fermer les surfaces : `closeAll` déplace le focus.
    const active =
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
        ? document.activeElement
        : null;
    // Un bouton des Réglages ou d'une fiche est masqué à l'ouverture : le focus revient à la surface
    // qui l'a menée jusqu'ici (son bouton dans la barre d'outils).
    const opener: HTMLElement | null = active?.closest('#orbit-options')
      ? document.getElementById('settings-trigger')
      : active?.closest('.surface--info')
        ? document.getElementById('info-trigger')
        : active;
    host.coordinator.closeAll();
    const reduced = prefersReducedMotion();
    const cleanups: Array<() => void> = [];
    const canvas = host.renderer.domElement;

    const scene = new NeighbourhoodScene(
      file.stars,
      window.innerWidth / Math.max(1, window.innerHeight)
    );
    const systems = scene.systems;
    const names = systems.map(systemName);
    const sceneYears = yearsFromJ2000(host.simulationDate());
    // Curseur, année affichée et calcul décrivent le même instant : voir `motionWindow`.
    const timeWindow = motionWindow(sceneYears, TIME_STEP_YEARS);
    let offsetYears = 0;
    let current = -1;

    // ---- le DOM de la vue
    const root = el('section', 'stellar-view', 'stellar-view');
    root.setAttribute('aria-labelledby', 'stellar-view-title');
    const top = el('header', 'sv-top');
    const title = el('h2', 'sv-title', 'stellar-view-title');
    const back = el('button', 'sv-button sv-back', 'stellar-back');
    back.type = 'button';
    const reset = el('button', 'sv-button', 'stellar-reset');
    reset.type = 'button';
    top.append(title, back, reset);
    const head = el('div', 'sv-head');
    const scale = el('p', 'sv-scale', 'stellar-scale');
    head.append(top, scale);
    const surface = el('div', 'sv-surface', 'stellar-surface');
    surface.tabIndex = 0;
    surface.setAttribute('role', 'group');
    surface.setAttribute('aria-describedby', 'stellar-help');
    const help = el('p', 'sv-help', 'stellar-help');
    const labels = el('div', 'sv-labels');
    labels.setAttribute('aria-hidden', 'true');
    const side = el('aside', 'sv-side');
    const listTitle = el('h3', 'sv-heading', 'stellar-list-title');
    const list = el('ul', 'sv-list', 'stellar-list');
    list.setAttribute('aria-labelledby', 'stellar-list-title');
    const card = el('div', 'sv-card', 'stellar-card');
    card.setAttribute('role', 'region');
    card.setAttribute('aria-labelledby', 'stellar-card-title');
    const cardTitle = el('h3', 'sv-heading', 'stellar-card-title');
    const facts = el('dl', 'exo-facts');
    const notes = el('div', 'sv-notes');
    card.append(cardTitle, facts, notes);
    const timeBox = el('div', 'sv-time');
    const timeLabel = el('label', 'sv-time-label');
    timeLabel.htmlFor = 'stellar-time';
    const time = el('input', 'sv-time-input', 'stellar-time');
    time.type = 'range';
    time.min = String(timeWindow.min);
    time.max = String(timeWindow.max);
    time.step = String(TIME_STEP_YEARS);
    time.value = '0';
    const timeOut = el('output', 'sv-time-out', 'stellar-time-out');
    timeOut.htmlFor = 'stellar-time';
    const timeNote = el('p', 'sv-note');
    timeBox.append(timeLabel, time, timeOut, timeNote);
    side.append(listTitle, list, card, timeBox);
    const frameNote = el('p', 'sv-note sv-frame');
    const symbolicNote = el('p', 'sv-note sv-symbolic');
    side.append(symbolicNote, frameNote);
    root.append(surface, labels, head, help, side);
    document.body.append(root);

    // ---- les éléments de la scène solaire : rendus inertes et invisibles, rétablis à la fermeture
    const toMask: Element[] = [];
    for (const child of Array.from(document.body.children)) {
      if (
        child === root ||
        child === canvas ||
        /^(SCRIPT|STYLE|LINK|NOSCRIPT)$/.test(child.tagName) ||
        child.hasAttribute('aria-live') ||
        child.classList.contains('sr-only') ||
        child.hasAttribute('data-stellar-hidden')
      )
        continue;
      toMask.push(child);
    }
    // L'état `inert` initial de chaque élément est mémorisé et rendu tel quel (stellarMask).
    const inert = maskElements(toMask);
    document.body.classList.add('stellar-view-active');

    // ---- les contrôles, sur la surface (jamais sur le canevas solaire)
    const controls = new OrbitControls(scene.camera, surface);
    controls.target.set(0, 0, 0);
    controls.enableDamping = !reduced;
    controls.dampingFactor = 0.12;
    controls.minDistance = MIN_DISTANCE_PC;
    controls.maxDistance = scene.extentPc * 6;
    controls.screenSpacePanning = true;
    const home = (): void => {
      const d = scene.extentPc * 2.1;
      scene.camera.position.set(d * 0.72, d * 0.5, d * 0.62);
      controls.target.set(0, 0, 0);
      controls.update();
    };
    home();

    // ---- les textes, réécrits au changement de langue
    const pointerRender = (): void => {
      const sun = t('st.sun');
      title.textContent = t('st.title');
      back.textContent = t('st.back');
      reset.textContent = t('st.reset');
      scale.textContent = t('st.scale');
      help.textContent = t('st.help');
      surface.setAttribute('aria-label', t('st.title'));
      listTitle.textContent = t('st.list');
      cardTitle.textContent = t('st.selected');
      timeLabel.textContent = t('st.timeLabel');
      timeNote.textContent = t('st.timeLimit');
      symbolicNote.textContent = t('st.symbolic');
      frameNote.textContent = t('st.frame');
      list.replaceChildren(
        ...systems.map((system, i) => {
          const item = el('li');
          const button = el('button', 'sv-star');
          button.type = 'button';
          button.dataset['index'] = String(i);
          button.setAttribute('aria-pressed', String(i === current));
          button.textContent = t('st.listItem', {
            name: names[i]!,
            ly: fixed(distanceFacts(systemPrimary(system)).lightYears, 2),
          });
          button.addEventListener('click', () => select(i));
          item.append(button);
          return item;
        })
      );
      renderTime();
      renderCard();
      buildLabels(sun);
    };

    // ---- les noms : un par étoile, plus le Soleil, l'axe et les cercles d'échelle
    interface Label {
      el: HTMLElement;
      priority: number;
      point(): THREE.Vector3;
      width: number;
    }
    let labelItems: Label[] = [];
    const buildLabels = (sunText: string): void => {
      labels.replaceChildren();
      labelItems = [];
      const add = (
        text: string,
        className: string,
        priority: number,
        point: () => THREE.Vector3
      ): void => {
        const node = el('span', `sv-label ${className}`);
        node.textContent = text;
        node.style.display = 'none';
        labels.append(node);
        labelItems.push({ el: node, priority, point, width: 0 });
      };
      add(sunText, 'sv-label--sun', 1000, () => new THREE.Vector3(0, 0, 0));
      add(
        t('st.centre'),
        'sv-label--axis',
        900,
        () => new THREE.Vector3(scene.extentPc + 0.6, 0, 0)
      );
      for (const r of scaleRingsPc(scene.extentPc))
        add(
          t('st.ring', {
            pc: String(r),
            ly: fixed(parsecsToLightYears(r), 1),
          }),
          'sv-label--ring',
          // Sous TOUTES les étoiles (priorité 50 à 100) : un repère d'échelle ne masque jamais un nom d'étoile.
          50 - r,
          () => new THREE.Vector3(0, 0, r)
        );
      systems.forEach((system, i) =>
        add(
          `${names[i]!} · ${fixed(distanceFacts(systemPrimary(system)).lightYears, 1)} ${t('nb.unit.ly')}`,
          'sv-label--star',
          100 - systemPrimary(system)[5] * 10,
          () => new THREE.Vector3(...scene.positionOf(i))
        )
      );
      labelItems.sort((a, b) => b.priority - a.priority);
    };

    const updateLabels = (): void => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const placed: Array<{ x: number; y: number; w: number }> = [];
      for (const item of labelItems) {
        const s = scene.projectVector(item.point(), width, height);
        let visible = false;
        if (s && s.x > 0 && s.x < width && s.y > 60 && s.y < height) {
          // Un élément en `display: none` mesure 0 : on l'affiche avant de le mesurer.
          if (item.el.style.display === 'none') item.el.style.display = '';
          if (item.width === 0) item.width = item.el.offsetWidth || 90;
          const x = s.x;
          const y = s.y + 16;
          const clash = placed.some(
            (p) =>
              Math.abs(p.x - x) < (p.w + item.width) / 2 + 6 &&
              Math.abs(p.y - y) < 18
          );
          if (!clash) {
            placed.push({ x, y, w: item.width });
            item.el.style.transform = `translate(${Math.round(x - item.width / 2)}px, ${Math.round(y - 8)}px)`;
            visible = true;
          }
        }
        item.el.style.display = visible ? '' : 'none';
      }
    };

    // ---- le temps : position à la date de la scène, déplacée en ligne droite
    const yearsNow = (): number => timeWindow.base + offsetYears;
    function renderTime(): void {
      const absolute = 2000 + yearsNow();
      const sign = offsetYears > 0 ? '+' : '';
      timeOut.textContent =
        offsetYears === 0 && timeWindow.base === sceneYears
          ? t('st.timeNow')
          : t('st.timeValue', {
              years: `${sign}${new Intl.NumberFormat(getLocale()).format(offsetYears)}`,
              year: new Intl.NumberFormat(getLocale(), {
                maximumFractionDigits: 0,
                useGrouping: false,
              }).format(Math.round(absolute)),
            });
      time.setAttribute('aria-valuetext', timeOut.textContent);
    }
    time.addEventListener('input', () => {
      offsetYears = Number(time.value);
      scene.setYears(yearsNow());
      renderTime();
      renderCard();
    });

    // ---- la fiche de l'étoile choisie
    function renderCard(): void {
      if (current < 0) {
        facts.replaceChildren();
        notes.textContent = t('st.noSelection');
        return;
      }
      const system = systems[current]!;
      const primary = systemPrimary(system);
      const d = distanceFacts(primary);
      const p = scene.positionOf(current);
      // Dans le repère galactique (x centre, y rotation, z pôle) : la scène a Y = z et Z = −y.
      const galactic = [p[0], -p[2], p[1]] as const;
      const away = distanceFromSunPc(p);
      const error = d.lightYearsError;
      const digits =
        error === null
          ? 2
          : Math.max(0, Math.min(5, 1 - Math.floor(Math.log10(error))));
      facts.replaceChildren(
        ...(system.members.length > 1
          ? fact(
              t('nb.card.members'),
              system.members
                .map((m) => (m[2] ? `${m[0]} (${m[2]})` : m[0]))
                .join(', ')
            )
          : []),
        ...fact(
          t('st.distSun'),
          error === null
            ? t('nb.card.distanceValue', { ly: number(d.lightYears, 4) })
            : t('nb.card.distanceError', {
                ly: fixed(d.lightYears, digits),
                err: fixed(error, digits),
              })
        ),
        ...fact(
          t('st.distAtDate'),
          t('nb.card.distanceValue', {
            ly: fixed(parsecsToLightYears(away), 2),
          })
        ),
        ...fact(
          t('st.position'),
          t('st.positionValue', {
            x: fixed(galactic[0], 2),
            y: fixed(galactic[1], 2),
            z: fixed(galactic[2], 2),
          })
        ),
        ...fact(t('nb.card.spectral'), primary[2] ?? t('nb.card.unknown')),
        ...fact(t('nb.card.vmag'), number(primary[7], 3))
      );
      const lines = [
        primary[11] === 'gaia-dr3'
          ? t('nb.card.origin.gaia', { id: primary[12] ?? '' })
          : t('nb.card.origin.hyg'),
      ];
      if (offsetYears !== 0 && primary[10] === null)
        lines.push(t('st.noRadial'));
      notes.replaceChildren(
        ...lines.map((line) => {
          const p2 = el('p', 'sv-note');
          p2.textContent = line;
          return p2;
        })
      );
    }

    function select(index: number, announce = true): void {
      current = index;
      scene.setSelected(index);
      for (const b of Array.from(list.querySelectorAll('button')))
        b.setAttribute(
          'aria-pressed',
          String(Number(b.dataset['index']) === index)
        );
      renderCard();
      // La hauteur du volet change avec la fiche : la zone libre aussi.
      layout();
      if (announce && index >= 0) {
        const primary = systemPrimary(systems[index]!);
        getAnnouncer().announce(
          t('st.selectedAnnounce', {
            name: names[index]!,
            ly: fixed(distanceFacts(primary).lightYears, 2),
          })
        );
      }
    }

    // ---- le clic ou le tap sur une étoile (même tolérance de glisser que les autres surfaces)
    let start: { id: number; x: number; y: number } | null = null;
    const down = (event: PointerEvent): void => {
      if (!event.isPrimary || event.button !== 0) return;
      start = { id: event.pointerId, x: event.clientX, y: event.clientY };
    };
    const up = (event: PointerEvent): void => {
      if (!start || event.pointerId !== start.id) return;
      const from = start;
      start = null;
      if (
        Math.hypot(event.clientX - from.x, event.clientY - from.y) >
        CLICK_MOVE_TOLERANCE
      )
        return;
      const rect = surface.getBoundingClientRect();
      const index = scene.pick(
        event.clientX - rect.left,
        event.clientY - rect.top,
        rect.width,
        rect.height,
        PICK_RADIUS_PX
      );
      if (index >= 0) select(index);
    };
    surface.addEventListener('pointerdown', down);
    surface.addEventListener('pointerup', up);
    cleanups.push(() => {
      surface.removeEventListener('pointerdown', down);
      surface.removeEventListener('pointerup', up);
    });

    // ---- le clavier : flèches (tourner), + et - (zoom), Origine (recentrer), Échap (revenir)
    const orbit = (dAzimuth: number, dPolar: number): void => {
      const offset = scene.camera.position.clone().sub(controls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      spherical.theta += dAzimuth;
      spherical.phi = Math.min(
        Math.PI - 0.05,
        Math.max(0.05, spherical.phi + dPolar)
      );
      offset.setFromSpherical(spherical);
      scene.camera.position.copy(controls.target).add(offset);
      controls.update();
    };
    const zoom = (factor: number): void => {
      const offset = scene.camera.position.clone().sub(controls.target);
      const length = Math.min(
        controls.maxDistance,
        Math.max(controls.minDistance, offset.length() * factor)
      );
      offset.setLength(length);
      scene.camera.position.copy(controls.target).add(offset);
      controls.update();
    };
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        event.preventDefault();
        session.close();
        return;
      }
      if (event.target !== surface) return;
      const handled = ((): boolean => {
        switch (event.key) {
          case 'ArrowLeft':
            orbit(KEY_ROTATE_RAD, 0);
            return true;
          case 'ArrowRight':
            orbit(-KEY_ROTATE_RAD, 0);
            return true;
          case 'ArrowUp':
            orbit(0, -KEY_ROTATE_RAD);
            return true;
          case 'ArrowDown':
            orbit(0, KEY_ROTATE_RAD);
            return true;
          case '+':
          case '=':
            zoom(1 / KEY_ZOOM);
            return true;
          case '-':
          case '_':
            zoom(KEY_ZOOM);
            return true;
          case 'Home':
            home();
            return true;
          default:
            return false;
        }
      })();
      if (handled) event.preventDefault();
    };
    root.addEventListener('keydown', keydown);
    cleanups.push(() => root.removeEventListener('keydown', keydown));
    back.addEventListener('click', () => session.close());
    reset.addEventListener('click', home);

    // Le cadrage : le centre de la zone libre (bandeau et volet exclus) reçoit le Soleil.
    const layout = (): void => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const sheet = side.getBoundingClientRect();
      const bar = head.getBoundingClientRect();
      const phone = window.matchMedia('(max-width: 640px)').matches;
      const free = phone
        ? { x0: 0, x1: w, y0: bar.bottom + 8, y1: sheet.top - 8 }
        : { x0: 0, x1: sheet.left - 8, y0: 0, y1: h };
      const dx = Math.round((free.x0 + free.x1) / 2 - w / 2);
      const dy = Math.round((free.y0 + free.y1) / 2 - h / 2);
      scene.setFraming(w, h, dx, dy);
    };
    const onResize = (): void => layout();
    window.addEventListener('resize', onResize);
    cleanups.push(() => window.removeEventListener('resize', onResize));
    cleanups.push(
      onLocaleChange(() => {
        void loadDeferredMessages().then(() => {
          if (opened === session) pointerRender();
        });
      })
    );

    // ---- la boucle : le rendu de remplacement de l'application
    scene.setYears(yearsNow(), true);
    host.animation.setRenderOverride(() => {
      controls.update();
      scene.render(host.renderer);
      updateLabels();
    });

    const session: Session = {
      scene,
      controls,
      root,
      cleanups,
      inert,
      opener,
      close() {
        if (opened !== session) return;
        opened = null;
        // D'abord rendre la boucle à la scène solaire : plus rien ne dessine la scène stellaire.
        host.animation.setRenderOverride(null);
        for (const cleanup of cleanups) cleanup();
        controls.dispose();
        scene.dispose();
        root.remove();
        document.body.classList.remove('stellar-view-active');
        restoreElements(inert);
        getAnnouncer().announce(t('st.closed'));
        // Le focus revient où il était ; à défaut, au canevas de la scène solaire.
        (opener && document.contains(opener) ? opener : canvas).focus?.();
      },
    };
    opened = session;
    pointerRender();
    layout();
    const wanted = focus
      ? systems.findIndex((s) =>
          namesOf(s).some((n) => n.toLowerCase() === focus.toLowerCase())
        )
      : -1;
    if (wanted >= 0) select(wanted, false);
    getAnnouncer().announce(t('st.opened', { n: String(systems.length) }));
    back.focus();
  }

  return {
    open,
    close: () => opened?.close(),
    get isOpen() {
      return opened !== null;
    },
  };
}
