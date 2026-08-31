/**
 * Couche de labels projetés — active en mode Éducatif ET Exploration.
 *
 * En Exploration (vraie échelle), les corps sont des points minuscules perdus dans le vide :
 * labels + points de repère maintiennent leur visibilité. En Éducatif, les corps sont des
 * meshes visibles : les labels apparaissent légèrement au-dessus de chaque corps pour
 * l'identifier. Dans les deux modes, la cible masque son nom pour ne pas couvrir l'astre,
 * et le clic cible le corps via la commande
 * de navigation partagée (`PlanetNavigation`).
 *
 * En Éducatif, seuls les corps possédant un mesh (planètes, naines texturées) sont étiquetés ;
 * astéroïdes et comètes sans texture restent sans label (corps invisibles à cette échelle).
 *
 * Piloté chaque frame par `AnimationSystem.onFrame`. Inerte (aucune écriture DOM) quand
 * `setActive(false)` a été appelé.
 */
import * as THREE from 'three';
import type { CameraSystem } from '@/components/systems/CameraSystem';
import type { SceneSystem } from '@/components/systems/SceneSystem';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { flattenBodies } from '@/config/catalog';
import { onLocaleChange } from '@/i18n';
import { bodyDisplayName } from '@/i18n/bodyText';
import { bodyAccentTriplet } from './bodyAccent';
import { getSceneOverlayRects } from './sceneOverlay';
import type { PlanetNavigation } from './planetNav';

const BODY_CONFIGS = flattenBodies(CELESTIAL_CONFIG);
function labelRgb(name: string): string {
  return bodyAccentTriplet(BODY_CONFIGS.get(name));
}

const MAJOR_BODIES = new Set([
  'sun',
  'mercury',
  'venus',
  'earth',
  'moon',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
]);

interface ProjectedLabel {
  name: string;
  element: HTMLButtonElement;
  x: number;
  y: number;
  z: number;
  target: boolean;
  major: boolean;
}

export interface LabelRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface LabelPlacement {
  /** Exact screen position of the projected body. The marker never leaves this anchor. */
  x: number;
  y: number;
  /** Text capsule offset relative to the marker. */
  textOffsetX: number;
  textOffsetY: number;
  /** Geometry of the line connecting marker and text. */
  leaderLength: number;
  leaderAngle: number;
  rect: LabelRect;
  offset: boolean;
  markerOnly: boolean;
}

export function findLabelPlacement(
  candidate: Pick<ProjectedLabel, 'name' | 'x' | 'y' | 'target'> &
    Partial<Pick<ProjectedLabel, 'major'>>,
  occupied: readonly LabelRect[],
  viewportWidth: number,
  viewportHeight: number,
  mode: 'educ' | 'explo'
): LabelPlacement | null {
  const markerSize = candidate.target ? 26 : 18;
  if (candidate.target) {
    const rect = {
      left: candidate.x - markerSize / 2,
      right: candidate.x + markerSize / 2,
      top: candidate.y - markerSize / 2,
      bottom: candidate.y + markerSize / 2,
    };
    if (
      rect.left < 6 ||
      rect.right > viewportWidth - 6 ||
      rect.top < 48 ||
      rect.bottom > viewportHeight - 46
    )
      return null;

    return {
      x: candidate.x,
      y: candidate.y,
      textOffsetX: 0,
      textOffsetY: 0,
      leaderLength: 0,
      leaderAngle: 0,
      rect,
      offset: false,
      markerOnly: false,
    };
  }

  // Only the text capsule moves to avoid collisions. The marker stays on the exact
  // projected body position and a leader keeps the marker-to-name relationship clear.
  const textWidth = Math.max(
    46,
    bodyDisplayName(candidate.name).length * 6.6 + 16
  );
  const textHeight = mode === 'educ' ? 22 : 20;
  const side = textWidth / 2 + 12;
  const offsets =
    mode === 'educ'
      ? [
          [0, -25],
          [side, 0],
          [-side, 0],
          [side, -24],
          [-side, -24],
          [0, 25],
          [side, 24],
          [-side, 24],
        ]
      : [
          [side, 0],
          [-side, 0],
          [0, -25],
          [0, 25],
          [side, -24],
          [-side, -24],
          [side, 24],
          [-side, 24],
        ];

  for (let index = 0; index < offsets.length; index++) {
    const [dx, dy] = offsets[index];
    const textX = candidate.x + dx;
    const textY = candidate.y + dy;
    const rect = {
      left: textX - textWidth / 2,
      right: textX + textWidth / 2,
      top: textY - textHeight / 2,
      bottom: textY + textHeight / 2,
    };
    if (
      rect.left < 6 ||
      rect.right > viewportWidth - 6 ||
      rect.top < 48 ||
      rect.bottom > viewportHeight - 46
    ) {
      continue;
    }
    const collides = occupied.some(
      (other) =>
        rect.left < other.right + 4 &&
        rect.right + 4 > other.left &&
        rect.top < other.bottom + 3 &&
        rect.bottom + 3 > other.top
    );
    if (!collides) {
      return {
        x: candidate.x,
        y: candidate.y,
        textOffsetX: dx,
        textOffsetY: dy,
        leaderLength: Math.hypot(dx, dy),
        leaderAngle: Math.atan2(dy, dx),
        rect,
        offset: index > 0,
        markerOnly: false,
      };
    }
  }

  if (candidate.major) {
    const markerSize = 14;
    const rect = {
      left: candidate.x - markerSize / 2,
      right: candidate.x + markerSize / 2,
      top: candidate.y - markerSize / 2,
      bottom: candidate.y + markerSize / 2,
    };
    return {
      x: candidate.x,
      y: candidate.y,
      textOffsetX: 0,
      textOffsetY: 0,
      leaderLength: 0,
      leaderAngle: 0,
      rect,
      offset: true,
      markerOnly: true,
    };
  }
  return null;
}

export class ExploHud {
  private readonly labelsLayer: HTMLDivElement;
  private readonly labels = new Map<string, HTMLButtonElement>();
  private readonly _ndc = new THREE.Vector3();
  private readonly nav: PlanetNavigation;
  private readonly controlSurface: HTMLElement;
  private active = false;
  private labelsVisible = true;
  private _mode: 'educ' | 'explo' = 'educ';
  private _lastTarget: string | null = null;
  /** En éduc, seuls les noms de ce Set reçoivent un label (corps avec mesh). */
  private _educFilter: ReadonlySet<string> | null = null;
  /** Corps exclus individuellement du panneau Réglages, dans les deux modes. */
  private _hiddenNames: ReadonlySet<string> = new Set();

  /**
   * @param nav             commande de navigation partagée (clic label → cible le corps)
   * @param controlSurface  surface OrbitControls (canvas WebGL) qui reçoit la molette
   *                        transférée depuis les labels pour préserver le zoom caméra.
   */
  constructor(nav: PlanetNavigation, controlSurface: HTMLElement) {
    this.nav = nav;
    this.controlSurface = controlSurface;

    this.labelsLayer = document.createElement('div');
    this.labelsLayer.id = 'explo-labels';

    // Changement de langue : ré-étiquette les labels déjà créés (nom d'affichage localisé).
    onLocaleChange(() => this._relabel());
  }

  /** Ré-étiquette tous les labels existants dans la langue courante. */
  private _relabel(): void {
    this.labels.forEach((el, name) => {
      const label = bodyDisplayName(name);
      el.setAttribute('aria-label', label);
      const text = el.querySelector<HTMLElement>('.explo-label-text');
      if (text) text.textContent = label;
    });
  }

  /** Ajoute la couche de labels au DOM (une fois, au démarrage). */
  mount(parent: HTMLElement = document.body): void {
    parent.append(this.labelsLayer);
  }

  /** Affiche/masque la couche. À l'extinction, masque tous les labels. */
  setActive(active: boolean): void {
    this.active = active;
    this.labelsLayer.classList.toggle('is-visible', active);
    if (!active) {
      this.labels.forEach((el) => (el.style.display = 'none'));
    }
  }

  /**
   * Bascule le mode d'affichage des labels.
   * Éduc : point + nom légèrement renforcés au-dessus des corps visibles.
   * Explo : même langage visuel sur chaque corps, à la vraie échelle.
   */
  setMode(mode: 'educ' | 'explo'): void {
    this._mode = mode;
    this.labelsLayer.classList.toggle('is-educ-mode', mode === 'educ');
  }

  /** Affiche les points d’ancrage même lorsque les noms sont masqués par les paramètres. */
  setLabelsVisible(visible: boolean): void {
    this.labelsVisible = visible;
    this.labelsLayer.classList.toggle('is-labels-hidden', !visible);
    if (!visible) {
      this.labels.forEach((element) => (element.style.display = 'none'));
    }
  }

  /**
   * Définit les corps affichés en mode Éducatif (ceux avec un mesh).
   * Les corps absents du Set sont masqués en éduc ; tous sont visibles en explo.
   */
  setEducFilter(names: ReadonlySet<string>): void {
    this._educFilter = names;
  }

  /** Corps dont le label (nom + marqueur) reste masqué, quel que soit le mode. */
  setHiddenNames(names: ReadonlySet<string>): void {
    this._hiddenNames = names;
  }

  /** À appeler chaque frame quand actif. Lit des positions déjà à jour (post-suivi caméra). */
  update(
    camera: THREE.PerspectiveCamera,
    cameraSystem: CameraSystem,
    sceneSystem: SceneSystem
  ): void {
    if (!this.active) return;

    const targetName = cameraSystem.targetName;
    const targetChanged = targetName !== this._lastTarget;
    this._lastTarget = targetName;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const candidates: ProjectedLabel[] = [];

    this.labels.forEach((element) => {
      element.style.display = 'none';
      element.classList.remove('is-target');
      if (targetChanged) element.classList.remove('is-acquiring');
      element.classList.remove('is-marker-only');
    });
    if (!this.labelsVisible) return;

    // Vue d'ensemble Explo (aucune cible suivie) : à cette échelle, TOUS les corps projettent
    // dans un même amas minuscule au centre — sans filtre, c'est une bouillie de labels
    // superposés qui ne donne aucune envie d'explorer. Ne garder que les planètes majeures ici ;
    // dès qu'une cible est suivie, la sélectivité naturelle de la projection à l'écran suffit
    // (la plupart des corps sortent du cadre), donc pas de filtre à cette étape.
    const isOverview = this._mode === 'explo' && targetName === null;

    sceneSystem.forEachBodyWorldPosition((bodyName, worldPos) => {
      if (
        this._mode === 'educ' &&
        this._educFilter &&
        !this._educFilter.has(bodyName)
      ) {
        return;
      }
      if (this._hiddenNames.has(bodyName)) return;

      // Créé même si masqué ci-dessous : d'autres surfaces (recherche, tests) s'attendent à
      // ce que le label existe dans le DOM dès qu'un corps est navigable, pas seulement une
      // fois affiché — `.explo-label` est masqué par défaut en CSS (display: none).
      const element = this._label(bodyName);
      if (isOverview && !MAJOR_BODIES.has(bodyName)) return;
      this._ndc.copy(worldPos).project(camera);
      const onScreen =
        this._ndc.z >= -1 &&
        this._ndc.z <= 1 &&
        this._ndc.x >= -1 &&
        this._ndc.x <= 1 &&
        this._ndc.y >= -1 &&
        this._ndc.y <= 1;
      if (!onScreen) return;

      candidates.push({
        name: bodyName,
        element,
        x: (this._ndc.x * 0.5 + 0.5) * width,
        y: (-this._ndc.y * 0.5 + 0.5) * height,
        z: this._ndc.z,
        target: bodyName === targetName,
        major: MAJOR_BODIES.has(bodyName),
      });
    });

    candidates.sort(
      (a, b) =>
        Number(b.target) - Number(a.target) ||
        Number(b.major) - Number(a.major) ||
        a.z - b.z
    );

    const occupied: LabelRect[] = getSceneOverlayRects();
    for (const candidate of candidates) {
      const placement = this._placeLabel(candidate, occupied, width, height);
      if (!placement) continue;

      const { element } = candidate;
      element.style.display = 'block';
      element.style.transform =
        'translate3d(' + placement.x + 'px, ' + placement.y + 'px, 0)';
      element.style.setProperty(
        '--label-offset-x',
        `${placement.textOffsetX}px`
      );
      element.style.setProperty(
        '--label-offset-y',
        `${placement.textOffsetY}px`
      );
      element.style.setProperty(
        '--leader-length',
        `${placement.leaderLength}px`
      );
      element.style.setProperty(
        '--leader-angle',
        `${placement.leaderAngle}rad`
      );
      element.classList.toggle('is-target', candidate.target);
      element.classList.toggle('is-offset', placement.offset);
      element.classList.toggle('is-marker-only', placement.markerOnly);
      if (candidate.target && targetChanged) {
        element.classList.remove('is-acquiring');
        void element.offsetWidth;
        element.classList.add('is-acquiring');
        window.setTimeout(() => element.classList.remove('is-acquiring'), 1800);
      }
      occupied.push(placement.rect);
    }
  }

  private _placeLabel(
    candidate: ProjectedLabel,
    occupied: readonly LabelRect[],
    viewportWidth: number,
    viewportHeight: number
  ): LabelPlacement | null {
    return findLabelPlacement(
      candidate,
      occupied,
      viewportWidth,
      viewportHeight,
      this._mode
    );
  }

  private _label(name: string): HTMLButtonElement {
    let element = this.labels.get(name);
    if (element) return element;

    element = document.createElement('button');
    element.type = 'button';
    element.className = 'explo-label';
    element.dataset.bodyName = name;
    if (MAJOR_BODIES.has(name)) element.classList.add('is-major');
    element.setAttribute('aria-label', bodyDisplayName(name));
    element.style.setProperty('--label-rgb', labelRgb(name));

    const dot = document.createElement('span');
    dot.className = 'explo-label-dot';
    dot.setAttribute('aria-hidden', 'true');
    const leader = document.createElement('span');
    leader.className = 'explo-label-leader';
    leader.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.className = 'explo-label-text';
    text.textContent = bodyDisplayName(name);
    element.append(leader, dot, text);

    element.addEventListener('click', () => {
      if (this.active) this.nav.selectBody(name);
    });
    element.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.controlSurface.dispatchEvent(
          new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            clientX: event.clientX,
            clientY: event.clientY,
            deltaX: event.deltaX,
            deltaY: event.deltaY,
            deltaMode: event.deltaMode,
            ctrlKey: event.ctrlKey,
            shiftKey: event.shiftKey,
            altKey: event.altKey,
            metaKey: event.metaKey,
          })
        );
      },
      { passive: false }
    );

    this.labelsLayer.append(element);
    this.labels.set(name, element);
    return element;
  }
}
