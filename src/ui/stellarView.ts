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
import { loadNeighbours } from './neighbourData';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { NeighbourhoodScene } from '@/components/stellar/NeighbourhoodScene';
import {
  distanceFacts,
  namesOf,
  systemName,
  systemPrimary,
  type NeighbourFile,
  type NeighbourSystem,
} from '@/core/neighbours';
import type { ExoplanetFile } from '@/core/exoplanets';
import {
  distanceFromSunPc,
  motionWindow,
  solarSceneToStellar,
  parsecsToLightYears,
  scaleRingsPc,
  yearsFromJ2000,
} from '@/core/stellarSpace';
import {
  auRingLabelPriority,
  AXIS_LABEL_PRIORITY,
  parsecRingLabelPriority,
  starLabelPriority,
  SUN_LABEL_PRIORITY,
} from '@/core/stellarLabels';
import {
  auToParsecs,
  AU_PER_PARSEC,
  fieldWidthPc,
  homeDirection,
  KM_PER_AU,
  readField,
  START_DISTANCE_AU,
  transitionDistancePc,
  transitionProgress,
} from '@/core/scaleTransition';
import {
  parseStellarAddress,
  resolveStar,
  serializeStellarAddress,
  snapYears,
  solarIdentity,
  starSlug,
} from '@/core/stellarPermalink';
import { loadDeferredMessages } from '@/i18n/deferredMessages';
import { getLocale, onLocaleChange, t } from '@/i18n';
import { prefersReducedMotion } from '@/utils/reducedMotion';
import Logger from '@/utils/Logger';
import { getAnnouncer } from './announcer';
import { claimHistory } from './permalink';
import type { OverlayCoordinator } from './overlayCoordinator';
import {
  maskElements,
  restoreElements,
  type MaskedElement,
} from './stellarMask';
import './stellarView.css';
import { el, fact, fixed, number } from './stellarDom';
import { createVolumePanel, type VolumePanel } from './stellarVolumePanel';

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
  /**
   * Le regard de la caméra solaire (vers sa cible, repère de la scène solaire), pour garder le cap
   * à l'arrivée. Absent ou nul : la direction d'ouverture.
   */
  gaze?: () => readonly [number, number, number] | null;
  /**
   * Ouvre l'exploration d'un hôte d'exoplanètes du ciel (`ui/systemView`, GAL-UNIVERSE-007) : la fiche
   * d'une étoile du volume étendu qui en héberge y mène (GAL-UNIVERSE-008). Absent : pas de bouton.
   */
  openSystem?: (host: string) => void;
}

/**
 * Ce que la visite guidée (`ui/stellarVisit`, un morceau à part) peut faire de la vue, et rien de plus :
 * choisir une étoile, déplacer le curseur de temps, cadrer la caméra, écrire son étape dans l'adresse.
 * Elle n'a ni la scène ni le renderer : une seule boucle, un seul rendu de remplacement.
 */
export interface VisitController {
  readonly systems: readonly NeighbourSystem[];
  /** La vue (pour y poser le panneau de la visite) et son volet latéral. */
  readonly root: HTMLElement;
  readonly side: HTMLElement;
  /** Choisit un système (rang), ou aucun (-1) : la fiche et la liste suivent. */
  select(index: number): void;
  /** Place le curseur de temps à ce décalage (années depuis la date de la scène), ramené à son pas et à sa fenêtre. */
  setYears(years: number): void;
  /** Décalage courant du curseur, et l'année absolue qu'il désigne. */
  years(): number;
  absoluteYear(): number;
  /**
   * Cadre la caméra : le centre est le système `index` (ou le Soleil si -1), à `distancePc` parsecs, en
   * gardant l'azimut. Glissement de 1,1 s, immédiat sous mouvement réduit ; un geste du visiteur l'interrompt.
   */
  frameOn(index: number, distancePc: number): void;
  /** La date de lecture de l'archive d'exoplanètes et ses systèmes, lus à la demande (`null` : illisible). */
  exoplanets(): Promise<ExoplanetFile | null>;
  /** Écrit (ou retire, avec `null`) la visite et son étape dans l'adresse. */
  setAddress(visit: { id: string; step: number } | null): void;
  /** Appelée une fois, quand la vue se ferme : la visite se défait avec elle. */
  onClose(callback: () => void): void;
}

export interface StellarView {
  /**
   * Ouvre la vue ; `focus` (un nom d'étoile) sélectionne le système qui le porte.
   * `fromAddress` : l'ADRESSE demande la vue (lien partagé, Suivant du navigateur) ; l'étoile et le
   * décalage de temps s'y lisent, et aucune entrée d'historique n'est ajoutée (l'adresse est déjà
   * la bonne). `visit` : commence la visite guidée du voisinage à son premier arrêt (GAL-UNIVERSE-005).
   */
  open(focus?: string, fromAddress?: boolean, visit?: boolean): void;
  close(): void;
  readonly isOpen: boolean;
}

export async function setupStellarView(
  host: StellarHost,
  fetchImpl: typeof fetch = fetch
): Promise<StellarView | null> {
  let file: NeighbourFile;
  try {
    file = await loadNeighbours(fetchImpl);
    if (file.stars.length === 0) throw new Error('fichier vide');
  } catch (err) {
    Logger.warn('[stellarView] étoiles voisines illisibles', err);
    return null;
  }
  // Les phrases de la vue sont hors démarrage : `t()` rendrait les clés brutes sans elles.
  await loadDeferredMessages();

  let opened: Session | null = null;

  // ---- l'adresse de l'observation (GAL-UNIVERSE-004, `core/stellarPermalink`)
  /** L'identité du Système solaire à la dernière ouverture (`solarIdentity` : sans la vue, la date ni le cadrage). */
  let baseAddress: string | null = null;
  /** Vrai quand CETTE ouverture a ajouté son entrée d'historique : fermer la retire par « Retour ». */
  let pushed = false;
  const here = (search = window.location.search): string =>
    `${window.location.pathname}${search}${window.location.hash}`;
  const solarNow = (): string =>
    solarIdentity(window.location.pathname, window.location.search);
  const writeAddress = (
    address: {
      star?: string | null;
      years?: number;
      visit?: string | null;
      step?: number;
      explore?: boolean;
      planet?: string | null;
      vol?: number;
      vstar?: string | null;
    } | null,
    how: 'push' | 'replace'
  ): void => {
    const next = here(serializeStellarAddress(window.location.search, address));
    if (next === here()) return;
    window.history[how === 'push' ? 'pushState' : 'replaceState'](
      null,
      '',
      next
    );
  };
  /**
   * Un Retour ou un Suivant du navigateur : la vue se ferme quand l'adresse ne la demande plus, et
   * s'ouvre quand elle la redemande. Rend `true` quand le mouvement ne change QUE la vue (même
   * identité solaire : `solarIdentity`, donc hors date et cadrage) : le permalien solaire ne le
   * traite alors pas (`claimHistory`), parce qu'il reselectionnerait le corps et ferait perdre le
   * cadrage du Système solaire.
   */
  claimHistory((): boolean => {
    const address = parseStellarAddress(window.location.search);
    const viewOnly = baseAddress !== null && solarNow() === baseAddress;
    // L'exploration d'un système suit l'historique comme la vue elle-même (GAL-UNIVERSE-006).
    if (opened && address) opened.followExplore(address);
    // Le volume étendu suit l'historique comme le reste de l'observation (GAL-UNIVERSE-008).
    if (opened && address) opened.followVolume(address);
    if (opened && !address) opened.close(true);
    else if (!opened && address) {
      open(undefined, true);
      // Suivant ramène l'entrée que l'ouverture avait ajoutée : elle a un prédécesseur solaire, que
      // fermer par le bouton doit retrouver par un « Retour » (sinon un doublon de l'adresse
      // solaire resterait dans l'historique, et le Retour suivant rappellerait le permalien solaire).
      if (viewOnly && opened) pushed = true;
    }
    return viewOnly;
  });

  /** Tout ce que possède une ouverture : scène, contrôles, DOM, écouteurs, éléments rendus inertes. */
  interface Session {
    scene: NeighbourhoodScene;
    controls: OrbitControls;
    root: HTMLElement;
    cleanups: Array<() => void>;
    inert: MaskedElement[];
    opener: HTMLElement | null;
    close(viaHistory?: boolean): void;
    /** Ouvre ou ferme l'exploration selon l'adresse ramenée par un Retour ou un Suivant. */
    followExplore(address: ReturnType<typeof parseStellarAddress>): void;
    /** Échelle et étoile du volume étendu ramenées par un Retour ou un Suivant. */
    followVolume(
      address: NonNullable<ReturnType<typeof parseStellarAddress>>
    ): void;
  }

  function open(focus?: string, fromAddress = false, visit = false): void {
    if (opened) return;
    // Une adresse qui demande la vue sans pouvoir l'obtenir la perd : sinon un rechargement la rejouerait.
    const refuse = (): void => {
      if (fromAddress && parseStellarAddress(window.location.search))
        writeAddress(null, 'replace');
    };
    // Pas en session VR : la scène solaire y est rendue par le casque, pas par la boucle bureau.
    if (host.renderer.xr.isPresenting) {
      refuse();
      return;
    }
    const gl = host.renderer.getContext();
    if (gl.isContextLost()) {
      getAnnouncer().announce(t('st.unavailable'));
      refuse();
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
    /** Le volume étendu (GAL-UNIVERSE-008) : créé une fois le cadrage prêt, plus bas. */
    let volumePanel: VolumePanel | null = null;

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
    const skip = el('button', 'sv-button sv-skip', 'stellar-skip');
    skip.type = 'button';
    skip.hidden = true;
    top.append(skip);
    const visitStart = el(
      'button',
      'sv-button sv-visit-start',
      'stellar-visit-start'
    );
    visitStart.type = 'button';
    top.append(visitStart);
    const head = el('div', 'sv-head');
    const scale = el('p', 'sv-scale', 'stellar-scale');
    // La largeur du champ de vue, en UA puis en années-lumière : l'échelle LUE, à chaque image.
    const field = el('p', 'sv-scale sv-field', 'stellar-field');
    // Pendant la transition seulement : dans quelle unité et dans quel repère on est.
    const stage = el('div', 'sv-scale sv-stage', 'stellar-stage');
    stage.hidden = true;
    const stageText = el('p');
    const stageNote = el('p');
    stage.append(stageText, stageNote);
    head.append(top, scale, field, stage);
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
    // L'exploration du système choisi (GAL-UNIVERSE-006) : un morceau à part, chargé au premier clic.
    const explore = el('button', 'sv-button sv-explore', 'stellar-explore');
    explore.type = 'button';
    explore.hidden = true;
    card.append(cardTitle, facts, notes, explore);
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
    // Le cap du regard solaire (jamais le roulis) : on arrive en regardant le même côté du ciel.
    const gazeSolar = host.gaze?.() ?? null;
    const homeDir = homeDirection(
      gazeSolar ? solarSceneToStellar(gazeSolar) : null
    );
    const homeDistance = scene.extentPc * 2.1;
    const startDistance = auToParsecs(START_DISTANCE_AU);
    // La transition : un recul de la caméra, du Soleil à 70 UA jusqu'à la vue d'ensemble, en une seule
    // échelle géométrique (voir core/scaleTransition). Elle vit dans la boucle de rendu : la fermer la
    // supprime avec elle, aucun minuteur à défaire.
    let transition: { t0: number } | null = null;
    // Le glissement d'une étape de visite : la caméra va d'un cadrage à un autre, dans la boucle de rendu
    // (aucun minuteur à défaire à la fermeture). Un geste du visiteur l'arrête là où il est.
    let glide: {
      t0: number;
      from: { position: THREE.Vector3; target: THREE.Vector3 };
      to: { position: THREE.Vector3; target: THREE.Vector3 };
    } | null = null;
    const GLIDE_MS = 1100;
    const placeCamera = (distance: number): void => {
      scene.camera.position.set(
        homeDir[0] * distance,
        homeDir[1] * distance,
        homeDir[2] * distance
      );
      controls.target.set(0, 0, 0);
      scene.fitClipping(distance);
      controls.update();
    };
    const endTransition = (): void => {
      if (!transition) return;
      transition = null;
      controls.minDistance = MIN_DISTANCE_PC;
      controls.enabled = true;
      placeCamera(homeDistance);
      // Le bouton qui disparaît ne doit pas emporter le focus avec lui : il revient à « Retour ».
      const hadFocus = document.activeElement === skip;
      skip.hidden = true;
      stage.hidden = true;
      if (hadFocus) back.focus();
      layout();
    };
    const home = (): void => {
      endTransition();
      placeCamera(homeDistance);
    };
    home();

    // ---- les textes, réécrits au changement de langue
    const pointerRender = (): void => {
      const sun = t('st.sun');
      title.textContent = t('st.title');
      back.textContent = t('st.back');
      reset.textContent = t('st.reset');
      scale.textContent = t('st.scale');
      skip.textContent = t('st.skip');
      visitStart.textContent = t('sv.visit.start');
      explore.textContent = t('sx.open');
      stageNote.textContent = t('st.stageNote');
      fieldText = '';
      stageUnit = '';
      renderField(true);
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
      /** Un repère du plan galactique : caché tant que le champ se lit en UA. */
      guide: boolean;
    }
    let labelItems: Label[] = [];
    const buildLabels = (sunText: string): void => {
      labels.replaceChildren();
      labelItems = [];
      const add = (
        text: string,
        className: string,
        priority: number,
        point: () => THREE.Vector3,
        guide = false
      ): void => {
        const node = el('span', `sv-label ${className}`);
        node.textContent = text;
        node.style.display = 'none';
        labels.append(node);
        labelItems.push({ el: node, priority, point, width: 0, guide });
      };
      add(
        sunText,
        'sv-label--sun',
        SUN_LABEL_PRIORITY,
        () => new THREE.Vector3(0, 0, 0)
      );
      add(
        t('st.centre'),
        'sv-label--axis',
        AXIS_LABEL_PRIORITY,
        () => new THREE.Vector3(scene.extentPc + 0.6, 0, 0),
        true
      );
      for (const r of scaleRingsPc(scene.extentPc))
        add(
          t('st.ring', {
            pc: String(r),
            ly: fixed(parsecsToLightYears(r), 1),
          }),
          'sv-label--ring',
          parsecRingLabelPriority(r),
          () => new THREE.Vector3(0, 0, r),
          true
        );
      // Les repères de l'écliptique : sous les étoiles dans la priorité des noms (core/stellarLabels).
      scene.eclipticAnchors.forEach(({ au, point }, k) =>
        add(
          t('st.ringAu', { au: fixed(au, 0) }),
          'sv-label--au',
          auRingLabelPriority(k),
          () => new THREE.Vector3(...point)
        )
      );
      systems.forEach((system, i) =>
        add(
          `${names[i]!} · ${fixed(distanceFacts(systemPrimary(system)).lightYears, 1)} ${t('nb.unit.ly')}`,
          'sv-label--star',
          starLabelPriority(systemPrimary(system)[5], scene.extentPc),
          () => new THREE.Vector3(...scene.positionOf(i))
        )
      );
      labelItems.sort((a, b) => b.priority - a.priority);
    };

    // La largeur du champ de vue, lue dans l'unité qui se lit (UA, puis années-lumière) : le texte
    // n'est réécrit que s'il change, et pas plus de dix fois par seconde.
    let fieldText = '';
    let stageUnit = '';
    let guidesVisible = true;
    let fieldAt = 0;
    const renderField = (force = false): void => {
      const now = performance.now();
      if (!force && now - fieldAt < 100) return;
      fieldAt = now;
      const distance = scene.camera.position.distanceTo(controls.target);
      const width = fieldWidthPc(
        distance,
        scene.camera.fov,
        scene.camera.aspect
      );
      const reading = readField(width);
      const text =
        reading.unit === 'au'
          ? t('st.fieldAu', { au: number(reading.au, 3) })
          : t('st.fieldLy', {
              ly: number(reading.ly, 3),
              pc: number(reading.pc, 2),
            });
      if (text !== fieldText) {
        fieldText = text;
        field.textContent = text;
      }
      const guides = reading.unit === 'ly';
      if (guides !== guidesVisible) {
        guidesVisible = guides;
        scene.setGuidesVisible(guides);
      }
      if (transition && reading.unit !== stageUnit) {
        stageUnit = reading.unit;
        stageText.textContent =
          reading.unit === 'au'
            ? t('st.stageAu', { km: fixed(KM_PER_AU / 1e6, 1) })
            : t('st.stageLy', {
                ly: fixed(parsecsToLightYears(1), 2),
                au: number(AU_PER_PARSEC, 6),
              });
      }
    };

    // Les boîtes de la vue (boutons et notes du haut, aide, volet) sont translucides : un nom posé dessous
    // se lisait à travers et brouillait leur texte sur un petit écran (iPhone SE, GAL-MOBILE-EXCELLENCE-001).
    // Un nom qui tomberait sous une boîte se pose ailleurs ou se tait, comme devant un nom plus prioritaire.
    // Les emprises sont relues au plus toutes les 250 ms.
    let boxes: DOMRect[] = [];
    let boxesAt = -Infinity;
    const obstacles = (): DOMRect[] => {
      const now = performance.now();
      if (now - boxesAt < 250) return boxes;
      boxesAt = now;
      boxes = [...head.children, help, side]
        .map((node) => node.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0);
      return boxes;
    };
    const updateLabels = (): void => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const placed: Array<{ x: number; y: number; w: number }> = [];
      const covered = obstacles();
      for (const item of labelItems) {
        const s = scene.projectVector(item.point(), width, height);
        let visible = false;
        if (
          s &&
          !(item.guide && !guidesVisible) &&
          s.x > 0 &&
          s.x < width &&
          s.y > 60 &&
          s.y < height
        ) {
          // Un élément en `display: none` mesure 0 : on l'affiche avant de le mesurer.
          if (item.el.style.display === 'none') item.el.style.display = '';
          if (item.width === 0) item.width = item.el.offsetWidth || 90;
          const x = s.x;
          // Le nom se pose sous le point ; s'il y recouvre un nom plus prioritaire, au-dessus ; sinon il se tait.
          for (const y of [s.y + 16, s.y - 16]) {
            const clash = placed.some(
              (p) =>
                Math.abs(p.x - x) < (p.w + item.width) / 2 + 6 &&
                Math.abs(p.y - y) < 18
            );
            if (clash) continue;
            const left = x - item.width / 2;
            const under = covered.some(
              (r) =>
                left < r.right &&
                left + item.width > r.left &&
                y - 8 < r.bottom &&
                y + 8 > r.top
            );
            if (under) continue;
            placed.push({ x, y, w: item.width });
            item.el.style.transform = `translate(${Math.round(x - item.width / 2)}px, ${Math.round(y - 8)}px)`;
            // Où est le point lui-même (px écran) : les tests cliquent l'étoile, pas son nom.
            item.el.dataset['sx'] = String(Math.round(s.x));
            item.el.dataset['sy'] = String(Math.round(s.y));
            visible = true;
            break;
          }
        }
        item.el.style.display = visible ? '' : 'none';
      }
    };

    // ---- l'adresse suit l'observation (étoile choisie, décalage de temps), une fois l'entrée posée
    let addressLive = false;
    let visitAddress: { id: string; step: number } | null = null;
    // L'exploration en cours, la planète qu'elle a choisie, et le rendu qu'elle emprunte à la vue.
    let exploring: { close(viaHistory?: boolean): void } | null = null;
    let exploredPlanet: string | null = null;
    let exploreRender: (() => void) | null = null;
    const syncAddress = (): void => {
      if (!addressLive) return;
      writeAddress(
        {
          star: current >= 0 ? starSlug(names[current]!) : undefined,
          years: offsetYears,
          ...(visitAddress
            ? { visit: visitAddress.id, step: visitAddress.step }
            : {}),
          ...(exploring ? { explore: true, planet: exploredPlanet } : {}),
          ...(volumePanel?.address() ?? {}),
        },
        'replace'
      );
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
      volumePanel?.setYears(yearsNow());
      renderTime();
      renderCard();
      syncAddress();
    });

    // ---- la fiche de l'étoile choisie
    function renderCard(): void {
      explore.hidden = current < 0;
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
      // Une étoile du voisinage et une étoile du volume ne sont jamais choisies ensemble.
      if (index >= 0) volumePanel?.clearSelection();
      for (const b of Array.from(list.querySelectorAll('button')))
        b.setAttribute(
          'aria-pressed',
          String(Number(b.dataset['index']) === index)
        );
      renderCard();
      // La hauteur du volet change avec la fiche : la zone libre aussi.
      layout();
      syncAddress();
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
      // Un geste pendant la transition la termine : il ne choisit pas une étoile par accident.
      if (transition) {
        endTransition();
        start = null;
        return;
      }
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
      else {
        // Les 61 voisines passent d'abord (points de 10 px) ; sinon l'étoile du volume la plus proche.
        const v =
          volumePanel?.pick(
            event.clientX - rect.left,
            event.clientY - rect.top,
            rect.width,
            rect.height,
            PICK_RADIUS_PX
          ) ?? -1;
        if (v >= 0) void volumePanel?.select(v);
      }
    };
    const wheel = (): void => endTransition();
    surface.addEventListener('pointerdown', down);
    surface.addEventListener('pointerup', up);
    surface.addEventListener('wheel', wheel, { passive: true });
    cleanups.push(() => {
      surface.removeEventListener('pointerdown', down);
      surface.removeEventListener('pointerup', up);
      surface.removeEventListener('wheel', wheel);
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
      if (transition && !/^(Tab|Shift|Control|Alt|Meta)$/.test(event.key)) {
        // Une touche pendant la transition la termine (aucun autre effet : le geste n'est pas rejoué).
        endTransition();
        event.preventDefault();
        return;
      }
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
    skip.addEventListener('click', endTransition);
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
          if (opened === session) {
            pointerRender();
            volumePanel?.rerender();
          }
        });
      })
    );

    // ---- la boucle : le rendu de remplacement de l'application
    scene.setYears(yearsNow(), true);
    host.animation.setRenderOverride(() => {
      // Pendant l'exploration d'un système, le même rendu de remplacement dessine SA scène.
      if (exploreRender) {
        exploreRender();
        return;
      }
      if (transition) {
        const p = transitionProgress(performance.now() - transition.t0);
        if (p >= 1) endTransition();
        else placeCamera(transitionDistancePc(p, startDistance, homeDistance));
      } else {
        stepGlide();
        controls.update();
      }
      renderField();
      scene.render(host.renderer);
      updateLabels();
      volumePanel?.frame(window.innerWidth, window.innerHeight);
    });

    // ---- la visite guidée : un morceau à part, chargé au premier usage, qui ne touche la vue que par ce contrôleur
    const closers: Array<() => void> = [];
    let archive: Promise<ExoplanetFile | null> | null = null;
    const frameOn = (index: number, distancePc: number): void =>
      frameOnPoint(
        index >= 0 ? scene.positionOf(index) : [0, 0, 0],
        distancePc
      );
    const frameOnPoint = (
      point: readonly [number, number, number],
      distancePc: number
    ): void => {
      endTransition();
      const target = new THREE.Vector3(...point);
      const offset = scene.camera.position.clone().sub(controls.target);
      if (offset.lengthSq() < 1e-12) offset.set(...homeDir);
      offset.setLength(distancePc);
      const position = target.clone().add(offset);
      if (reduced) {
        glide = null;
        controls.target.copy(target);
        scene.camera.position.copy(position);
        scene.fitClipping(distancePc);
        controls.update();
        return;
      }
      glide = {
        t0: performance.now(),
        from: {
          position: scene.camera.position.clone(),
          target: controls.target.clone(),
        },
        to: { position, target },
      };
    };
    const stepGlide = (): void => {
      if (!glide) return;
      const p = Math.min(1, (performance.now() - glide.t0) / GLIDE_MS);
      const e = p * p * (3 - 2 * p);
      controls.target.lerpVectors(glide.from.target, glide.to.target, e);
      scene.camera.position.lerpVectors(
        glide.from.position,
        glide.to.position,
        e
      );
      scene.fitClipping(scene.camera.position.distanceTo(controls.target));
      if (p >= 1) glide = null;
    };

    // ---- le volume étendu (GAL-UNIVERSE-008) : commandes, fiche, données à la demande
    volumePanel = createVolumePanel({
      scene,
      controls,
      renderer: host.renderer,
      side,
      systemCard: card,
      labels,
      yearsFromJ2000: yearsNow,
      deselectSystem: () => {
        if (current >= 0) select(-1, false);
      },
      frameOn: frameOnPoint,
      syncAddress: () => syncAddress(),
      layout: () => layout(),
      ...(host.openSystem
        ? {
            openSystem: (name: string) => {
              // Fermer la vue d'abord : son entrée d'historique est retirée par un « Retour », asynchrone.
              // L'exploration ne s'ouvre qu'une fois ce Retour arrivé, sinon il retirerait SON entrée.
              const viaBack = pushed;
              session.close();
              if (viaBack)
                window.addEventListener(
                  'popstate',
                  () => host.openSystem?.(name),
                  { once: true }
                );
              else host.openSystem?.(name);
            },
          }
        : {}),
    });
    closers.push(() => {
      volumePanel?.dispose();
      volumePanel = null;
    });
    const controller: VisitController = {
      systems,
      root,
      side,
      select: (index) => select(index, false),
      setYears: (years) => {
        offsetYears = snapYears(years, timeWindow, TIME_STEP_YEARS);
        time.value = String(offsetYears);
        scene.setYears(yearsNow());
        renderTime();
        renderCard();
        syncAddress();
      },
      years: () => offsetYears,
      absoluteYear: () => 2000 + yearsNow(),
      frameOn,
      exoplanets: () =>
        (archive ??= fetchImpl('/assets/sky/exoplanets.json')
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json() as Promise<ExoplanetFile>;
          })
          .catch((error: unknown) => {
            Logger.warn(
              '[stellarView] archive des exoplanètes illisible',
              error
            );
            return null;
          })),
      setAddress: (visit) => {
        visitAddress = visit;
        syncAddress();
      },
      onClose: (callback) => closers.push(callback),
    };
    let visitModule: Promise<typeof import('./stellarVisit')> | null = null;
    const beginVisit = (id: string | null, step = 0): void => {
      void (visitModule ??= import('./stellarVisit').catch((error: unknown) => {
        visitModule = null;
        throw error;
      }))
        .then((module) => {
          if (opened !== session) return;
          if (!module.begin(controller, id, step)) {
            getAnnouncer().announce(t('sv.visit.unknown'));
            visitAddress = null;
            syncAddress();
          }
        })
        .catch((error: unknown) =>
          Logger.warn('[stellarView] visite guidée indisponible', error)
        );
    };
    visitStart.addEventListener('click', () => beginVisit(null));
    // Un geste du visiteur interrompt le glissement : la caméra reste où il l'a prise.
    const stopGlide = (): void => {
      glide = null;
    };
    surface.addEventListener('pointerdown', stopGlide);
    surface.addEventListener('wheel', stopGlide, { passive: true });
    cleanups.push(() => {
      surface.removeEventListener('pointerdown', stopGlide);
      surface.removeEventListener('wheel', stopGlide);
    });

    // ---- l'exploration du système choisi (GAL-UNIVERSE-006)
    let explorerModule: Promise<typeof import('./systemExplorer')> | null =
      null;
    /** Vrai quand CETTE exploration a ajouté son entrée d'historique : la fermer la retire par « Retour ». */
    let explorePushed = false;
    let exploreRequested = false;
    let closingViaHistory = false;
    const beginExplore = (
      fromAddress: boolean,
      planet: string | null = null,
      historyEntry = false
    ): void => {
      if (current < 0 || exploring || exploreRequested) return;
      exploreRequested = true;
      endTransition();
      glide = null;
      const index = current;
      void (explorerModule ??= import('./systemExplorer').catch(
        (error: unknown) => {
          explorerModule = null;
          throw error;
        }
      ))
        .then((module) =>
          module.openSystemExplorer({
            root,
            renderer: host.renderer,
            setRender: (fn) => {
              exploreRender = fn;
            },
            system: systems[index]!,
            name: names[index]!,
            exoplanets: controller.exoplanets,
            fetchImpl,
            initialPlanet: planet,
            onPlanet: (slug) => {
              exploredPlanet = slug;
              syncAddress();
            },
            onClose: () => {
              const viaHistory = closingViaHistory;
              closingViaHistory = false;
              exploring = null;
              exploredPlanet = null;
              if (opened !== session) return;
              layout();
              explore.focus();
              if (viaHistory) explorePushed = false;
              else if (explorePushed) {
                explorePushed = false;
                window.history.back();
              } else syncAddress();
            },
          })
        )
        .then((explorer) => {
          exploreRequested = false;
          if (opened !== session) {
            explorer.close();
            return;
          }
          exploring = {
            close: (viaHistory = false) => {
              closingViaHistory = viaHistory;
              explorer.close();
            },
          };
          if (!fromAddress && addressLive) {
            // Un geste ajoute UNE entrée : le Retour du navigateur revient au voisinage.
            explorePushed = true;
            writeAddress(
              {
                star: starSlug(names[index]!),
                years: offsetYears,
                explore: true,
                planet: exploredPlanet,
              },
              'push'
            );
          } else {
            // Ramenée par Suivant, l'entrée de l'exploration a un prédécesseur (le voisinage) : la fermer
            // doit le retrouver par un Retour, sinon un doublon resterait et fermer la vue la rouvrirait.
            if (historyEntry) explorePushed = true;
            syncAddress();
          }
        })
        .catch((error: unknown) => {
          exploreRequested = false;
          Logger.warn(
            '[stellarView] exploration du système indisponible',
            error
          );
          getAnnouncer().announce(t('sx.unavailable'));
        });
    };
    explore.addEventListener('click', () => beginExplore(false));
    closers.push(() => exploring?.close(true));

    const session: Session = {
      scene,
      controls,
      root,
      cleanups,
      inert,
      opener,
      followVolume(address) {
        void volumePanel?.applyAddress({
          ...(address.vol ? { vol: address.vol } : {}),
          ...(address.vstar ? { vstar: address.vstar } : {}),
        });
      },
      followExplore(address) {
        if (!address) return;
        if (exploring && !address.explore) exploring.close(true);
        else if (!exploring && address.explore && current >= 0)
          beginExplore(true, address.planet ?? null, true);
      },
      close(viaHistory = false) {
        if (opened !== session) return;
        opened = null;
        addressLive = false;
        // D'abord rendre la boucle à la scène solaire : plus rien ne dessine la scène stellaire.
        host.animation.setRenderOverride(null);
        for (const closer of closers) closer();
        for (const cleanup of cleanups) cleanup();
        controls.dispose();
        scene.dispose();
        root.remove();
        document.body.classList.remove('stellar-view-active');
        restoreElements(inert);
        getAnnouncer().announce(t('st.closed'));
        // Le focus revient où il était ; à défaut, au canevas de la scène solaire.
        (opener && document.contains(opener) ? opener : canvas).focus?.();
        // L'adresse revient au Système solaire. Fermée PAR l'historique (Retour du navigateur), elle y
        // est déjà. Sinon : l'entrée que l'ouverture avait ajoutée est retirée par un « Retour » (le
        // Suivant du navigateur rouvre la vue) ; une adresse arrivée par un lien, qui n'a pas d'entrée
        // à elle, est simplement réécrite.
        if (viaHistory) pushed = false;
        else if (pushed) {
          pushed = false;
          window.history.back();
        } else writeAddress(null, 'replace');
      },
    };
    opened = session;
    // Mouvement réduit : arrivée directe, sans animation (le champ affiché dit la même chose).
    if (!reduced) {
      transition = { t0: performance.now() };
      controls.enabled = false;
      controls.minDistance = 1e-7;
      placeCamera(startDistance);
      skip.hidden = false;
      stage.hidden = false;
    }
    pointerRender();
    layout();
    const wanted = focus
      ? systems.findIndex((s) =>
          namesOf(s).some((n) => n.toLowerCase() === focus.toLowerCase())
        )
      : -1;
    if (wanted >= 0) select(wanted, false);
    // L'observation que l'adresse décrit : le décalage de temps d'abord (la fiche le lit), puis l'étoile.
    const requested = fromAddress
      ? parseStellarAddress(window.location.search)
      : null;
    let unknownStar = false;
    if (requested) {
      if (requested.years !== undefined) {
        offsetYears = snapYears(requested.years, timeWindow, TIME_STEP_YEARS);
        time.value = String(offsetYears);
        scene.setYears(yearsNow());
        renderTime();
        renderCard();
      }
      if (requested.star !== undefined) {
        const index =
          requested.star === null
            ? -1
            : resolveStar(requested.star, systems.map(namesOf));
        if (index >= 0) select(index, false);
        else unknownStar = true;
      }
    }
    // L'entrée d'historique : un lien (ou Suivant) arrive déjà sur l'adresse de la vue, on la remet
    // seulement au propre (une étoile inconnue en est retirée) ; un geste ajoute une entrée.
    baseAddress = solarNow();
    const observation = {
      star: current >= 0 ? starSlug(names[current]!) : undefined,
      years: offsetYears,
    };
    if (requested) {
      pushed = false;
      writeAddress(observation, 'replace');
    } else {
      pushed = true;
      writeAddress(observation, 'push');
    }
    addressLive = true;
    getAnnouncer().announce(t('st.opened', { n: String(systems.length) }));
    // Le volume étendu demandé par l'adresse (`vol=`, `vstar=`) : chargé seulement alors.
    if (requested?.vstar === null)
      getAnnouncer().announce(t('vol.unknownStar'));
    if (requested && (requested.vol || requested.vstar))
      void volumePanel?.applyAddress({
        ...(requested.vol ? { vol: requested.vol } : {}),
        ...(requested.vstar ? { vstar: requested.vstar } : {}),
      });
    // La visite demandée par l'adresse (`visit=` et `step=`) ou par le bouton des réglages : elle fixe l'étoile
    // et le temps de chaque étape, donc elle passe après la mise en place de l'adresse.
    if (requested?.visit !== undefined && requested.visit !== null)
      beginVisit(requested.visit, requested.step ?? 0);
    else if (requested?.visit === null) {
      getAnnouncer().announce(t('sv.visit.unknown'));
      syncAddress();
    } else if (visit) beginVisit(null);
    if (unknownStar) getAnnouncer().announce(t('st.unknownStar'));
    // L'exploration demandée par l'adresse (`explore=1`, `planet=`) : seulement pour une étoile reconnue.
    if (requested?.explore && current >= 0 && requested.visit === undefined)
      beginExplore(true, requested.planet ?? null);
    if (transition) getAnnouncer().announce(t('st.transitionStart'));
    renderField(true);
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

/**
 * L'adresse demandait la vue et elle ne peut pas s'ouvrir (fichier des étoiles illisible) : on le
 * dit, et la demande est retirée de l'adresse pour qu'un rechargement ne la rejoue pas.
 */
export async function abandonStellarAddress(): Promise<void> {
  await loadDeferredMessages();
  getAnnouncer().announce(t('st.dataUnavailable'));
  if (parseStellarAddress(window.location.search))
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${serializeStellarAddress(window.location.search, null)}${window.location.hash}`
    );
}
