/**
 * Couche de labels projetés du mode Exploration — « Voyage spatial ».
 *
 * En vraie échelle, les corps sont des points minuscules perdus dans le vide : cette couche
 * projette un marqueur + label sur chaque corps pour qu'aucun ne se perde à l'écran. La
 * distance réelle et le temps-lumière de la cible suivie, eux, sont affichés dans la fiche
 * unique (`ui/bodyInfo`, bloc live) — plus de HUD « TARGET » séparé.
 *
 * Les labels projetés sont des boutons accessibles : cliqués (ou activés au clavier), ils
 * ciblent le corps via la commande de navigation partagée (`PlanetNavigation`) — la couche ne
 * touche jamais elle-même à la caméra ni aux boutons de la barre de navigation.
 *
 * Piloté chaque frame par `AnimationSystem.onFrame` quand le mode explo est actif ; inerte
 * (aucune écriture DOM, labels non cliquables) sinon.
 */
import * as THREE from 'three';
import type { CameraSystem } from '@/components/systems/CameraSystem';
import type { SceneSystem } from '@/components/systems/SceneSystem';
import { markForwardedControlEvent } from './controlEventForwarding';
import type { PlanetNavigation } from './planetNav';

function cap(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export class ExploHud {
  private readonly labelsLayer: HTMLDivElement;
  private readonly labels = new Map<string, HTMLButtonElement>();
  private readonly _ndc = new THREE.Vector3();
  private readonly nav: PlanetNavigation;
  private readonly controlSurface: HTMLElement;
  private active = false;

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

  /** À appeler chaque frame quand actif. Lit des positions déjà à jour (post-suivi caméra). */
  update(
    camera: THREE.PerspectiveCamera,
    cameraSystem: CameraSystem,
    sceneSystem: SceneSystem
  ): void {
    if (!this.active) return;

    // Corps actuellement suivi : son label est marqué `is-target` (mis en avant).
    const name = cameraSystem.targetName;

    // Marqueurs + labels projetés : aucun corps ne se perd dans le vide.
    const w = window.innerWidth;
    const h = window.innerHeight;
    sceneSystem.forEachBodyWorldPosition((bodyName, worldPos) => {
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
      el.style.display = 'block';
      el.style.transform = `translate(${x}px, ${y}px)`;
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
      el.setAttribute('aria-label', cap(name));
      const dot = document.createElement('span');
      dot.className = 'explo-label-dot';
      dot.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      text.className = 'explo-label-text';
      text.textContent = cap(name);
      el.append(dot, text);
      // Inerte hors mode explo : les labels masqués (display:none) ne sont ni cliquables ni
      // focusables ; ce garde-fou couvre en plus une éventuelle frame de transition.
      el.addEventListener('click', () => {
        if (!this.active) return;
        this.nav.selectBody(name);
      });
      // Un label cliquable capterait sinon molette/drag destinés à la caméra — or celui de
      // la cible suivie est toujours au centre. On réémet ces gestes vers OrbitControls pour
      // préserver zoom, rotation et pan ; seul le clic (sélection) reste au label.
      el.addEventListener('wheel', this._forward, { passive: false });
      el.addEventListener('pointerdown', this._forward);
      this.labelsLayer.append(el);
      this.labels.set(name, el);
    }
    return el;
  }
}
