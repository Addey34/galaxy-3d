/**
 * Couche instrument 2D des sondes spatiales (Voyager 1/2, Parker Solar Probe, JWST).
 *
 * Même principe que `smallBodyOverlay.ts` : une sonde est un point sous-pixel à vraie échelle,
 * jamais un mesh 3D (l'invariant Explo interdit toute taille apparente plancher). Positions
 * réelles JPL Horizons (`HorizonsEphemerisService`, mêmes binaires que planètes/lunes/planètes
 * naines) — `getHeliocentricAU` renvoie `null` hors de sa fenêtre de couverture (avant le
 * lancement, ou au-delà de la solution de trajectoire) : on saute alors simplement cette sonde,
 * sans erreur.
 *
 * Actif dans les DEUX modes depuis que les sondes sont cherchables et ciblables : la restreindre
 * à l'Exploration, comme le champ de petits corps, ouvrait en Éducatif une vue sur un point que
 * rien ne dessinait. Deux réglages la pilotent par objet, colonnes « Nom » et « Corps » du
 * tableau Réglages (`setHiddenLabelNames`, `setHiddenNames`), et `markerAt` rend chaque marqueur
 * cliquable — sans lui, une sonde serait le seul objet nommé à l'écran qu'un clic ne peut pas
 * atteindre, puisqu'elle n'a aucun mesh que le rayon puisse toucher.
 */
import * as THREE from 'three';
import { scaleToScene } from '@/core/overlayScale';
import {
  MARKER_LABEL_HEIGHT,
  markerLabelCandidates,
  overlayLabelBounds,
} from '@/core/labelSpace';
import type { LabelSpace } from '@/core/labelSpace';
import type { HorizonsEphemerisService } from '@/core/HorizonsEphemerisService';
import { getLocale } from '@/i18n';
import type { SpacecraftMission } from '@/config/spacecraft';

export class SpacecraftOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly missions: SpacecraftMission[];
  private active = false;
  /** Marqueurs masqués par le tableau Réglages (colonne « Corps »). */
  private hidden: ReadonlySet<string> = new Set();
  /** Objets dont le NOM est masqué (colonne « Libellé »), marqueur conservé. */
  private hiddenLabels: ReadonlySet<string> = new Set();
  /**
   * Où chaque marqueur a été peint à la dernière image, en pixels écran. C'est ce qui rend une
   * sonde CLIQUABLE : elle n'a pas de mesh, donc le raycast ne peut pas la toucher — le clic
   * est résolu contre ces positions (cf. `ui/bodyPicker.ts`).
   */
  private readonly _markers: { name: string; x: number; y: number }[] = [];
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
    if (!active) {
      this._clear();
      // Plus rien n'est peint : plus rien n'est cliquable (cf. `markerAt`).
      this._markers.length = 0;
    }
  }

  /** Marqueurs à ne pas peindre (colonne « Corps » du tableau Réglages). */
  setHiddenNames(names: ReadonlySet<string>): void {
    this.hidden = new Set(names);
  }

  /** Noms à ne pas écrire (colonne « Libellé »), les marqueurs restent. */
  setHiddenLabelNames(names: ReadonlySet<string>): void {
    this.hiddenLabels = new Set(names);
  }

  /**
   * Nom de la sonde dont le marqueur a été peint sous ce point d'écran, sinon `null`.
   * `radius` est la tolérance en pixels : un point de 2,5 px se vise mal au doigt près.
   */
  markerAt(x: number, y: number, radius = 12): string | null {
    let best: string | null = null;
    let bestDistance = radius;
    for (const marker of this._markers) {
      const d = Math.hypot(marker.x - x, marker.y - y);
      if (d <= bestDistance) {
        bestDistance = d;
        best = marker.name;
      }
    }
    return best;
  }

  /**
   * À appeler chaque frame quand actif. `date` = date de simulation courante, `morph` = état de
   * la transition Éduc↔Explo (cf. `core/overlayScale.ts`) : sans lui, les marqueurs sautaient à
   * leur position Explo pendant que les planètes glissaient encore.
   */
  update(
    camera: THREE.PerspectiveCamera,
    date: Date,
    horizons: HorizonsEphemerisService,
    morph = 1,
    space: LabelSpace | null = null
  ): void {
    if (!this.active || !this.ctx || this.missions.length === 0) return;

    const w = window.innerWidth;
    const h = window.innerHeight;
    this._clear();
    this._markers.length = 0;
    const locale = getLocale();

    for (const mission of this.missions) {
      if (this.hidden.has(mission.name)) continue;
      const posAU = horizons.getHeliocentricAU(mission.name, date);
      if (!posAU) continue; // avant le lancement, ou au-delà de la solution de trajectoire

      scaleToScene(this._p, posAU.x, posAU.y, posAU.z, morph).project(camera);
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
      this._markers.push({ name: mission.name, x, y });

      if (this.hiddenLabels.has(mission.name)) continue;
      this.ctx.font = '11px sans-serif';
      const text = mission.displayName[locale] ?? mission.displayName.en;
      const textWidth = this.ctx.measureText(text).width;
      // Le nom ne s'écrit que s'il trouve une place libre : mieux vaut un marqueur seul que
      // deux noms superposés, dont aucun ne se lit (cf. `core/labelSpace.ts`).
      const placed = space
        ? space.placeText(
            x,
            y,
            textWidth,
            MARKER_LABEL_HEIGHT,
            markerLabelCandidates(textWidth),
            overlayLabelBounds(w, h)
          )
        : { dx: 8 + textWidth / 2, dy: 0, rect: null };
      space?.add({ left: x - 4, right: x + 4, top: y - 4, bottom: y + 4 });
      if (!placed) continue;
      if (placed.rect) space?.add(placed.rect);
      this.ctx.fillStyle = 'rgba(225, 238, 255, 0.9)';
      this.ctx.fillText(text, x + placed.dx - textWidth / 2, y + placed.dy + 4);
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
