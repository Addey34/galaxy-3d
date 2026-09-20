/**
 * Couche instrument 2D des ÉVÉNEMENTS TERRESTRES — séismes USGS et événements rapportés EONET.
 *
 * Même famille que `smallBodyOverlay` et `spacecraftOverlay`, et pour la même raison : à vraie
 * échelle, un épicentre n'a aucune taille. Lui en donner une — un mesh, un sprite, une sphère
 * plancher — violerait l'invariant Explo. Un marqueur d'instrument, lui, est assumé comme tel :
 * il dit « ici », il ne prétend pas être un objet.
 *
 * LE POINT QUI SE PAIE SI ON LE RATE : un marqueur doit tomber sur sa VRAIE longitude, donc
 * derrière la phase de rotation de surface de la Terre — la seule grandeur que le moteur
 * recalcule à chaque image (`OrbitalMechanics.syncEarthSurfaceRotation`). D'où le passage par
 * `CelestialObject.surfacePointToWorld`, qui compose la translation du corps, le quaternion du
 * vrai pôle IAU et cette phase. Recalculer la position à partir du rayon et de l'axe donnerait
 * une phase indépendante de celle qui est RENDUE : les épicentres glisseraient par rapport aux
 * continents sans jamais déformer quoi que ce soit, donc sans se voir sur une capture isolée.
 * `e2e/earthEvents.spec.ts` mesure cette phase contre des coordonnées publiées.
 *
 * ZOOM SÉMANTIQUE : chaque couche déclare le rayon apparent minimal de la Terre sous lequel
 * elle ne peint rien (`EarthEventLayer.minEarthRadiusPx`). Vue depuis Saturne, la Terre fait
 * moins d'un pixel ; y empiler des centaines de marqueurs masquerait la planète pour ne rien
 * dire. La face cachée est écartée de la même façon, par le signe du produit scalaire.
 */
import * as THREE from 'three';
import {
  MARKER_LABEL_HEIGHT,
  markerLabelCandidates,
  overlayLabelBounds,
} from '@/core/labelSpace';
import type { LabelSpace } from '@/core/labelSpace';
import {
  topEvents,
  type EarthEvent,
  type EarthEventLayer,
  type EarthEventLayerId,
} from '@/core/earthEvents';
import type CelestialObject from '@/components/celestial/CelestialObject';

/** Rayon du marqueur (px) : du plus léger au plus lourd. Taille ÉCRAN, jamais une taille scène. */
const MARKER_MIN_RADIUS_PX = 2;
const MARKER_MAX_RADIUS_PX = 7;

/** Nombre de noms écrits par couche : au-delà, les marqueurs restent seuls et lisibles. */
const MAX_LABELS_PER_LAYER = 6;

export class EarthEventsOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly layers: readonly EarthEventLayer[];
  private readonly events = new Map<EarthEventLayerId, EarthEvent[]>();
  private readonly visible = new Set<EarthEventLayerId>();
  private active = false;
  private readonly _point = new THREE.Vector3();
  private readonly _earth = new THREE.Vector3();
  private readonly _camera = new THREE.Vector3();
  private readonly _normal = new THREE.Vector3();
  private readonly _toCamera = new THREE.Vector3();

  constructor(layers: readonly EarthEventLayer[]) {
    this.layers = [...layers].sort((a, b) => a.priority - b.priority);
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'earth-events-overlay';
    this.ctx = this.canvas.getContext('2d');
  }

  mount(parent: HTMLElement = document.body): void {
    parent.append(this.canvas);
    this._resize();
    window.addEventListener('resize', this._resize, { passive: true });
  }

  /**
   * Remplace le lot d'une couche (appelé quand un chargement aboutit).
   *
   * Le tri par poids est fait ICI, une fois par lot, et non à chaque image : `topEvents`
   * alloue une copie triée, ce qui à 160 marqueurs et 60 images par seconde serait du déchet
   * produit en pure perte dans la boucle de rendu.
   */
  setEvents(layerId: EarthEventLayerId, events: EarthEvent[]): void {
    const layer = this.layers.find((l) => l.id === layerId);
    this.events.set(
      layerId,
      topEvents(events, layer?.maxMarkers ?? events.length)
    );
  }

  /** Allume ou éteint une couche. Le canvas reste monté ; seul ce qu'il peint change. */
  setLayerVisible(layerId: EarthEventLayerId, visible: boolean): void {
    if (visible) this.visible.add(layerId);
    else this.visible.delete(layerId);
    this.active = this.visible.size > 0;
    this.canvas.classList.toggle('is-visible', this.active);
    if (!this.active) this._clear();
  }

  /**
   * À appeler chaque frame. `earth` est le corps RENDU : c'est lui qui porte la phase de
   * rotation à laquelle les marqueurs doivent obéir. Absent (catalogue partiel, contexte
   * WebGL perdu) : rien n'est peint, sans erreur.
   */
  update(
    camera: THREE.PerspectiveCamera,
    earth: CelestialObject | null,
    space: LabelSpace | null = null
  ): void {
    if (!this.active || !this.ctx || !earth) return;

    const w = window.innerWidth;
    const h = window.innerHeight;
    this._clear();

    earth.group.getWorldPosition(this._earth);
    camera.getWorldPosition(this._camera);
    const distance = this._camera.distanceTo(this._earth);
    const sceneRadius = Number(earth.group.userData['radius']);
    if (!Number.isFinite(sceneRadius) || sceneRadius <= 0 || distance <= 0)
      return;

    // Rayon apparent en pixels. `asin` et non `atan` : ce qu'on voit est le limbe TANGENT,
    // pas le grand cercle, et la différence cesse d'être négligeable de près. L'angle est
    // ensuite projeté par sa tangente, comme le fait la caméra, et non proportionnellement
    // au champ. Le résultat sert de SEUIL (« la Terre est-elle assez grande pour qu'un point
    // veuille dire un lieu ? »), pas de mesure publiée : l'approximation qui reste, valable
    // sur l'axe optique, n'a pas d'incidence sur cette décision. Le rapport est borné sous 1 :
    // caméra posée sur la surface, `asin` rendrait un angle droit et la tangente l'infini.
    const halfFov = THREE.MathUtils.degToRad(camera.fov) / 2;
    const earthRadiusPx =
      (Math.tan(Math.asin(Math.min(sceneRadius / distance, 0.9999))) /
        Math.tan(halfFov)) *
      (h / 2);

    const bounds = overlayLabelBounds(w, h);
    for (const layer of this.layers) {
      if (!this.visible.has(layer.id)) continue;
      if (earthRadiusPx < layer.minEarthRadiusPx) continue;
      const events = this.events.get(layer.id);
      if (!events || events.length === 0) continue;

      let labelled = 0;
      for (const event of events) {
        earth.surfacePointToWorld(
          event.latitudeDeg,
          event.longitudeDeg,
          this._point
        );

        // Face cachée : le marqueur d'un point situé de l'autre côté du globe doit
        // disparaître derrière lui, pas se peindre par-dessus.
        this._normal.subVectors(this._point, this._earth).normalize();
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
        ) {
          continue;
        }

        const x = (this._point.x * 0.5 + 0.5) * w;
        const y = (-this._point.y * 0.5 + 0.5) * h;
        const radius =
          MARKER_MIN_RADIUS_PX +
          (MARKER_MAX_RADIUS_PX - MARKER_MIN_RADIUS_PX) * event.weight;
        const color = `#${event.color.toString(16).padStart(6, '0')}`;

        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 1.4;
        this.ctx.beginPath();
        this.ctx.arc(x, y, radius, 0, Math.PI * 2);
        this.ctx.stroke();

        if (labelled >= MAX_LABELS_PER_LAYER) continue;
        this.ctx.font = '11px sans-serif';
        const textWidth = this.ctx.measureText(event.label).width;
        // Même règle que les sondes : un nom ne s'écrit que s'il trouve une place libre dans
        // la place commune à toutes les couches (cf. `core/labelSpace.ts`).
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
        // Seuls les marqueurs QUI PORTENT UN NOM réservent leur place. Déclarer les centaines
        // d'autres rendrait chaque recherche de place linéaire en leur nombre, pour protéger
        // des points de deux pixels que rien ne rend illisibles.
        space?.add({
          left: x - radius,
          right: x + radius,
          top: y - radius,
          bottom: y + radius,
        });
        if (!placed) continue;
        if (placed.rect) space?.add(placed.rect);
        this.ctx.fillStyle = 'rgba(225, 238, 255, 0.9)';
        this.ctx.fillText(
          event.label,
          x + placed.dx - textWidth / 2,
          y + placed.dy + 4
        );
        labelled++;
      }
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
