/**
 * Couche de labels projetés — active en mode Éducatif ET Exploration.
 *
 * En Exploration (vraie échelle), les corps sont des points minuscules perdus dans le vide :
 * labels + points de repère maintiennent leur visibilité. En Éducatif, les corps sont des
 * meshes visibles : les labels apparaissent légèrement au-dessus de chaque corps pour
 * l'identifier, sans point de repère. Dans les deux cas le clic cible le corps via la commande
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
import { onLocaleChange } from '@/i18n';
import { bodyDisplayName } from '@/i18n/bodyText';
import { markForwardedControlEvent } from './controlEventForwarding';
import type { PlanetNavigation } from './planetNav';

/** Déplacement max (px) entre pointerdown et pointerup pour rester un « clic » (sinon glisser). */
const CLICK_MOVE_TOLERANCE = 5;

export class ExploHud {
  private readonly labelsLayer: HTMLDivElement;
  private readonly labels = new Map<string, HTMLButtonElement>();
  private readonly _ndc = new THREE.Vector3();
  private readonly nav: PlanetNavigation;
  private readonly controlSurface: HTMLElement;
  private active = false;
  private _mode: 'educ' | 'explo' = 'educ';
  /** En éduc, seuls les noms de ce Set reçoivent un label (corps avec mesh). */
  private _educFilter: ReadonlySet<string> | null = null;
  /** Clic de label en cours (pointerdown reçu, en attente du pointerup). */
  private _pendingClick: {
    name: string;
    id: number;
    x: number;
    y: number;
  } | null = null;

  /**
   * @param nav             commande de navigation partagée (clic label → cible le corps)
   * @param controlSurface  surface OrbitControls (canvas WebGL) : les labels lui réémettent
   *                        molette/pointerdown pour ne jamais bloquer zoom, rotation ni pan.
   */
  constructor(nav: PlanetNavigation, controlSurface: HTMLElement) {
    this.nav = nav;
    this.controlSurface = controlSurface;

    this.labelsLayer = document.createElement('div');
    this.labelsLayer.id = 'explo-labels';

    // La sélection est résolue au pointerup GLOBAL, pas au `click` du label : le pointerdown
    // réémis au canvas fait qu'OrbitControls capture le pointeur (`setPointerCapture`), le
    // pointerup est alors retargeté vers le canvas et le `click` du label ne part jamais.
    // Même logique que le picker 3D : un vrai clic = même pointeur + déplacement ≤ tolérance.
    window.addEventListener('pointerup', (e) => {
      const p = this._pendingClick;
      if (!p || e.pointerId !== p.id) return;
      this._pendingClick = null;
      if (
        this.active &&
        Math.hypot(e.clientX - p.x, e.clientY - p.y) <= CLICK_MOVE_TOLERANCE
      ) {
        this.nav.selectBody(p.name);
      }
    });
    window.addEventListener('pointercancel', (e) => {
      if (this._pendingClick?.id === e.pointerId) this._pendingClick = null;
    });

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
   * Éduc : labels texte au-dessus des corps visibles (sans point de repère).
   * Explo : point + texte sur chaque corps (corps invisibles à l'œil nu).
   */
  setMode(mode: 'educ' | 'explo'): void {
    this._mode = mode;
    this.labelsLayer.classList.toggle('is-educ-mode', mode === 'educ');
  }

  /**
   * Définit les corps affichés en mode Éducatif (ceux avec un mesh).
   * Les corps absents du Set sont masqués en éduc ; tous sont visibles en explo.
   */
  setEducFilter(names: ReadonlySet<string>): void {
    this._educFilter = names;
  }

  /** À appeler chaque frame quand actif. Lit des positions déjà à jour (post-suivi caméra). */
  update(
    camera: THREE.PerspectiveCamera,
    cameraSystem: CameraSystem,
    sceneSystem: SceneSystem
  ): void {
    if (!this.active) return;

    // Corps actuellement suivi : son label est marqué `is-target` (mis en avant).
    const name = cameraSystem.targetName;

    const w = window.innerWidth;
    const h = window.innerHeight;
    sceneSystem.forEachBodyWorldPosition((bodyName, worldPos) => {
      // En éduc : masquer les corps sans mesh (astéroïdes/comètes non texturés).
      if (
        this._mode === 'educ' &&
        this._educFilter &&
        !this._educFilter.has(bodyName)
      ) {
        const el = this.labels.get(bodyName);
        if (el) el.style.display = 'none';
        return;
      }

      const el = this._label(bodyName);
      this._ndc.copy(worldPos).project(camera);
      // z hors [-1,1] → derrière la caméra ou au-delà du far : masquer.
      const onScreen =
        this._ndc.z >= -1 &&
        this._ndc.z <= 1 &&
        this._ndc.x >= -1 &&
        this._ndc.x <= 1 &&
        this._ndc.y >= -1 &&
        this._ndc.y <= 1;
      if (!onScreen) {
        el.style.display = 'none';
        return;
      }
      const x = (this._ndc.x * 0.5 + 0.5) * w;
      const y = (-this._ndc.y * 0.5 + 0.5) * h;
      // Éduc : label légèrement au-dessus du corps visible (décalage Y en px).
      const yOffset = this._mode === 'educ' ? -14 : 0;
      el.style.display = 'flex';
      el.style.transform = `translate(${x}px, ${y + yOffset}px)`;
      el.classList.toggle('is-target', bodyName === name);
    });
  }

  /**
   * Réémet un geste (molette/pointerdown) vers la surface OrbitControls : clone l'événement
   * et le redispatche sur le canvas, qui gère alors zoom/rotation/pan comme si le label
   * n'était pas là. Le clic de sélection, lui, n'est pas réémis.
   */
  private readonly _forward = (ev: Event): void => {
    const Ctor = ev.constructor as new (type: string, init: Event) => Event;
    this.controlSurface.dispatchEvent(
      markForwardedControlEvent(new Ctor(ev.type, ev))
    );
  };

  private _label(name: string): HTMLButtonElement {
    let el = this.labels.get(name);
    if (!el) {
      el = document.createElement('button');
      el.type = 'button';
      el.className = 'explo-label';
      el.setAttribute('aria-label', bodyDisplayName(name));
      const dot = document.createElement('span');
      dot.className = 'explo-label-dot';
      dot.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      text.className = 'explo-label-text';
      text.textContent = bodyDisplayName(name);
      el.append(dot, text);
      // Clavier uniquement (Enter/Espace → click avec detail 0) : les clics pointeur sont
      // résolus par le pointerup global (cf. constructeur), le `click` souris étant avalé
      // par la capture de pointeur d'OrbitControls.
      el.addEventListener('click', (ev) => {
        if (!this.active || ev.detail !== 0) return;
        this.nav.selectBody(name);
      });
      // Un label cliquable capterait sinon molette/drag destinés à la caméra — or celui de
      // la cible suivie est toujours au centre. On réémet ces gestes vers OrbitControls pour
      // préserver zoom, rotation et pan ; la sélection est arbitrée au pointerup global.
      el.addEventListener('wheel', this._forward, { passive: false });
      el.addEventListener('pointerdown', (ev) => {
        if (ev.isPrimary && ev.button === 0) {
          this._pendingClick = {
            name,
            id: ev.pointerId,
            x: ev.clientX,
            y: ev.clientY,
          };
        }
        this._forward(ev);
      });
      this.labelsLayer.append(el);
      this.labels.set(name, el);
    }
    return el;
  }
}
