import * as THREE from 'three';

import {
  MARKER_LABEL_HEIGHT,
  markerLabelCandidates,
  overlayLabelBounds,
} from '@/core/labelSpace';
import type { LabelSpace } from '@/core/labelSpace';
import {
  featuresToLabel,
  iauLongitudeToSceneLongitude,
  type NamedFeature,
} from '@/core/gazetteer';
import Logger from '@/utils/Logger';
import type CelestialObject from '@/components/celestial/CelestialObject';

/**
 * LES NOMS DE LA SURFACE, ÉCRITS SUR LA SURFACE.
 *
 * Trente-six corps du catalogue portent des formations nommées par l'UAI — 15 932 en tout, dont
 * 9 087 pour la seule Lune. Rien de tout cela n'est demandé au démarrage : le fichier d'un corps
 * n'est chargé qu'à l'APPROCHE, comme les tuiles de surface, et pour la même raison — survoler
 * Jupiter de loin ne doit coûter aucune requête.
 *
 * Le placement passe par `CelestialObject.surfacePointToWorld`, donc par la chaîne qui oriente
 * VRAIMENT la surface à l'instant de la scène. Reconstruire la phase autrement redonnerait une
 * longitude indépendante de celle qui est RENDUE, et chaque nom se poserait à côté de sa
 * formation — la faute que `e2e/subsolar.spec.ts` décrit pour le terminateur.
 *
 * La conversion de convention (UAI en longitude est 0-360, la scène en −180..180 est) vit dans
 * `core/gazetteer.ts` avec sa garde : les deux sont EST, il n'y a donc aucun miroir à appliquer,
 * et un miroir ne déformerait rien tout en posant chaque nom à l'opposé.
 */

/** Au-delà de cette taille apparente, on ne charge rien : le corps n'occupe pas l'écran. */
export const GAZETTEER_LOAD_RADII = 8;

export class GazetteerOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly cache = new Map<string, NamedFeature[]>();
  private readonly failed = new Set<string>();
  private loading: string | null = null;
  private active = false;
  private readonly _point = new THREE.Vector3();
  private readonly _centre = new THREE.Vector3();
  private readonly _camera = new THREE.Vector3();
  private readonly _normal = new THREE.Vector3();
  private readonly _toCamera = new THREE.Vector3();

  /**
   * `radiiKm` porte les DEUX informations : un corps y est présent s'il a des formations
   * nommées, et sa valeur est le rayon publié dont dépend la taille apparente. Le rayon vient
   * du catalogue, lu une fois au montage — `CelestialObject` garde sa configuration privée, et
   * la lui arracher pour une seule grandeur serait ouvrir une porte pour rien.
   */
  constructor(private readonly radiiKm: ReadonlyMap<string, number>) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'gazetteer-overlay';
    this.ctx = this.canvas.getContext('2d');
  }

  mount(parent: HTMLElement = document.body): void {
    parent.append(this.canvas);
    this._resize();
    window.addEventListener('resize', this._resize, { passive: true });
  }

  setActive(active: boolean): void {
    this.active = active;
    this.canvas.classList.toggle('is-visible', active);
    if (!active) this._clear();
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Combien de noms la dernière image a écrits — lu par l'e2e, jamais par le produit. */
  private lastDrawn = 0;

  /**
   * Charge le répertoire d'un corps, une seule fois, et jamais deux en parallèle.
   *
   * Un échec est retenu : ce chemin tourne à chaque image, et sans cette mémoire un fichier
   * absent relancerait un `fetch` soixante fois par seconde.
   */
  private _ensure(body: string): NamedFeature[] | null {
    const cached = this.cache.get(body);
    if (cached) return cached;
    if (this.failed.has(body) || this.loading) return null;
    this.loading = body;
    // Chemin ABSOLU, et ce n'est pas un detail : le corps est porte par le CHEMIN de l'URL
    // (`/moon`), donc une adresse relative resout en `/moon/assets/gazetteer/moon.json` et rend
    // un 404 — mesure faite dans un vrai navigateur, ou la couche restait vide sans un mot.
    void fetch(`/assets/gazetteer/${body}.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<NamedFeature[]>;
      })
      .then((list) => {
        this.cache.set(body, list);
      })
      .catch((error: unknown) => {
        this.failed.add(body);
        Logger.warn(`[Gazetteer] ${body} indisponible : ${String(error)}`);
      })
      .finally(() => {
        this.loading = null;
      });
    return null;
  }

  draw(
    camera: THREE.PerspectiveCamera,
    target: CelestialObject | undefined,
    targetName: string | null,
    space: LabelSpace | null
  ): void {
    this.lastDrawn = 0;
    // Le compte PUBLIÉ se remet à zéro AVANT les sorties anticipées, pas seulement à la fin :
    // sinon il garde la valeur de la dernière image qui a dessiné, et la couche annonce encore
    // cinq noms alors qu'on s'est éloigné et qu'elle ne peint plus rien. C'est un témoin
    // d'e2e, donc un témoin qui ment est pire que pas de témoin du tout.
    this.canvas.dataset['names'] = '0';
    if (!this.ctx || !this.active) return;
    this._clear();
    if (!target || !targetName) return;
    const radiusKm = this.radiiKm.get(targetName) ?? 0;
    if (radiusKm <= 0) return;

    const sceneRadius =
      (target.group.userData['radius'] as number | undefined) ?? 0;
    if (sceneRadius <= 0) return;
    target.group.getWorldPosition(this._centre);
    camera.getWorldPosition(this._camera);
    const apparentRadii = this._camera.distanceTo(this._centre) / sceneRadius;
    if (apparentRadii > GAZETTEER_LOAD_RADII) return;

    const features = this._ensure(targetName);
    if (!features) return;

    const w = window.innerWidth;
    const h = window.innerHeight;
    const bounds = overlayLabelBounds(w, h);
    this.ctx.font = '11px sans-serif';

    for (const feature of featuresToLabel(
      features,
      radiusKm,
      apparentRadii,
      h,
      camera.fov
    )) {
      target.surfacePointToWorld(
        feature.lat,
        iauLongitudeToSceneLongitude(feature.lon),
        this._point
      );

      // Face cachée : un nom de l'autre côté du corps doit disparaître derrière lui.
      this._normal.subVectors(this._point, this._centre).normalize();
      this._toCamera.subVectors(this._camera, this._point).normalize();
      if (this._normal.dot(this._toCamera) <= 0) continue;

      this._point.project(camera);
      if (
        this._point.z < -1 ||
        this._point.z > 1 ||
        this._point.x < -1 ||
        this._point.x > 1 ||
        this._point.y < -1 ||
        this._point.y > 1
      )
        continue;

      const x = (this._point.x * 0.5 + 0.5) * w;
      const y = (-this._point.y * 0.5 + 0.5) * h;
      const textWidth = this.ctx.measureText(feature.name).width;
      const placed = space
        ? space.placeText(
            x,
            y,
            textWidth,
            MARKER_LABEL_HEIGHT,
            markerLabelCandidates(textWidth),
            bounds
          )
        : { dx: 8 + textWidth / 2, dy: 0, rect: null };
      if (!placed) continue;
      if (placed.rect) space?.add(placed.rect);

      this.ctx.fillStyle = 'rgba(180, 205, 235, 0.85)';
      this.ctx.beginPath();
      this.ctx.arc(x, y, 1.6, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.fillStyle = 'rgba(225, 238, 255, 0.92)';
      this.ctx.fillText(
        feature.name,
        x + placed.dx - textWidth / 2,
        y + placed.dy + 4
      );
      this.lastDrawn += 1;
    }

    this.canvas.dataset['names'] = String(this.lastDrawn);
  }

  dispose(): void {
    window.removeEventListener('resize', this._resize);
    this.canvas.remove();
  }

  private _clear(): void {
    this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private readonly _resize = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(window.innerWidth * dpr);
    this.canvas.height = Math.round(window.innerHeight * dpr);
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
}
