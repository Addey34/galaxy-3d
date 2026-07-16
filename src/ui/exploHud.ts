/**
 * HUD du mode Exploration — « Voyage spatial ».
 *
 * En vraie échelle, les corps sont des points minuscules perdus dans le vide : ce HUD
 * transforme ce vide en information. Il affiche, pour la cible suivie, la distance réelle
 * (UA + km) et le temps-lumière, et projette un marqueur + label sur chaque corps pour
 * qu'aucun ne se perde à l'écran.
 *
 * Les labels projetés sont des boutons accessibles : cliqués (ou activés au clavier), ils
 * ciblent le corps via la commande de navigation partagée (`PlanetNavigation`) — le HUD ne
 * touche jamais lui-même à la caméra ni aux boutons de la barre de navigation.
 *
 * Piloté chaque frame par `AnimationSystem.onFrame` quand le mode explo est actif ; inerte
 * (aucune écriture DOM, labels non cliquables) sinon.
 */
import * as THREE from 'three';
import { KM_PER_AU, SQRT_K } from '../core/ScaleService';
import type { CameraSystem } from '../components/systems/CameraSystem';
import type { SceneSystem } from '../components/systems/SceneSystem';
import type { PlanetNavigation } from './planetNav';

const C_KM_PER_S = 299_792.458; // vitesse de la lumière

/** Convertit une distance en unités scène (explo : AU × SQRT_K) vers des kilomètres. */
function sceneUnitsToKm(sceneUnits: number): number {
  return (sceneUnits / SQRT_K) * KM_PER_AU;
}

function formatDistance(km: number): string {
  const au = km / KM_PER_AU;
  const auStr = `${au.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} UA`;
  let kmStr: string;
  if (km >= 1e9) kmStr = `${(km / 1e9).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} Md km`;
  else if (km >= 1e6) kmStr = `${(km / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M km`;
  else kmStr = `${Math.round(km).toLocaleString('fr-FR')} km`;
  return `${auStr} · ${kmStr}`;
}

function formatLightTime(km: number): string {
  const s = km / C_KM_PER_S;
  if (s < 1)   return `${(s * 1000).toFixed(0)} ms-lumière`;
  if (s < 60)  return `${s.toFixed(1)} s-lumière`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    return `${m} min ${Math.round(s - m * 60)} s-lumière`;
  }
  const h = Math.floor(s / 3600);
  return `${h} h ${Math.round((s - h * 3600) / 60)} min-lumière`;
}

function cap(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export class ExploHud {
  private readonly root: HTMLDivElement;
  private readonly targetName: HTMLDivElement;
  private readonly distance: HTMLDivElement;
  private readonly lightTime: HTMLDivElement;
  private readonly labelsLayer: HTMLDivElement;
  private readonly labels = new Map<string, HTMLButtonElement>();
  private readonly _ndc = new THREE.Vector3();
  private readonly nav: PlanetNavigation;
  private active = false;

  constructor(nav: PlanetNavigation) {
    this.nav = nav;

    this.labelsLayer = document.createElement('div');
    this.labelsLayer.id = 'explo-labels';

    this.root = document.createElement('div');
    this.root.id = 'explo-hud';
    this.root.setAttribute('aria-hidden', 'true');

    const title = document.createElement('div');
    title.className = 'explo-hud-title';
    title.textContent = 'CIBLE';
    this.targetName = document.createElement('div');
    this.targetName.className = 'explo-hud-target';
    this.distance = document.createElement('div');
    this.distance.className = 'explo-hud-line';
    this.lightTime = document.createElement('div');
    this.lightTime.className = 'explo-hud-line';

    this.root.append(title, this.targetName, this.distance, this.lightTime);
  }

  /** Ajoute le HUD au DOM (une fois, au démarrage). */
  mount(parent: HTMLElement = document.body): void {
    parent.append(this.labelsLayer, this.root);
  }

  /** Affiche/masque le HUD. À l'extinction, purge les labels et vide les écritures. */
  setActive(active: boolean): void {
    this.active = active;
    this.root.classList.toggle('is-visible', active);
    this.labelsLayer.classList.toggle('is-visible', active);
    if (!active) {
      this.labels.forEach((el) => (el.style.display = 'none'));
    }
  }

  /** À appeler chaque frame quand actif. Lit des positions déjà à jour (post-suivi caméra). */
  update(camera: THREE.PerspectiveCamera, cameraSystem: CameraSystem, sceneSystem: SceneSystem): void {
    if (!this.active) return;

    // Bloc cible : distance réelle + temps-lumière.
    const name = cameraSystem.targetName;
    const sceneDist = cameraSystem.getDistanceToTargetSceneUnits();
    if (name && sceneDist !== null) {
      const km = sceneUnitsToKm(sceneDist);
      this.targetName.textContent = cap(name);
      this.distance.textContent   = formatDistance(km);
      this.lightTime.textContent  = formatLightTime(km);
      this.root.classList.remove('is-free');
    } else {
      this.targetName.textContent = 'Vue libre';
      this.distance.textContent   = '—';
      this.lightTime.textContent  = '';
      this.root.classList.add('is-free');
    }

    // Marqueurs + labels projetés : aucun corps ne se perd dans le vide.
    const w = window.innerWidth;
    const h = window.innerHeight;
    sceneSystem.forEachBodyWorldPosition((bodyName, worldPos) => {
      const el = this._label(bodyName);
      this._ndc.copy(worldPos).project(camera);
      // z hors [-1,1] → derrière la caméra ou au-delà du far : masquer.
      const onScreen = this._ndc.z >= -1 && this._ndc.z <= 1
        && this._ndc.x >= -1 && this._ndc.x <= 1
        && this._ndc.y >= -1 && this._ndc.y <= 1;
      if (!onScreen) { el.style.display = 'none'; return; }
      const x = (this._ndc.x * 0.5 + 0.5) * w;
      const y = (-this._ndc.y * 0.5 + 0.5) * h;
      el.style.display = 'block';
      el.style.transform = `translate(${x}px, ${y}px)`;
      el.classList.toggle('is-target', bodyName === name);
    });
  }

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
      this.labelsLayer.append(el);
      this.labels.set(name, el);
    }
    return el;
  }
}
