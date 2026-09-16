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
import { scaleToScene } from '@/core/overlayScale';
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

/** Vrai si le point projeté (NDC) est devant la caméra, entre les plans near/far. */
const inDepth = (p: THREE.Vector3): boolean => p.z >= -1 && p.z <= 1;

/**
 * Pas de date en deçà duquel les marqueurs ne sont pas redessinés. Dix minutes de temps simulé :
 * 3I/ATLAS, le plus rapide, y parcourt 0,0002 UA — rien de visible à l'échelle d'un
 * instrument, mais une vue immobile en temps réel cesse enfin de repeindre à chaque frame.
 */
const REDRAW_DATE_STEP_MS = 10 * 60_000;

/** Marge (px) hors de laquelle un segment dont les deux bouts sont du même côté est ignoré. */
const OFFSCREEN_MARGIN_PX = 64;

export class InterstellarOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly tracks: Track[];
  private active = false;
  private lastPublished = '';
  /** État de la dernière image peinte — sans changement, on ne redessine rien (cf. `update`). */
  private readonly _lastView = new Float64Array(34);
  private _hasDrawn = false;
  private _lastLocale = '';
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
      this._hasDrawn = false;
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
    if (!this._viewChanged(camera, now, morph, w, h, locale)) return;
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
   * Faut-il repeindre ? Oui seulement si la caméra, le morph, la taille, la langue ou la date
   * (au pas `REDRAW_DATE_STEP_MS`) ont changé depuis la dernière image.
   *
   * Économie de REPOS (batterie, vue immobile), pas la correction du coût de rendu : mesuré en
   * forçant un redessin à chaque frame, le tracé de `_drawPath` tient déjà la parité avec une
   * application sans cette couche. Le coût réel était ailleurs, cf. `_drawPath`.
   */
  private _viewChanged(
    camera: THREE.PerspectiveCamera,
    now: number,
    morph: number,
    w: number,
    h: number,
    locale: string
  ): boolean {
    const view = this._lastView;
    const next = [
      ...camera.matrixWorld.elements,
      ...camera.projectionMatrix.elements,
      Math.floor(now / REDRAW_DATE_STEP_MS),
      morph,
    ];
    let changed = !this._hasDrawn || this._lastLocale !== locale;
    changed ||= view[32] !== w || view[33] !== h;
    for (let i = 0; i < next.length && !changed; i++)
      changed = view[i] !== next[i];
    if (!changed) return false;
    next.forEach((value, i) => (view[i] = value));
    view[32] = w;
    view[33] = h;
    this._lastLocale = locale;
    this._hasDrawn = true;
    return true;
  }

  /**
   * Trace la trajectoire en trait plein discret.
   *
   * La première version, en pointillés et sans tri des segments hors écran, coûtait cher —
   * mesuré sur `e2e/perf-fps.spec.ts`, avec la couche puis sans : 12 contre 50 fps en vue mobile
   * sous CPU ×4, 5-7 contre 11 fps sur bureau sous CPU ×4. Un motif `setLineDash` se calcule sur
   * toute la longueur tracée, or une trajectoire de ±20 ans déborde de l'écran de milliers de
   * pixels. Trait plein et segments hors écran écartés : parité rétablie (16 / 12,5 / 59 fps),
   * même en redessinant à chaque frame. Un segment dont une extrémité sort de la
   * profondeur visible est sauté aussi : projeté, un point derrière la caméra retombe de l'autre
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
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.beginPath();
    let hasPrev = false;
    let penAt = false;
    let px = 0;
    let py = 0;
    const m = OFFSCREEN_MARGIN_PX;
    const outside = (x: number, y: number): number =>
      (x < -m ? 1 : 0) |
      (x > w + m ? 2 : 0) |
      (y < -m ? 4 : 0) |
      (y > h + m ? 8 : 0);
    for (let i = 0; i < path.length; i += 3) {
      scaleToScene(this._q, path[i], path[i + 1], path[i + 2], morph).project(
        camera
      );
      if (!inDepth(this._q)) {
        hasPrev = false;
        penAt = false;
        continue;
      }
      const x = (this._q.x * 0.5 + 0.5) * w;
      const y = (-this._q.y * 0.5 + 0.5) * h;
      // Segment [prev, cur] visible sauf si ses deux bouts sortent du même côté.
      if (hasPrev && (outside(px, py) & outside(x, y)) === 0) {
        if (!penAt) ctx.moveTo(px, py);
        ctx.lineTo(x, y);
        penAt = true;
      } else {
        penAt = false;
      }
      px = x;
      py = y;
      hasPrev = true;
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
    this._hasDrawn = false;
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
