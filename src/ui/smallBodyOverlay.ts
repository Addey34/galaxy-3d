/**
 * Couche instrument 2D des petits corps de masse (champ SBDB).
 *
 * En vraie échelle, des milliers d'astéroïdes seraient des points sous-pixel invisibles : au
 * lieu d'en faire des meshes (ce qui violerait l'invariant si on leur donnait une taille
 * apparente plancher), on les projette sur un canvas 2D en surimpression — un instrument de
 * navigation, au même titre que le HUD et les labels. Les corps eux-mêmes ne sont jamais
 * mis à l'échelle ; ce sont des glyphes à taille-pixel fixe, non interactifs.
 *
 * Actif uniquement en mode Exploration. Chaque frame propage les orbites (Kepler) et redessine
 * les marqueurs visibles, plafonnés pour tenir à l'échelle de milliers de corps.
 */
import * as THREE from 'three';
import { SQRT_K } from '../core/ScaleService';
import { keplerianPositionEcliptic } from '../core/kepler';
import { eclipticToScene } from '../core/frames';
import type { ParsedSmallBody } from '../core/sbdb';

/** Nombre maximal de marqueurs dessinés par frame (LOD : les plus proches d'abord). */
const MAX_MARKERS = 1500;

export class SmallBodyOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private bodies: ParsedSmallBody[] = [];
  private active = false;
  private readonly _p = new THREE.Vector3();
  private readonly _cam = new THREE.Vector3();

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'smallbody-overlay';
    this.ctx = this.canvas.getContext('2d');
  }

  /** Ajoute l'overlay au DOM et cale sa taille sur la fenêtre. */
  mount(parent: HTMLElement = document.body): void {
    parent.append(this.canvas);
    this._resize();
    window.addEventListener('resize', this._resize, { passive: true });
  }

  /** Remplace le lot de corps affichés (appelé une fois le fetch SBDB résolu). */
  setBodies(bodies: ParsedSmallBody[]): void {
    this.bodies = bodies;
  }

  /** Affiche/masque l'overlay. À l'extinction, efface le canvas. */
  setActive(active: boolean): void {
    this.active = active;
    this.canvas.classList.toggle('is-visible', active);
    if (!active) this._clear();
  }

  /** À appeler chaque frame quand actif. `date` = date de simulation courante. */
  update(camera: THREE.PerspectiveCamera, date: Date): void {
    if (!this.active || !this.ctx || this.bodies.length === 0) return;

    const w = window.innerWidth;
    const h = window.innerHeight;
    this._clear();
    camera.getWorldPosition(this._cam);

    // LOD : à partir d'un certain volume, ne garder que les corps les plus proches de la
    // caméra. Le tri complet serait coûteux chaque frame ; on approxime avec un seuil de
    // distance adaptatif appliqué à la volée (voir _distanceCutoff).
    const cutoff = this._distanceCutoff();

    this.ctx.fillStyle = 'rgba(180, 200, 235, 0.75)';
    let drawn = 0;
    for (let b = 0; b < this.bodies.length && drawn < MAX_MARKERS; b++) {
      const pos = keplerianPositionEcliptic(this.bodies[b].elements, date);
      this._p.copy(eclipticToScene(pos.x, pos.y, pos.z)).multiplyScalar(SQRT_K);

      if (cutoff > 0 && this._p.distanceToSquared(this._cam) > cutoff) continue;

      this._p.project(camera);
      if (
        this._p.z < -1 ||
        this._p.z > 1 ||
        this._p.x < -1 ||
        this._p.x > 1 ||
        this._p.y < -1 ||
        this._p.y > 1
      ) {
        continue;
      }
      const x = (this._p.x * 0.5 + 0.5) * w;
      const y = (-this._p.y * 0.5 + 0.5) * h;
      this.ctx.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
      drawn++;
    }
  }

  /** Rayon² de coupe LOD (unités scène²), ou 0 = pas de coupe. */
  private _distanceCutoff(): number {
    if (this.bodies.length <= MAX_MARKERS) return 0;
    // ~100 UA en unités scène explo, au carré : au-delà, on abandonne les marqueurs.
    const r = 100 * SQRT_K;
    return r * r;
  }

  private _clear(): void {
    this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private readonly _resize = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(window.innerWidth * dpr);
    this.canvas.height = Math.round(window.innerHeight * dpr);
    // Dessiner en pixels CSS : on met à l'échelle le contexte du device pixel ratio.
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  dispose(): void {
    window.removeEventListener('resize', this._resize);
    this.canvas.remove();
  }
}
