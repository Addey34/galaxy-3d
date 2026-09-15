/**
 * Couche instrument 2D des objets interstellaires (1I/ʻOumuamua, 2I/Borisov, 3I/ATLAS).
 *
 * Même principe que `spacecraftOverlay.ts` : quelques centaines de mètres à quelques
 * kilomètres, donc des points sous-pixel à vraie échelle — jamais un mesh, jamais une taille
 * apparente plancher (invariant Explo). On projette un marqueur, une étiquette et la ligne de
 * trajectoire sur un canvas 2D en surimpression.
 *
 * Deux choses la distinguent des autres couches instrument :
 *   - elle est active en Éducatif ET en Explo. Une trajectoire ouverte se lit justement dans
 *     la vue compressée : c'est là qu'on voit l'objet plonger vers le Soleil, tourner, et
 *     repartir. En Éducatif chaque point subit la même compression √ que les planètes
 *     (`OrbitalMechanics._computeEducPos`), et pendant la transition animée on interpole
 *     avec le même facteur de morph que les corps, sinon la trajectoire décrocherait d'eux ;
 *   - la ligne ne dépend pas de la date : sa fenêtre est bornée autour du périhélie
 *     (`interstellarWindow`). Elle est donc calculée UNE fois, en anomalie hyperbolique
 *     (`sampleHyperbolicTrajectory`), et seule sa projection est refaite à chaque frame.
 *
 * Hors fenêtre, rien : ni marqueur ni ligne (cf. `INTERSTELLAR_WINDOW_YEARS`).
 */
import * as THREE from 'three';
import { SQRT_K } from '@/core/ScaleService';
import { eclipticToScene } from '@/core/frames';
import {
  keplerianPositionEcliptic,
  sampleHyperbolicTrajectory,
} from '@/core/kepler';
import { getLocale } from '@/i18n';
import {
  INTERSTELLAR_OBJECTS,
  INTERSTELLAR_TRAJECTORY_SAMPLES,
  interstellarWindow,
  type InterstellarObject,
} from '@/config/interstellar';

interface Track {
  object: InterstellarObject;
  fromMs: number;
  toMs: number;
  /** Points de la trajectoire en UA, déjà dans le repère de la scène (x, y, z entrelacés). */
  pathAU: Float32Array;
  css: string;
}

/**
 * UA (repère scène) → unités scène, pour un facteur de morph donné (0 = Éducatif √,
 * 1 = Explo linéaire). Les deux positions sont colinéaires, donc interpoler les rayons
 * revient exactement à interpoler les positions comme le fait `OrbitalMechanics`.
 */
function scaleToScene(
  out: THREE.Vector3,
  x: number,
  y: number,
  z: number,
  morph: number
): THREE.Vector3 {
  const r = Math.hypot(x, y, z);
  if (r < 1e-12) return out.set(0, 0, 0);
  const educ = Math.sqrt(r) * SQRT_K;
  const explo = r * SQRT_K;
  const k = (educ + (explo - educ) * morph) / r;
  return out.set(x * k, y * k, z * k);
}

/** Vrai si le point projeté (NDC) est devant la caméra, entre les plans near/far. */
const inDepth = (p: THREE.Vector3): boolean => p.z >= -1 && p.z <= 1;

export class InterstellarOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly tracks: Track[];
  private active = false;
  private lastPublished = '';
  private readonly _p = new THREE.Vector3();
  private readonly _q = new THREE.Vector3();

  constructor(objects: readonly InterstellarObject[] = INTERSTELLAR_OBJECTS) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'interstellar-overlay';
    this.ctx = this.canvas.getContext('2d');
    this.tracks = objects.map((object) => {
      const { from, to } = interstellarWindow(object);
      const points = sampleHyperbolicTrajectory(
        object.elements,
        from,
        to,
        INTERSTELLAR_TRAJECTORY_SAMPLES
      );
      const pathAU = new Float32Array(points.length * 3);
      points.forEach((p, i) => {
        const s = eclipticToScene(p.x, p.y, p.z);
        pathAU[i * 3] = s.x;
        pathAU[i * 3 + 1] = s.y;
        pathAU[i * 3 + 2] = s.z;
      });
      return {
        object,
        fromMs: from.getTime(),
        toMs: to.getTime(),
        pathAU,
        css: `#${object.color.toString(16).padStart(6, '0')}`,
      };
    });
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
      this._publish(0, 0);
    }
  }

  /**
   * À appeler chaque frame. `morph` = facteur d'échelle courant d'`OrbitalMechanics`
   * (0 = Éducatif, 1 = Explo, intermédiaire pendant la transition).
   */
  update(camera: THREE.PerspectiveCamera, date: Date, morph: number): void {
    if (!this.active || !this.ctx) return;
    const ctx = this.ctx;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const now = date.getTime();
    const locale = getLocale();
    this._clear();

    let markers = 0;
    let tracks = 0;
    for (const track of this.tracks) {
      if (now < track.fromMs || now > track.toMs) continue;
      tracks++;

      this._drawPath(ctx, camera, track, morph, w, h);

      const pos = keplerianPositionEcliptic(track.object.elements, date);
      const s = eclipticToScene(pos.x, pos.y, pos.z);
      scaleToScene(this._p, s.x, s.y, s.z, morph).project(camera);
      if (
        !inDepth(this._p) ||
        Math.abs(this._p.x) > 1 ||
        Math.abs(this._p.y) > 1
      ) {
        continue;
      }
      const x = (this._p.x * 0.5 + 0.5) * w;
      const y = (-this._p.y * 0.5 + 0.5) * h;

      ctx.fillStyle = track.css;
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '11px sans-serif';
      ctx.fillStyle = 'rgba(225, 238, 255, 0.9)';
      ctx.fillText(track.object.displayName[locale], x + 6, y + 4);
      markers++;
    }
    this._publish(markers, tracks);
  }

  /**
   * Trace la trajectoire en pointillés discrets. Un segment dont une extrémité sort de la
   * profondeur visible est sauté : projeté, un point derrière la caméra retombe de l'autre
   * côté de l'écran et tirerait un trait à travers toute la vue.
   */
  private _drawPath(
    ctx: CanvasRenderingContext2D,
    camera: THREE.PerspectiveCamera,
    track: Track,
    morph: number,
    w: number,
    h: number
  ): void {
    const path = track.pathAU;
    ctx.save();
    ctx.strokeStyle = track.css;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    let penDown = false;
    for (let i = 0; i < path.length; i += 3) {
      scaleToScene(this._q, path[i], path[i + 1], path[i + 2], morph).project(
        camera
      );
      if (!inDepth(this._q)) {
        penDown = false;
        continue;
      }
      const x = (this._q.x * 0.5 + 0.5) * w;
      const y = (-this._q.y * 0.5 + 0.5) * h;
      if (penDown) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      penDown = true;
    }
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Ce qui a été peint à la dernière frame — la seule trace DOM d'un canvas, lue par l'e2e :
   * `data-markers` (marqueurs dans le champ) et `data-tracks` (objets dans leur fenêtre,
   * trajectoire tracée). Le second ne dépend pas du cadrage : hors fenêtre, les trois objets
   * sont à plus de 116 UA, donc hors champ de toute façon, et compter les seuls marqueurs ne
   * prouverait pas que la borne est appliquée. N'écrit que sur changement.
   */
  private _publish(markers: number, tracks: number): void {
    const key = `${markers}/${tracks}`;
    if (key === this.lastPublished) return;
    this.lastPublished = key;
    this.canvas.dataset.markers = String(markers);
    this.canvas.dataset.tracks = String(tracks);
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
