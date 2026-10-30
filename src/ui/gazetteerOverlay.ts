import * as THREE from 'three';

import {
  MARKER_LABEL_HEIGHT,
  markerLabelCandidates,
  overlayLabelBounds,
} from '@/core/labelSpace';
import type { LabelSpace } from '@/core/labelSpace';
import {
  quantizeViewKey,
  ROTATION_QUANTUM,
  SIGNATURE_QUANTUM,
} from '@/core/viewKey';
import type { ScreenOcclusion } from '@/core/screenOcclusion';
import {
  featuresToLabel,
  iauLongitudeToSceneLongitude,
  MAX_FEATURE_LABELS,
  type NamedFeature,
} from '@/core/gazetteer';
import {
  earthNameIn,
  earthNamesToLabel,
  metresPerPixelAt,
  webMapZoom,
  type EarthName,
} from '@/core/earthNames';
import { diameterFromWebZoom } from '@/core/placeDive';
import { getLocale } from '@/i18n';
import { GAZETTEER_LOAD_RADII } from '@/core/layerDistances';
import Logger from '@/utils/Logger';
import type CelestialObject from '@/components/celestial/CelestialObject';

/**
 * LES NOMS DE LA SURFACE, ÉCRITS SUR LA SURFACE.
 *
 * Trente-six corps du catalogue portent des formations nommées par l'UAI (le compte se lit dans
 * `config/gazetteerIndex.json`), dont 9 087 pour la seule Lune. Rien de tout cela n'est demandé
 * au démarrage : le fichier d'un corps
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
 *
 * LA TERRE (lot 53), que l'UAI ne nomme pas, a ses noms de Natural Earth
 * (`/assets/earth-names/earth.json`) : même canevas, même placement, même évitement, mais la
 * règle de sélection de SA source, le niveau de zoom publié pour chaque nom (`core/earthNames.ts`),
 * et le nom dans la langue de l'interface.
 */

/**
 * Un nom écrit à l'image courante, avec de quoi y plonger : son rectangle à l'écran, son point de
 * surface et la taille qu'on lui connaît (km), publiée par l'UAI ou déduite du niveau de zoom
 * d'apparition d'un nom de la Terre.
 */
export interface DrawnPlace {
  readonly body: string;
  readonly name: string;
  readonly lat: number;
  /** Longitude EST de la source (0 à 360 pour l'UAI, −180 à 180 pour la Terre). */
  readonly lon: number;
  readonly diameterKm: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export class GazetteerOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly cache = new Map<string, NamedFeature[]>();
  private earthNames: EarthName[] | null = null;
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
  constructor(
    private readonly radiiKm: ReadonlyMap<string, number>,
    /** Le corps qui porte les noms de Natural Earth, et son rayon publié. */
    private readonly earth: { name: string; radiusKm: number } | null = null
  ) {
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
    this._drawnKey = [];
    if (!active) this._clear();
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Combien de noms la dernière image a écrits — lu par l'e2e, jamais par le produit. */
  private lastDrawn = 0;
  /** Les noms de la dernière image : c'est eux qu'un clic peut viser. */
  private drawnPlaces: DrawnPlace[] = [];
  /** Ce qui a décidé la dernière image : identique, le canvas déjà peint reste juste. */
  private _drawnKey: number[] = [];
  private _drawnTarget: string | null = null;
  private _drawnLocale = '';

  /**
   * Le nom sous un clic, s'il y en a un (marge de 6 px autour du texte, un doigt n'est pas un
   * pixel). Le plus proche du centre du texte gagne quand deux rectangles se recouvrent.
   */
  placeAt(px: number, py: number): DrawnPlace | null {
    const slop = 6;
    let best: DrawnPlace | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const p of this.drawnPlaces) {
      if (
        px < p.x - slop ||
        px > p.x + p.width + slop ||
        py < p.y - slop ||
        py > p.y + p.height + slop
      )
        continue;
      const d = Math.hypot(px - (p.x + p.width / 2), py - (p.y + p.height / 2));
      if (d < bestDistance) {
        best = p;
        bestDistance = d;
      }
    }
    return best;
  }

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
    const isEarth = body === this.earth?.name;
    void fetch(
      isEarth
        ? '/assets/earth-names/earth.json'
        : `/assets/gazetteer/${body}.json`
    )
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<NamedFeature[] | EarthName[]>;
      })
      .then((list) => {
        if (isEarth) {
          this.earthNames = list as EarthName[];
          this.cache.set(body, []);
        } else this.cache.set(body, list as NamedFeature[]);
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
    space: LabelSpace | null,
    /**
     * Les AUTRES corps entre la caméra et un nom le cachent (lot 53) : la Lune devant la Terre
     * laissait écrire « Rio de Janeiro » par-dessus elle. Même occultation que les autres
     * couches 2D (`core/screenOcclusion.ts`, ligne 45.8), la cible exclue : sa propre face
     * cachée est déjà écartée plus bas.
     */
    occlusion: ScreenOcclusion | null = null
  ): void {
    // Le compte PUBLIÉ se remet à zéro AVANT les sorties anticipées, pas seulement à la fin :
    // sinon il garde la valeur de la dernière image qui a dessiné, et la couche annonce encore
    // cinq noms alors qu'on s'est éloigné et qu'elle ne peint plus rien. C'est un témoin
    // d'e2e, donc un témoin qui ment est pire que pas de témoin du tout.
    if (!this.ctx || !this.active) {
      this._resetWitnesses();
      return;
    }
    if (!target || !targetName) {
      this._repaintFromScratch();
      return;
    }
    const isEarth = targetName === this.earth?.name;
    const radiusKm = isEarth
      ? this.earth!.radiusKm
      : (this.radiiKm.get(targetName) ?? 0);
    if (radiusKm <= 0) {
      this._repaintFromScratch();
      return;
    }

    const sceneRadius =
      (target.group.userData['radius'] as number | undefined) ?? 0;
    if (sceneRadius <= 0) {
      this._repaintFromScratch();
      return;
    }
    target.group.getWorldPosition(this._centre);
    camera.getWorldPosition(this._camera);
    const apparentRadii = this._camera.distanceTo(this._centre) / sceneRadius;
    if (apparentRadii > GAZETTEER_LOAD_RADII) {
      this._repaintFromScratch();
      return;
    }

    const features = this._ensure(targetName);
    if (!features) {
      this._repaintFromScratch();
      return;
    }

    const w = window.innerWidth;
    const h = window.innerHeight;
    // Rien n'a changé depuis la dernière image : le canvas déjà peint, les témoins et les noms
    // cliquables restent justes. Vider et repeindre un canvas plein écran coûte surtout du travail
    // natif du navigateur (mesuré le 2026-10-29, `earth-explo`, frein CPU x12, palier medium :
    // ~9 ms par image avec cette couche). Les valeurs sont arrondies à 1e-6 pour ignorer le bruit
    // flottant ; l'orientation de la cible y est, parce qu'un nom suit la rotation de sa surface.
    const locale = getLocale();
    // La caméra est lue RELATIVEMENT à la cible : elle la suit, la dérive commune ne change rien.
    const cam = camera.matrixWorld.elements.slice();
    const tgt = target.group.matrixWorld.elements.slice();
    for (let k = 12; k < 15; k++) {
      cam[k] = cam[k]! - tgt[k]!;
      tgt[k] = 0;
    }
    const key = [
      ...quantizeViewKey([...cam, ...camera.projectionMatrix.elements]),
      ...quantizeViewKey(tgt, ROTATION_QUANTUM),
      ...quantizeViewKey([occlusion?.signature ?? 0], SIGNATURE_QUANTUM),
      w,
      h,
      space?.signature() ?? 0,
    ];
    if (
      this._drawnTarget === targetName &&
      this._drawnLocale === locale &&
      key.length === this._drawnKey.length &&
      key.every((v, i) => v === this._drawnKey[i])
    )
      return;
    this._repaintFromScratch();
    this._inked = true;
    this._drawnKey = key;
    this._drawnTarget = targetName;
    this._drawnLocale = locale;
    const bounds = overlayLabelBounds(w, h);
    this.ctx.font = '11px sans-serif';

    // Une seule liste de noms à poser, quelle que soit leur source : le placement ne change pas.
    const labels: {
      lat: number;
      lon: number;
      text: string;
      diameterKm: number;
    }[] = isEarth
      ? earthNamesToLabel(
          this.earthNames ?? [],
          webMapZoom(
            metresPerPixelAt(
              (apparentRadii - 1) * radiusKm * 1000,
              camera.fov,
              h
            )
          ),
          MAX_FEATURE_LABELS
        ).map((e) => ({
          lat: e.lat,
          lon: e.lon,
          text: earthNameIn(e, locale),
          diameterKm: diameterFromWebZoom(e.minZoom),
        }))
      : featuresToLabel(features, radiusKm, apparentRadii, h, camera.fov).map(
          (f) => ({
            lat: f.lat,
            lon: f.lon,
            text: f.name,
            diameterKm: f.diameterKm,
          })
        );

    const drawnText: string[] = [];
    for (const feature of labels) {
      target.surfacePointToWorld(
        feature.lat,
        iauLongitudeToSceneLongitude(feature.lon),
        this._point
      );

      // Face cachée : un nom de l'autre côté du corps doit disparaître derrière lui.
      this._normal.subVectors(this._point, this._centre).normalize();
      this._toCamera.subVectors(this._camera, this._point).normalize();
      if (this._normal.dot(this._toCamera) <= 0) continue;
      if (
        occlusion?.hides(
          this._point.x,
          this._point.y,
          this._point.z,
          targetName
        )
      )
        continue;

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
      const textWidth = this.ctx.measureText(feature.text).width;
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
        feature.text,
        x + placed.dx - textWidth / 2,
        y + placed.dy + 4
      );
      this.lastDrawn += 1;
      drawnText.push(feature.text);
      this.drawnPlaces.push({
        body: targetName,
        name: feature.text,
        lat: feature.lat,
        lon: feature.lon,
        diameterKm: feature.diameterKm,
        x: x + placed.dx - textWidth / 2,
        y: y + placed.dy - MARKER_LABEL_HEIGHT / 2,
        width: textWidth,
        height: MARKER_LABEL_HEIGHT,
      });
    }

    this.canvas.dataset['names'] = String(this.lastDrawn);
    // Les noms ÉCRITS, au plus `MAX_FEATURE_LABELS` : un canevas ne se lit pas, et c'est le seul
    // moyen pour l'e2e de vérifier la LANGUE d'un nom de la Terre.
    this.canvas.dataset['drawn'] = drawnText.join('|');
    // Où chacun est écrit (centre du texte, px CSS) : un canevas ne se clique pas à l'aveugle, et
    // l'e2e de la plongée en a besoin pour viser un nom qui existe vraiment à cette image.
    this.canvas.dataset['places'] = this.drawnPlaces
      .map(
        (p) =>
          `${p.name}@${Math.round(p.x + p.width / 2)},${Math.round(p.y + p.height / 2)}`
      )
      .join('|');
  }

  dispose(): void {
    window.removeEventListener('resize', this._resize);
    this.canvas.remove();
  }

  /** Les témoins lus par l'e2e et par `placeAt` : à zéro, et la prochaine image repeint. */
  private _resetWitnesses(): void {
    this.lastDrawn = 0;
    this.drawnPlaces = [];
    this._drawnKey = [];
    this.canvas.dataset['names'] = '0';
    this.canvas.dataset['drawn'] = '';
    this.canvas.dataset['places'] = '';
  }

  /** Le canvas porte-t-il de l'encre ? Sinon le vider chaque image n'est que du travail natif. */
  private _inked = false;

  private _repaintFromScratch(): void {
    this._resetWitnesses();
    if (!this._inked) return;
    this._inked = false;
    this._clear();
  }

  private _clear(): void {
    this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private readonly _resize = (): void => {
    this._drawnKey = []; // redimensionner un canvas le vide
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(window.innerWidth * dpr);
    this.canvas.height = Math.round(window.innerHeight * dpr);
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
}
