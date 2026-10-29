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
 * rien ne dessinait. Deux réglages la pilotent par objet, colonnes « Étiquette » et « Objet » du
 * tableau Réglages (`setHiddenLabelNames`, `setHiddenNames`), et `markerAt` rend chaque marqueur
 * cliquable — sans lui, une sonde serait le seul objet nommé à l'écran qu'un clic ne peut pas
 * atteindre, puisqu'elle n'a aucun mesh que le rayon puisse toucher.
 */
import type { ScreenOcclusion } from '@/core/screenOcclusion';
import * as THREE from 'three';
import type { InstrumentPlacer } from '@/core/instrumentPlacement';
import {
  MARKER_LABEL_HEIGHT,
  markerLabelCandidates,
  overlayLabelBounds,
} from '@/core/labelSpace';
import type { LabelRect, LabelSpace } from '@/core/labelSpace';
import type { HorizonsEphemerisService } from '@/core/HorizonsEphemerisService';
import { getLocale } from '@/i18n';
import type { SpacecraftMission } from '@/config/spacecraft';
import type { SpacecraftTrajectories } from './spacecraftTrajectories';

export class SpacecraftOverlay {
  /** Les corps qui masquent un repère passé derrière eux (ligne 45.8), ou rien. */
  private _occlusion: ScreenOcclusion | null = null;

  /** Branche l'occultation par les corps (`core/screenOcclusion`), recomposée à chaque image. */
  setOcclusion(occlusion: ScreenOcclusion | null): void {
    this._occlusion = occlusion;
  }
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly missions: SpacecraftMission[];
  private active = false;
  /** Marqueurs masqués par le tableau Réglages (colonne « Objet »). */
  private hidden: ReadonlySet<string> = new Set();
  /** Objets dont le NOM est masqué (colonne « Étiquette »), marqueur conservé. */
  private hiddenLabels: ReadonlySet<string> = new Set();
  /** Objet sélectionné : toujours peint et nommé, quels que soient les réglages. */
  private target: string | null = null;
  /**
   * Où chaque marqueur a été peint à la dernière image, en pixels écran. C'est ce qui rend une
   * sonde CLIQUABLE : elle n'a pas de mesh, donc le raycast ne peut pas la toucher — le clic
   * est résolu contre ces positions (cf. `ui/bodyPicker.ts`).
   */
  private readonly _markers: { name: string; x: number; y: number }[] = [];
  private readonly _p = new THREE.Vector3();
  /**
   * Ce qui est PEINT : un état identique à la dernière image rend la repeinture inutile, et vider
   * puis repeindre un canvas plein écran coûte surtout du travail natif du navigateur (mesuré le
   * 2026-10-29 sur la couche voisine des petits corps). Ici la comparaison porte sur les
   * positions ÉCRAN des marqueurs, à 0,25 px près : exacte quelle que soit la vitesse du temps,
   * sans seuil de date.
   */
  private _painted: { name: string; x: number; y: number }[] = [];
  /** Emprises déclarées à `LabelSpace` à la dernière peinture, redéclarées quand on saute une image. */
  private _claimed: LabelRect[] = [];
  /** Un réglage a changé sans bouger la vue : la prochaine image repeint. */
  private _dirty = true;
  private _paintedLocale = '';
  private _paintedWidth = 0;
  private _paintedHeight = 0;
  private _paintedSpace = Number.NaN;
  /** Trajectoires allumées (colonne « Orbite ») : vide par défaut. */
  private trajectoryNames: ReadonlySet<string> = new Set();
  /** Le tracé, chargé à la PREMIÈRE trajectoire allumée (cf. `spacecraftTrajectories.ts`). */
  private trajectories: SpacecraftTrajectories | null = null;
  private trajectoryModule: Promise<
    typeof import('./spacecraftTrajectories')
  > | null = null;

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
    this._dirty = true;
    this.canvas.classList.toggle('is-visible', active);
    if (!active) {
      this._clear();
      // Plus rien n'est peint : plus rien n'est cliquable (cf. `markerAt`).
      this._markers.length = 0;
      this._paths = 0;
      this._publish();
    }
  }

  /** Marqueurs à ne pas peindre (colonne « Objet » du tableau Réglages). */
  setHiddenNames(names: ReadonlySet<string>): void {
    this.hidden = new Set(names);
    this._dirty = true;
  }

  /** Noms à ne pas écrire (colonne « Étiquette »), les marqueurs restent. */
  setHiddenLabelNames(names: ReadonlySet<string>): void {
    this.hiddenLabels = new Set(names);
    this._dirty = true;
  }

  /**
   * Trajectoires à tracer, sonde par sonde : la colonne « Orbite » du tableau Réglages. Le
   * module du tracé ne se charge qu'à la première allumée, et ses octets d'éphémérides aussi.
   */
  setTrajectoryNames(names: ReadonlySet<string>): void {
    const own = new Set(
      [...names].filter((n) => this.missions.some((m) => m.name === n))
    );
    this.trajectoryNames = own;
    this._dirty = true;
    this.trajectories?.setNames(own);
    if (own.size > 0)
      this.trajectoryModule ??= import('./spacecraftTrajectories');
  }

  /** Le tracé, créé quand son module est arrivé et que le service est connu. */
  private _trajectoriesFor(
    horizons: HorizonsEphemerisService
  ): SpacecraftTrajectories | null {
    if (this.trajectories || !this.trajectoryModule) return this.trajectories;
    void this.trajectoryModule.then((module) => {
      if (this.trajectories) return;
      this.trajectories = new module.SpacecraftTrajectories(
        horizons,
        this.missions
      );
      this.trajectories.setNames(this.trajectoryNames);
    });
    return null;
  }

  /**
   * Objet sélectionné par la commande de navigation partagée. Il est toujours peint et nommé :
   * les sondes sont masquées au premier chargement (cf. `defaultDisplay.ts`), et choisir Juno
   * dans la palette ne doit pas ouvrir une vue sur un point que rien ne dessine.
   */
  setTarget(name: string | null): void {
    if (this.target !== name) this._dirty = true;
    this.target = name;
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
   * leur position Explo pendant que les planètes glissaient encore. `place` est le placeur
   * partagé avec les ancres caméra : une sonde en orbite autour d'un corps s'y pose comme une
   * lune en Éducatif (cf. `core/instrumentPlacement.ts`), et l'ancre regarde le même point.
   */
  update(
    camera: THREE.PerspectiveCamera,
    date: Date,
    horizons: HorizonsEphemerisService,
    place: InstrumentPlacer,
    morph = 1,
    space: LabelSpace | null = null
  ): void {
    if (!this.active || !this.ctx || this.missions.length === 0) return;

    const w = window.innerWidth;
    const h = window.innerHeight;
    const locale = getLocale();
    const trajectories = this._trajectoriesFor(horizons);
    const drawingPaths = trajectories !== null && this.trajectoryNames.size > 0;

    // 1. Où chaque marqueur tombe à l'écran, sans rien peindre.
    const found: { mission: SpacecraftMission; x: number; y: number }[] = [];
    for (const mission of this.missions) {
      const isTarget = mission.name === this.target;
      if (!isTarget && this.hidden.has(mission.name)) continue;
      const posAU = horizons.getHeliocentricAU(mission.name, date);
      if (!posAU) continue; // avant le lancement, ou au-delà de la solution de trajectoire

      place(this._p, mission.name, posAU, date, morph);
      // Derrière un corps (une sonde en orbite passe derrière sa planète) : rien à peindre.
      if (this._occlusion?.hides(this._p.x, this._p.y, this._p.z)) continue;
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
      found.push({
        mission,
        x: (this._p.x * 0.5 + 0.5) * w,
        y: (-this._p.y * 0.5 + 0.5) * h,
      });
    }

    // Les libellés des couches précédentes font partie de la vue : s'ils bougent, la place
    // disponible change. Lue AVANT que cette couche n'y déclare quoi que ce soit.
    const spaceSignature = space?.signature() ?? 0;
    if (
      !drawingPaths &&
      !this._dirty &&
      this._paintedLocale === locale &&
      this._paintedWidth === w &&
      this._paintedHeight === h &&
      this._paintedSpace === spaceSignature &&
      found.length === this._painted.length &&
      found.every((f, k) => {
        const before = this._painted[k]!;
        return (
          before.name === f.mission.name &&
          Math.abs(before.x - f.x) < 0.25 &&
          Math.abs(before.y - f.y) < 0.25
        );
      })
    ) {
      // Les couches suivantes comptent sur ces emprises pour leurs propres noms.
      for (const rect of this._claimed) space?.add(rect);
      return;
    }
    this._dirty = false;
    this._paintedLocale = locale;
    this._paintedWidth = w;
    this._paintedHeight = h;
    this._paintedSpace = spaceSignature;
    this._painted = found.map((f) => ({
      name: f.mission.name,
      x: f.x,
      y: f.y,
    }));
    this._claimed = [];
    const claim = (rect: LabelRect): void => {
      this._claimed.push(rect);
      space?.add(rect);
    };

    // 2. Peindre. Sous les marqueurs : une ligne ne masque jamais le point qu'elle relie.
    this._clear();
    this._markers.length = 0;
    this._paths = drawingPaths
      ? trajectories.draw(this.ctx, camera, date, morph, place, w, h)
      : 0;

    for (const { mission, x, y } of found) {
      const isTarget = mission.name === this.target;
      const color = `#${mission.color.toString(16).padStart(6, '0')}`;

      this.ctx.fillStyle = color;
      this.ctx.beginPath();
      this.ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      this.ctx.fill();
      this._markers.push({ name: mission.name, x, y });

      if (!isTarget && this.hiddenLabels.has(mission.name)) continue;
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
      claim({ left: x - 4, right: x + 4, top: y - 4, bottom: y + 4 });
      if (!placed) continue;
      if (placed.rect) claim(placed.rect);
      this.ctx.fillStyle = 'rgba(225, 238, 255, 0.9)';
      this.ctx.fillText(text, x + placed.dx - textWidth / 2, y + placed.dy + 4);
    }
    this._publish();
  }

  /**
   * `data-markers` : nombre de marqueurs peints à la dernière image, la seule trace DOM de ce
   * que la couche a dessiné (même contrat que `interstellarOverlay`). Écrit seulement quand il
   * change : un attribut réécrit à chaque image serait une mutation DOM par image.
   */
  private _publish(): void {
    const value = String(this._markers.length);
    if (this.canvas.dataset['markers'] !== value)
      this.canvas.dataset['markers'] = value;
    // `data-paths` : trajectoires RÉELLEMENT tracées à la dernière image (même contrat que
    // `interstellarOverlay`), 0 par défaut puisqu'elles sont en option.
    const paths = String(this._paths);
    if (this.canvas.dataset['paths'] !== paths)
      this.canvas.dataset['paths'] = paths;
  }

  private _paths = 0;

  private _clear(): void {
    this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private readonly _resize = (): void => {
    this._dirty = true; // redimensionner un canvas le vide
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
