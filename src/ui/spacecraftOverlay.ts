/**
 * Couche instrument 2D des sondes spatiales (Voyager 1/2, Parker Solar Probe, JWST).
 *
 * Même principe que `smallBodyOverlay.ts` : une sonde est un point sous-pixel à vraie échelle,
 * jamais un mesh 3D (l'invariant Explo interdit toute taille apparente plancher). Positions
 * réelles JPL Horizons (`HorizonsEphemerisService`, mêmes binaires que planètes/lunes/planètes
 * naines) — `getHeliocentricAU` renvoie `null` hors de sa fenêtre de couverture (avant le
 * lancement, ou au-delà de la solution de trajectoire) : on saute alors simplement cette sonde,
 * sans erreur. Actif uniquement en mode Exploration, comme le champ de petits corps.
 */
import * as THREE from 'three';
import { SQRT_K } from '@/core/ScaleService';
import type { HorizonsEphemerisService } from '@/core/HorizonsEphemerisService';
import { getLocale } from '@/i18n';
import type { SpacecraftMission } from '@/config/spacecraft';

export class SpacecraftOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly missions: SpacecraftMission[];
  private active = false;
  private readonly _p = new THREE.Vector3();

  constructor(missions: SpacecraftMission[]) {
    this.missions = missions;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'spacecraft-overlay';
    this.ctx = this.canvas.getContext('2d');
  }

  /** Ajoute l'overlay au DOM et cale sa taille sur la fenêtre. */
  mount(parent: HTMLElement = document.body): void {
    parent.append(this.canvas);
    this._resize();
    window.addEventListener('resize', this._resize, { passive: true });
  }

  /** Affiche/masque l'overlay. À l'extinction, efface le canvas. */
  setActive(active: boolean): void {
    this.active = active;
    this.canvas.classList.toggle('is-visible', active);
    if (!active) this._clear();
  }

  /** À appeler chaque frame quand actif. `date` = date de simulation courante. */
  update(
    camera: THREE.PerspectiveCamera,
    date: Date,
    horizons: HorizonsEphemerisService
  ): void {
    if (!this.active || !this.ctx || this.missions.length === 0) return;

    const w = window.innerWidth;
    const h = window.innerHeight;
    this._clear();
    const locale = getLocale();

    for (const mission of this.missions) {
      const posAU = horizons.getHeliocentricAU(mission.name, date);
      if (!posAU) continue; // avant le lancement, ou au-delà de la solution de trajectoire

      this._p.copy(posAU).multiplyScalar(SQRT_K);
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
      const color = `#${mission.color.toString(16).padStart(6, '0')}`;

      this.ctx.fillStyle = color;
      this.ctx.beginPath();
      this.ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      this.ctx.fill();

      this.ctx.font = '11px sans-serif';
      this.ctx.fillStyle = 'rgba(225, 238, 255, 0.9)';
      this.ctx.fillText(mission.displayName[locale] ?? mission.displayName.en, x + 6, y + 4);
    }
  }

  private _clear(): void {
    this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private readonly _resize = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(window.innerWidth * dpr);
    this.canvas.height = Math.round(window.innerHeight * dpr);
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  dispose(): void {
    window.removeEventListener('resize', this._resize);
    this.canvas.remove();
  }
}
